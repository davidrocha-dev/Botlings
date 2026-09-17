import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";

export async function ownedAgentId(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [agent] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.ownerId, userId)));
  return agent?.id ?? null;
}

export async function memoryList(agentId: string) {
  const rows = await db
    .select()
    .from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, agentId))
    .orderBy(asc(schema.agentMemories.createdAt));
  return rows.map((m) => ({ id: m.id, content: m.content, source: m.source, updatedAt: m.updatedAt.getTime() }));
}
