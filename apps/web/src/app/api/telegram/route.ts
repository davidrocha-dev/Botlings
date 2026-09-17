import { getCurrentUser } from "@/server/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { createLinkCode, telegramStatus, unlinkTelegram } from "@/server/telegram/bot";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await telegramStatus(user.id));
}

/** Creates a one-time t.me link that connects the Telegram chat opening it to this account. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const status = await telegramStatus(user.id);
  if (!status.running) return Response.json({ error: "not_configured" }, { status: 409 });
  return Response.json(createLinkCode(user.id, await getLocale()));
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await unlinkTelegram(user.id);
  return Response.json(await telegramStatus(user.id));
}
