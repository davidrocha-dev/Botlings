import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { groupErrorResponse } from "@/server/groups/api";
import { addGroupMembers } from "@/server/groups/groups";

const bodySchema = z.object({ agentIds: z.array(z.uuid()).min(1).max(12) });

export async function POST(request: Request, ctx: RouteContext<"/api/groups/[id]/members">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  try {
    return Response.json({ conversation: await addGroupMembers(user.id, id, parsed.data.agentIds) });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
