import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getOwnedConversation } from "@/server/data";
import { changeModel, runAgentTurn, saveMessage, type AgentRow, type Emit } from "./agent-turn";
import { parseCommand, runCommand } from "./commands";
import { trackGeneration } from "./generations";
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
  /** Language for command replies ("en" | "pt"). */
  locale?: string;
}) {
  const { userId, conversationId, text, emit, signal } = options;
  const conversation = await getOwnedConversation(userId, conversationId);
  if (!conversation) throw new Error("Conversation not found");

  const members = conversation.members.map((m) => m.agent);
  const names = new Map(members.map((a) => [a.id, a.name]));
  const command = parseCommand(text);

  // Commands are kept out of the agent's history (kind "command").
  emit({
    type: "user_message",
    message: await saveMessage({ conversationId, authorType: "user", content: text, kind: command ? "command" : "text" }),
  });
  await db.update(schema.conversations).set({ lastReadAt: new Date() }).where(eq(schema.conversations.id, conversationId));

  const agent = pickResponder(text, members);
  if (!agent) return;

  if (command) {
    // "/model <id>" changes the model deterministically (also works with models that lack tools).
    if (command.name === "model" && command.args) {
      const result = await changeModel(agent, conversationId, command.args.split(/\s+/)[0], emit);
      if (!result.ok) {
        emit({
          type: "message",
          message: await saveMessage({ conversationId, authorType: "agent", agentId: agent.id, kind: "error", content: result.reason }),
        });
      }
      return;
    }
    const result = await runCommand({ ownerId: userId, conversationId, agent, name: command.name, args: command.args, locale: options.locale ?? "en" });
    emit({
      type: "message",
      message: await saveMessage({
        conversationId,
        authorType: "agent",
        agentId: agent.id,
        kind: "command",
        content: result.text,
        metadata: { command: command.name, pendingApprovals: result.pendingApprovals },
      }),
    });
    return;
  }

  // Linked to the caller's signal, and stoppable with /stop.
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const untrack = trackGeneration(conversationId, controller);

  const requestId = crypto.randomUUID();
  const endRequest = agent.isOrchestrator ? beginRequest(requestId) : null;
  try {
    const result = await runAgentTurn({
      agent,
      conversation: { id: conversationId, type: conversation.type, names },
      emit,
      signal: controller.signal,
      mode: "chat",
      userText: text,
      onDelegate: agent.isOrchestrator ? createDelegator({ orchestrator: agent, conversationId, requestId, emit }) : undefined,
    });
    if (!result.error && result.finalContent) {
      void notify(userId, { type: "reply", agentName: agent.name, text: result.finalContent, conversationId });
    }
  } finally {
    untrack();
    signal.removeEventListener("abort", onAbort);
    await endRequest?.();
  }
}
