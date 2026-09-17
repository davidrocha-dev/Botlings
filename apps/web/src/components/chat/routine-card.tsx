"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { AlarmClock, Check, Loader2, TriangleAlert, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/cn";
import { stripMarkdown } from "@/lib/markdown-text";

/** A routine run in progress/finished, or a routine the agent suggested (enable / discard). */
export function RoutineCard({ message }: { message: Message }) {
  const { t } = useI18n();
  const { applyMessage } = useStore();
  const [pending, setPending] = useState<"enable" | "discard" | null>(null);
  const meta = message.metadata ?? {};
  const suggestion = meta.routineSuggestion;
  const runStatus = meta.routineRunStatus;

  const decide = async (decision: "enable" | "discard") => {
    setPending(decision);
    try {
      const res = await fetch(`/api/routines/suggestions/${message.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.message) applyMessage(data.message);
    } finally {
      setPending(null);
    }
  };

  const status = suggestion
    ? { label: t.routines.suggestion[suggestion], tone: suggestion === "enabled" ? "good" : suggestion === "pending" ? "accent" : "muted" }
    : { label: t.routines.run[runStatus ?? "running"], tone: runStatus === "completed" ? "good" : runStatus === "failed" ? "bad" : "accent" };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 ml-9 max-w-[85%] rounded-2xl border border-border bg-surface p-3 md:max-w-md"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <AlarmClock className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{suggestion ? t.routines.suggestedTitle : t.routines.runTitle}</p>
          <p className="truncate text-sm font-semibold">{meta.routineName}</p>
          <span
            className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              status.tone === "good" && "bg-success/15 text-success",
              status.tone === "bad" && "bg-danger/10 text-danger",
              status.tone === "accent" && "bg-accent-soft text-accent",
              status.tone === "muted" && "bg-surface-2 text-muted",
            )}
          >
            {!suggestion && runStatus === "running" && <Loader2 className="size-3 animate-spin" />}
            {!suggestion && runStatus === "completed" && <Check className="size-3" />}
            {!suggestion && runStatus === "failed" && <TriangleAlert className="size-3" />}
            {status.label}
          </span>
        </div>
      </div>
      <p className="mt-2.5 line-clamp-4 text-sm leading-snug text-muted">{stripMarkdown(message.text)}</p>
      {meta.routineCron && <p className="mt-1.5 font-mono text-[11px] text-subtle">cron: {meta.routineCron}</p>}

      {suggestion === "pending" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => decide("enable")}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-60"
          >
            {pending === "enable" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t.routines.enable}
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => decide("discard")}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-border-strong text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
          >
            {pending === "discard" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            {t.routines.discard}
          </button>
        </div>
      ) : (
        <Link href="/routines" className="mt-2 inline-block text-xs font-medium text-accent">
          {t.routines.manage}
        </Link>
      )}
    </motion.div>
  );
}
