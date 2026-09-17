import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import type { RoutineSchedule } from "@/server/db/schema";

export const SERVER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const scheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily"), time }),
  z.object({ type: z.literal("weekdays"), time }),
  z.object({ type: z.literal("weekly"), day: z.number().int().min(0).max(6), time }),
  z.object({ type: z.literal("hourly"), every: z.number().int().min(1).max(24) }),
  z.object({ type: z.literal("cron"), cron: z.string().trim().min(9).max(100) }),
]);

/** Minimum gap between runs, so a routine can't burn through the budget every minute. */
const MIN_INTERVAL_MS = 15 * 60_000;

export function scheduleToCron(schedule: RoutineSchedule) {
  const hm = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `${m} ${h}`;
  };
  switch (schedule.type) {
    case "daily":
      return `${hm(schedule.time)} * * *`;
    case "weekdays":
      return `${hm(schedule.time)} * * 1-5`;
    case "weekly":
      return `${hm(schedule.time)} * * ${schedule.day}`;
    case "hourly":
      return `0 */${schedule.every} * * *`;
    case "cron":
      return schedule.cron;
  }
}

export function nextRuns(cron: string, timeZone: string, count = 1, from = new Date()) {
  const it = CronExpressionParser.parse(cron, { tz: timeZone, currentDate: from });
  return Array.from({ length: count }, () => it.next().toDate());
}

/** Returns an error code when the cron is invalid or runs more often than every 15 minutes. */
export function validateCron(cron: string, timeZone: string): "invalid_schedule" | "too_frequent" | null {
  if (cron.trim().split(/\s+/).length !== 5) return "invalid_schedule";
  try {
    const runs = nextRuns(cron, timeZone, 4);
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].getTime() - runs[i - 1].getTime() < MIN_INTERVAL_MS) return "too_frequent";
    }
    return null;
  } catch {
    return "invalid_schedule";
  }
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}
