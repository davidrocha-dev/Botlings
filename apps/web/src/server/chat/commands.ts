import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { runRoutine } from "@/server/routines/routines";
import { getUsageReport } from "@/server/usage/usage";
import { stopGenerations } from "./generations";
import { listMemories } from "./memory";
import { cancelTask } from "./tasks";
import type { AgentRow } from "./agent-turn";

/**
 * Slash commands shared by the web chat and Telegram. They run on the server without calling a
 * model, so they're instant and free. `/model <id>` is handled by respond.ts (it changes state
 * through changeModel).
 */

export type CommandName = "help" | "new" | "stop" | "status" | "cost" | "model" | "memory" | "routines" | "routine" | "approvals";

const ALIASES: Record<string, CommandName> = {
  help: "help",
  ajuda: "help",
  new: "new",
  novo: "new",
  stop: "stop",
  parar: "stop",
  status: "status",
  estado: "status",
  cost: "cost",
  custo: "cost",
  custos: "cost",
  model: "model",
  modelo: "model",
  memory: "memory",
  memoria: "memory",
  routines: "routines",
  rotinas: "routines",
  routine: "routine",
  rotina: "routine",
  approvals: "approvals",
  aprovacoes: "approvals",
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Recognises "/name args" (also "/name@bot"); returns null for anything that isn't a known command. */
export function parseCommand(text: string) {
  const match = text.trim().match(/^\/([\p{L}_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/u);
  if (!match) return null;
  const name = ALIASES[normalize(match[1])];
  return name ? { name, args: (match[2] ?? "").trim() } : null;
}

type Lang = "en" | "pt";

const TEXT = {
  en: {
    help: [
      "**Commands**",
      "- `/new` — start a new topic (older messages stay, but the agent stops using them)",
      "- `/stop` — stop what the agent is doing",
      "- `/status` — tasks, routines and approvals in progress",
      "- `/cost` — spend today and this month",
      "- `/model` — show the model · `/model <id>` — change it",
      "- `/memory` — what the agent remembers",
      "- `/routines` — your routines · `/routine <name>` — run one now",
      "- `/approvals` — actions waiting for you",
    ].join("\n"),
    newTopic: (agent: string) => `🧹 New topic. ${agent} won't use the earlier messages anymore (they're still here).`,
    stopped: (n: number) => (n ? `⏹️ Stopped (${n}).` : "Nothing is running right now."),
    statusTitle: "**In progress**",
    nothingRunning: "Nothing is running. ✨",
    tasks: "Delegated tasks",
    routinesRunning: "Routines running",
    approvalsPending: "Waiting for approval",
    since: "since",
    costTitle: "**Spend**",
    today: "Today",
    month: "This month",
    budgetDay: "Daily budget",
    budgetMonth: "Monthly budget",
    left: "left",
    noBudget: "No budget set (Usage & budgets).",
    model: (agent: string, model: string) => `${agent} is using \`${model}\`. Change it with \`/model <id>\`.`,
    memoryTitle: (agent: string) => `**What ${agent} remembers**`,
    memoryEmpty: (agent: string) => `${agent} doesn't remember anything yet.`,
    routinesTitle: "**Routines**",
    routinesEmpty: "No routines yet. Ask an agent or open Routines to create one.",
    paused: "paused",
    next: "next",
    routineStarted: (name: string, agent: string) => `▶️ Running “${name}” now — ${agent} will post the result in its chat.`,
    routineBusy: (name: string) => `“${name}” is already running.`,
    routineMissing: (name: string) => `No routine called “${name}”. Send /routines to see the list.`,
    routineUsage: "Usage: `/routine <name>`",
    approvalsTitle: "**Waiting for your approval**",
    approvalsEmpty: "No approvals waiting. ✅",
  },
  pt: {
    help: [
      "**Comandos**",
      "- `/novo` — começar um assunto novo (as mensagens antigas ficam, mas o agente deixa de as usar)",
      "- `/parar` — parar o que o agente está a fazer",
      "- `/estado` — tarefas, rotinas e aprovações em curso",
      "- `/custo` — gasto de hoje e do mês",
      "- `/modelo` — ver o modelo · `/modelo <id>` — mudá-lo",
      "- `/memoria` — o que o agente sabe sobre ti",
      "- `/rotinas` — as tuas rotinas · `/rotina <nome>` — correr uma agora",
      "- `/aprovacoes` — ações à tua espera",
    ].join("\n"),
    newTopic: (agent: string) => `🧹 Assunto novo. ${agent} deixa de usar as mensagens anteriores (continuam aqui).`,
    stopped: (n: number) => (n ? `⏹️ Parado (${n}).` : "Não há nada a correr agora."),
    statusTitle: "**Em curso**",
    nothingRunning: "Não há nada a correr. ✨",
    tasks: "Tarefas delegadas",
    routinesRunning: "Rotinas a correr",
    approvalsPending: "À espera de aprovação",
    since: "desde",
    costTitle: "**Gastos**",
    today: "Hoje",
    month: "Este mês",
    budgetDay: "Orçamento diário",
    budgetMonth: "Orçamento mensal",
    left: "disponível",
    noBudget: "Sem orçamento definido (Custos e orçamentos).",
    model: (agent: string, model: string) => `${agent} está a usar \`${model}\`. Muda com \`/modelo <id>\`.`,
    memoryTitle: (agent: string) => `**O que ${agent} sabe**`,
    memoryEmpty: (agent: string) => `${agent} ainda não guardou nada.`,
    routinesTitle: "**Rotinas**",
    routinesEmpty: "Ainda não há rotinas. Pede a um agente ou abre Rotinas para criar uma.",
    paused: "em pausa",
    next: "próxima",
    routineStarted: (name: string, agent: string) => `▶️ A correr “${name}” agora — ${agent} publica o resultado no chat dele.`,
    routineBusy: (name: string) => `“${name}” já está a correr.`,
    routineMissing: (name: string) => `Não há nenhuma rotina chamada “${name}”. Envia /rotinas para ver a lista.`,
    routineUsage: "Uso: `/rotina <nome>`",
    approvalsTitle: "**À espera da tua aprovação**",
    approvalsEmpty: "Nenhuma aprovação pendente. ✅",
  },
};

export type PendingApproval = { id: string; agentName: string; detail: string };
export type CommandResult = { text: string; pendingApprovals?: PendingApproval[] };

const money = (usd: number) => `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;

function when(date: Date, lang: Lang, timeZone?: string) {
  return date.toLocaleString(lang === "pt" ? "pt-PT" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

async function agentNames(ownerId: string) {
  const rows = await db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.ownerId, ownerId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function pendingApprovals(ownerId: string): Promise<PendingApproval[]> {
  const names = await agentNames(ownerId);
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.ownerId, ownerId), eq(schema.approvals.status, "pending")))
    .orderBy(asc(schema.approvals.createdAt));
  return rows.map((r) => ({ id: r.id, agentName: names.get(r.agentId) ?? "Botling", detail: r.detail }));
}

export async function runCommand(opts: {
  ownerId: string;
  conversationId: string;
  agent: AgentRow;
  name: CommandName;
  args: string;
  locale: string;
}): Promise<CommandResult> {
  const lang: Lang = opts.locale === "pt" ? "pt" : "en";
  const t = TEXT[lang];
  const { ownerId, conversationId, agent } = opts;

  switch (opts.name) {
    case "help":
      return { text: t.help };

    case "new": {
      const now = new Date();
      await db
        .update(schema.conversations)
        .set({ contextStartedAt: now, summary: "", summaryUntil: now })
        .where(eq(schema.conversations.id, conversationId));
      return { text: t.newTopic(agent.name) };
    }

    case "stop": {
      let stopped = stopGenerations(conversationId);
      // Tasks the orchestrator delegated from this chat run elsewhere: cancel those too.
      const tasks = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.orchestratorConversationId, conversationId), eq(schema.tasks.status, "running")));
      for (const task of tasks) if ((await cancelTask(ownerId, task.id)) === "ok") stopped += 1;
      return { text: t.stopped(stopped) };
    }

    case "status": {
      const names = await agentNames(ownerId);
      const tasks = await db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.ownerId, ownerId), eq(schema.tasks.status, "running")));
      const runs = await db
        .select({ name: schema.routines.name, agentId: schema.routines.agentId, startedAt: schema.routineRuns.startedAt })
        .from(schema.routineRuns)
        .innerJoin(schema.routines, eq(schema.routines.id, schema.routineRuns.routineId))
        .where(and(eq(schema.routines.ownerId, ownerId), eq(schema.routineRuns.status, "running")));
      const approvals = await pendingApprovals(ownerId);
      if (!tasks.length && !runs.length && !approvals.length) return { text: t.nothingRunning };

      const lines = [t.statusTitle];
      if (tasks.length) {
        lines.push("", `${t.tasks}:`);
        for (const task of tasks) {
          lines.push(`- **${names.get(task.targetAgentId ?? "") ?? "Botling"}** — ${task.instruction.slice(0, 120)}`);
        }
      }
      if (runs.length) {
        lines.push("", `${t.routinesRunning}:`);
        for (const run of runs) lines.push(`- **${run.name}** (${names.get(run.agentId) ?? "Botling"}) — ${t.since} ${when(run.startedAt, lang)}`);
      }
      if (approvals.length) {
        lines.push("", `${t.approvalsPending}:`);
        for (const a of approvals) lines.push(`- **${a.agentName}** — ${a.detail.slice(0, 120)}`);
      }
      return { text: lines.join("\n"), pendingApprovals: approvals.length ? approvals : undefined };
    }

    case "cost": {
      const report = await getUsageReport(ownerId, 1);
      const lines = [t.costTitle, `- ${t.today}: **${money(report.todayUsd)}**`, `- ${t.month}: **${money(report.monthUsd)}**`];
      const { dailyUsd, monthlyUsd } = report.budgets;
      if (dailyUsd != null) lines.push(`- ${t.budgetDay}: ${money(dailyUsd)} (${money(Math.max(0, dailyUsd - report.todayUsd))} ${t.left})`);
      if (monthlyUsd != null) lines.push(`- ${t.budgetMonth}: ${money(monthlyUsd)} (${money(Math.max(0, monthlyUsd - report.monthUsd))} ${t.left})`);
      if (dailyUsd == null && monthlyUsd == null) lines.push("", t.noBudget);
      return { text: lines.join("\n") };
    }

    case "model":
      return { text: t.model(agent.name, agent.model) };

    case "memory": {
      const memories = await listMemories(agent.id);
      if (!memories.length) return { text: t.memoryEmpty(agent.name) };
      return { text: [t.memoryTitle(agent.name), ...memories.map((m) => `- ${m.content}`)].join("\n") };
    }

    case "routines": {
      const names = await agentNames(ownerId);
      const routines = await db
        .select()
        .from(schema.routines)
        .where(eq(schema.routines.ownerId, ownerId))
        .orderBy(desc(schema.routines.enabled), asc(schema.routines.name));
      if (!routines.length) return { text: t.routinesEmpty };
      return {
        text: [
          t.routinesTitle,
          ...routines.map((r) => {
            const state = !r.enabled ? t.paused : r.nextRunAt ? `${t.next}: ${when(r.nextRunAt, lang, r.timeZone)}` : "";
            return `- **${r.name}** (${names.get(r.agentId) ?? "Botling"})${state ? ` — ${state}` : ""}`;
          }),
        ].join("\n"),
      };
    }

    case "routine": {
      if (!opts.args) return { text: t.routineUsage };
      const wanted = normalize(opts.args);
      const routines = await db.select().from(schema.routines).where(eq(schema.routines.ownerId, ownerId));
      const routine =
        routines.find((r) => normalize(r.name) === wanted) ?? routines.find((r) => normalize(r.name).includes(wanted));
      if (!routine) return { text: t.routineMissing(opts.args) };
      const names = await agentNames(ownerId);
      const started = await runRoutine(routine.id, "manual");
      return { text: started ? t.routineStarted(routine.name, names.get(routine.agentId) ?? "Botling") : t.routineBusy(routine.name) };
    }

    case "approvals": {
      const approvals = await pendingApprovals(ownerId);
      if (!approvals.length) return { text: t.approvalsEmpty };
      return {
        text: [t.approvalsTitle, ...approvals.map((a) => `- **${a.agentName}** — ${a.detail.slice(0, 200)}`)].join("\n"),
        pendingApprovals: approvals,
      };
    }
  }
}

/** Plain-text list for Telegram's /help. */
export function commandHelpText(locale: string) {
  return TEXT[locale === "pt" ? "pt" : "en"].help
    .split("\n")
    .slice(1)
    .map((line) => line.replace(/^- /, "").replace(/`/g, ""))
    .join("\n");
}

