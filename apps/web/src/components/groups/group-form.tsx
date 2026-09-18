"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Loader2, MessagesSquare, MessageSquareReply } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/cn";

const fieldClass =
  "w-full rounded-xl border border-border-strong bg-bg px-3.5 py-2.5 text-[15px] outline-none transition-shadow placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft";

type ErrorKey = "generic" | "invalid_input" | "invalid_members" | "too_many_members" | "last_member" | "not_found";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{title}</h3>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** Agents as a grid of selectable tiles. */
export function AgentPicker({ selected, onToggle, excludeIds = [] }: { selected: string[]; onToggle: (id: string) => void; excludeIds?: string[] }) {
  const { agents } = useStore();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {agents
        .filter((a) => !excludeIds.includes(a.id))
        .map((agent) => {
          const on = selected.includes(agent.id);
          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(agent.id)}
              className={cn(
                "relative flex items-center gap-2.5 rounded-2xl border p-2.5 text-left transition-colors",
                on ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2",
              )}
            >
              <BotlingAvatar appearance={agent.appearance} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{agent.name}</span>
                <span className="block truncate text-xs text-muted">{agent.role}</span>
              </span>
              {on && (
                <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-contrast">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}

/** Create a group, or edit one's settings when `group` is given (members are managed in the details panel). */
export function GroupForm({ group }: { group?: Conversation }) {
  const { t, f } = useI18n();
  const { upsertConversation } = useStore();
  const router = useRouter();
  const editing = !!group;
  const backHref = group ? `/c/${group.id}` : "/";

  const [title, setTitle] = useState(group?.title ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [flows, setFlows] = useState(group?.flows ?? "");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"discussion" | "mentions">(group?.discussionMode ?? "discussion");
  const [maxTurns, setMaxTurns] = useState(group?.maxTurns ?? 6);
  const [maxCostUsd, setMaxCostUsd] = useState(group?.maxCostUsd ?? 0.05);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const canSubmit = title.trim().length > 0 && (editing || memberIds.length > 0);
  const toggle = (id: string) => setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const settings = { title, description, flows, discussionMode: mode, maxTurns, maxCostUsd };
      const res = await fetch(editing ? `/api/groups/${group.id}` : "/api/groups", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? settings : { ...settings, memberIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error in t.groups.errors ? data.error : "generic");
        return;
      }
      upsertConversation(data.conversation);
      router.push(`/c/${data.conversation.id}`);
    } catch {
      setError("generic");
    } finally {
      setSubmitting(false);
    }
  };

  const modes = [
    { value: "discussion" as const, icon: <MessagesSquare className="size-5" />, ...t.groups.discussion },
    { value: "mentions" as const, icon: <MessageSquareReply className="size-5" />, ...t.groups.mentions },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="glass pt-safe sticky top-0 z-10 border-b border-border">
        <div className="flex h-14 items-center gap-2 px-2 md:px-6">
          <Link href={backHref} aria-label={t.nav.back} className={cn("inline-flex h-9 items-center text-accent", !editing && "md:hidden")}>
            <ChevronLeft className="size-7" />
          </Link>
          <div>
            <h1 className="leading-tight font-semibold">{editing ? t.groups.editTitle : t.groups.newTitle}</h1>
            <p className="text-xs text-muted">{editing ? t.groups.editSubtitle : t.groups.newSubtitle}</p>
          </div>
        </div>
      </header>

      <form onSubmit={submit} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-7 px-4 py-6 md:px-8">
          <Section title={t.groups.name}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.groups.namePlaceholder}
              maxLength={60}
              required
              className={fieldClass}
            />
          </Section>

          <Section title={t.groups.purpose}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.groups.purposePlaceholder}
              maxLength={600}
              rows={3}
              className={cn(fieldClass, "resize-y")}
            />
          </Section>

          <Section title={t.groups.flows} hint={t.groups.flowsHint}>
            <textarea
              value={flows}
              onChange={(e) => setFlows(e.target.value)}
              placeholder={t.groups.flowsPlaceholder}
              maxLength={1500}
              rows={4}
              className={cn(fieldClass, "resize-y")}
            />
          </Section>

          {!editing && (
            <Section title={t.groups.members} hint={memberIds.length ? f(t.groups.selected, { count: memberIds.length }) : t.groups.membersHint}>
              <AgentPicker selected={memberIds} onToggle={toggle} />
            </Section>
          )}

          <Section title={t.groups.mode}>
            <div className="grid gap-2 sm:grid-cols-2">
              {modes.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => setMode(option.value)}
                  className={cn(
                    "flex gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                    mode === option.value ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2",
                  )}
                >
                  <span className={cn("mt-0.5", mode === option.value ? "text-accent" : "text-muted")}>{option.icon}</span>
                  <span>
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{option.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>

          {mode === "discussion" && (
            <Section title={t.groups.limits}>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs text-muted">{t.groups.maxTurns}</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className={fieldClass}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs text-muted">{t.groups.maxCost}</span>
                  <input
                    type="number"
                    min={0.001}
                    max={2}
                    // "any": with a 0.001 minimum, a 0.01 step would make the browser reject round cents like 0.05.
                    step="any"
                    value={maxCostUsd}
                    onChange={(e) => setMaxCostUsd(Math.max(0.001, Math.min(2, Number(e.target.value) || 0.001)))}
                    className={fieldClass}
                  />
                </label>
              </div>
              <p className="text-xs text-muted">{t.groups.limitsHint}</p>
            </Section>
          )}

          <div className="pb-safe sticky bottom-0 -mx-4 bg-gradient-to-t from-bg via-bg to-transparent px-4 pt-6 pb-4 md:static md:mx-0 md:bg-none md:p-0">
            {error && (
              <p role="alert" className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
                {t.groups.errors[error]}
              </p>
            )}
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="h-12 w-full rounded-2xl bg-accent text-[15px] font-semibold text-accent-contrast shadow-float transition-all hover:bg-accent-hover active:scale-[0.99] disabled:opacity-40 md:w-auto md:px-8"
            >
              {submitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {editing ? t.groups.saving : t.groups.creating}
                </span>
              ) : editing ? (
                t.groups.save
              ) : (
                t.groups.create
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function EditGroup({ groupId }: { groupId: string }) {
  const { conversations } = useStore();
  const group = conversations.find((c) => c.id === groupId && c.type === "group");
  if (!group) return <div className="flex flex-1 items-center justify-center text-muted">404</div>;
  return <GroupForm group={group} />;
}
