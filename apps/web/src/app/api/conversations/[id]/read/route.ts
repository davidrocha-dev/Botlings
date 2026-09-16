import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";

export async function POST(_request: Request, ctx: RouteContext<"/api/conversations/[id]/read">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });

  await db
    .update(schema.conversations)
    .set({ lastReadAt: new Date() })
    .where(and(eq(schema.conversations.id, id), eq(schema.conversations.ownerId, user.id)));
  return new Response(null, { status: 204 });
}
