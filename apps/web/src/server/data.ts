import { and, desc, eq, gt, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { assertWithinLimit } from "@/server/license";
import type { BotlingAppearance } from "@/components/avatar/botling-options";
import type { Agent, Bootstrap, Conversation, Message } from "@/lib/types";

type AgentRow = typeof schema.agents.$inferSelect;
type MessageRow = typeof schema.messages.$inferSelect;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toAgentDto(row: AgentRow, usage?: { cost: number; tokens: number }): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    prompt: row.prompt,
    model: row.model,
    appearance: row.appearance,
    isOrchestrator: row.isOrchestrator,
    autonomy: row.autonomy,
    status: "idle",
    spendTodayUsd: usage?.cost ?? 0,
    tokensToday: usage?.tokens ?? 0,
  };
}

export function toMessageDto(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    author: row.authorType === "agent" && row.agentId ? { type: "agent", agentId: row.agentId } : { type: "user" },
    text: row.content,
    createdAt: row.createdAt.getTime(),
    kind: row.kind,
    model: row.model,
    costUsd: row.costUsd,
    metadata: row.metadata,
  };
}

export async function getAgentUsageToday(agentIds: string[]) {
  if (!agentIds.length) return new Map<string, { cost: number; tokens: number }>();
  const rows = await db
    .select({
      agentId: schema.usageLedger.agentId,
      cost: sql<number>`coalesce(sum(${schema.usageLedger.costUsd}), 0)::float`,
      tokens: sql<number>`coalesce(sum(${schema.usageLedger.promptTokens} + ${schema.usageLedger.completionTokens}), 0)::int`,
    })
    .from(schema.usageLedger)
    .where(and(inArray(schema.usageLedger.agentId, agentIds), gte(schema.usageLedger.createdAt, startOfToday())))
    .groupBy(schema.usageLedger.agentId);
  return new Map(rows.map((r) => [r.agentId!, { cost: r.cost, tokens: r.tokens }]));
}

export async function getAgentDto(row: AgentRow) {
  const usage = await getAgentUsageToday([row.id]);
  return toAgentDto(row, usage.get(row.id));
}

export async function getBootstrap(user: { id: string; name: string; email: string }): Promise<Bootstrap> {
  const agentRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.ownerId, user.id))
    .orderBy(desc(schema.agents.isOrchestrator), schema.agents.createdAt);
  const usage = await getAgentUsageToday(agentRows.map((a) => a.id));

  const conversationRows = await db.query.conversations.findMany({
    where: eq(schema.conversations.ownerId, user.id),
    with: { members: true },
  });
  const ids = conversationRows.map((c) => c.id);

  const lastMessages = ids.length
    ? await db
        .selectDistinctOn([schema.messages.conversationId])
        .from(schema.messages)
        .where(and(inArray(schema.messages.conversationId, ids), ne(schema.messages.content, "")))
        .orderBy(schema.messages.conversationId, desc(schema.messages.createdAt))
    : [];
  const lastByConversation = new Map(lastMessages.map((m) => [m.conversationId, m]));

  const unreadRows = ids.length
    ? await db
        .select({ conversationId: schema.messages.conversationId, count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .where(
          and(
            inArray(schema.messages.conversationId, ids),
            eq(schema.messages.authorType, "agent"),
            eq(schema.messages.kind, "text"),
            gt(schema.messages.createdAt, schema.conversations.lastReadAt),
          ),
        )
        .groupBy(schema.messages.conversationId)
    : [];
  const unreadByConversation = new Map(unreadRows.map((r) => [r.conversationId, r.count]));

  const conversations: Conversation[] = conversationRows.map((c) => {
    const last = lastByConversation.get(c.id);
    return {
      id: c.id,
      type: c.type,
      title: c.title,
      pinned: c.pinned,
      memberIds: c.members.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()).map((m) => m.agentId),
      unread: unreadByConversation.get(c.id) ?? 0,
      lastMessage: last ? toMessageDto(last) : null,
      ...(c.type === "group"
        ? { description: c.description, discussionMode: c.discussionMode, maxTurns: c.maxTurns, maxCostUsd: c.maxCostUsd }
        : {}),
    };
  });

  return {
    user: { id: user.id, name: user.name, email: user.email },
    agents: agentRows.map((a) => toAgentDto(a, usage.get(a.id))),
    conversations,
    defaultModel: env.BOTLINGS_DEFAULT_MODEL,
  };
}

export async function getOwnedConversation(userId: string, conversationId: string) {
  return db.query.conversations.findFirst({
    where: and(eq(schema.conversations.id, conversationId), eq(schema.conversations.ownerId, userId)),
    with: { members: { with: { agent: true } } },
  });
}

export async function getMessages(conversationId: string, limit = 200) {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), ne(schema.messages.content, "")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit);
  return rows.reverse().map(toMessageDto);
}

export type NewAgentInput = {
  name: string;
  role: string;
  prompt: string;
  model: string;
  appearance: BotlingAppearance;
  autonomy?: "ask_always" | "ask_sensitive" | "autonomous";
  isOrchestrator?: boolean;
  greeting?: string;
};

/** Creates an agent together with its direct conversation. */
export async function createAgent(ownerId: string, input: NewAgentInput) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.agents)
    .where(eq(schema.agents.ownerId, ownerId));
  await assertWithinLimit("agents", count);

  return db.transaction(async (tx) => {
    const [agent] = await tx
      .insert(schema.agents)
      .values({
        ownerId,
        name: input.name,
        role: input.role,
        prompt: input.prompt,
        model: input.model,
        appearance: input.appearance,
        autonomy: input.autonomy ?? "ask_sensitive",
        isOrchestrator: input.isOrchestrator ?? false,
      })
      .returning();
    const [conversation] = await tx
      .insert(schema.conversations)
      .values({ ownerId, type: "direct", pinned: input.isOrchestrator ?? false })
      .returning();
    await tx.insert(schema.conversationMembers).values({ conversationId: conversation.id, agentId: agent.id });
    if (input.greeting) {
      await tx.insert(schema.messages).values({
        conversationId: conversation.id,
        authorType: "agent",
        agentId: agent.id,
        content: input.greeting,
      });
    }
    return { agent, conversation };
  });
}

export async function seedWorkspace(ownerId: string) {
  await createAgent(ownerId, {
    name: "Atlas",
    role: "Chief of staff. Answers directly whenever possible and coordinates the other Botlings.",
    prompt:
      "You are warm, sharp and concise. Handle simple requests yourself. When specialist Botlings exist, suggest routing work to them only if they are clearly better suited.",
    model: env.BOTLINGS_DEFAULT_MODEL,
    appearance: { shape: "blob", color: "violet", mood: "happy" },
    isOrchestrator: true,
    greeting: "Hi! I'm Atlas, your chief of staff. Ask me anything, or create more Botlings to build your crew. 👋",
  });
}

export class ProtectedAgentError extends Error {
  constructor() {
    super("The orchestrator cannot be deleted");
  }
}

/**
 * Deletes an agent and its direct conversation. Group memberships are removed by cascade; the
 * agent's past group messages stay, without an author. Returns the removed conversation ids, or
 * null when the agent does not exist for this owner.
 */
export async function deleteAgent(ownerId: string, agentId: string) {
  const [agent] = await db
    .select({ id: schema.agents.id, isOrchestrator: schema.agents.isOrchestrator })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, ownerId)));
  if (!agent) return null;
  if (agent.isOrchestrator) throw new ProtectedAgentError();

  return db.transaction(async (tx) => {
    const direct = await tx
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .innerJoin(schema.conversationMembers, eq(schema.conversationMembers.conversationId, schema.conversations.id))
      .where(
        and(
          eq(schema.conversations.ownerId, ownerId),
          eq(schema.conversations.type, "direct"),
          eq(schema.conversationMembers.agentId, agentId),
        ),
      );
    const conversationIds = direct.map((c) => c.id);
    if (conversationIds.length) {
      await tx.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
    }
    await tx.delete(schema.agents).where(eq(schema.agents.id, agentId));
    return conversationIds;
  });
}
