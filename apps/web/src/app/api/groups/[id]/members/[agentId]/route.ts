import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { groupErrorResponse } from "@/server/groups/api";
import { removeGroupMember } from "@/server/groups/groups";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/groups/[id]/members/[agentId]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, agentId } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(agentId).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  try {
    return Response.json({ conversation: await removeGroupMember(user.id, id, agentId) });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
