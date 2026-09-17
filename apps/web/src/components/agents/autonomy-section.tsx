"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { Autonomy } from "@/lib/types";
import { cn } from "@/lib/cn";

const LEVELS: Autonomy[] = ["ask_always", "ask_sensitive", "autonomous"];

export function AutonomyPicker({ value, onChange }: { value: Autonomy; onChange: (value: Autonomy) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => onChange(level)}
          aria-pressed={value === level}
          className={cn(
            "rounded-2xl border p-3 text-left transition-all",
            value === level ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2",
          )}
        >
          <p className="text-sm font-medium">{t.agent.autonomy[level].label}</p>
          <p className="mt-1 text-xs leading-snug text-muted">{t.agent.autonomy[level].description}</p>
        </button>
      ))}
    </div>
  );
}

/** "Always allowed" categories for an existing agent, with a way to revoke each one. */
export function ApprovalRules({ agentId }: { agentId: string }) {
  const { t } = useI18n();
  const [rules, setRules] = useState<{ category: string }[] | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/agents/${agentId}/approval-rules`)
      .then((res) => (res.ok ? res.json() : { rules: [] }))
      .then((data) => active && setRules(data.rules))
      .catch(() => active && setRules([]));
    return () => {
      active = false;
    };
  }, [agentId]);

  const remove = async (category: string) => {
    setRemoving(category);
    try {
      const res = await fetch(`/api/agents/${agentId}/approval-rules?category=${encodeURIComponent(category)}`, { method: "DELETE" });
      if (res.ok) setRules((list) => list?.filter((r) => r.category !== category) ?? null);
    } finally {
      setRemoving(null);
    }
  };

  const label = (category: string) =>
    category.startsWith("tool:")
      ? (t.tools[category.slice(5) as keyof typeof t.tools] ?? category.slice(5))
      : (t.approvals.categories[category as keyof typeof t.approvals.categories] ?? category);

  return (
    <div className="rounded-2xl border border-border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <ShieldCheck className="size-4 text-success" />
        {t.agent.rules.title}
      </p>
      {rules === null ? (
        <Loader2 className="mt-2 size-4 animate-spin text-muted" />
      ) : rules.length === 0 ? (
        <p className="mt-1 text-xs text-muted">{t.agent.rules.empty}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {rules.map((rule) => (
            <li key={rule.category} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-xs">
              {label(rule.category)}
              <button
                type="button"
                aria-label={t.agent.rules.remove}
                title={t.agent.rules.remove}
                onClick={() => remove(rule.category)}
                disabled={removing === rule.category}
                className="inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-danger/15 hover:text-danger"
              >
                {removing === rule.category ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
