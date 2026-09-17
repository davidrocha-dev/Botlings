import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { listRoutines, ownsAgent, resolveSchedule, routineInputSchema } from "@/server/routines/api";
import { computeNextRun } from "@/server/routines/routines";

async function owned(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select()
    .from(schema.routines)
    .where(and(eq(schema.routines.id, id), eq(schema.routines.ownerId, userId)));
  return row ?? null;
}

const patchSchema = routineInputSchema.partial().extend({
  schedule: routineInputSchema.shape.schedule.optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/routines/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const routine = await owned(user.id, (await ctx.params).id);
  if (!routine) return Response.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || !body) return Response.json({ error: "invalid_input" }, { status: 400 });
  // Only fields actually sent override the stored ones (zod defaults would otherwise apply).
  const sent = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => key in body));
  if (sent.agentId && !(await ownsAgent(user.id, sent.agentId as string))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const merged = { ...routine, ...sent } as typeof routine;
  const resolved = resolveSchedule(merged.schedule, merged.timeZone);
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: 400 });

  await db
    .update(schema.routines)
    .set({
      agentId: merged.agentId,
      name: merged.name,
      instruction: merged.instruction,
      schedule: merged.schedule,
      timeZone: merged.timeZone,
      enabled: merged.enabled,
      cron: resolved.cron,
      nextRunAt: merged.enabled ? computeNextRun({ cron: resolved.cron, timeZone: merged.timeZone }) : null,
    })
    .where(eq(schema.routines.id, routine.id));
  return Response.json({ routines: await listRoutines(user.id) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/routines/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const routine = await owned(user.id, (await ctx.params).id);
  if (!routine) return Response.json({ error: "not_found" }, { status: 404 });
  await db.delete(schema.routines).where(eq(schema.routines.id, routine.id));
  return Response.json({ routines: await listRoutines(user.id) });
}
