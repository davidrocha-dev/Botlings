import type { Dictionary } from "@/lib/i18n/dictionaries";

export type RoutineSchedule =
  | { type: "daily"; time: string }
  | { type: "weekdays"; time: string }
  | { type: "weekly"; day: number; time: string }
  | { type: "hourly"; every: number }
  | { type: "cron"; cron: string };

/** Localized weekday name for 0 (Sunday) … 6 (Saturday). */
export function weekdayName(day: number, locale: string) {
  // 2023-01-01 was a Sunday.
  return new Date(Date.UTC(2023, 0, 1 + day, 12)).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" });
}

export function describeSchedule(schedule: RoutineSchedule, t: Dictionary, locale: string) {
  switch (schedule.type) {
    case "daily":
      return t.routines.describe.daily.replace("{time}", schedule.time);
    case "weekdays":
      return t.routines.describe.weekdays.replace("{time}", schedule.time);
    case "weekly":
      return t.routines.describe.weekly.replace("{day}", weekdayName(schedule.day, locale)).replace("{time}", schedule.time);
    case "hourly":
      return schedule.every === 1 ? t.routines.describe.everyHour : t.routines.describe.hourly.replace("{every}", String(schedule.every));
    case "cron":
      return t.routines.describe.cron.replace("{cron}", schedule.cron);
  }
}
