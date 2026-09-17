import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

type VapidKeys = { publicKey: string; privateKey: string };

let cachedKeys: VapidKeys | null = null;

/** VAPID keys from env, or generated once into <repo>/data/vapid.json. Changing them invalidates every subscription. */
export function vapidKeys(): VapidKeys {
  if (cachedKeys) return cachedKeys;
  if (env.BOTLINGS_VAPID_PUBLIC_KEY && env.BOTLINGS_VAPID_PRIVATE_KEY) {
    return (cachedKeys = { publicKey: env.BOTLINGS_VAPID_PUBLIC_KEY, privateKey: env.BOTLINGS_VAPID_PRIVATE_KEY });
  }
  const file = path.resolve(process.cwd(), "../../data/vapid.json");
  if (fs.existsSync(file)) {
    return (cachedKeys = JSON.parse(fs.readFileSync(file, "utf8")) as VapidKeys);
  }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return (cachedKeys = keys);
}

/**
 * Only real push services: https, public hostname. Stops a subscription from making the server
 * POST to localhost or the LAN.
 */
export function isValidPushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol !== "https:" || !host.includes(".") || isIP(host)) return false;
  return !host.endsWith(".local") && !host.endsWith(".internal") && !host.endsWith(".localhost");
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/** Sends to every device of the user; drops subscriptions the push service says are gone. */
export async function sendPush(userId: string, payload: PushPayload | ((locale: string) => PushPayload)) {
  const subscriptions = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
  if (!subscriptions.length) return { sent: 0, failed: 0 };
  const keys = vapidKeys();
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      const data = typeof payload === "function" ? payload(sub.locale) : payload;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ ...data, body: data.body.slice(0, 300) }),
          {
            TTL: 6 * 3600,
            urgency: "normal",
            timeout: 10_000,
            vapidDetails: { subject: env.BOTLINGS_VAPID_SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
          },
        );
        sent += 1;
        await db.update(schema.pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(schema.pushSubscriptions.id, sub.id));
      } catch (error) {
        failed += 1;
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
        } else {
          console.error("[push]", status ?? "", error instanceof Error ? error.message : error);
        }
      }
    }),
  );
  return { sent, failed };
}
