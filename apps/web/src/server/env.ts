import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Env files live at the monorepo root. Next.js only loads env files from apps/web (and resets
 * process.env when it does), so the root files are read here, at server-module load time.
 * Values already present in process.env win.
 */
function loadRootEnv() {
  const root = path.resolve(process.cwd(), "../..");
  for (const name of [".env.local", ".env"]) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

loadRootEnv();

const schema = z.object({
  /** Optional — without it Botlings uses an embedded PGlite database. */
  DATABASE_URL: z.string().optional(),
  BOTLINGS_DATA_DIR: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  BOTLINGS_MODE: z.enum(["personal", "commercial"]).default("personal"),
  BOTLINGS_DEFAULT_MODEL: z.string().default("google/gemma-4-31b-it:free"),
  /** Free model(s) for small helper jobs ("Generate with AI"); comma-separated, tried in order. */
  BOTLINGS_UTILITY_MODEL: z
    .string()
    .default("google/gemma-4-31b-it:free,z-ai/glm-5.2:free,nvidia/nemotron-3-super-120b-a12b:free,openrouter/free"),
  BOTLINGS_LICENSE_PUBLIC_KEY: z.string().optional(),
  /** base64 32-byte key for encrypting secrets; generated into data/secret.key when unset. */
  BOTLINGS_SECRET_KEY: z.string().optional(),
  BOTLINGS_AGENT_IMAGE: z.string().default("botlings-agent:latest"),
  BOTLINGS_MAX_ACTIVE_COMPUTERS: z.coerce.number().int().min(1).default(4),
  BOTLINGS_COMPUTER_MEMORY_MB: z.coerce.number().int().min(512).default(1536),
  BOTLINGS_COMPUTER_CPUS: z.coerce.number().min(0.5).default(1.5),
  BOTLINGS_COMPUTER_IDLE_MINUTES: z.coerce.number().min(1).default(15),
  /** Agents can't reach private networks (your LAN, the host) unless this is "true". */
  BOTLINGS_COMPUTER_ALLOW_LAN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Delegation limits (orchestrator → other agents). */
  BOTLINGS_MAX_DELEGATIONS_PER_REQUEST: z.coerce.number().int().min(0).default(3),
  BOTLINGS_TASK_MAX_COST_USD: z.coerce.number().min(0).default(0.05),
  BOTLINGS_TASK_TIMEOUT_MINUTES: z.coerce.number().min(1).default(10),
  /** Port of the authenticated screen gateway (src/gateway/server.ts). */
  BOTLINGS_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.string().default("development"),
});

export const env = schema.parse(process.env);
