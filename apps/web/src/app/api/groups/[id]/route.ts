import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { groupErrorResponse } from "@/server/groups/api";
import { deleteGroup, groupPatchSchema, updateGroup } from "@/server/groups/groups";

export async function PATCH(request: Request, ctx: RouteContext<"/api/groups/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = groupPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  try {
    return Response.json({ conversation: await updateGroup(user.id, id, parsed.data) });
  } catch (error) {
    return groupErrorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/groups/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    await deleteGroup(user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
