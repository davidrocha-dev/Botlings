import { and, asc, desc, eq, gt, ne } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getAgentDto } from "@/server/data";
import { env } from "@/server/env";
import {
  OpenRouterError,
  findModel,
  streamChat,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition,
  type Usage,
} from "@/server/openrouter";
import { callRunner, dockerAvailable, getComputer } from "@/server/computers/manager";
import { isAlwaysAllowed, requestApproval } from "@/server/approvals/approvals";
import { classifyAction, type ElementInfo } from "@/server/approvals/classify";
import { secretNamesForAgent } from "@/server/secrets/secrets";
import { BudgetExceededError, assertWithinBudget } from "@/server/usage/usage";
import { COMPUTER_TOOLS, COMPUTER_TOOL_NAMES, describeToolCall, executeComputerTool } from "@/server/computers/tools";
import { MEMORY_TOOLS, MEMORY_TOOL_NAMES, executeMemoryTool, listMemories, memorySection, updateConversationSummary, type MemoryRow } from "./memory";
import { PROPOSAL_GUIDE, PROPOSE_INSTRUCTIONS_TOOL, createProposal } from "./proposals";
import { isStopped } from "./generations";
import { saveMessage } from "./save-message";
import { SUGGEST_ROUTINE_TOOL, suggestRoutine } from "@/server/routines/suggest";
import type { ChatStreamEvent } from "@/lib/types";

export { saveMessage };

export type AgentRow = typeof schema.agents.$inferSelect;
export type Emit = (event: ChatStreamEvent) => void;
type TeamMember = { name: string; role: string };

/**
 * - chat: answering the user.
 * - delegated: working on a task the orchestrator delegated (no delegation, no model changes).
 * - summary: the orchestrator reporting finished delegated tasks back to the user.
 * - routine: a scheduled routine running without the user present.
 */
export type TurnMode = "chat" | "delegated" | "summary" | "routine";

export type TurnConversation = {
  id: string;
  type: "direct" | "group";
  /** Names by agent id, for labelling other agents' messages in the history. */
  names: Map<string, string>;
};

export type TurnOptions = {
  agent: AgentRow;
  conversation: TurnConversation;
  emit: Emit;
  signal: AbortSignal;
  mode: TurnMode;
  /** The user's message in chat mode; required for the set_model guard. */
  userText?: string;
  /** Extra context appended after the history for this turn only (not persisted). */
  extraMessages?: ChatMessage[];
  /** Orchestrator in chat mode only: handles delegate_task calls. */
  onDelegate?: (args: { agentName: string; instruction: string }) => Promise<string>;
  /** Name of the agent that delegated the work (delegated mode). */
  delegatedBy?: string;
  /** Aborts the turn once its cost exceeds this amount. */
  costLimitUsd?: number;
  /** Name of the routine being run (routine mode). */
  routineName?: string;
};

/** `content`: everything the agent wrote this turn (progress notes included); `finalContent`: only its last message. */
export type TurnResult = { content: string; finalContent: string; costUsd: number; error?: string };

export class CostLimitError extends Error {
  constructor(limit: number) {
    super(`Cost limit reached ($${limit.toFixed(2)})`);
  }
}

const HISTORY_LIMIT = 40;
const MAX_TOOL_ROUNDS = 15;

const SET_MODEL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "set_model",
    description:
      "Switch the AI model you run on. ONLY call this when the user explicitly asks you to change or use a different model in their latest message. Never call it on your own initiative, not even after errors.",
    parameters: {
      type: "object",
      properties: {
        model_id: { type: "string", description: "Exact OpenRouter model ID, e.g. google/gemma-4-31b-it:free" },
      },
      required: ["model_id"],
    },
  },
};

function delegateTool(teamNames: string[]): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "delegate_task",
      description:
        "Delegate work to another Botling in your crew. It works in its own chat with its own computer, and its result comes back to you automatically when it finishes (do not wait or poll). Only use this when that Botling is clearly better suited than you.",
      parameters: {
        type: "object",
        properties: {
          agent_name: { type: "string", enum: teamNames, description: "Name of the Botling to delegate to" },
          instruction: {
            type: "string",
            description: "Complete, self-contained instructions: goal, relevant details from the conversation, expected result.",
          },
        },
        required: ["agent_name", "instruction"],
      },
    },
  };
}

/** The user must actually be talking about models for a switch to be accepted. */
function userAskedForModelChange(text: string, modelId: string) {
  const lower = text.toLowerCase();
  const slug = modelId.toLowerCase().split("/").pop()?.split(":")[0] ?? "";
  return /\bmodel|\bmodelo/.test(lower) || (slug.length > 3 && lower.includes(slug));
}

/** The orchestrator's current crew: every other agent of the same owner, fetched fresh per turn. */
async function loadTeam(agent: AgentRow): Promise<TeamMember[]> {
  if (!agent.isOrchestrator) return [];
  return db
    .select({ name: schema.agents.name, role: schema.agents.role })
    .from(schema.agents)
    .where(and(eq(schema.agents.ownerId, agent.ownerId), ne(schema.agents.id, agent.id)))
    .orderBy(asc(schema.agents.createdAt));
}

function teamSection(team: TeamMember[]) {
  if (!team.length) return "Your crew: you are currently the only Botling. The user can create more.";
  return [
    "Your crew (the other Botlings you coordinate, as of this message):",
    ...team.map((m) => `- ${m.name}: ${m.role.trim() || "(no role description)"}`),
  ].join("\n");
}

const DELEGATION_GUIDE =
  "Delegation: handle simple things yourself (questions, quick answers, small tasks you can do well). Use delegate_task only when a crew member is clearly better suited for the work, e.g. it matches their role or needs their computer. When you delegate, tell the user briefly who is working on it; the result will come back to you and you will then summarise it.";

const SAFETY_GUIDE =
  "Risky actions on your computer (purchases, sending or publishing, deleting, pushing code, accepting terms…) automatically pause for the user's approval; just attempt them normally when the task requires it. If an action is denied, do not retry it or find a workaround — tell the user. You can never type passwords, codes or card details: ask the user to take control of the screen for those steps.";

function systemPrompt(opts: {
  agent: AgentRow;
  mode: TurnMode;
  conversationType: "direct" | "group";
  memberNames: string[];
  hasComputer: boolean;
  secrets: { name: string; description: string }[];
  team: TeamMember[];
  canDelegate: boolean;
  canPropose: boolean;
  canRemember: boolean;
  memories: MemoryRow[];
  conversationSummary: string;
  delegatedBy?: string;
  routineName?: string;
  canSuggestRoutine: boolean;
}) {
  const { agent, mode } = opts;
  return [
    `You are ${agent.name}, a Botling — an AI agent in the user's personal crew.`,
    agent.role && `Your role: ${agent.role}`,
    agent.prompt &&
      (opts.canPropose
        ? `Your saved instructions from the user (the only text propose_instructions_update may change), between the markers:\n<<<INSTRUCTIONS\n${agent.prompt}\nINSTRUCTIONS>>>`
        : `Instructions from the user:\n${agent.prompt}`),
    agent.isOrchestrator && teamSection(opts.team),
    opts.canDelegate && DELEGATION_GUIDE,
    opts.canPropose && !agent.prompt.trim() && "Your saved instructions are currently empty.",
    opts.canPropose && PROPOSAL_GUIDE,
    opts.canRemember
      ? memorySection(opts.memories)
      : opts.memories.length > 0 && ["What you remember:", ...opts.memories.map((m) => `- ${m.content}`)].join("\n"),
    opts.conversationSummary && `Summary of earlier parts of this conversation (older messages are not shown):
${opts.conversationSummary}`,
    mode === "delegated" &&
      `You are working on a task delegated to you by ${opts.delegatedBy ?? "the orchestrator"} (the message prefixed with their name). Do the work with your tools, then reply with a concise report of what you did and the result. You cannot delegate work to others.`,
    mode === "routine" &&
      `The scheduled routine "${opts.routineName ?? ""}" is running now (details in the last message). The user is probably not watching: do the work with your tools, then post a short report of the results. Approvals, if needed, will wait for the user.`,
    opts.canSuggestRoutine &&
      "Routines: when the user asks for something to happen regularly (every morning, every Monday…), use suggest_routine; it is only enabled after the user confirms.",
    mode === "summary" &&
      "Delegated tasks you started have finished (details below). Give the user a short, clear summary of the results and anything that still needs their attention. Do not delegate again.",
    opts.conversationType === "group" &&
      `You are in a group chat with the user and these Botlings: ${opts.memberNames.join(", ")}. Messages from other Botlings are prefixed with their name in brackets. Only speak for yourself.`,
    opts.hasComputer &&
      "You have your own Linux computer with a terminal, files (~/workspace) and a Chromium browser the user can watch live. Use your tools to actually do tasks instead of describing them. Briefly tell the user what you are about to do, then do it. Never enter passwords or payment details; ask the user to take control of the screen for logins.",
    opts.hasComputer && SAFETY_GUIDE,
    opts.hasComputer &&
      opts.secrets.length > 0 &&
      [
        "Secrets you can use: they are set as environment variables in every run_command (e.g. \"$NAME\"). You never see their values and must never print, echo, save or send them anywhere except the service they are meant for.",
        ...opts.secrets.map((s) => `- $${s.name}${s.description ? `: ${s.description}` : ""}`),
      ].join("\n"),
    `You currently run on the model "${agent.model}". Never change model unless the user explicitly asks.`,
    "Reply in the same language the user writes in. Be concise and natural, like a chat message. Use Markdown sparingly.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function buildHistory(conversationId: string, agent: AgentRow, names: Map<string, string>, since: Date | null) {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.kind, "text"),
        since ? gt(schema.messages.createdAt, since) : undefined,
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(HISTORY_LIMIT);

  return rows.reverse().map<ChatMessage>((m) => {
    if (m.authorType === "user") return { role: "user", content: m.content };
    if (m.agentId === agent.id) return { role: "assistant", content: m.content };
    return { role: "user", content: `[${names.get(m.agentId ?? "") ?? "Botling"}]: ${m.content}` };
  });
}


export async function changeModel(agent: AgentRow, conversationId: string, modelId: string, emit: Emit) {
  const model = await findModel(modelId);
  if (!model) return { ok: false as const, reason: `Model "${modelId}" does not exist on OpenRouter.` };

  const fromModel = agent.model;
  const [updated] = await db.update(schema.agents).set({ model: model.id }).where(eq(schema.agents.id, agent.id)).returning();
  agent.model = updated.model;

  emit({
    type: "message",
    message: await saveMessage({
      conversationId,
      authorType: "agent",
      agentId: agent.id,
      kind: "event",
      content: `${fromModel} → ${model.id}`,
      metadata: { fromModel, toModel: model.id },
    }),
  });
  emit({ type: "agent", agent: await getAgentDto(updated) });
  return { ok: true as const, model };
}

/**
 * Server-side gate for computer actions: blocks credentials entry outright and pauses sensitive
 * actions until the user approves them (unless an "always allow" rule exists for the agent).
 */
async function gateComputerAction(opts: {
  agent: AgentRow;
  conversationId: string;
  tool: string;
  args: Record<string, unknown>;
  emit: Emit;
  signal: AbortSignal;
}): Promise<{ allowed: true } | { allowed: false; result: string }> {
  const { agent, tool, args } = opts;
  let element: ElementInfo | null = null;
  if (tool === "browser_click" || tool === "browser_type") {
    element = await callRunner<ElementInfo>(agent.id, "/browser/describe", { ref: args.ref }, 30_000).catch(() => null);
  }

  const verdict = classifyAction({ tool, args, autonomy: agent.autonomy, element });
  if (verdict.decision === "allow") return { allowed: true };
  if (verdict.decision === "block") {
    return { allowed: false, result: `Blocked: ${verdict.reason} Ask the user to do this step themselves (they can take control of the screen).` };
  }
  if (await isAlwaysAllowed(agent.id, verdict.category)) return { allowed: true };

  const status = await requestApproval({
    ownerId: agent.ownerId,
    agentId: agent.id,
    conversationId: opts.conversationId,
    tool,
    category: verdict.category,
    detail: verdict.detail,
    emit: opts.emit,
    signal: opts.signal,
  });
  if (status === "approved") return { allowed: true };
  return {
    allowed: false,
    result:
      status === "denied"
        ? "The user denied this action. Do not retry it or work around it; tell the user and ask how they want to proceed."
        : "No decision was made in time, so the action was not performed. Tell the user it is waiting for their approval.",
  };
}

/** Appends the turn's spend to the usage ledger (survives agent and chat deletion). */
async function recordUsage(agent: AgentRow, model: string, usage: Usage) {
  const cost = usage.cost ?? 0;
  if (!cost && !usage.prompt_tokens && !usage.completion_tokens) return;
  await db.insert(schema.usageLedger).values({
    ownerId: agent.ownerId,
    agentId: agent.id,
    agentName: agent.name,
    model,
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    costUsd: cost,
  });
}

/** Runs one agent turn: prompt + tools + streaming, persisting the resulting messages. */
export async function runAgentTurn(opts: TurnOptions): Promise<TurnResult> {
  const { agent, conversation, emit, signal, mode } = opts;
  const conversationId = conversation.id;
  emit({ type: "typing", agentId: agent.id });

  const catalogEntry = await findModel(agent.model).catch(() => undefined);
  const supportsTools = catalogEntry?.tools ?? false;
  const computerReady =
    supportsTools && mode !== "summary" && (await dockerAvailable()) && (await getComputer(agent.id)).status !== "no_image";
  const team = await loadTeam(agent);
  const canDelegate = supportsTools && mode === "chat" && agent.isOrchestrator && !!opts.onDelegate && team.length > 0;
  // Preferences come from talking with the user, so proposals are only offered in chat mode.
  const canPropose = supportsTools && mode === "chat";
  const canRemember = supportsTools && mode !== "summary";
  const canSuggestRoutine = supportsTools && mode === "chat";
  const memories = await listMemories(agent.id);
  const [conversationRow] = await db
    .select({ summary: schema.conversations.summary, contextStartedAt: schema.conversations.contextStartedAt })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));

  const tools = supportsTools
    ? [
        ...(mode === "chat" && opts.userText ? [SET_MODEL_TOOL] : []),
        ...(computerReady ? COMPUTER_TOOLS : []),
        ...(canDelegate ? [delegateTool(team.map((m) => m.name))] : []),
        ...(canPropose ? [PROPOSE_INSTRUCTIONS_TOOL] : []),
        ...(canRemember ? MEMORY_TOOLS : []),
        ...(canSuggestRoutine ? [SUGGEST_ROUTINE_TOOL] : []),
      ]
    : [];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt({
        agent,
        mode,
        conversationType: conversation.type,
        memberNames: [...conversation.names.values()],
        hasComputer: computerReady,
        secrets: computerReady ? await secretNamesForAgent(agent.id) : [],
        team,
        canDelegate,
        canPropose,
        canRemember,
        memories,
        conversationSummary: conversationRow?.summary ?? "",
        delegatedBy: opts.delegatedBy,
        routineName: opts.routineName,
        canSuggestRoutine,
      }),
    },
    ...(await buildHistory(conversationId, agent, conversation.names, conversationRow?.contextStartedAt ?? null)),
    ...(opts.extraMessages ?? []),
  ];

  let draftId = crypto.randomUUID();
  const modelUsed = agent.model;
  let content = "";
  let fullContent = "";
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Budgets are checked before every model call, including the spend of this turn so far.
      await assertWithinBudget(agent.ownerId, agent.id, usage.cost ?? 0);

      let calls: ToolCall[] = [];
      let roundText = "";

      for await (const event of streamChat({ model: modelUsed, messages, tools: tools.length ? tools : undefined, signal })) {
        if (event.type === "delta") {
          roundText += event.text;
          content += event.text;
          emit({ type: "delta", messageId: draftId, agentId: agent.id, text: event.text });
        } else if (event.type === "tool_calls") {
          calls = event.calls;
        } else {
          usage.prompt_tokens += event.usage.prompt_tokens ?? 0;
          usage.completion_tokens += event.usage.completion_tokens ?? 0;
          usage.cost = (usage.cost ?? 0) + (event.usage.cost ?? 0);
        }
      }

      if (opts.costLimitUsd !== undefined && (usage.cost ?? 0) > opts.costLimitUsd) throw new CostLimitError(opts.costLimitUsd);
      if (!calls.length) break;

      messages.push({ role: "assistant", content: roundText || null, tool_calls: calls });

      // Commit the text said before the tools run as its own bubble.
      if (content.trim()) {
        fullContent += `${content.trim()}\n\n`;
        emit({
          type: "message",
          message: await saveMessage({ conversationId, authorType: "agent", agentId: agent.id, content: content.trim(), model: modelUsed }),
        });
      }
      content = "";
      draftId = crypto.randomUUID();

      for (const call of calls) {
        let result: string;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {}

        if (COMPUTER_TOOL_NAMES.has(call.function.name) && computerReady) {
          const gate = await gateComputerAction({ agent, conversationId, tool: call.function.name, args, emit, signal });
          if (gate.allowed) {
            emit({ type: "typing", agentId: agent.id });
            emit({
              type: "message",
              message: await saveMessage({
                conversationId,
                authorType: "agent",
                agentId: agent.id,
                kind: "tool",
                content: describeToolCall(call.function.name, args),
                metadata: { tool: call.function.name },
              }),
            });
            try {
              result = await executeComputerTool(agent.id, call.function.name, args);
            } catch (error) {
              result = `Tool failed: ${error instanceof Error ? error.message : String(error)}`;
            }
            emit({ type: "computer", agentId: agent.id });
          } else {
            result = gate.result;
          }
        } else if (call.function.name === "set_model" && mode === "chat" && opts.userText) {
          const modelId = String(args.model_id ?? "");
          if (!userAskedForModelChange(opts.userText, modelId)) {
            result = "Refused: the user did not ask to change the model. Do not change it.";
          } else {
            const change = await changeModel(agent, conversationId, modelId, emit);
            result = change.ok
              ? `Model changed to ${change.model.id}. Confirm this briefly to the user.`
              : `Failed: ${change.reason} Tell the user and suggest they check the ID.`;
          }
        } else if (call.function.name === "suggest_routine" && canSuggestRoutine) {
          const suggestion = await suggestRoutine(agent, conversationId, args);
          if (suggestion.card) emit({ type: "message", message: suggestion.card });
          result = suggestion.toolResult;
        } else if (MEMORY_TOOL_NAMES.has(call.function.name) && canRemember) {
          const memory = await executeMemoryTool(agent, conversationId, call.function.name, args, memories);
          if (memory.message) emit({ type: "message", message: memory.message });
          result = memory.result;
        } else if (call.function.name === "propose_instructions_update" && canPropose) {
          const proposal = await createProposal(agent, conversationId, args);
          for (const stale of proposal.staleCards ?? []) emit({ type: "message", message: stale });
          if (proposal.card) emit({ type: "message", message: proposal.card });
          result = proposal.toolResult;
        } else if (call.function.name === "delegate_task" && canDelegate && opts.onDelegate) {
          result = await opts.onDelegate({
            agentName: String(args.agent_name ?? ""),
            instruction: String(args.instruction ?? "").trim(),
          });
        } else {
          result = `Tool ${call.function.name} is not available.`;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    fullContent += content.trim();
    const usageFields = {
      model: modelUsed,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      costUsd: usage.cost ?? 0,
    };
    if (content.trim() || !tools.length) {
      emit({
        type: "message",
        message: await saveMessage({ conversationId, authorType: "agent", agentId: agent.id, content: content.trim() || "…", ...usageFields }),
      });
    } else {
      // The turn ended with tool calls only: record its usage on a silent bookkeeping row.
      await db.insert(schema.messages).values({
        conversationId,
        authorType: "agent",
        agentId: agent.id,
        kind: "tool",
        content: "",
        metadata: { tool: "usage" },
        ...usageFields,
      });
    }
    await recordUsage(agent, modelUsed, usage);
    void updateConversationSummary(conversationId, HISTORY_LIMIT, conversation.names).catch(() => {});
    const [fresh] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.id));
    if (fresh) emit({ type: "agent", agent: await getAgentDto(fresh) });
    return { content: fullContent.trim(), finalContent: content.trim(), costUsd: usage.cost ?? 0 };
  } catch (error) {
    const reason = signal.aborted
      ? String(signal.reason instanceof Error ? signal.reason.message : (signal.reason ?? "Aborted"))
      : error instanceof Error
        ? error.message
        : "Unknown error";
    const status = error instanceof OpenRouterError ? error.status : error instanceof BudgetExceededError ? 402 : 500;
    // Keep whatever was streamed before the failure, and record the usage so far.
    if (content.trim()) {
      fullContent += content.trim();
      emit({
        type: "message",
        message: await saveMessage({ conversationId, authorType: "agent", agentId: agent.id, content: content.trim(), model: modelUsed }),
      });
    }
    // Stopped with /stop: no error card, the user asked for it.
    if (!isStopped(signal)) emit({
      type: "message",
      message: await saveMessage({
        conversationId,
        authorType: "agent",
        agentId: agent.id,
        kind: "error",
        content: reason,
        model: modelUsed,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        costUsd: usage.cost ?? 0,
        metadata: { errorCode: status },
      }),
    });
    await recordUsage(agent, modelUsed, usage);
    void updateConversationSummary(conversationId, HISTORY_LIMIT, conversation.names).catch(() => {});
    return { content: fullContent.trim(), finalContent: content.trim(), costUsd: usage.cost ?? 0, error: reason };
  }
}

export const TASK_LIMITS = {
  maxDelegationsPerRequest: env.BOTLINGS_MAX_DELEGATIONS_PER_REQUEST,
  costLimitUsd: env.BOTLINGS_TASK_MAX_COST_USD,
  timeoutMs: env.BOTLINGS_TASK_TIMEOUT_MINUTES * 60_000,
};
