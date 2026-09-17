import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { toMessageDto } from "@/server/data";
import { publish } from "@/server/events";
import { TASK_LIMITS, runAgentTurn, saveMessage, type AgentRow, type Emit } from "./agent-turn";
import type { TaskStatus } from "@/server/db/schema";
import { notify } from "@/server/notifications/notify";

/**
 * Delegation: the orchestrator hands work to another agent, which runs in the background in its
 * own conversation. When every task started while answering one user message has finished, the
 * orchestrator posts a summary in its own chat.
 */

type TaskRow = typeof schema.tasks.$inferSelect;

const globalTasks = globalThis as unknown as {
  botlingsTaskControllers?: Map<string, AbortController>;
  botlingsActiveRequests?: Set<string>;
};
/** Running tasks, so they can be cancelled. */
const controllers = (globalTasks.botlingsTaskControllers ??= new Map());
/** Orchestrator turns still in progress; their tasks are summarised only after the turn ends. */
const activeRequests = (globalTasks.botlingsActiveRequests ??= new Set());

async function conversationNames(conversationId: string) {
  const rows = await db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.conversationMembers)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.conversationMembers.agentId))
    .where(eq(schema.conversationMembers.conversationId, conversationId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Keeps the task card in the orchestrator's chat in sync with the task row. */
async function syncCard(task: TaskRow) {
  if (!task.cardMessageId) return;
  const [card] = await db
    .update(schema.messages)
    .set({
      metadata: {
        taskId: task.id,
        targetAgentId: task.targetAgentId ?? undefined,
        taskStatus: task.status,
        taskResult: task.result ?? undefined,
        taskError: task.error ?? undefined,
      },
    })
    .where(eq(schema.messages.id, task.cardMessageId))
    .returning();
  if (card) publish(task.ownerId, task.orchestratorConversationId, { type: "message", message: toMessageDto(card) });
}

async function finishTask(taskId: string, status: Exclude<TaskStatus, "running">, fields: { result?: string; error?: string; costUsd?: number }) {
  const [task] = await db
    .update(schema.tasks)
    .set({ status, result: fields.result ?? null, error: fields.error ?? null, costUsd: fields.costUsd ?? 0, completedAt: new Date() })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "running")))
    .returning();
  if (task) await syncCard(task);
  return task;
}

/** Runs a delegated task in the target agent's own conversation. */
async function runTask(taskId: string) {
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
  if (!task) return;

  const controller = new AbortController();
  controllers.set(task.id, controller);
  const timeout = setTimeout(() => controller.abort(new Error("Timed out")), TASK_LIMITS.timeoutMs);

  try {
    const [target] = task.targetAgentId
      ? await db.select().from(schema.agents).where(eq(schema.agents.id, task.targetAgentId))
      : [];
    const [orchestrator] = await db.select().from(schema.agents).where(eq(schema.agents.id, task.orchestratorAgentId));
    if (!target || !task.targetConversationId || !orchestrator) {
      await finishTask(task.id, "failed", { error: "The agent or its chat no longer exists." });
      return;
    }

    const conversationId = task.targetConversationId;
    const emit: Emit = (event) => publish(task.ownerId, conversationId, event);

    // The instruction appears in the target's chat as a message from the orchestrator.
    emit({
      type: "message",
      message: await saveMessage({ conversationId, authorType: "agent", agentId: orchestrator.id, content: task.instruction }),
    });

    const names = await conversationNames(conversationId);
    names.set(orchestrator.id, orchestrator.name);

    const result = await runAgentTurn({
      agent: target,
      conversation: { id: conversationId, type: "direct", names },
      emit,
      signal: controller.signal,
      mode: "delegated",
      delegatedBy: orchestrator.name,
      costLimitUsd: TASK_LIMITS.costLimitUsd,
    });

    if (controller.signal.aborted && (controller.signal.reason as Error | undefined)?.message === "Cancelled") {
      await finishTask(task.id, "cancelled", { result: result.content || undefined, costUsd: result.costUsd });
    } else if (result.error) {
      await finishTask(task.id, "failed", { error: result.error, result: result.content || undefined, costUsd: result.costUsd });
    } else {
      await finishTask(task.id, "completed", { result: result.content || "(no report)", costUsd: result.costUsd });
    }
  } catch (error) {
    await finishTask(task.id, "failed", { error: error instanceof Error ? error.message : "Task failed" });
  } finally {
    clearTimeout(timeout);
    controllers.delete(task.id);
    await maybeSummarize(task.requestId).catch((error) => console.error("[tasks] summary", error));
  }
}

/** Once all tasks of a request are finished (and the orchestrator's turn ended), report back. */
async function maybeSummarize(requestId: string) {
  if (activeRequests.has(requestId)) return;
  const all = await db.select().from(schema.tasks).where(eq(schema.tasks.requestId, requestId));
  if (!all.length || all.some((t) => t.status === "running")) return;

  // Claim the summary atomically so it runs once.
  const claimed = await db
    .update(schema.tasks)
    .set({ summarized: true })
    .where(and(eq(schema.tasks.requestId, requestId), eq(schema.tasks.summarized, false)))
    .returning({ id: schema.tasks.id });
  if (!claimed.length) return;

  const first = all[0];
  const [orchestrator] = await db.select().from(schema.agents).where(eq(schema.agents.id, first.orchestratorAgentId));
  if (!orchestrator) return;

  const targetIds = all.map((t) => t.targetAgentId).filter((id): id is string => !!id);
  const targets = targetIds.length
    ? await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(inArray(schema.agents.id, targetIds))
    : [];
  const nameOf = new Map(targets.map((t) => [t.id, t.name]));

  const report = all
    .map((t) => {
      const who = (t.targetAgentId && nameOf.get(t.targetAgentId)) || "A Botling";
      const outcome =
        t.status === "completed"
          ? `completed. Report:\n${t.result}`
          : t.status === "cancelled"
            ? "was cancelled by the user."
            : `failed: ${t.error}${t.result ? `\nPartial report:\n${t.result}` : ""}`;
      return `- Task for ${who} ("${t.instruction.slice(0, 200)}") ${outcome}`;
    })
    .join("\n\n");

  const conversationId = first.orchestratorConversationId;
  const result = await runAgentTurn({
    agent: orchestrator,
    conversation: { id: conversationId, type: "direct", names: await conversationNames(conversationId) },
    emit: (event) => publish(first.ownerId, conversationId, event),
    signal: new AbortController().signal,
    mode: "summary",
    extraMessages: [{ role: "user", content: `[Delegated task results]\n\n${report}` }],
  });
  if (!result.error && result.content) {
    await notify(first.ownerId, { type: "reply", agentName: orchestrator.name, text: result.content, conversationId });
  }
}

/**
 * Creates the delegate_task handler for one orchestrator turn. Enforces the per-request limit and
 * only allows delegating to other (non-orchestrator) agents of the same owner.
 */
export function createDelegator(opts: {
  orchestrator: AgentRow;
  conversationId: string;
  requestId: string;
  emit: Emit;
}) {
  let count = 0;

  return async ({ agentName, instruction }: { agentName: string; instruction: string }) => {
    if (count >= TASK_LIMITS.maxDelegationsPerRequest) {
      return `Refused: you already delegated ${count} tasks for this request (limit ${TASK_LIMITS.maxDelegationsPerRequest}). Handle the rest yourself or ask the user.`;
    }
    if (!instruction) return "Refused: the instruction is empty.";

    const [target] = await db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.ownerId, opts.orchestrator.ownerId),
          ne(schema.agents.id, opts.orchestrator.id),
          eq(schema.agents.isOrchestrator, false),
          eq(sql`lower(${schema.agents.name})`, agentName.trim().toLowerCase()),
        ),
      )
      .limit(1);
    if (!target) return `Refused: there is no Botling called "${agentName}" in your crew.`;

    const [direct] = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .innerJoin(schema.conversationMembers, eq(schema.conversationMembers.conversationId, schema.conversations.id))
      .where(and(eq(schema.conversations.type, "direct"), eq(schema.conversationMembers.agentId, target.id)))
      .limit(1);
    if (!direct) return `Refused: ${target.name} has no chat to work in.`;

    count += 1;

    const [task] = await db
      .insert(schema.tasks)
      .values({
        ownerId: opts.orchestrator.ownerId,
        requestId: opts.requestId,
        orchestratorAgentId: opts.orchestrator.id,
        orchestratorConversationId: opts.conversationId,
        targetAgentId: target.id,
        targetConversationId: direct.id,
        instruction,
      })
      .returning();

    const card = await saveMessage({
      conversationId: opts.conversationId,
      authorType: "agent",
      agentId: opts.orchestrator.id,
      kind: "task",
      content: instruction,
      metadata: { taskId: task.id, targetAgentId: target.id, taskStatus: "running" },
    });
    await db.update(schema.tasks).set({ cardMessageId: card.id }).where(eq(schema.tasks.id, task.id));
    opts.emit({ type: "message", message: card });

    void runTask(task.id);

    return `Delegated to ${target.name}; it is working on it now. Its result will be sent back to you automatically when it finishes — do not wait for it. Briefly tell the user who is handling it.`;
  };
}

/** Marks the end of an orchestrator turn; summarises any tasks that already finished meanwhile. */
export function beginRequest(requestId: string) {
  activeRequests.add(requestId);
  return async () => {
    activeRequests.delete(requestId);
    await maybeSummarize(requestId).catch((error) => console.error("[tasks] summary", error));
  };
}

/** Cancels a running task owned by the user. */
export async function cancelTask(ownerId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.ownerId, ownerId)));
  if (!task) return "not_found" as const;
  if (task.status !== "running") return "not_running" as const;

  const controller = controllers.get(task.id);
  if (controller) {
    controller.abort(new Error("Cancelled"));
  } else {
    // No live run (e.g. after a restart): close it directly.
    await finishTask(task.id, "cancelled", {});
    await maybeSummarize(task.requestId).catch(() => {});
  }
  return "ok" as const;
}

/** On startup, tasks left running by a previous process can never finish: mark them failed. */
export async function failInterruptedTasks() {
  const stale = await db.select().from(schema.tasks).where(eq(schema.tasks.status, "running"));
  for (const task of stale) {
    if (controllers.has(task.id)) continue;
    await finishTask(task.id, "failed", { error: "Interrupted: the server restarted." });
  }
  for (const requestId of new Set(stale.map((t) => t.requestId))) {
    await maybeSummarize(requestId).catch((error) => console.error("[tasks] summary", error));
  }
}
