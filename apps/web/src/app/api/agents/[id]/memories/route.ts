import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { MEMORY_LIMIT, MEMORY_MAX_LENGTH } from "@/server/chat/memory";
import { db, schema } from "@/server/db";
import { memoryList, ownedAgentId } from "@/server/memories-api";

export async function GET(_request: Request, ctx: RouteContext<"/api/agents/[id]/memories">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = await ownedAgentId(user.id, (await ctx.params).id);
  if (!agentId) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ memories: await memoryList(agentId), limit: MEMORY_LIMIT });
}

const bodySchema = z.object({ content: z.string().trim().min(1).max(MEMORY_MAX_LENGTH) });

/** The user adds a fact to the agent's memory. */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/[id]/memories">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = await ownedAgentId(user.id, (await ctx.params).id);
  if (!agentId) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const [{ total }] = await db.select({ total: count() }).from(schema.agentMemories).where(eq(schema.agentMemories.agentId, agentId));
  if (total >= MEMORY_LIMIT) return Response.json({ error: "memory_full" }, { status: 409 });

  await db.insert(schema.agentMemories).values({ agentId, content: parsed.data.content, source: "user" });
  return Response.json({ memories: await memoryList(agentId), limit: MEMORY_LIMIT }, { status: 201 });
}
