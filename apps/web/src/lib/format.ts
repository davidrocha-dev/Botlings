import type { Locale } from "./i18n/dictionaries";

export function formatListTime(timestamp: number, locale: Locale) {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
  }
  return date.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

export function formatMessageTime(timestamp: number, locale: Locale) {
  return new Date(timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function formatUsd(value: number) {
  return `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;
}
