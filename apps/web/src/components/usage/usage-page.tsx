"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert, OctagonAlert, Table2, BarChart3 } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { CostChart, formatUsdAxis } from "./cost-chart";

type Report = {
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

const RANGES = [7, 30, 90] as const;

const fieldClass =
  "h-10 w-full rounded-xl border border-border-strong bg-bg pr-3 pl-7 text-[15px] tabular-nums outline-none placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle tabular-nums">{hint}</p>}
    </div>
  );
}

/** Budget usage bar; status is shown with an icon and words, not colour alone. */
function BudgetMeter({ spent, limit }: { spent: number; limit: number | null }) {
  const { t, f } = useI18n();
  if (limit === null) return <p className="text-xs text-subtle">{t.usage.noLimit}</p>;
  const ratio = limit > 0 ? spent / limit : 1;
  const status = ratio >= 1 ? "critical" : ratio >= 0.8 ? "warning" : "good";
  const Icon = status === "critical" ? OctagonAlert : status === "warning" ? TriangleAlert : CheckCircle2;
  return (
    <div className="space-y-1.5">
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full",
            status === "critical" ? "bg-danger" : status === "warning" ? "bg-warning" : "bg-success",
          )}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted tabular-nums">
        <Icon
          className={cn("size-3.5", status === "critical" ? "text-danger" : status === "warning" ? "text-warning" : "text-success")}
        />
        {f(status === "critical" ? t.usage.reached : t.usage.used, {
          spent: formatUsdAxis(spent),
          limit: formatUsdAxis(limit),
          percent: Math.round(ratio * 100),
        })}
      </p>
    </div>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
        placeholder={placeholder}
        className={fieldClass}
      />
    </div>
  );
}

const toInput = (v: number | null) => (v === null ? "" : String(v));
const fromInput = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

export function UsagePage() {
  const { t, locale } = useI18n();
  const { agents, getAgent } = useStore();
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  const [agentLimits, setAgentLimits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const applyBudgets = useCallback((r: Report) => {
    setDaily(toInput(r.budgets.dailyUsd));
    setMonthly(toInput(r.budgets.monthlyUsd));
    setAgentLimits(Object.fromEntries(r.budgets.agents.map((a) => [a.agentId, String(a.monthlyUsd)])));
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/usage?days=${range}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Report | null) => {
        if (!active || !data) return;
        setReport(data);
        applyBudgets(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [range, applyBudgets]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/budgets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyUsd: fromInput(daily),
          monthlyUsd: fromInput(monthly),
          agents: agents.map((a) => ({ agentId: a.id, monthlyUsd: fromInput(agentLimits[a.id] ?? "") })),
        }),
      });
      if (res.ok) {
        const data: Report = await res.json();
        setReport((current) => (current ? { ...current, budgets: data.budgets } : data));
        applyBudgets(data);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const monthByAgent = new Map(report?.agents.map((a) => [a.agentId, a.monthUsd]) ?? []);
  const rangeByAgent = new Map(report?.agents.map((a) => [a.agentId, a]) ?? []);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.usage.title} subtitle={report ? f2(t.usage.timeZone, report.timeZone) : undefined}>
        <div className="flex rounded-xl bg-surface-2 p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium tabular-nums transition-all",
                range === r ? "bg-elevated text-text shadow-soft" : "text-muted hover:text-text",
              )}
            >
              {r}d
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        {!report ? (
          <Loader2 className="mx-auto mt-10 size-5 animate-spin text-muted" />
        ) : (
          <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 md:px-8">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tile label={t.usage.today} value={formatUsdAxis(report.todayUsd)} />
              <Tile label={t.usage.thisMonth} value={formatUsdAxis(report.monthUsd)} />
              <Tile
                label={t.usage.lastDays.replace("{days}", String(range))}
                value={formatUsdAxis(report.rangeUsd)}
                hint={`${report.rangeTokens.toLocaleString(locale)} tokens`}
              />
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t.usage.dailySpend}</h2>
                <button
                  type="button"
                  onClick={() => setView(view === "chart" ? "table" : "chart")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted hover:bg-surface hover:text-text"
                >
                  {view === "chart" ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
                  {view === "chart" ? t.usage.showTable : t.usage.showChart}
                </button>
              </div>
              <div className="rounded-3xl border border-border p-4">
                {view === "chart" ? (
                  <CostChart days={report.days} />
                ) : (
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm tabular-nums">
                      <thead className="sticky top-0 bg-bg text-left text-xs text-muted">
                        <tr>
                          <th className="py-1.5 font-medium">{t.usage.date}</th>
                          <th className="py-1.5 text-right font-medium">{t.usage.cost}</th>
                          <th className="py-1.5 text-right font-medium">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...report.days].reverse().map((d) => (
                          <tr key={d.date} className="border-t border-border">
                            <td className="py-1.5">{new Date(`${d.date}T12:00:00`).toLocaleDateString(locale)}</td>
                            <td className="py-1.5 text-right">{formatUsdAxis(d.costUsd)}</td>
                            <td className="py-1.5 text-right text-muted">{d.tokens.toLocaleString(locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">{t.usage.budgets}</h2>
              <p className="text-xs text-muted">{t.usage.budgetsHint}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 rounded-2xl border border-border p-4">
                  <p className="text-sm font-medium">{t.usage.dailyLimit}</p>
                  <MoneyInput value={daily} onChange={setDaily} placeholder={t.usage.noLimitPlaceholder} />
                  <BudgetMeter spent={report.todayUsd} limit={report.budgets.dailyUsd} />
                </div>
                <div className="space-y-2 rounded-2xl border border-border p-4">
                  <p className="text-sm font-medium">{t.usage.monthlyLimit}</p>
                  <MoneyInput value={monthly} onChange={setMonthly} placeholder={t.usage.noLimitPlaceholder} />
                  <BudgetMeter spent={report.monthUsd} limit={report.budgets.monthlyUsd} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">{t.usage.byAgent}</h2>
              <ul className="space-y-2">
                {agents.map((agent) => {
                  const row = rangeByAgent.get(agent.id);
                  const limit = report.budgets.agents.find((a) => a.agentId === agent.id)?.monthlyUsd ?? null;
                  return (
                    <li key={agent.id} className="grid gap-3 rounded-2xl border border-border p-3 sm:grid-cols-[1fr_180px] sm:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <BotlingAvatar appearance={agent.appearance} size={36} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{agent.name}</p>
                          <p className="text-xs text-muted tabular-nums">
                            {formatUsdAxis(row?.costUsd ?? 0)} · {(row?.tokens ?? 0).toLocaleString(locale)} tokens · {range}d
                          </p>
                          <div className="mt-1.5">
                            <BudgetMeter spent={monthByAgent.get(agent.id) ?? 0} limit={limit} />
                          </div>
                        </div>
                      </div>
                      <label className="space-y-1">
                        <span className="text-xs text-muted">{t.usage.agentMonthlyLimit}</span>
                        <MoneyInput
                          value={agentLimits[agent.id] ?? ""}
                          onChange={(v) => setAgentLimits((m) => ({ ...m, [agent.id]: v }))}
                          placeholder={t.usage.noLimitPlaceholder}
                        />
                      </label>
                    </li>
                  );
                })}
                {report.agents
                  .filter((a) => !a.agentId || !getAgent(a.agentId))
                  .map((a) => (
                    <li key={`${a.agentId ?? "deleted"}-${a.agentName}`} className="flex items-center justify-between rounded-2xl bg-surface px-4 py-2.5 text-sm">
                      <span className="text-muted">
                        {a.agentName || "Botling"} · {t.usage.deletedAgents}
                      </span>
                      <span className="tabular-nums">{formatUsdAxis(a.costUsd)}</span>
                    </li>
                  ))}
              </ul>
            </section>

            <div className="pb-safe sticky bottom-0 -mx-4 flex items-center gap-3 bg-gradient-to-t from-bg via-bg to-transparent px-4 pt-6 pb-4 md:static md:mx-0 md:bg-none md:p-0">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-accent px-6 text-sm font-semibold text-accent-contrast shadow-float hover:bg-accent-hover disabled:opacity-60"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t.usage.saveBudgets}
              </button>
              {saved && <span className="text-sm text-success">{t.usage.saved}</span>}
            </div>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">{t.usage.byModel}</h2>
              {report.models.length === 0 ? (
                <p className="text-sm text-muted">{t.usage.noUsage}</p>
              ) : (
                <ul className="divide-y divide-border rounded-2xl border border-border">
                  {report.models.map((m) => (
                    <li key={m.model} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 truncate font-mono text-xs">{m.model}</span>
                      <span className="shrink-0 text-right tabular-nums">
                        {formatUsdAxis(m.costUsd)}
                        <span className="ml-2 text-xs text-muted">{m.tokens.toLocaleString(locale)} tokens</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function f2(template: string, timeZone: string) {
  return template.replace("{timeZone}", timeZone);
}
