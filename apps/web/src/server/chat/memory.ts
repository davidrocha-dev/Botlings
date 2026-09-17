import { and, asc, desc, eq, gt, lte } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { toMessageDto } from "@/server/data";
import type { ChatMessage, ToolDefinition } from "@/server/openrouter";
import { completeWithUtilityModel } from "@/server/utility-model";
import type { Message } from "@/lib/types";

type AgentRow = typeof schema.agents.$inferSelect;
export type MemoryRow = typeof schema.agentMemories.$inferSelect;

export const MEMORY_LIMIT = 60;
export const MEMORY_MAX_LENGTH = 500;

// ---------- Agent memories (facts) ----------

export const MEMORY_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Save a durable fact worth knowing in future conversations (about the user, their projects, contacts, accounts, decisions). One short, self-contained sentence. Not for how you should behave — use propose_instructions_update for that.",
      parameters: {
        type: "object",
        properties: { fact: { type: "string", description: "The fact, max 500 characters" } },
        required: ["fact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget",
      description: "Delete a saved fact that is wrong or outdated, by its number in your memory list.",
      parameters: {
        type: "object",
        properties: { number: { type: "number", description: "The [n] number from your memory list" } },
        required: ["number"],
      },
    },
  },
];

export const MEMORY_TOOL_NAMES = new Set(MEMORY_TOOLS.map((t) => t.function.name));

export async function listMemories(agentId: string) {
  return db
    .select()
    .from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, agentId))
    .orderBy(asc(schema.agentMemories.createdAt));
}

export function memorySection(memories: MemoryRow[]) {
  const guide =
    "Memory: use remember for durable facts you learn (not for one-off details of the current task, and never for secrets or passwords). Use forget when a saved fact becomes wrong. Don't announce every save — a short mention is enough.";
  if (!memories.length) return `${guide}\nYou have no saved facts yet.`;
  return [
    guide,
    `What you remember (${memories.length}/${MEMORY_LIMIT}):`,
    ...memories.map((m, i) => `[${i + 1}] ${m.content}`),
  ].join("\n");
}

/** Executes remember/forget. The agent's memory list is numbered in the order given to the model. */
export async function executeMemoryTool(
  agent: AgentRow,
  conversationId: string,
  name: string,
  args: Record<string, unknown>,
  memories: MemoryRow[],
): Promise<{ result: string; message?: Message }> {
  if (name === "remember") {
    const fact = String(args.fact ?? "").replace(/\s+/g, " ").trim();
    if (!fact) return { result: "Refused: the fact is empty." };
    if (fact.length > MEMORY_MAX_LENGTH) return { result: `Refused: keep facts under ${MEMORY_MAX_LENGTH} characters.` };
    if (memories.some((m) => m.content.toLowerCase() === fact.toLowerCase())) return { result: "Already remembered." };
    if (memories.length >= MEMORY_LIMIT) {
      return { result: `Refused: memory is full (${MEMORY_LIMIT}). Forget outdated facts first, or ask the user to tidy your memory.` };
    }
    const [row] = await db.insert(schema.agentMemories).values({ agentId: agent.id, content: fact, source: "agent" }).returning();
    memories.push(row);
    const [message] = await db
      .insert(schema.messages)
      .values({ conversationId, authorType: "agent", agentId: agent.id, kind: "memory", content: fact, metadata: { tool: "remember" } })
      .returning();
    return { result: `Saved as [${memories.length}].`, message: toMessageDto(message) };
  }

  const index = Number(args.number) - 1;
  const target = Number.isInteger(index) ? memories[index] : undefined;
  if (!target) return { result: "Refused: no memory with that number." };
  await db
    .delete(schema.agentMemories)
    .where(and(eq(schema.agentMemories.id, target.id), eq(schema.agentMemories.agentId, agent.id)));
  const [message] = await db
    .insert(schema.messages)
    .values({ conversationId, authorType: "agent", agentId: agent.id, kind: "memory", content: target.content, metadata: { tool: "forget" } })
    .returning();
  return { result: `Forgot [${index + 1}]. Numbers of later facts will change next turn.`, message: toMessageDto(message) };
}

// ---------- Conversation summaries ----------

/** Only summarise once enough messages have fallen out of the window, to limit calls. */
const SUMMARY_BATCH = 20;

/**
 * Folds messages older than the model's history window into the conversation's rolling summary.
 * Runs in the background after a turn; failures just leave the previous summary in place.
 */
export async function updateConversationSummary(conversationId: string, historyLimit: number, names: Map<string, string>) {
  const [conversation] = await db
    .select({ summary: schema.conversations.summary, summaryUntil: schema.conversations.summaryUntil })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  if (!conversation) return;

  const textOnly = and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.kind, "text"));
  // The oldest message still inside the window.
  const window = await db
    .select({ createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(textOnly)
    .orderBy(desc(schema.messages.createdAt))
    .limit(historyLimit);
  if (window.length < historyLimit) return;
  const windowStart = window[window.length - 1].createdAt;

  const outside = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        textOnly,
        lte(schema.messages.createdAt, new Date(windowStart.getTime() - 1)),
        conversation.summaryUntil ? gt(schema.messages.createdAt, conversation.summaryUntil) : undefined,
      ),
    )
    .orderBy(asc(schema.messages.createdAt))
    .limit(200);
  if (outside.length < SUMMARY_BATCH) return;

  const transcript = outside
    .map((m) => `${m.authorType === "user" ? "User" : (names.get(m.agentId ?? "") ?? "Botling")}: ${m.content.slice(0, 1500)}`)
    .join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You maintain a running summary of a chat between a user and their AI agents. Merge the previous summary with the new messages into one updated summary: key facts, decisions, open tasks and preferences. Max ~250 words, plain text, same language as the chat. Output only the summary.",
    },
    {
      role: "user",
      content: `Previous summary:\n${conversation.summary || "(none)"}\n\nNew messages:\n${transcript}`,
    },
  ];
  const result = await completeWithUtilityModel(messages, { timeoutMs: 45_000, accept: (text) => text.trim().length >= 30 });
  if ("error" in result) return;

  await db
    .update(schema.conversations)
    .set({ summary: result.text.slice(0, 4_000), summaryUntil: outside[outside.length - 1].createdAt })
    .where(eq(schema.conversations.id, conversationId));
}
