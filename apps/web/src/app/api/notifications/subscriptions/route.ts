import { eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { isValidPushEndpoint } from "@/server/notifications/push";
import { isLocale } from "@/lib/i18n/dictionaries";

const subscribeSchema = z.object({
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  locale: z.string().optional(),
});

/** Saves this browser's push subscription (re-subscribing just refreshes it). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isValidPushEndpoint(parsed.data.endpoint)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const { endpoint, keys, locale } = parsed.data;
  const values = {
    userId: user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    locale: isLocale(locale) ? locale : "en",
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  };
  await db
    .insert(schema.pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: values });
  return Response.json({ ok: true });
}

const unsubscribeSchema = z.object({ endpoint: z.string().max(2000) });

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const [row] = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.endpoint, parsed.data.endpoint));
  if (row?.userId === user.id) await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, row.id));
  return Response.json({ ok: true });
}
