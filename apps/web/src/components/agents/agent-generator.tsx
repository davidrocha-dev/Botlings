"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

export type AgentDraft = { name: string; role: string; prompt: string };

/** "Generate with AI": turns one sentence into a draft name, role and instructions to review. */
export function AgentGenerator({ onDraft }: { onDraft: (draft: AgentDraft) => void }) {
  const { t } = useI18n();
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const generate = async () => {
    const text = description.trim();
    if (text.length < 3 || pending) return;
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.draft) {
        setError(res.status === 429 ? t.generator.rateLimited : t.generator.failed);
        return;
      }
      onDraft(data.draft);
      setDone(true);
    } catch {
      setError(t.generator.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="space-y-3 rounded-3xl border border-accent/25 bg-accent-soft/40 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent" />
        <h3 className="text-sm font-semibold">{t.generator.title}</h3>
      </div>
      <p className="text-xs text-muted">{t.generator.hint}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            // Enter generates instead of submitting the whole form.
            if (e.key === "Enter") {
              e.preventDefault();
              void generate();
            }
          }}
          maxLength={500}
          placeholder={t.generator.placeholder}
          className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-bg px-3.5 text-[15px] outline-none placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft"
        />
        <button
          type="button"
          onClick={generate}
          disabled={pending || description.trim().length < 3}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {pending ? t.generator.generating : t.generator.generate}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {done && !error && <p className="text-xs text-success">{t.generator.review}</p>}
    </section>
  );
}
