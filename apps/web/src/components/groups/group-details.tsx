"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, MessagesSquare, Pencil, Trash2, UserMinus, UserPlus } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { ConversationAvatar } from "@/components/avatar/conversation-avatar";
import { moodForStatus } from "@/components/avatar/botling-options";
import { VmPreview } from "@/components/chat/vm-preview";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { StatusDot } from "@/components/ui/status-dot";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { Agent, Conversation } from "@/lib/types";
import { AgentPicker } from "./group-form";

type ErrorKey = keyof ReturnType<typeof useI18n>["t"]["groups"]["errors"];

export function GroupDetails({ conversation }: { conversation: Conversation }) {
  const { t, f } = useI18n();
  const { getAgent, agents, upsertConversation, removeConversation } = useStore();
  const router = useRouter();
  const members = conversation.memberIds.map(getAgent).filter((a): a is Agent => a !== undefined);

  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Agent | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const call = async (url: string, init: RequestInit) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error in t.groups.errors ? data.error : "generic");
        return null;
      }
      return data;
    } catch {
      setError("generic");
      return null;
    } finally {
      setPending(false);
    }
  };

  const addMembers = async () => {
    if (!toAdd.length) return;
    const data = await call(`/api/groups/${conversation.id}/members`, { method: "POST", body: JSON.stringify({ agentIds: toAdd }) });
    if (data) {
      upsertConversation(data.conversation);
      setToAdd([]);
      setAdding(false);
    }
  };

  const removeMember = async () => {
    if (!removing) return;
    const data = await call(`/api/groups/${conversation.id}/members/${removing.id}`, { method: "DELETE" });
    if (data) {
      upsertConversation(data.conversation);
      setRemoving(null);
    }
  };

  const deleteGroup = async () => {
    const data = await call(`/api/groups/${conversation.id}`, { method: "DELETE" });
    if (data) {
      setDeleteOpen(false);
      router.push("/");
      removeConversation(conversation.id);
    }
  };

  const available = agents.filter((a) => !conversation.memberIds.includes(a.id));
  const cost = (conversation.maxCostUsd ?? 0.05).toFixed(conversation.maxCostUsd && conversation.maxCostUsd >= 0.1 ? 2 : 3);

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center">
        <ConversationAvatar conversation={conversation} size={96} />
        <h2 className="mt-3 text-xl font-semibold tracking-tight">{conversation.title}</h2>
        <p className="mt-1 text-sm text-muted">{f(t.chat.members, { count: members.length })}</p>
      </div>

      {conversation.description && (
        <section className="rounded-2xl bg-surface p-3.5">
          <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.groups.purpose}</h3>
          <p className="mt-1 text-sm leading-snug whitespace-pre-wrap">{conversation.description}</p>
        </section>
      )}

      <section className="flex items-start gap-3 rounded-2xl bg-surface p-3.5">
        <MessagesSquare className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 text-sm">
          <p className="font-medium">{conversation.discussionMode === "mentions" ? t.groups.modeMentions : t.groups.modeDiscussion}</p>
          {conversation.discussionMode !== "mentions" && (
            <p className="text-xs text-muted">{f(t.groups.limitsSummary, { turns: conversation.maxTurns ?? 6, cost })}</p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.info.members}</h3>
          {available.length > 0 && !adding && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent"
            >
              <UserPlus className="size-3.5" />
              {t.groups.addMembers}
            </button>
          )}
        </div>

        <AnimatePresence initial={false}>
          {adding && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-2.5 rounded-2xl border border-border p-2.5">
                {available.length ? (
                  <AgentPicker
                    selected={toAdd}
                    excludeIds={conversation.memberIds}
                    onToggle={(id) => setToAdd((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))}
                  />
                ) : (
                  <p className="text-sm text-muted">{t.groups.noMoreAgents}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!toAdd.length || pending}
                    onClick={addMembers}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
                  >
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                    {t.groups.add}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setToAdd([]);
                    }}
                    className="inline-flex h-9 flex-1 items-center justify-center rounded-full border border-border-strong text-sm font-medium hover:bg-surface-2"
                  >
                    {t.groups.cancel}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && !removing && !deleteOpen && (
          <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {t.groups.errors[error]}
          </p>
        )}

        <ul className="space-y-3">
          {members.map((agent) => (
            <li key={agent.id} className="space-y-2 rounded-2xl bg-surface p-3">
              <div className="flex items-center gap-3">
                <BotlingAvatar appearance={{ ...agent.appearance, mood: moodForStatus(agent.appearance.mood, agent.status) }} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{agent.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <StatusDot status={agent.status} />
                    {t.status[agent.status]}
                  </p>
                </div>
                {members.length > 1 && (
                  <IconButton
                    aria-label={`${t.groups.remove}: ${agent.name}`}
                    onClick={() => {
                      setError(null);
                      setRemoving(agent);
                    }}
                  >
                    <UserMinus className="size-4" />
                  </IconButton>
                )}
              </div>
              <VmPreview agent={agent} />
            </li>
          ))}
        </ul>
      </section>

      <div className="flex gap-2 border-t border-border pt-4">
        <Link
          href={`/groups/${conversation.id}/edit`}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border border-border-strong text-sm font-medium transition-colors hover:bg-surface"
        >
          <Pencil className="size-4" />
          {t.groups.edit}
        </Link>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setDeleteOpen(true);
          }}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border border-danger/30 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
        >
          <Trash2 className="size-4" />
          {t.groups.delete}
        </button>
      </div>

      <ConfirmDialog
        open={!!removing}
        title={f(t.groups.removeTitle, { name: removing?.name ?? "" })}
        description={f(t.groups.removeDescription, { name: removing?.name ?? "" })}
        confirmLabel={t.groups.removeConfirm}
        cancelLabel={t.groups.cancel}
        pending={pending}
        error={removing && error ? t.groups.errors[error] : null}
        onConfirm={removeMember}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={f(t.groups.deleteTitle, { name: conversation.title ?? "" })}
        description={t.groups.deleteDescription}
        confirmLabel={pending ? t.groups.deleting : t.groups.delete}
        cancelLabel={t.groups.cancel}
        pending={pending}
        error={deleteOpen && error ? t.groups.errors[error] : null}
        onConfirm={deleteGroup}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
