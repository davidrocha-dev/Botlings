import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getAgentDto, getOwnedConversation, toMessageDto } from "@/server/data";
import {
  OpenRouterError,
  findModel,
  streamChat,
  type ChatMessage,
  type ToolCall,
  type ToolDefinition,
  type Usage,
} from "@/server/openrouter";
import type { ChatStreamEvent } from "@/lib/types";

type AgentRow = typeof schema.agents.$inferSelect;
type Emit = (event: ChatStreamEvent) => void;

const HISTORY_LIMIT = 40;
const MAX_TOOL_ROUNDS = 3;

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

/** The user must actually be talking about models for a switch to be accepted. */
function userAskedForModelChange(text: string, modelId: string) {
  const lower = text.toLowerCase();
  const slug = modelId.toLowerCase().split("/").pop()?.split(":")[0] ?? "";
  return /\bmodel|\bmodelo/.test(lower) || (slug.length > 3 && lower.includes(slug));
}

function systemPrompt(agent: AgentRow, conversationType: "direct" | "group", memberNames: string[]) {
  return [
    `You are ${agent.name}, a Botling — an AI agent in the user's personal crew.`,
    agent.role && `Your role: ${agent.role}`,
    agent.prompt && `Instructions from the user:\n${agent.prompt}`,
    conversationType === "group" &&
      `You are in a group chat with the user and these Botlings: ${memberNames.join(", ")}. Messages from other Botlings are prefixed with their name in brackets. Only speak for yourself.`,
    `You currently run on the model "${agent.model}". Never change model unless the user explicitly asks.`,
    "Reply in the same language the user writes in. Be concise and natural, like a chat message. Use Markdown sparingly.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function buildHistory(conversationId: string, agent: AgentRow, names: Map<string, string>) {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.kind, "text")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(HISTORY_LIMIT);

  return rows.reverse().map<ChatMessage>((m) => {
    if (m.authorType === "user") return { role: "user", content: m.content };
    if (m.agentId === agent.id) return { role: "assistant", content: m.content };
    return { role: "user", content: `[${names.get(m.agentId ?? "") ?? "Botling"}]: ${m.content}` };
  });
}

async function saveMessage(values: typeof schema.messages.$inferInsert) {
  const [row] = await db.insert(schema.messages).values(values).returning();
  await db.update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, values.conversationId));
  return toMessageDto(row);
}

async function changeModel(agent: AgentRow, conversationId: string, modelId: string, emit: Emit) {
  const model = await findModel(modelId);
  if (!model) return { ok: false as const, reason: `Model "${modelId}" does not exist on OpenRouter.` };

  const fromModel = agent.model;
  const [updated] = await db
    .update(schema.agents)
    .set({ model: model.id })
    .where(eq(schema.agents.id, agent.id))
    .returning();
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

/** Picks who answers: an @mentioned member, else the orchestrator, else the first member. */
function pickResponder(text: string, members: AgentRow[]) {
  const lower = text.toLowerCase();
  const mentioned = members.find((a) => lower.includes(`@${a.name.toLowerCase()}`));
  return mentioned ?? members.find((a) => a.isOrchestrator) ?? members[0];
}

export async function handleUserMessage(options: {
  userId: string;
  conversationId: string;
  text: string;
  emit: Emit;
  signal: AbortSignal;
}) {
  const { userId, conversationId, text, emit, signal } = options;
  const conversation = await getOwnedConversation(userId, conversationId);
  if (!conversation) throw new Error("Conversation not found");

  const members = conversation.members.map((m) => m.agent);
  const names = new Map(members.map((a) => [a.id, a.name]));

  emit({
    type: "user_message",
    message: await saveMessage({ conversationId, authorType: "user", content: text }),
  });
  await db.update(schema.conversations).set({ lastReadAt: new Date() }).where(eq(schema.conversations.id, conversationId));

  const agent = pickResponder(text, members);
  if (!agent) return;

  // Deterministic model switch: "/model <id>" (also works with models that lack tool support).
  const command = text.trim().match(/^\/model\s+(\S+)$/i);
  if (command) {
    const result = await changeModel(agent, conversationId, command[1], emit);
    if (!result.ok) {
      emit({
        type: "message",
        message: await saveMessage({ conversationId, authorType: "agent", agentId: agent.id, kind: "error", content: result.reason }),
      });
    }
    return;
  }

  emit({ type: "typing", agentId: agent.id });

  const catalogEntry = await findModel(agent.model).catch(() => undefined);
  const tools = catalogEntry?.tools ? [SET_MODEL_TOOL] : undefined;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(agent, conversation.type, members.map((m) => m.name)) },
    ...(await buildHistory(conversationId, agent, names)),
  ];

  const draftId = crypto.randomUUID();
  const modelUsed = agent.model;
  let content = "";
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let calls: ToolCall[] = [];
      let roundText = "";

      for await (const event of streamChat({ model: modelUsed, messages, tools, signal })) {
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

      if (!calls.length) break;

      messages.push({ role: "assistant", content: roundText || null, tool_calls: calls });
      for (const call of calls) {
        let result: string;
        if (call.function.name === "set_model") {
          let modelId = "";
          try {
            modelId = String(JSON.parse(call.function.arguments || "{}").model_id ?? "");
          } catch {}
          if (!userAskedForModelChange(text, modelId)) {
            result = "Refused: the user did not ask to change the model. Do not change it.";
          } else {
            const change = await changeModel(agent, conversationId, modelId, emit);
            result = change.ok
              ? `Model changed to ${change.model.id}. Confirm this briefly to the user.`
              : `Failed: ${change.reason} Tell the user and suggest they check the ID.`;
          }
        } else {
          result = `Unknown tool ${call.function.name}`;
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    emit({
      type: "message",
      message: await saveMessage({
        conversationId,
        authorType: "agent",
        agentId: agent.id,
        content: content.trim() || "…",
        model: modelUsed,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        costUsd: usage.cost ?? 0,
      }),
    });
    const [fresh] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.id));
    emit({ type: "agent", agent: await getAgentDto(fresh) });
  } catch (error) {
    if (signal.aborted) return;
    const status = error instanceof OpenRouterError ? error.status : 500;
    const reason = error instanceof Error ? error.message : "Unknown error";
    // Keep whatever was streamed before the failure.
    if (content.trim()) {
      emit({
        type: "message",
        message: await saveMessage({ conversationId, authorType: "agent", agentId: agent.id, content: content.trim(), model: modelUsed }),
      });
    }
    emit({
      type: "message",
      message: await saveMessage({
        conversationId,
        authorType: "agent",
        agentId: agent.id,
        kind: "error",
        content: reason,
        model: modelUsed,
        metadata: { errorCode: status },
      }),
    });
  }
}
