import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { reportPresence } from "@/server/notifications/presence";

const bodySchema = z.object({ clientId: z.string().min(8).max(64), visible: z.boolean() });

/** Tabs report whether they're visible, so we don't push notifications for things the user is watching. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  reportPresence(user.id, parsed.data.clientId, parsed.data.visible);
  return new Response(null, { status: 204 });
}
