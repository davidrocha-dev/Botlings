import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/auth/rate-limit";
import { sendPush } from "@/server/notifications/push";

/** Sends a test notification to every device of the user, even while they're in the app. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`push-test:${user.id}`, 5, 60_000).ok) return Response.json({ error: "rate_limited" }, { status: 429 });
  const result = await sendPush(user.id, (locale) =>
    locale === "pt"
      ? { title: "Botlings", body: "As notificações estão a funcionar. 🎉", url: "/settings/notifications", tag: "test" }
      : { title: "Botlings", body: "Notifications are working. 🎉", url: "/settings/notifications", tag: "test" },
  );
  return Response.json(result);
}
