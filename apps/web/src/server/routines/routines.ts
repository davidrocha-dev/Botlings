import { and, eq, lte } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { toMessageDto } from "@/server/data";
import { publish } from "@/server/events";
import { runAgentTurn } from "@/server/chat/agent-turn";
import { saveMessage } from "@/server/chat/save-message";
import { nextRuns } from "./schedule";

type RoutineRow = typeof schema.routines.$inferSelect;

const TICK_MS = 30_000;
const RUN_TIMEOUT_MS = 20 * 60_000;

const globalRoutines = globalThis as unknown as {
  botlingsRoutineTimer?: NodeJS.Timeout;
  botlingsRunningRoutines?: Set<string>;
  botlingsRoutineListeners?: Set<RoutineListener>;
};
/** Routines with a run in progress in this process (a routine never overlaps itself). */
const running = (globalRoutines.botlingsRunningRoutines ??= new Set());

export type RoutineRunEvent = {
  ownerId: string;
  agentId: string;
  routineName: string;
  status: "completed" | "failed";
  summary: string;
  conversationId: string;
};
type RoutineListener = (event: RoutineRunEvent) => void | Promise<void>;
const listeners = (globalRoutines.botlingsRoutineListeners ??= new Set());

/** Lets notification channels (push, Telegram) react to finished runs. */
export function onRoutineFinished(listener: RoutineListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function computeNextRun(routine: Pick<RoutineRow, "cron" | "timeZone">, from = new Date()) {
  try {
    return nextRuns(routine.cron, routine.timeZone, 1, from)[0];
  } catch {
    return null;
  }
}

async function directConversationId(agentId: string) {
  const [row] = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .innerJoin(schema.conversationMembers, eq(schema.conversationMembers.conversationId, schema.conversations.id))
    .where(and(eq(schema.conversations.type, "direct"), eq(schema.conversationMembers.agentId, agentId)))
    .limit(1);
  return row?.id ?? null;
}

async function updateRunCard(cardMessageId: string | null, ownerId: string, patch: Record<string, unknown>) {
  if (!cardMessageId) return;
  const [current] = await db.select().from(schema.messages).where(eq(schema.messages.id, cardMessageId));
  if (!current) return;
  const [card] = await db
    .update(schema.messages)
    .set({ metadata: { ...(current.metadata ?? {}), ...patch } })
    .where(eq(schema.messages.id, cardMessageId))
    .returning();
  publish(ownerId, card.conversationId, { type: "message", message: toMessageDto(card) });
}

/** Runs a routine now, in the agent's own chat. Returns false if it was already running. */
export async function runRoutine(routineId: string, trigger: "schedule" | "manual") {
  if (running.has(routineId)) return false;
  // Claim synchronously so two concurrent starts can't both pass the check above.
  running.add(routineId);
  const [routine] = await db.select().from(schema.routines).where(eq(schema.routines.id, routineId));
  const agent = routine
    ? (await db.select().from(schema.agents).where(eq(schema.agents.id, routine.agentId)))[0]
    : undefined;
  const conversationId = routine ? await directConversationId(routine.agentId) : null;
  if (!routine || !agent || !conversationId) {
    running.delete(routineId);
    return false;
  }

  const [run] = await db.insert(schema.routineRuns).values({ routineId, trigger }).returning();
  await db.update(schema.routines).set({ lastRunAt: new Date() }).where(eq(schema.routines.id, routineId));

  const emit = (event: Parameters<typeof publish>[2]) => publish(routine.ownerId, conversationId, event);
  const card = await saveMessage({
    conversationId,
    authorType: "agent",
    agentId: agent.id,
    kind: "routine",
    content: routine.instruction,
    metadata: { routineId, routineName: routine.name, routineRunId: run.id, routineRunStatus: "running" },
  });
  await db.update(schema.routineRuns).set({ cardMessageId: card.id }).where(eq(schema.routineRuns.id, run.id));
  emit({ type: "message", message: card });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Routine timed out")), RUN_TIMEOUT_MS);
  let status: "completed" | "failed" = "failed";
  let summary = "";
  try {
    const names = new Map([[agent.id, agent.name]]);
    const result = await runAgentTurn({
      agent,
      conversation: { id: conversationId, type: "direct", names },
      emit,
      signal: controller.signal,
      mode: "routine",
      routineName: routine.name,
      extraMessages: [{ role: "user", content: `[Scheduled routine "${routine.name}"] ${routine.instruction}` }],
    });
    status = result.error ? "failed" : "completed";
    summary = result.error ?? (result.finalContent || result.content);
    await db
      .update(schema.routineRuns)
      .set({ status, result: result.content || null, error: result.error ?? null, costUsd: result.costUsd, finishedAt: new Date() })
      .where(eq(schema.routineRuns.id, run.id));
  } catch (error) {
    summary = error instanceof Error ? error.message : "Routine failed";
    await db
      .update(schema.routineRuns)
      .set({ status: "failed", error: summary, finishedAt: new Date() })
      .where(eq(schema.routineRuns.id, run.id));
  } finally {
    clearTimeout(timeout);
    running.delete(routineId);
    await updateRunCard(card.id, routine.ownerId, { routineRunStatus: status });
  }

  for (const listener of listeners) {
    Promise.resolve(
      listener({ ownerId: routine.ownerId, agentId: agent.id, routineName: routine.name, status, summary, conversationId }),
    ).catch((error) => console.error("[routines] listener", error));
  }
  return true;
}

/** Claims and starts routines that are due. Claiming moves next_run_at forward first, so a run starts once. */
async function tick() {
  const due = await db
    .select()
    .from(schema.routines)
    .where(and(eq(schema.routines.enabled, true), lte(schema.routines.nextRunAt, new Date())));
  for (const routine of due) {
    const next = computeNextRun(routine);
    const [claimed] = await db
      .update(schema.routines)
      .set({ nextRunAt: next })
      .where(and(eq(schema.routines.id, routine.id), eq(schema.routines.nextRunAt, routine.nextRunAt!)))
      .returning({ id: schema.routines.id });
    if (claimed) void runRoutine(routine.id, "schedule").catch((error) => console.error("[routines] run", error));
  }
}

export async function startScheduler() {
  // Runs interrupted by a restart can't resume.
  const stale = await db.select().from(schema.routineRuns).where(eq(schema.routineRuns.status, "running"));
  for (const run of stale) {
    await db
      .update(schema.routineRuns)
      .set({ status: "failed", error: "Interrupted: the server restarted.", finishedAt: new Date() })
      .where(eq(schema.routineRuns.id, run.id));
    const [routine] = await db.select({ ownerId: schema.routines.ownerId }).from(schema.routines).where(eq(schema.routines.id, run.routineId));
    if (routine) await updateRunCard(run.cardMessageId, routine.ownerId, { routineRunStatus: "failed" });
  }
  // Occurrences missed while the server was off are skipped, not replayed.
  const enabled = await db.select().from(schema.routines).where(eq(schema.routines.enabled, true));
  for (const routine of enabled) {
    if (!routine.nextRunAt || routine.nextRunAt < new Date()) {
      await db.update(schema.routines).set({ nextRunAt: computeNextRun(routine) }).where(eq(schema.routines.id, routine.id));
    }
  }
  globalRoutines.botlingsRoutineTimer ??= setInterval(() => {
    tick().catch((error) => console.error("[routines] tick", error));
  }, TICK_MS);
}
