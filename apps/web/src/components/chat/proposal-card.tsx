"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, Loader2, NotebookPen, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { Message, ProposalStatus } from "@/lib/types";
import { cn } from "@/lib/cn";

type DiffLine = { type: "same" | "removed" | "added"; text: string };

/** Line-level diff (LCS) — instructions are short, so the quadratic table is fine. */
function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "removed", text: a[i++] });
    } else {
      out.push({ type: "added", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ type: "removed", text: a[i++] });
  while (j < b.length) out.push({ type: "added", text: b[j++] });
  return out;
}

const STATUS_STYLE: Record<ProposalStatus, string> = {
  pending: "bg-accent-soft text-accent",
  accepted: "bg-success/15 text-success",
  rejected: "bg-surface-2 text-muted",
  stale: "bg-warning/15 text-warning",
};

/** An agent's proposed change to its own instructions, applied only if the user accepts. */
export function ProposalCard({ message }: { message: Message }) {
  const { t } = useI18n();
  const { getAgent, applyMessage, upsertAgent } = useStore();
  const [pending, setPending] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = message.metadata ?? {};
  const status: ProposalStatus = meta.proposalStatus ?? "pending";
  const agent = message.author.type === "agent" ? getAgent(message.author.agentId) : undefined;
  const diff = useMemo(() => diffLines(meta.proposalBefore ?? "", meta.proposalAfter ?? ""), [meta.proposalBefore, meta.proposalAfter]);

  const decide = async (decision: "accept" | "reject") => {
    if (!meta.proposalId) return;
    setPending(decision);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${meta.proposalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.message) applyMessage(data.message);
      if (data.agent && agent) upsertAgent({ ...data.agent, status: agent.status });
      if (!res.ok) {
        const key = data.error as keyof typeof t.proposals.errors;
        setError(t.proposals.errors[key] ?? t.proposals.errors.generic);
      }
    } catch {
      setError(t.proposals.errors.generic);
    } finally {
      setPending(null);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 ml-9 max-w-[85%] rounded-2xl border border-border bg-surface p-3 md:max-w-lg"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <NotebookPen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {agent?.name ? `${agent.name} · ` : ""}
            {t.proposals.title}
          </p>
          <span className={cn("mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>
            {t.proposals.status[status]}
          </span>
        </div>
      </div>

      {meta.proposalReason && (
        <p className="mt-2.5 text-sm leading-snug">
          <span className="font-medium text-muted">{t.proposals.reason}: </span>
          {meta.proposalReason}
        </p>
      )}

      <div className="mt-2.5 max-h-72 overflow-y-auto rounded-xl border border-border bg-bg font-mono text-xs leading-relaxed">
        {!meta.proposalBefore && <p className="px-3 pt-2 text-subtle italic">{t.proposals.emptyBefore}</p>}
        <div className="py-1.5">
          {diff.map((line, index) => (
            <p
              key={index}
              className={cn(
                "px-3 break-words whitespace-pre-wrap",
                line.type === "added" && "bg-success/10 text-success",
                line.type === "removed" && "bg-danger/10 text-danger line-through",
                line.type === "same" && "text-muted",
              )}
            >
              <span className="mr-2 inline-block w-2 select-none">{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span>
              {line.text || " "}
            </p>
          ))}
        </div>
      </div>

      {error && <p className="mt-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {status === "pending" && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => decide("accept")}
            disabled={pending !== null}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-60"
          >
            {pending === "accept" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t.proposals.accept}
          </button>
          <button
            type="button"
            onClick={() => decide("reject")}
            disabled={pending !== null}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-border-strong text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
          >
            {pending === "reject" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            {t.proposals.reject}
          </button>
        </div>
      )}
    </motion.div>
  );
}
