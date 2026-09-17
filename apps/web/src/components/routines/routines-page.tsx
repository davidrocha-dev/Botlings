"use client";

import { useEffect, useState } from "react";
import { AlarmClock, Check, Loader2, Pencil, Play, Plus, Trash2, TriangleAlert } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/client";
import { formatListTime } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { describeSchedule, weekdayName, type RoutineSchedule } from "./schedule-text";

type Routine = {
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
  runs: { id: string; trigger: "schedule" | "manual"; status: "running" | "completed" | "failed"; startedAt: number; costUsd: number; error: string | null }[];
};

type Draft = {
  id?: string;
  agentId: string;
  name: string;
  instruction: string;
  type: RoutineSchedule["type"];
  time: string;
  day: number;
  every: number;
  cron: string;
  enabled: boolean;
};

const fieldClass =
  "h-10 w-full rounded-xl border border-border-strong bg-bg px-3.5 text-[15px] outline-none placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft";

function toSchedule(d: Draft): RoutineSchedule {
  switch (d.type) {
    case "daily":
      return { type: "daily", time: d.time };
    case "weekdays":
      return { type: "weekdays", time: d.time };
    case "weekly":
      return { type: "weekly", day: d.day, time: d.time };
    case "hourly":
      return { type: "hourly", every: d.every };
    case "cron":
      return { type: "cron", cron: d.cron };
  }
}

function fromRoutine(r: Routine): Draft {
  const s = r.schedule;
  return {
    id: r.id,
    agentId: r.agentId,
    name: r.name,
    instruction: r.instruction,
    type: s.type,
    time: "time" in s ? s.time : "09:00",
    day: s.type === "weekly" ? s.day : 1,
    every: s.type === "hourly" ? s.every : 4,
    cron: r.cron,
    enabled: r.enabled,
  };
}

function RoutineForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const { t, locale } = useI18n();
  const { agents } = useStore();
  const types: RoutineSchedule["type"][] = ["daily", "weekdays", "weekly", "hourly", "cron"];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-4 rounded-3xl border border-border p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">{t.routines.agent}</span>
          <select value={draft.agentId} onChange={(e) => onChange({ ...draft, agentId: e.target.value })} className={fieldClass}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted">{t.routines.name}</span>
          <input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder={t.routines.namePlaceholder}
            maxLength={80}
            required
            className={fieldClass}
          />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted">{t.routines.instruction}</span>
        <textarea
          value={draft.instruction}
          onChange={(e) => onChange({ ...draft, instruction: e.target.value })}
          placeholder={t.routines.instructionPlaceholder}
          rows={3}
          maxLength={4000}
          required
          className={cn(fieldClass, "h-auto resize-y py-2.5")}
        />
      </label>

      <div className="space-y-2">
        <span className="text-xs font-medium text-muted">{t.routines.when}</span>
        <div className="flex flex-wrap gap-1.5">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onChange({ ...draft, type })}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                draft.type === type ? "bg-accent text-accent-contrast" : "bg-surface-2 text-muted hover:text-text",
              )}
            >
              {t.routines.types[type]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft.type === "weekly" && (
            <select
              value={draft.day}
              onChange={(e) => onChange({ ...draft, day: Number(e.target.value) })}
              className={cn(fieldClass, "w-auto capitalize")}
            >
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {weekdayName(d, locale)}
                </option>
              ))}
            </select>
          )}
          {(draft.type === "daily" || draft.type === "weekdays" || draft.type === "weekly") && (
            <input
              type="time"
              value={draft.time}
              onChange={(e) => onChange({ ...draft, time: e.target.value })}
              required
              className={cn(fieldClass, "w-auto")}
            />
          )}
          {draft.type === "hourly" && (
            <label className="flex items-center gap-2 text-sm">
              {t.routines.every}
              <input
                type="number"
                min={1}
                max={24}
                value={draft.every}
                onChange={(e) => onChange({ ...draft, every: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })}
                className={cn(fieldClass, "w-20")}
              />
              {t.routines.hours}
            </label>
          )}
          {draft.type === "cron" && (
            <input
              value={draft.cron}
              onChange={(e) => onChange({ ...draft, cron: e.target.value })}
              placeholder="0 9 * * 1-5"
              spellCheck={false}
              required
              className={cn(fieldClass, "font-mono text-sm sm:w-60")}
            />
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => onChange({ ...draft, enabled: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        {t.routines.enabledLabel}
      </label>

      {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-60"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t.secrets.save}
        </button>
        <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-border-strong px-4 text-sm font-medium hover:bg-surface">
          {t.agent.cancel}
        </button>
      </div>
    </form>
  );
}

export function RoutinesPage() {
  const { t, locale } = useI18n();
  const { agents, getAgent } = useStore();
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    fetch("/api/routines")
      .then((res) => (res.ok ? res.json() : { routines: [] }))
      .then((data) => setRoutines(data.routines))
      .catch(() => setRoutines([]));

  useEffect(() => {
    void load();
    // Refresh run statuses periodically while the page is open.
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, []);

  const errorText = (code: string) => t.routines.errors[code as keyof typeof t.routines.errors] ?? t.routines.errors.generic;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        agentId: draft.agentId,
        name: draft.name,
        instruction: draft.instruction,
        schedule: toSchedule(draft),
        enabled: draft.enabled,
      };
      const res = await fetch(draft.id ? `/api/routines/${draft.id}` : "/api/routines", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(errorText(data.error));
      setRoutines(data.routines);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/routines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRoutines(data.routines);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/routines/${id}/run`, { method: "POST" });
      setTimeout(load, 1500);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      const res = await fetch(`/api/routines/${deleting.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRoutines(data.routines);
      setDeleting(null);
    } finally {
      setBusy(null);
    }
  };

  const newDraft = (): Draft => ({
    agentId: agents.find((a) => a.isOrchestrator)?.id ?? agents[0]?.id ?? "",
    name: "",
    instruction: "",
    type: "daily",
    time: "09:00",
    day: 1,
    every: 4,
    cron: "0 9 * * 1-5",
    enabled: true,
  });

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.routines.title} subtitle={t.routines.subtitle}>
        {!draft && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setDraft(newDraft());
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t.routines.add}</span>
          </button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 md:px-8">
          {draft && !draft.id && (
            <RoutineForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} saving={saving} error={error} />
          )}

          {routines === null ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted" />
          ) : routines.length === 0 && !draft ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlarmClock className="size-8 text-subtle" />
              <p className="text-sm text-muted">{t.routines.empty}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {routines.map((routine) => {
                const agent = getAgent(routine.agentId);
                if (draft?.id === routine.id) {
                  return (
                    <li key={routine.id}>
                      <RoutineForm draft={draft} onChange={setDraft} onSave={save} onCancel={() => setDraft(null)} saving={saving} error={error} />
                    </li>
                  );
                }
                return (
                  <li key={routine.id} className={cn("space-y-3 rounded-3xl border border-border p-4", !routine.enabled && "opacity-70")}>
                    <div className="flex items-start gap-3">
                      {agent && <BotlingAvatar appearance={agent.appearance} size={36} />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{routine.name}</p>
                        <p className="text-xs text-muted">
                          {agent?.name} · {describeSchedule(routine.schedule, t, locale)}
                          {routine.createdBy === "agent" && ` · ${t.routines.byAgent}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={routine.enabled}
                        aria-label={t.routines.enabledLabel}
                        disabled={busy === routine.id}
                        onClick={() => patch(routine.id, { enabled: !routine.enabled })}
                        className={cn(
                          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                          routine.enabled ? "bg-accent" : "bg-surface-2",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 size-5 rounded-full bg-elevated shadow-soft transition-all",
                            routine.enabled ? "left-[22px]" : "left-0.5",
                          )}
                        />
                      </button>
                    </div>

                    <p className="text-sm leading-snug text-muted">{routine.instruction}</p>

                    {routine.enabled && routine.nextRuns.length > 0 && (
                      <p suppressHydrationWarning className="text-xs text-subtle">
                        {t.routines.next}: {routine.nextRuns.map((n) => new Date(n).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })).join(" · ")}
                      </p>
                    )}

                    {routine.runs.length > 0 && (
                      <ul className="space-y-1 rounded-2xl bg-surface p-2.5">
                        {routine.runs.map((run) => (
                          <li key={run.id} className="flex items-center gap-2 text-xs">
                            {run.status === "running" ? (
                              <Loader2 className="size-3.5 animate-spin text-accent" />
                            ) : run.status === "completed" ? (
                              <Check className="size-3.5 text-success" />
                            ) : (
                              <TriangleAlert className="size-3.5 text-danger" />
                            )}
                            <span suppressHydrationWarning className="text-muted">
                              {formatListTime(run.startedAt, locale)}
                            </span>
                            <span className="text-subtle">{run.trigger === "manual" ? t.routines.manual : t.routines.scheduled}</span>
                            <span className="min-w-0 flex-1 truncate text-danger">{run.error}</span>
                            <span className="tabular-nums text-subtle">${run.costUsd.toFixed(4)}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy === routine.id || routine.runs[0]?.status === "running"}
                        onClick={() => runNow(routine.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-medium text-accent disabled:opacity-50"
                      >
                        <Play className="size-3.5" />
                        {t.routines.runNow}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setDraft(fromRoutine(routine));
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong px-3 text-xs font-medium hover:bg-surface"
                      >
                        <Pencil className="size-3.5" />
                        {t.agent.edit}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(routine)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-danger hover:bg-danger/10"
                      >
                        <Trash2 className="size-3.5" />
                        {t.agent.delete}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        title={t.routines.deleteTitle.replace("{name}", deleting?.name ?? "")}
        description={t.routines.deleteDescription}
        confirmLabel={t.agent.delete}
        cancelLabel={t.agent.cancel}
        pending={busy === deleting?.id}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
