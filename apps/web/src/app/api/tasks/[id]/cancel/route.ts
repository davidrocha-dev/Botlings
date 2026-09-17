import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { cancelTask } from "@/server/chat/tasks";

export async function POST(_request: Request, ctx: RouteContext<"/api/tasks/[id]/cancel">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });

  const result = await cancelTask(user.id, id);
  if (result === "not_found") return Response.json({ error: "Not found" }, { status: 404 });
  if (result === "not_running") return Response.json({ error: "not_running" }, { status: 409 });
  return new Response(null, { status: 204 });
}
