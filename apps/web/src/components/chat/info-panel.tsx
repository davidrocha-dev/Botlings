"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Brain, Coins, Cpu, FolderOpen, Pencil, Trash2, Wallet, X } from "lucide-react";
import { MemoryDialog } from "./memory-dialog";
import { WorkspaceDialog } from "./workspace-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModelPicker } from "@/components/agents/model-picker";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { ConversationAvatar } from "@/components/avatar/conversation-avatar";
import { moodForStatus } from "@/components/avatar/botling-options";
import { IconButton } from "@/components/ui/icon-button";
import { StatusDot } from "@/components/ui/status-dot";
import { VmPreview } from "./vm-preview";
import { useI18n } from "@/lib/i18n/client";
import { formatUsd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Agent, Conversation } from "@/lib/types";

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-surface p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function AgentDetails({ agent }: { agent: Agent }) {
  const { t, f } = useI18n();
  const { upsertAgent, removeAgent } = useStore();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error === "orchestrator" ? t.agent.cannotDeleteOrchestrator : t.agent.errors.generic);
        return;
      }
      setConfirmOpen(false);
      router.push("/");
      removeAgent(agent.id, data.removedConversationIds ?? []);
    } catch {
      setDeleteError(t.agent.errors.generic);
    } finally {
      setDeleting(false);
    }
  };

  // Explicit model change made by the user from the UI.
  const changeModel = async (model: string) => {
    if (model === agent.model) return;
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (res.ok) upsertAgent({ ...(await res.json()).agent, status: agent.status });
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center">
        <BotlingAvatar
          appearance={{ ...agent.appearance, mood: moodForStatus(agent.appearance.mood, agent.status) }}
          size={96}
          animated
          title={agent.name}
        />
        <h2 className="mt-3 text-xl font-semibold tracking-tight">{agent.name}</h2>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <StatusDot status={agent.status} />
          {t.status[agent.status]}
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.info.computer}</h3>
        <VmPreview agent={agent} />
        <button
          type="button"
          onClick={() => setWorkspaceOpen(true)}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-surface text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <FolderOpen className="size-4" />
          {t.workspace.open}
        </button>
        <WorkspaceDialog agent={agent} open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
      </section>

      {agent.role && (
        <section className="space-y-1.5 rounded-2xl bg-surface p-3.5">
          <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.info.role}</h3>
          <p className="text-sm leading-relaxed">{agent.role}</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">
          <Cpu className="size-3.5" />
          {t.info.model}
        </h3>
        <ModelPicker value={agent.model} onChange={changeModel} />
      </section>

      <button
        type="button"
        onClick={() => setMemoryOpen(true)}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-border-strong text-sm font-medium transition-colors hover:bg-surface"
      >
        <Brain className="size-4 text-accent" />
        {t.memory.open}
      </button>
      <MemoryDialog agent={agent} open={memoryOpen} onClose={() => setMemoryOpen(false)} />

      <div className="grid grid-cols-2 gap-2">
        <Stat icon={<Wallet className="size-3.5" />} label={t.info.spendToday} value={formatUsd(agent.spendTodayUsd)} />
        <Stat icon={<Coins className="size-3.5" />} label={t.info.tokensToday} value={agent.tokensToday.toLocaleString()} />
      </div>

      <div className="flex gap-2 border-t border-border pt-4">
        <Link
          href={`/agents/${agent.id}/edit`}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border border-border-strong text-sm font-medium transition-colors hover:bg-surface"
        >
          <Pencil className="size-4" />
          {t.agent.edit}
        </Link>
        {!agent.isOrchestrator && (
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setConfirmOpen(true);
            }}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border border-danger/30 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <Trash2 className="size-4" />
            {t.agent.delete}
          </button>
        )}
      </div>
      {agent.isOrchestrator && <p className="text-center text-xs text-subtle">{t.agent.cannotDeleteOrchestrator}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title={f(t.agent.deleteTitle, { name: agent.name })}
        description={t.agent.deleteDescription}
        confirmLabel={deleting ? t.agent.deleting : t.agent.delete}
        cancelLabel={t.agent.cancel}
        pending={deleting}
        error={deleteError}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function GroupDetails({ conversation }: { conversation: Conversation }) {
  const { t, f } = useI18n();
  const { getAgent } = useStore();
  const members = conversation.memberIds.map(getAgent).filter((a) => a !== undefined);
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center">
        <ConversationAvatar conversation={conversation} size={96} />
        <h2 className="mt-3 text-xl font-semibold tracking-tight">{conversation.title}</h2>
        <p className="mt-1 text-sm text-muted">{f(t.chat.members, { count: members.length })}</p>
      </div>
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.info.members}</h3>
        <ul className="space-y-3">
          {members.map((agent) => (
            <li key={agent.id} className="space-y-2 rounded-2xl bg-surface p-3">
              <div className="flex items-center gap-3">
                <BotlingAvatar
                  appearance={{ ...agent.appearance, mood: moodForStatus(agent.appearance.mood, agent.status) }}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{agent.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <StatusDot status={agent.status} />
                    {t.status[agent.status]}
                  </p>
                </div>
              </div>
              <VmPreview agent={agent} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function InfoPanel({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const { t } = useI18n();
  const { getAgent } = useStore();
  const agent = conversation.type === "direct" ? getAgent(conversation.memberIds[0]) : undefined;

  return (
    <>
      {/* Backdrop for the overlay variant (below xl) */}
      <motion.div
        className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] xl:hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: "100%", opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0.6 }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-bg shadow-modal sm:w-[380px] xl:static xl:z-auto xl:w-[340px] xl:shadow-none"
      >
        <div className="pt-safe flex h-14 shrink-0 items-center justify-between px-3">
          <span className="pl-2 text-sm font-semibold">{t.info.toggle}</span>
          <IconButton aria-label={t.info.close} onClick={onClose}>
            <X className="size-[18px]" />
          </IconButton>
        </div>
        <div className="pb-safe flex-1 overflow-y-auto px-4 pb-6">
          {agent ? <AgentDetails agent={agent} /> : <GroupDetails conversation={conversation} />}
        </div>
      </motion.aside>
    </>
  );
}
