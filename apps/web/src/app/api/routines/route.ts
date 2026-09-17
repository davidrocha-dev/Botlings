import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { listRoutines, ownsAgent, resolveSchedule, routineInputSchema } from "@/server/routines/api";
import { computeNextRun } from "@/server/routines/routines";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ routines: await listRoutines(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = routineInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  if (!(await ownsAgent(user.id, parsed.data.agentId))) return Response.json({ error: "not_found" }, { status: 404 });

  const resolved = resolveSchedule(parsed.data.schedule, parsed.data.timeZone);
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: 400 });

  const values = { ...parsed.data, ownerId: user.id, cron: resolved.cron, createdBy: "user" as const };
  await db.insert(schema.routines).values({ ...values, nextRunAt: values.enabled ? computeNextRun(values) : null });
  return Response.json({ routines: await listRoutines(user.id) }, { status: 201 });
}
