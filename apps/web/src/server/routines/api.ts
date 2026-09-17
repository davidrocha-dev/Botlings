import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import type { RoutineSchedule } from "@/server/db/schema";
import { isValidTimeZone, nextRuns, scheduleSchema, scheduleToCron, SERVER_TIME_ZONE, validateCron } from "./schedule";

export type RoutineDto = {
  id: string;
  agentId: string;
  name: string;
  instruction: string;
  schedule: RoutineSchedule;
  cron: string;
  timeZone: string;
  enabled: boolean;
  createdBy: "user" | "agent";
  nextRuns: number[];
  lastRunAt: number | null;
  runs: {
    id: string;
    trigger: "schedule" | "manual";
    status: "running" | "completed" | "failed";
    startedAt: number;
    costUsd: number;
    error: string | null;
  }[];
};

export async function listRoutines(ownerId: string): Promise<RoutineDto[]> {
  const rows = await db
    .select()
    .from(schema.routines)
    .where(eq(schema.routines.ownerId, ownerId))
    .orderBy(desc(schema.routines.createdAt));
  const runs = rows.length
    ? await db
        .select()
        .from(schema.routineRuns)
        .where(inArray(schema.routineRuns.routineId, rows.map((r) => r.id)))
        .orderBy(desc(schema.routineRuns.startedAt))
    : [];
  return rows.map((r) => {
    let upcoming: number[] = [];
    if (r.enabled) {
      try {
        upcoming = nextRuns(r.cron, r.timeZone, 3).map((d) => d.getTime());
      } catch {}
    }
    return {
      id: r.id,
      agentId: r.agentId,
      name: r.name,
      instruction: r.instruction,
      schedule: r.schedule,
      cron: r.cron,
      timeZone: r.timeZone,
      enabled: r.enabled,
      createdBy: r.createdBy,
      nextRuns: upcoming,
      lastRunAt: r.lastRunAt?.getTime() ?? null,
      runs: runs
        .filter((run) => run.routineId === r.id)
        .slice(0, 5)
        .map((run) => ({
          id: run.id,
          trigger: run.trigger,
          status: run.status,
          startedAt: run.startedAt.getTime(),
          costUsd: run.costUsd,
          error: run.error,
        })),
    };
  });
}

export const routineInputSchema = z.object({
  agentId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  instruction: z.string().trim().min(1).max(4_000),
  schedule: scheduleSchema,
  timeZone: z.string().default(SERVER_TIME_ZONE),
  enabled: z.boolean().default(true),
});

/** Validates the schedule and returns the derived cron, or an error code. */
export function resolveSchedule(schedule: RoutineSchedule, timeZone: string) {
  if (!isValidTimeZone(timeZone)) return { error: "invalid_time_zone" as const };
  const cron = scheduleToCron(schedule);
  const error = validateCron(cron, timeZone);
  return error ? { error } : { cron };
}

export async function ownsAgent(ownerId: string, agentId: string) {
  const [row] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.ownerId, ownerId)));
  return !!row;
}
