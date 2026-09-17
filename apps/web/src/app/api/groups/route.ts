import { getCurrentUser } from "@/server/auth/session";
import { groupErrorResponse } from "@/server/groups/api";
import { createGroup, groupInputSchema } from "@/server/groups/groups";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = groupInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  try {
    return Response.json({ conversation: await createGroup(user.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return groupErrorResponse(error);
  }
}
