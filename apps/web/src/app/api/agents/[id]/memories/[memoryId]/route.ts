import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { MEMORY_LIMIT, MEMORY_MAX_LENGTH } from "@/server/chat/memory";
import { db, schema } from "@/server/db";
import { memoryList, ownedAgentId } from "@/server/memories-api";

type Ctx = RouteContext<"/api/agents/[id]/memories/[memoryId]">;

async function resolve(ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { id, memoryId } = await ctx.params;
  const agentId = await ownedAgentId(user.id, id);
  if (!agentId || !z.uuid().safeParse(memoryId).success) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  return { agentId, memoryId };
}

const bodySchema = z.object({ content: z.string().trim().min(1).max(MEMORY_MAX_LENGTH) });

export async function PATCH(request: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  await db
    .update(schema.agentMemories)
    .set({ content: parsed.data.content, source: "user" })
    .where(and(eq(schema.agentMemories.id, r.memoryId), eq(schema.agentMemories.agentId, r.agentId)));
  return Response.json({ memories: await memoryList(r.agentId), limit: MEMORY_LIMIT });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  await db
    .delete(schema.agentMemories)
    .where(and(eq(schema.agentMemories.id, r.memoryId), eq(schema.agentMemories.agentId, r.agentId)));
  return Response.json({ memories: await memoryList(r.agentId), limit: MEMORY_LIMIT });
}
