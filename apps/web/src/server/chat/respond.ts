import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getOwnedConversation } from "@/server/data";
import { changeModel, runAgentTurn, saveMessage, type AgentRow, type Emit } from "./agent-turn";
import { beginRequest, createDelegator } from "./tasks";
import { notify } from "@/server/notifications/notify";

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

  const requestId = crypto.randomUUID();
  const endRequest = agent.isOrchestrator ? beginRequest(requestId) : null;
  try {
    const result = await runAgentTurn({
      agent,
      conversation: { id: conversationId, type: conversation.type, names },
      emit,
      signal,
      mode: "chat",
      userText: text,
      onDelegate: agent.isOrchestrator ? createDelegator({ orchestrator: agent, conversationId, requestId, emit }) : undefined,
    });
    if (!result.error && result.finalContent) {
      void notify(userId, { type: "reply", agentName: agent.name, text: result.finalContent, conversationId });
    }
  } finally {
    await endRequest?.();
  }
}
