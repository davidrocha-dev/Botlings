import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

/**
 * Spend comes from the usage ledger (one row per agent turn), which survives agent and chat
 * deletion. Day and month boundaries follow the server's time zone.
 */

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfMonth() {
  const d = startOfToday();
  d.setDate(1);
  return d;
}

const L = schema.usageLedger;
const costSum = sql<number>`coalesce(sum(${L.costUsd}), 0)::float`;
const tokenSum = sql<number>`coalesce(sum(${L.promptTokens} + ${L.completionTokens}), 0)::int`;

async function spendSince(ownerId: string, since: Date, agentId?: string) {
  const [row] = await db
    .select({ cost: costSum })
    .from(L)
    .where(and(eq(L.ownerId, ownerId), gte(L.createdAt, since), agentId ? eq(L.agentId, agentId) : undefined));
  return row?.cost ?? 0;
}

export type BudgetScope = { period: "day" | "month"; agentId: string | null; limitUsd: number; spentUsd: number };

export class BudgetExceededError extends Error {
  constructor(public budget: BudgetScope) {
    super(
      `${budget.agentId ? "This agent's" : "Your"} ${budget.period === "day" ? "daily" : "monthly"} budget of $${budget.limitUsd.toFixed(2)} has been reached ($${budget.spentUsd.toFixed(4)} spent). Raise it in Usage & budgets to continue.`,
    );
  }
}

/**
 * Throws BudgetExceededError when the owner's or the agent's budget is used up.
 * `pendingUsd` is spend from the current turn that hasn't been saved yet.
 */
export async function assertWithinBudget(ownerId: string, agentId: string, pendingUsd = 0) {
  const limits = await db
    .select()
    .from(schema.budgets)
    .where(eq(schema.budgets.ownerId, ownerId));
  const relevant = limits.filter((b) => b.agentId === null || b.agentId === agentId);
  for (const budget of relevant) {
    const since = budget.period === "day" ? startOfToday() : startOfMonth();
    const spent = (await spendSince(ownerId, since, budget.agentId ?? undefined)) + pendingUsd;
    if (spent >= budget.limitUsd) {
      throw new BudgetExceededError({ period: budget.period, agentId: budget.agentId, limitUsd: budget.limitUsd, spentUsd: spent });
    }
  }
}

export type UsageReport = {
  timeZone: string;
  todayUsd: number;
  monthUsd: number;
  rangeUsd: number;
  rangeTokens: number;
  days: { date: string; costUsd: number; tokens: number }[];
  agents: { agentId: string | null; agentName: string; costUsd: number; tokens: number; monthUsd: number }[];
  models: { model: string; costUsd: number; tokens: number }[];
  budgets: { dailyUsd: number | null; monthlyUsd: number | null; agents: { agentId: string; monthlyUsd: number }[] };
};

export async function getUsageReport(ownerId: string, rangeDays = 30): Promise<UsageReport> {
  const rangeStart = startOfToday();
  rangeStart.setDate(rangeStart.getDate() - (rangeDays - 1));
  const monthStart = startOfMonth();

  const ownedSince = (since: Date) => and(eq(L.ownerId, ownerId), gte(L.createdAt, since));
  const day = sql<string>`to_char(${L.createdAt} at time zone ${TIME_ZONE}, 'YYYY-MM-DD')`;

  const [byDay, byAgent, byAgentMonth, byModel, todayUsd, monthUsd, budgetRows] = await Promise.all([
    db
      .select({ date: day, costUsd: costSum, tokens: tokenSum })
      .from(L)
      .where(ownedSince(rangeStart))
      // By position: the day expression binds the time zone as a parameter, so it can’t be repeated.
      .groupBy(sql`1`),
    db
      .select({ agentId: L.agentId, agentName: sql<string>`max(${L.agentName})`, costUsd: costSum, tokens: tokenSum })
      .from(L)
      .where(ownedSince(rangeStart))
      .groupBy(L.agentId)
      .orderBy(desc(costSum)),
    db.select({ agentId: L.agentId, costUsd: costSum }).from(L).where(ownedSince(monthStart)).groupBy(L.agentId),
    db
      .select({ model: L.model, costUsd: costSum, tokens: tokenSum })
      .from(L)
      .where(and(ownedSince(rangeStart), sql`${L.model} is not null`))
      .groupBy(L.model)
      .orderBy(desc(costSum)),
    spendSince(ownerId, startOfToday()),
    spendSince(ownerId, monthStart),
    db.select().from(schema.budgets).where(eq(schema.budgets.ownerId, ownerId)),
  ]);

  // Every day in the range, including days without activity.
  const costByDay = new Map(byDay.map((d) => [d.date, d]));
  const days: UsageReport["days"] = [];
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(rangeStart);
    d.setDate(rangeStart.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const row = costByDay.get(key);
    days.push({ date: key, costUsd: row?.costUsd ?? 0, tokens: row?.tokens ?? 0 });
  }

  const monthByAgent = new Map(byAgentMonth.map((r) => [r.agentId, r.costUsd]));
  return {
    timeZone: TIME_ZONE,
    todayUsd,
    monthUsd,
    rangeUsd: days.reduce((sum, d) => sum + d.costUsd, 0),
    rangeTokens: days.reduce((sum, d) => sum + d.tokens, 0),
    days,
    agents: byAgent.map((a) => ({ ...a, monthUsd: monthByAgent.get(a.agentId) ?? 0 })),
    models: byModel.map((m) => ({ model: m.model ?? "?", costUsd: m.costUsd, tokens: m.tokens })),
    budgets: {
      dailyUsd: budgetRows.find((b) => !b.agentId && b.period === "day")?.limitUsd ?? null,
      monthlyUsd: budgetRows.find((b) => !b.agentId && b.period === "month")?.limitUsd ?? null,
      agents: budgetRows
        .filter((b): b is typeof b & { agentId: string } => !!b.agentId && b.period === "month")
        .map((b) => ({ agentId: b.agentId, monthlyUsd: b.limitUsd })),
    },
  };
}

export type BudgetInput = {
  dailyUsd: number | null;
  monthlyUsd: number | null;
  agents: { agentId: string; monthlyUsd: number | null }[];
};

/** Replaces the owner's budgets. `null` removes a limit. */
export async function saveBudgets(ownerId: string, input: BudgetInput) {
  const owned = new Set(
    (await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.ownerId, ownerId))).map((a) => a.id),
  );

  const upsert = async (agentId: string | null, period: "day" | "month", limitUsd: number | null) => {
    const scope = and(
      eq(schema.budgets.ownerId, ownerId),
      eq(schema.budgets.period, period),
      agentId ? eq(schema.budgets.agentId, agentId) : isNull(schema.budgets.agentId),
    );
    if (limitUsd === null) {
      await db.delete(schema.budgets).where(scope);
      return;
    }
    const updated = await db.update(schema.budgets).set({ limitUsd }).where(scope).returning({ id: schema.budgets.id });
    if (!updated.length) await db.insert(schema.budgets).values({ ownerId, agentId, period, limitUsd });
  };

  await upsert(null, "day", input.dailyUsd);
  await upsert(null, "month", input.monthlyUsd);
  for (const a of input.agents) {
    if (owned.has(a.agentId)) await upsert(a.agentId, "month", a.monthlyUsd);
  }
}
