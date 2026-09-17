import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import type { NotificationPrefs } from "@/server/db/schema";
import { isUserPresent } from "./presence";
import { sendPush } from "./push";

export type NotificationCategory = keyof NotificationPrefs;

/** What happened, in structured form; each channel renders it in the recipient's language. */
export type NotificationEvent =
  | { type: "approval"; agentName: string; detail: string; conversationId: string; approvalId: string }
  | { type: "routine"; routineName: string; status: "completed" | "failed"; summary: string; conversationId: string }
  | { type: "reply"; agentName: string; text: string; conversationId: string };

const CATEGORY: Record<NotificationEvent["type"], NotificationCategory> = {
  approval: "approvals",
  routine: "routines",
  reply: "replies",
};

/** Extra delivery channels (Telegram) plug in here. */
export type NotificationChannel = (userId: string, event: NotificationEvent) => Promise<void>;
const globalChannels = globalThis as unknown as { botlingsNotificationChannels?: Map<string, NotificationChannel> };
const channels = (globalChannels.botlingsNotificationChannels ??= new Map());

export function registerNotificationChannel(name: string, channel: NotificationChannel) {
  channels.set(name, channel);
}

const TEXT = {
  en: {
    approval: (agent: string) => `${agent} needs your approval`,
    routineDone: (name: string) => `Routine “${name}” finished`,
    routineFailed: (name: string) => `Routine “${name}” failed`,
  },
  pt: {
    approval: (agent: string) => `${agent} precisa da tua aprovação`,
    routineDone: (name: string) => `Rotina “${name}” concluída`,
    routineFailed: (name: string) => `Rotina “${name}” falhou`,
  },
};

export function notificationText(event: NotificationEvent, locale: string) {
  const t = locale === "pt" ? TEXT.pt : TEXT.en;
  switch (event.type) {
    case "approval":
      return { title: t.approval(event.agentName), body: event.detail };
    case "routine":
      return {
        title: event.status === "completed" ? t.routineDone(event.routineName) : t.routineFailed(event.routineName),
        body: event.summary,
      };
    case "reply":
      return { title: event.agentName, body: event.text };
  }
}

/** Plain text for notification bodies: drops Markdown noise and collapses whitespace. */
function plain(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Notifies the user on every channel, unless they turned the category off or are looking at the
 * app right now. Never throws.
 */
export async function notify(userId: string, event: NotificationEvent) {
  try {
    if (isUserPresent(userId)) return;
    const [user] = await db
      .select({ prefs: schema.users.notificationPrefs })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user || user.prefs[CATEGORY[event.type]] === false) return;

    const tag = event.type === "approval" ? `approval-${event.approvalId}` : `conversation-${event.conversationId}`;
    await Promise.all([
      sendPush(userId, (locale) => {
        const { title, body } = notificationText(event, locale);
        return { title, body: plain(body), url: `/c/${event.conversationId}`, tag };
      }),
      ...[...channels.values()].map((channel) => channel(userId, event)),
    ]);
  } catch (error) {
    console.error("[notify]", error);
  }
}
