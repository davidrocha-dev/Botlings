import { env } from "@/server/env";
import { markdownToTelegramHtml } from "./format";

/** Minimal Telegram Bot API client (only what Botlings uses). */

export type TelegramUser = { id: number; is_bot: boolean; first_name: string; username?: string; language_code?: string };
export type TelegramChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
export type TelegramMessage = { message_id: number; chat: TelegramChat; from?: TelegramUser; text?: string };
export type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string };
export type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery };
export type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export function telegramToken() {
  return env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export async function tg<T>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const token = telegramToken();
  if (!token) throw new TelegramError("Telegram bot is not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string; error_code?: number } | null;
  // Never include the URL in errors: it contains the token.
  if (!data?.ok) throw new TelegramError(data?.description ?? `Telegram ${method} failed (${res.status})`, data?.error_code ?? res.status);
  return data.result as T;
}

const LIMIT = 4000;

/** Splits long text on paragraph/line boundaries to fit Telegram's 4096-char message limit. */
export function splitMessage(text: string) {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > LIMIT) {
    let cut = rest.lastIndexOf("\n\n", LIMIT);
    if (cut < LIMIT / 2) cut = rest.lastIndexOf("\n", LIMIT);
    if (cut < LIMIT / 2) cut = rest.lastIndexOf(" ", LIMIT);
    if (cut < LIMIT / 2) cut = LIMIT;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Sends text, split to fit. With `markdown`, each part is formatted as Telegram HTML and resent as
 * plain text if Telegram rejects the markup. Keyboard goes on the last part.
 */
export async function sendText(chatId: string | number, text: string, keyboard?: InlineKeyboard, options: { markdown?: boolean } = {}) {
  const parts = splitMessage(text || "…");
  let last: TelegramMessage | null = null;
  for (const [i, part] of parts.entries()) {
    const base = {
      chat_id: chatId,
      link_preview_options: { is_disabled: true },
      ...(keyboard && i === parts.length - 1 ? { reply_markup: keyboard } : {}),
    };
    if (options.markdown) {
      try {
        last = await tg<TelegramMessage>("sendMessage", { ...base, text: markdownToTelegramHtml(part), parse_mode: "HTML" });
        continue;
      } catch (error) {
        if (!(error instanceof TelegramError && error.code === 400)) throw error;
      }
    }
    last = await tg<TelegramMessage>("sendMessage", { ...base, text: part });
  }
  return last;
}
