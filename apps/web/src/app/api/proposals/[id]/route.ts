import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { decideProposal } from "@/server/chat/proposals";

const bodySchema = z.object({ decision: z.enum(["accept", "reject"]) });

/** The user accepts or rejects an agent's proposed instructions change. */
export async function POST(request: Request, ctx: RouteContext<"/api/proposals/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const result = await decideProposal(user.id, id, parsed.data.decision);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return Response.json({ error: result.error, message: result.message ?? null }, { status });
  }
  return Response.json({ message: result.message, agent: result.agent ?? null });
}
