"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Loader2, Shuffle } from "lucide-react";
import { AgentGenerator } from "./agent-generator";
import { ModelPicker } from "./model-picker";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import {
  BOTLING_COLORS,
  BOTLING_COLOR_KEYS,
  BOTLING_MOODS,
  BOTLING_SHAPES,
  randomAppearance,
  type BotlingAppearance,
} from "@/components/avatar/botling-options";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/cn";

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-subtle uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const fieldClass =
  "w-full rounded-xl border border-border-strong bg-bg px-3.5 py-2.5 text-[15px] outline-none transition-shadow placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft";

/** Create a new agent, or edit an existing one when `agent` is given. */
export function AgentForm({ agent }: { agent?: Agent }) {
  const { t } = useI18n();
  const { addAgent, upsertAgent, defaultModel, conversations } = useStore();
  const router = useRouter();
  const editing = !!agent;
  const directConversationId = agent
    ? conversations.find((c) => c.type === "direct" && c.memberIds[0] === agent.id)?.id
    : undefined;
  const backHref = directConversationId ? `/c/${directConversationId}` : "/";

  const [appearance, setAppearance] = useState<BotlingAppearance>(
    agent?.appearance ?? { shape: "blob", color: "violet", mood: "happy" },
  );
  const [name, setName] = useState(agent?.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [prompt, setPrompt] = useState(agent?.prompt ?? "");
  const [model, setModel] = useState(agent?.model ?? defaultModel);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<keyof typeof t.agent.errors | null>(null);

  const update = (patch: Partial<BotlingAppearance>) => setAppearance((a) => ({ ...a, ...patch }));
  const canCreate = name.trim().length > 0 && model.trim().length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/agents/${agent.id}` : "/api/agents", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, prompt, model, appearance }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error in t.agent.errors ? data.error : "generic");
        return;
      }
      if (editing) {
        upsertAgent({ ...data.agent, status: agent.status });
        router.push(backHref);
        return;
      }
      addAgent(data.agent, {
        id: data.conversationId,
        type: "direct",
        title: null,
        memberIds: [data.agent.id],
        unread: 0,
        pinned: false,
        lastMessage: null,
      });
      router.push(`/c/${data.conversationId}`);
    } catch {
      setError("generic");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="glass pt-safe sticky top-0 z-10 border-b border-border">
        <div className="flex h-14 items-center gap-2 px-2 md:px-6">
          <Link
            href={backHref}
            aria-label={t.nav.back}
            className={cn("inline-flex h-9 items-center text-accent", !editing && "md:hidden")}
          >
            <ChevronLeft className="size-7" />
          </Link>
          <div>
            <h1 className="leading-tight font-semibold">{editing ? t.agent.editTitle : t.agent.createTitle}</h1>
            <p className="text-xs text-muted">{editing ? t.agent.editSubtitle : t.agent.createSubtitle}</p>
          </div>
        </div>
      </header>

      <form onSubmit={submit} className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-6 md:px-8 lg:grid-cols-[300px_1fr]">
          {/* Live preview */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="flex flex-col items-center rounded-3xl border border-border bg-surface px-6 py-8 text-center">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={`${appearance.shape}-${appearance.color}`}
                  initial={{ scale: 0.7, opacity: 0, rotate: -8 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.7, opacity: 0, rotate: 8 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                >
                  <BotlingAvatar appearance={appearance} size={148} animated />
                </motion.div>
              </AnimatePresence>
              <p className="mt-5 text-xl font-semibold tracking-tight">{name || "Botling"}</p>
              <p className="mt-1 line-clamp-3 min-h-5 text-sm text-muted">{role}</p>
              <p className="mt-3 max-w-full truncate rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-muted">
                {model || "—"}
              </p>
            </div>
          </div>

          <div className="space-y-8">
            {!editing && (
              <AgentGenerator
                onDraft={(draft) => {
                  setName(draft.name);
                  setRole(draft.role);
                  setPrompt(draft.prompt);
                }}
              />
            )}
            <Section
              title={t.agent.appearance}
              action={
                <button
                  type="button"
                  onClick={() => setAppearance(randomAppearance())}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-medium text-accent transition-transform active:scale-95"
                >
                  <Shuffle className="size-3.5" />
                  {t.agent.randomize}
                </button>
              }
            >
              <div className="space-y-5 rounded-3xl border border-border p-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.agent.shape}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {BOTLING_SHAPES.map((shape) => (
                      <button
                        key={shape}
                        type="button"
                        onClick={() => update({ shape })}
                        aria-pressed={appearance.shape === shape}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-2xl border p-2 transition-all",
                          appearance.shape === shape
                            ? "border-accent bg-accent-soft"
                            : "border-transparent bg-surface hover:bg-surface-2",
                        )}
                      >
                        <BotlingAvatar appearance={{ ...appearance, shape, mood: "neutral" }} size={44} />
                        <span className="text-[11px] text-muted">{t.shapes[shape]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.agent.color}</p>
                  <div className="flex flex-wrap gap-2.5">
                    {BOTLING_COLOR_KEYS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={color}
                        aria-pressed={appearance.color === color}
                        onClick={() => update({ color })}
                        className={cn(
                          "size-9 rounded-full ring-offset-2 ring-offset-bg transition-transform hover:scale-110",
                          appearance.color === color && "ring-2 ring-accent",
                        )}
                        style={{
                          background: `linear-gradient(145deg, ${BOTLING_COLORS[color].from}, ${BOTLING_COLORS[color].to})`,
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t.agent.mood}</p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {BOTLING_MOODS.map((mood) => (
                      <button
                        key={mood}
                        type="button"
                        onClick={() => update({ mood })}
                        aria-pressed={appearance.mood === mood}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-2xl border p-2 transition-all",
                          appearance.mood === mood
                            ? "border-accent bg-accent-soft"
                            : "border-transparent bg-surface hover:bg-surface-2",
                        )}
                      >
                        <BotlingAvatar appearance={{ ...appearance, mood }} size={36} />
                        <span className="truncate text-[10px] text-muted">{t.moods[mood]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            <Section title={t.agent.name}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.agent.namePlaceholder}
                maxLength={32}
                required
                className={fieldClass}
              />
            </Section>

            <Section title={t.agent.role}>
              <textarea
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder={t.agent.rolePlaceholder}
                rows={2}
                className={cn(fieldClass, "resize-none")}
              />
            </Section>

            <Section title={t.agent.prompt}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t.agent.promptPlaceholder}
                rows={5}
                className={cn(fieldClass, "resize-y")}
              />
            </Section>

            <Section title={t.agent.model}>
              <ModelPicker value={model} onChange={setModel} />
              <p className="text-xs text-muted">{t.agent.modelHint}</p>
            </Section>

            <div className="pb-safe sticky bottom-0 -mx-4 bg-gradient-to-t from-bg via-bg to-transparent px-4 pt-6 pb-4 md:static md:mx-0 md:bg-none md:p-0">
              {error && (
                <p role="alert" className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
                  {t.agent.errors[error]}
                </p>
              )}
              <button
                type="submit"
                disabled={!canCreate || submitting}
                className="h-12 w-full rounded-2xl bg-accent text-[15px] font-semibold text-accent-contrast shadow-float transition-all hover:bg-accent-hover active:scale-[0.99] disabled:opacity-40 md:w-auto md:px-8"
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {editing ? t.agent.saving : t.agent.creating}
                  </span>
                ) : editing ? (
                  t.agent.save
                ) : (
                  t.agent.create
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
