import { z } from "zod";
import { decideApproval } from "@/server/approvals/approvals";
import { getCurrentUser } from "@/server/auth/session";

const bodySchema = z.object({ decision: z.enum(["approve", "deny", "always"]) });

/** The user's decision on a paused agent action: allow once, deny, or always allow this category. */
export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const result = await decideApproval(user.id, id, parsed.data.decision);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return Response.json({ error: result.error, message: "message" in result ? result.message : null }, { status });
  }
  return Response.json({ message: result.message });
}
