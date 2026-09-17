import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { destroyComputerOrQueue } from "@/server/computers/manager";
import { db, schema } from "@/server/db";
import { ProtectedAgentError, deleteAgent, getAgentDto } from "@/server/data";
import { findModel } from "@/server/openrouter";
import { agentPatchSchema } from "@/server/validation";
import type { BotlingAppearance } from "@/components/avatar/botling-options";

/** Edits made explicitly by the user from the UI (including model changes). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = agentPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  if (parsed.data.model && !(await findModel(parsed.data.model).catch(() => undefined))) {
    return Response.json({ error: "unknown_model" }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.agents)
    .set({ ...parsed.data, appearance: parsed.data.appearance as BotlingAppearance | undefined })
    .where(and(eq(schema.agents.id, id), eq(schema.agents.ownerId, user.id)))
    .returning();
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ agent: await getAgentDto(updated) });
}

/** Deletes the agent, its direct chat, and its computer (container + home volume). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const removedConversationIds = await deleteAgent(user.id, id);
    if (!removedConversationIds) return Response.json({ error: "Not found" }, { status: 404 });

    // The agent is gone from the database; its computer is removed now or queued until Docker is back.
    await destroyComputerOrQueue(id);

    return Response.json({ removedConversationIds });
  } catch (error) {
    if (error instanceof ProtectedAgentError) return Response.json({ error: "orchestrator" }, { status: 403 });
    throw error;
  }
}
