import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { runRoutine } from "@/server/routines/routines";

/** Runs a routine now, in the background. */
export async function POST(_request: Request, ctx: RouteContext<"/api/routines/[id]/run">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const [routine] = await db
    .select({ id: schema.routines.id })
    .from(schema.routines)
    .where(and(eq(schema.routines.id, id), eq(schema.routines.ownerId, user.id)));
  if (!routine) return Response.json({ error: "not_found" }, { status: 404 });
  void runRoutine(routine.id, "manual").catch((error) => console.error("[routines] manual run", error));
  return new Response(null, { status: 202 });
}
