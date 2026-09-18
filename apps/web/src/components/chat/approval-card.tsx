"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Check, Loader2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { ApprovalStatus, Message } from "@/lib/types";
import { cn } from "@/lib/cn";

const STATUS_STYLE: Record<ApprovalStatus, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  denied: "bg-danger/10 text-danger",
  expired: "bg-surface-2 text-muted",
};

/** A paused agent action waiting for the user: allow once, deny, or always allow the category. */
export function ApprovalCard({ message }: { message: Message }) {
  const { t, f } = useI18n();
  const { getAgent, applyMessage } = useStore();
  const [pending, setPending] = useState<"approve" | "deny" | "always" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = message.metadata ?? {};
  const status: ApprovalStatus = meta.approvalStatus ?? "pending";
  const agent = message.author.type === "agent" ? getAgent(message.author.agentId) : undefined;
  const category = meta.approvalCategory ?? "";
  // A request for help at the screen is not a permission: the user does the step, then says it is done.
  const screenHelp = category === "screen_help";
  const categoryLabel = category.startsWith("tool:")
    ? (t.tools[category.slice(5) as keyof typeof t.tools] ?? category.slice(5))
    : (t.approvals.categories[category as keyof typeof t.approvals.categories] ?? category);

  const decide = async (decision: "approve" | "deny" | "always") => {
    if (!meta.approvalId) return;
    setPending(decision);
    setError(null);
    try {
      const res = await fetch(`/api/approvals/${meta.approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.message) applyMessage(data.message);
      if (!res.ok) {
        const key = data.error as keyof typeof t.approvals.errors;
        setError(t.approvals.errors[key] ?? t.approvals.errors.generic);
      }
    } catch {
      setError(t.approvals.errors.generic);
    } finally {
      setPending(null);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "my-2 ml-9 max-w-[85%] rounded-2xl border p-3 md:max-w-md",
        status === "pending" ? "border-warning/40 bg-warning/5" : "border-border bg-surface",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            status === "approved" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          {status === "approved" ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {f(screenHelp ? t.approvals.screenTitle : t.approvals.title, { name: agent?.name ?? "Botling" })}
          </p>
          <p className="text-xs text-muted">{screenHelp ? t.approvals.screenHint : categoryLabel}</p>
          <span className={cn("mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>
            {status === "approved" && meta.approvalAlwaysAllowed ? t.approvals.alwaysAllowed : t.approvals.status[status]}
          </span>
        </div>
      </div>

      <p className="mt-2.5 rounded-xl bg-bg px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {meta.approvalDetail ?? message.text}
      </p>

      {error && <p className="mt-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      {status === "pending" && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => decide("approve")}
              disabled={pending !== null}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-60"
            >
              {pending === "approve" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {screenHelp ? t.approvals.screenDone : t.approvals.allowOnce}
            </button>
            <button
              type="button"
              onClick={() => decide("deny")}
              disabled={pending !== null}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-border-strong text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
            >
              {pending === "deny" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              {screenHelp ? t.approvals.screenSkip : t.approvals.deny}
            </button>
          </div>
          {/* "Always allow" makes no sense for a step only the user can do. */}
          <button
            type="button"
            hidden={screenHelp}
            onClick={() => decide("always")}
            disabled={pending !== null}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full text-xs font-medium text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60"
          >
            {pending === "always" && <Loader2 className="size-3.5 animate-spin" />}
            {f(t.approvals.always, { category: categoryLabel })}
          </button>
        </div>
      )}
    </motion.div>
  );
}
