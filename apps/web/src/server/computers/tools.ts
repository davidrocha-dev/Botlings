import type { ToolDefinition } from "@/server/openrouter";
import { markSecretsUsed, redactSecrets, secretValuesForAgent } from "@/server/secrets/secrets";
import { callRunner } from "./manager";

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDefinition => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const COMPUTER_TOOLS: ToolDefinition[] = [
  tool(
    "run_command",
    "Run a bash command on your Linux computer (working directory ~/workspace). Use for git, scripts, installing packages with pip/npm, etc. Returns combined output and exit code.",
    {
      command: { type: "string", description: "Bash command to run" },
      timeout_seconds: { type: "number", description: "Max seconds (default 120, max 600)" },
    },
    ["command"],
  ),
  tool("read_file", "Read a text file. Relative paths start at ~/workspace.", { path: { type: "string" } }, ["path"]),
  tool(
    "write_file",
    "Create or overwrite a text file. Relative paths start at ~/workspace.",
    { path: { type: "string" }, content: { type: "string" } },
    ["path", "content"],
  ),
  tool("list_files", "List a folder. Relative paths start at ~/workspace.", { path: { type: "string" } }),
  tool(
    "browser_open",
    "Open a URL in your Chromium browser (the user can watch it live). Returns the page text and numbered interactive elements like [12] button Sign in.",
    { url: { type: "string", description: "Full http(s) URL" } },
    ["url"],
  ),
  tool("browser_snapshot", "Re-read the current browser page: text and numbered interactive elements.", {}),
  tool(
    "browser_click",
    "Click an interactive element by its number from the latest snapshot.",
    { ref: { type: "number" } },
    ["ref"],
  ),
  tool(
    "browser_type",
    "Type into an input by its number from the latest snapshot. Never type passwords or payment details.",
    { ref: { type: "number" }, text: { type: "string" }, submit: { type: "boolean", description: "Press Enter after typing" } },
    ["ref", "text"],
  ),
];

export const COMPUTER_TOOL_NAMES = new Set(COMPUTER_TOOLS.map((t) => t.function.name));

/** Short human-readable summary shown in the chat for each tool call. */
export function describeToolCall(name: string, args: Record<string, unknown>) {
  const s = (v: unknown) => String(v ?? "").slice(0, 160);
  switch (name) {
    case "run_command":
      return s(args.command);
    case "read_file":
    case "write_file":
    case "list_files":
      return s(args.path || "~/workspace");
    case "browser_open":
      return s(args.url);
    case "browser_click":
      return `[${s(args.ref)}]`;
    case "browser_type":
      return `[${s(args.ref)}] ${s(args.text).slice(0, 60)}`;
    default:
      return "";
  }
}

type Snapshot = { url: string; title: string; elements: string; text: string };
const formatSnapshot = (p: Snapshot) =>
  `URL: ${p.url}\nTitle: ${p.title}\n\nInteractive elements:\n${p.elements || "(none)"}\n\nPage text:\n${p.text}`;

/**
 * Executes a computer tool and returns the text result for the model. The agent's secrets are
 * injected as environment variables into commands, and their values are redacted from every result.
 */
export async function executeComputerTool(agentId: string, name: string, args: Record<string, unknown>): Promise<string> {
  const secrets = await secretValuesForAgent(agentId);
  if (name === "run_command" && secrets.length) {
    const command = String(args.command ?? "");
    const used = secrets.filter((s) => new RegExp("\\$\\{?" + s.name + "\\b").test(command));
    await markSecretsUsed(used.map((s) => s.id));
  }
  const result = await runTool(agentId, name, args, Object.fromEntries(secrets.map((s) => [s.name, s.value])));
  return secrets.length ? redactSecrets(result, secrets) : result;
}

async function runTool(agentId: string, name: string, args: Record<string, unknown>, secretEnv: Record<string, string>): Promise<string> {
  switch (name) {
    case "run_command": {
      const timeoutMs = Math.min(Number(args.timeout_seconds ?? 120), 600) * 1000;
      const r = await callRunner<{ exitCode: number | null; timedOut: boolean; output: string }>(
        agentId,
        "/exec",
        { command: args.command, timeoutMs, env: secretEnv },
        timeoutMs + 15_000,
      );
      return `exit code: ${r.exitCode}${r.timedOut ? " (timed out)" : ""}\n${r.output || "(no output)"}`;
    }
    case "read_file": {
      const r = await callRunner<{ path: string; content: string }>(agentId, "/files/read", { path: args.path });
      return `${r.path}:\n${r.content}`;
    }
    case "write_file": {
      const r = await callRunner<{ path: string; bytes: number }>(agentId, "/files/write", { path: args.path, content: args.content });
      return `Wrote ${r.bytes} bytes to ${r.path}`;
    }
    case "list_files": {
      const r = await callRunner<{ path: string; entries: string[] }>(agentId, "/files/list", { path: args.path });
      return `${r.path}:\n${r.entries.join("\n") || "(empty)"}`;
    }
    case "browser_open":
      return formatSnapshot(await callRunner<Snapshot>(agentId, "/browser/open", { url: args.url }));
    case "browser_snapshot":
      return formatSnapshot(await callRunner<Snapshot>(agentId, "/browser/snapshot", {}));
    case "browser_click":
      return formatSnapshot(await callRunner<Snapshot>(agentId, "/browser/click", { ref: args.ref }));
    case "browser_type":
      return formatSnapshot(
        await callRunner<Snapshot>(agentId, "/browser/type", { ref: args.ref, text: args.text, submit: args.submit === true }),
      );
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
