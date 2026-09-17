import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";

async function ownedAgentId(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [agent] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.ownerId, userId)));
  return agent?.id ?? null;
}

/** Categories this agent may do without asking ("always allow" decisions). */
export async function GET(_request: Request, ctx: RouteContext<"/api/agents/[id]/approval-rules">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = await ownedAgentId(user.id, (await ctx.params).id);
  if (!agentId) return Response.json({ error: "Not found" }, { status: 404 });
  const rules = await db
    .select({ category: schema.approvalRules.category, createdAt: schema.approvalRules.createdAt })
    .from(schema.approvalRules)
    .where(eq(schema.approvalRules.agentId, agentId))
    .orderBy(asc(schema.approvalRules.createdAt));
  return Response.json({ rules });
}

/** Revokes an "always allow" rule: `?category=`. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/agents/[id]/approval-rules">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = await ownedAgentId(user.id, (await ctx.params).id);
  if (!agentId) return Response.json({ error: "Not found" }, { status: 404 });
  const category = new URL(request.url).searchParams.get("category") ?? "";
  await db
    .delete(schema.approvalRules)
    .where(and(eq(schema.approvalRules.agentId, agentId), eq(schema.approvalRules.category, category)));
  return new Response(null, { status: 204 });
}
