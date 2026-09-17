import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { decideRoutineSuggestion } from "@/server/routines/suggest";

const bodySchema = z.object({ decision: z.enum(["enable", "discard"]) });

/** Enables or discards a routine an agent suggested. */
export async function POST(request: Request, ctx: RouteContext<"/api/routines/suggestions/[messageId]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { messageId } = await ctx.params;
  if (!z.uuid().safeParse(messageId).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const result = await decideRoutineSuggestion(user.id, messageId, parsed.data.decision);
  if ("error" in result) return Response.json(result, { status: 404 });
  return Response.json(result);
}
