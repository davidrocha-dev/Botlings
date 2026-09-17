import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { toMessageDto } from "@/server/data";
import { publish } from "@/server/events";
import { saveMessage } from "@/server/chat/save-message";
import type { Conversation } from "@/lib/types";

export const GROUP_LIMITS = { minMembers: 1, maxMembers: 12, maxTurns: 20, maxCostUsd: 2 };

export const groupInputSchema = z.object({
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().max(600).default(""),
  memberIds: z.array(z.uuid()).min(GROUP_LIMITS.minMembers).max(GROUP_LIMITS.maxMembers),
  discussionMode: z.enum(["discussion", "mentions"]).default("discussion"),
  maxTurns: z.number().int().min(1).max(GROUP_LIMITS.maxTurns).default(6),
  maxCostUsd: z.number().min(0.001).max(GROUP_LIMITS.maxCostUsd).default(0.05),
});

/** PATCH: no defaults, so fields that weren't sent are never overwritten. */
export const groupPatchSchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(600).optional(),
  discussionMode: z.enum(["discussion", "mentions"]).optional(),
  maxTurns: z.number().int().min(1).max(GROUP_LIMITS.maxTurns).optional(),
  maxCostUsd: z.number().min(0.001).max(GROUP_LIMITS.maxCostUsd).optional(),
});

export class GroupError extends Error {
  constructor(readonly code: "not_found" | "invalid_members" | "too_many_members" | "last_member" | "orchestrator") {
    super(code);
  }
}

async function ownedGroup(ownerId: string, groupId: string) {
  const [group] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, groupId), eq(schema.conversations.ownerId, ownerId), eq(schema.conversations.type, "group")));
  if (!group) throw new GroupError("not_found");
  return group;
}

async function assertOwnAgents(ownerId: string, agentIds: string[]) {
  const unique = [...new Set(agentIds)];
  if (!unique.length) return unique;
  const rows = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.ownerId, ownerId), inArray(schema.agents.id, unique)));
  if (rows.length !== unique.length) throw new GroupError("invalid_members");
  return unique;
}

export async function getGroupDto(ownerId: string, groupId: string): Promise<Conversation> {
  const group = await ownedGroup(ownerId, groupId);
  const members = await db
    .select()
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, groupId))
    .orderBy(schema.conversationMembers.joinedAt);
  const [last] = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, groupId), ne(schema.messages.content, "")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return {
    id: group.id,
    type: "group",
    title: group.title,
    pinned: group.pinned,
    memberIds: members.map((m) => m.agentId),
    unread: 0,
    lastMessage: last ? toMessageDto(last) : null,
    description: group.description,
    discussionMode: group.discussionMode,
    maxTurns: group.maxTurns,
    maxCostUsd: group.maxCostUsd,
  };
}

async function memberEvent(ownerId: string, groupId: string, agentId: string, event: "joined" | "left") {
  const [agent] = await db.select({ name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, agentId));
  const message = await saveMessage({
    conversationId: groupId,
    authorType: "agent",
    kind: "event",
    content: `${agent?.name ?? "Botling"} ${event}`,
    metadata: { memberEvent: event, memberAgentId: agentId },
  });
  publish(ownerId, groupId, { type: "message", message });
}

/** The orchestrator chairs every group: it picks who speaks and closes each round. */
async function orchestratorId(ownerId: string) {
  const [row] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.ownerId, ownerId), eq(schema.agents.isOrchestrator, true)));
  return row?.id ?? null;
}

export async function createGroup(ownerId: string, input: z.infer<typeof groupInputSchema>) {
  const chosen = await assertOwnAgents(ownerId, input.memberIds);
  const chair = await orchestratorId(ownerId);
  const memberIds = chair && !chosen.includes(chair) ? [chair, ...chosen] : chosen;
  const [group] = await db
    .insert(schema.conversations)
    .values({
      ownerId,
      type: "group",
      title: input.title,
      description: input.description,
      discussionMode: input.discussionMode,
      maxTurns: input.maxTurns,
      maxCostUsd: input.maxCostUsd,
    })
    .returning();
  await db.insert(schema.conversationMembers).values(memberIds.map((agentId) => ({ conversationId: group.id, agentId })));
  return getGroupDto(ownerId, group.id);
}

export async function updateGroup(ownerId: string, groupId: string, patch: z.infer<typeof groupPatchSchema>) {
  await ownedGroup(ownerId, groupId);
  const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(values).length) {
    await db.update(schema.conversations).set(values).where(eq(schema.conversations.id, groupId));
  }
  return getGroupDto(ownerId, groupId);
}

export async function addGroupMembers(ownerId: string, groupId: string, agentIds: string[]) {
  await ownedGroup(ownerId, groupId);
  const ids = await assertOwnAgents(ownerId, agentIds);
  const current = await db
    .select({ agentId: schema.conversationMembers.agentId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, groupId));
  const existing = new Set(current.map((m) => m.agentId));
  const added = ids.filter((id) => !existing.has(id));
  if (existing.size + added.length > GROUP_LIMITS.maxMembers) throw new GroupError("too_many_members");
  if (added.length) {
    await db.insert(schema.conversationMembers).values(added.map((agentId) => ({ conversationId: groupId, agentId })));
    for (const agentId of added) await memberEvent(ownerId, groupId, agentId, "joined");
  }
  return getGroupDto(ownerId, groupId);
}

export async function removeGroupMember(ownerId: string, groupId: string, agentId: string) {
  await ownedGroup(ownerId, groupId);
  if (agentId === (await orchestratorId(ownerId))) throw new GroupError("orchestrator");
  const members = await db
    .select({ agentId: schema.conversationMembers.agentId })
    .from(schema.conversationMembers)
    .where(eq(schema.conversationMembers.conversationId, groupId));
  if (!members.some((m) => m.agentId === agentId)) throw new GroupError("not_found");
  if (members.length <= GROUP_LIMITS.minMembers) throw new GroupError("last_member");
  await db
    .delete(schema.conversationMembers)
    .where(and(eq(schema.conversationMembers.conversationId, groupId), eq(schema.conversationMembers.agentId, agentId)));
  // Its past messages stay in the group, still attributed to it.
  await memberEvent(ownerId, groupId, agentId, "left");
  return getGroupDto(ownerId, groupId);
}

export async function deleteGroup(ownerId: string, groupId: string) {
  await ownedGroup(ownerId, groupId);
  await db.delete(schema.conversations).where(eq(schema.conversations.id, groupId));
}
