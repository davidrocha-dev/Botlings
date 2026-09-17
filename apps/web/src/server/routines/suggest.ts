import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { toMessageDto } from "@/server/data";
import type { RoutineSchedule } from "@/server/db/schema";
import type { ToolDefinition } from "@/server/openrouter";
import type { Message } from "@/lib/types";
import { saveMessage } from "@/server/chat/save-message";
import { nextRuns, SERVER_TIME_ZONE, validateCron } from "./schedule";

type AgentRow = typeof schema.agents.$inferSelect;

function computeNextRun(routine: { cron: string; timeZone: string }) {
  try {
    return nextRuns(routine.cron, routine.timeZone, 1)[0];
  } catch {
    return null;
  }
}


export const SUGGEST_ROUTINE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "suggest_routine",
    description:
      "Suggest a recurring scheduled task for yourself when the user asks for something to happen regularly (e.g. every morning, every Monday). It is created disabled and only runs after the user enables it.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name, e.g. Morning inbox summary" },
        instruction: { type: "string", description: "What to do at each run, self-contained" },
        cron: { type: "string", description: "5-field cron in the user's time zone, e.g. '0 9 * * 1-5' for weekdays at 09:00" },
      },
      required: ["name", "instruction", "cron"],
    },
  },
};

export async function suggestRoutine(agent: AgentRow, conversationId: string, args: Record<string, unknown>) {
  const name = String(args.name ?? "").trim().slice(0, 80);
  const instruction = String(args.instruction ?? "").trim().slice(0, 4_000);
  const cron = String(args.cron ?? "").trim();
  if (!name || !instruction) return { toolResult: "Refused: name and instruction are required." };
  const cronError = validateCron(cron, SERVER_TIME_ZONE);
  if (cronError) {
    return {
      toolResult:
        cronError === "too_frequent"
          ? "Refused: routines can run at most every 15 minutes."
          : "Refused: invalid cron. Use 5 fields: minute hour day-of-month month day-of-week.",
    };
  }

  const schedule: RoutineSchedule = { type: "cron", cron };
  const [routine] = await db
    .insert(schema.routines)
    .values({
      ownerId: agent.ownerId,
      agentId: agent.id,
      name,
      instruction,
      schedule,
      cron,
      timeZone: SERVER_TIME_ZONE,
      enabled: false,
      createdBy: "agent",
    })
    .returning();
  const card = await saveMessage({
    conversationId,
    authorType: "agent",
    agentId: agent.id,
    kind: "routine",
    content: instruction,
    metadata: { routineId: routine.id, routineName: name, routineSuggestion: "pending", routineCron: cron },
  });
  return {
    card,
    toolResult: "Routine suggested. It stays disabled until the user enables it on the card. Mention it briefly.",
  };
}

/** The user's decision on a suggested routine: enable it, or discard (delete) it. */
export async function decideRoutineSuggestion(ownerId: string, messageId: string, decision: "enable" | "discard") {
  const [card] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId));
  const meta = card?.metadata;
  if (!card || card.kind !== "routine" || !meta?.routineId || meta.routineSuggestion !== "pending") return { error: "not_found" as const };
  const [routine] = await db
    .select()
    .from(schema.routines)
    .where(and(eq(schema.routines.id, meta.routineId), eq(schema.routines.ownerId, ownerId)));
  if (!routine) return { error: "not_found" as const };

  if (decision === "enable") {
    await db
      .update(schema.routines)
      .set({ enabled: true, nextRunAt: computeNextRun(routine) })
      .where(eq(schema.routines.id, routine.id));
  } else {
    await db.delete(schema.routines).where(eq(schema.routines.id, routine.id));
  }
  const [updated] = await db
    .update(schema.messages)
    .set({ metadata: { ...meta, routineSuggestion: decision === "enable" ? "enabled" : "discarded" } })
    .where(eq(schema.messages.id, messageId))
    .returning();
  return { message: toMessageDto(updated) as Message };
}
