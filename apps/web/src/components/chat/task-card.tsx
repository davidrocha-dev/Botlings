"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRightLeft, Ban, Check, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { Message, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/cn";

const STATUS_STYLE: Record<TaskStatus, string> = {
  running: "bg-accent-soft text-accent",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/10 text-danger",
  cancelled: "bg-surface-2 text-muted",
};

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "running") return <Loader2 className="size-3 animate-spin" />;
  if (status === "completed") return <Check className="size-3" />;
  if (status === "failed") return <TriangleAlert className="size-3" />;
  return <Ban className="size-3" />;
}

/** "Delegated to X" card shown in the orchestrator's chat, kept live via server events. */
export function TaskCard({ message }: { message: Message }) {
  const { t, f } = useI18n();
  const { getAgent, conversations } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const meta = message.metadata ?? {};
  const status: TaskStatus = meta.taskStatus ?? "running";
  const target = meta.targetAgentId ? getAgent(meta.targetAgentId) : undefined;
  const targetChat = target
    ? conversations.find((c) => c.type === "direct" && c.memberIds[0] === target.id)
    : undefined;
  const detail = status === "failed" ? meta.taskError : meta.taskResult;

  const cancel = async () => {
    if (!meta.taskId) return;
    setCancelling(true);
    try {
      await fetch(`/api/tasks/${meta.taskId}/cancel`, { method: "POST" });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-2 ml-9 max-w-[85%] rounded-2xl border border-border bg-surface p-3 md:max-w-md"
    >
      <div className="flex items-center gap-2.5">
        {target ? (
          <BotlingAvatar
            appearance={status === "running" ? { ...target.appearance, mood: "focused" } : target.appearance}
            size={32}
            animated={status === "running"}
          />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-muted">
            <ArrowRightLeft className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{f(t.tasks.delegatedTo, { name: target?.name ?? t.tasks.unknownAgent })}</p>
          <span className={cn("mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>
            <StatusIcon status={status} />
            {t.tasks.status[status]}
          </span>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-3 text-sm leading-snug text-muted">{message.text}</p>

      {detail && status !== "running" && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
            {status === "failed" ? t.tasks.showError : t.tasks.showResult}
          </button>
          {expanded && (
            <p className="mt-1.5 max-h-60 overflow-y-auto rounded-xl bg-bg p-2.5 text-xs leading-relaxed break-words whitespace-pre-wrap">
              {detail}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {targetChat && (
          <Link
            href={`/c/${targetChat.id}`}
            className="inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-xs font-medium hover:bg-surface-2"
          >
            {f(t.tasks.openChat, { name: target?.name ?? "" })}
          </Link>
        )}
        {status === "running" && (
          <button
            type="button"
            onClick={cancel}
            disabled={cancelling}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
            {t.tasks.cancel}
          </button>
        )}
      </div>
    </motion.div>
  );
}
