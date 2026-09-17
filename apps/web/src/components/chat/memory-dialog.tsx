"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useI18n } from "@/lib/i18n/client";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/cn";

type Memory = { id: string; content: string; source: "agent" | "user"; updatedAt: number };
type Payload = { memories: Memory[]; limit: number };

const noopSubscribe = () => () => {};

export function MemoryDialog({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const { t, f } = useI18n();
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (path: string, init?: RequestInit, key = "load") => {
      setBusy(key);
      setError(null);
      try {
        const res = await fetch(`/api/agents/${agent.id}/memories${path}`, {
          ...init,
          headers: init?.body ? { "Content-Type": "application/json" } : undefined,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error === "memory_full" ? t.memory.full : t.memory.error);
          return false;
        }
        setData(body);
        return true;
      } finally {
        setBusy(null);
      }
    },
    [agent.id, t.memory.full, t.memory.error],
  );

  useEffect(() => {
    // Loads when opened; state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void call("");
  }, [open, call]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!isClient) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm md:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="pt-safe flex h-full w-full max-w-xl flex-col overflow-hidden bg-elevated shadow-modal md:h-[min(calc(100dvh-4rem),40rem)] md:rounded-3xl"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-border py-2.5 pr-3 pl-5">
              <Brain className="size-4 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {t.memory.title} · {agent.name}
                </p>
                {data && (
                  <p className="text-xs text-muted tabular-nums">
                    {f(t.memory.count, { count: data.memories.length, limit: data.limit })}
                  </p>
                )}
              </div>
              <IconButton aria-label={t.info.close} onClick={onClose}>
                <X className="size-[18px]" />
              </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <p className="mb-3 text-xs leading-relaxed text-muted">{t.memory.explainer}</p>
              {error && <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
              {!data ? (
                <Loader2 className="mx-auto size-5 animate-spin text-muted" />
              ) : data.memories.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">{t.memory.empty}</p>
              ) : (
                <ul className="space-y-2">
                  {data.memories.map((m, i) => (
                    <li key={m.id} className="group rounded-2xl bg-surface p-3">
                      {editing?.id === m.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editing.content}
                            onChange={(e) => setEditing({ id: m.id, content: e.target.value })}
                            maxLength={500}
                            rows={3}
                            autoFocus
                            className="w-full resize-none rounded-xl border border-border-strong bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50 focus:ring-4 focus:ring-accent-soft"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={!editing.content.trim() || busy !== null}
                              onClick={async () => {
                                const ok = await call(`/${m.id}`, { method: "PATCH", body: JSON.stringify({ content: editing.content }) }, m.id);
                                if (ok) setEditing(null);
                              }}
                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-medium text-accent-contrast disabled:opacity-50"
                            >
                              {busy === m.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                              {t.secrets.save}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="h-8 rounded-full px-3 text-xs font-medium text-muted hover:bg-surface-2"
                            >
                              {t.agent.cancel}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 w-6 shrink-0 text-xs text-subtle tabular-nums">{i + 1}</span>
                          <p className="min-w-0 flex-1 text-sm leading-snug">{m.content}</p>
                          <span
                            className={cn(
                              "mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              m.source === "user" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
                            )}
                          >
                            {m.source === "user" ? t.memory.byYou : t.memory.byAgent}
                          </span>
                          <button
                            type="button"
                            aria-label={t.agent.edit}
                            onClick={() => setEditing({ id: m.id, content: m.content })}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={t.agent.delete}
                            disabled={busy === m.id}
                            onClick={() => call(`/${m.id}`, { method: "DELETE" }, m.id)}
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"
                          >
                            {busy === m.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                if (await call("", { method: "POST", body: JSON.stringify({ content: draft }) }, "add")) setDraft("");
              }}
              className="pb-safe flex shrink-0 items-center gap-2 border-t border-border p-3"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={500}
                placeholder={t.memory.addPlaceholder}
                className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-bg px-3.5 text-sm outline-none placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft"
              />
              <button
                type="submit"
                disabled={!draft.trim() || busy !== null}
                aria-label={t.memory.add}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-sm font-medium text-accent-contrast disabled:opacity-50"
              >
                {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                <span className="hidden sm:inline">{t.memory.add}</span>
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
