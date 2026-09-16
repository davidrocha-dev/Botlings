import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
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
      agentId: schema.messages.agentId,
      cost: sql<number>`coalesce(sum(${schema.messages.costUsd}), 0)::float`,
      tokens: sql<number>`coalesce(sum(coalesce(${schema.messages.promptTokens}, 0) + coalesce(${schema.messages.completionTokens}, 0)), 0)::int`,
    })
    .from(schema.messages)
    .where(and(inArray(schema.messages.agentId, agentIds), gte(schema.messages.createdAt, startOfToday())))
    .groupBy(schema.messages.agentId);
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
        .where(inArray(schema.messages.conversationId, ids))
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
    .where(eq(schema.messages.conversationId, conversationId))
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
