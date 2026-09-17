import { eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { vapidKeys } from "@/server/notifications/push";

async function state(userId: string) {
  const [user] = await db
    .select({ prefs: schema.users.notificationPrefs })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const devices = await db.$count(schema.pushSubscriptions, eq(schema.pushSubscriptions.userId, userId));
  return { publicKey: vapidKeys().publicKey, prefs: user.prefs, devices };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await state(user.id));
}

const prefsSchema = z.object({ approvals: z.boolean(), routines: z.boolean(), replies: z.boolean() }).partial();

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = prefsSchema.safeParse((await request.json().catch(() => null))?.prefs);
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const current = await state(user.id);
  await db
    .update(schema.users)
    .set({ notificationPrefs: { ...current.prefs, ...parsed.data } })
    .where(eq(schema.users.id, user.id));
  return Response.json(await state(user.id));
}
