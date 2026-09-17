"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { PageHeader } from "@/components/layout/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n/client";
import { formatListTime } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

type Secret = {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
  updatedAt: number;
  lastUsedAt: number | null;
};

const fieldClass =
  "h-10 w-full rounded-xl border border-border-strong bg-bg px-3.5 text-[15px] outline-none placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft";

function AgentChecklist({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { agents } = useStore();
  return (
    <div className="flex flex-wrap gap-2">
      {agents.map((agent) => {
        const on = value.includes(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((id) => id !== agent.id) : [...value, agent.id])}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-xs font-medium transition-colors",
              on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-text",
            )}
          >
            <BotlingAvatar appearance={agent.appearance} size={20} />
            {agent.name}
          </button>
        );
      })}
    </div>
  );
}

export function SecretsPage() {
  const { t, locale } = useI18n();
  const { getAgent } = useStore();
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", value: "", description: "", agentIds: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{ id: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<Secret | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/secrets")
      .then((res) => (res.ok ? res.json() : { secrets: [] }))
      .then((data) => setSecrets(data.secrets))
      .catch(() => setSecrets([]));
  }, []);

  const errorText = (code: string) => t.secrets.errors[code as keyof typeof t.secrets.errors] ?? t.secrets.errors.generic;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(errorText(data.error));
      setSecrets(data.secrets);
      setForm({ name: "", value: "", description: "", agentIds: [] });
      setCreating(false);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/secrets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSecrets(data.secrets);
      return res.ok;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/secrets/${deleting.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSecrets(data.secrets);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.secrets.title} subtitle={t.secrets.subtitle}>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-3.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t.secrets.add}</span>
          </button>
        )}
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:px-8">
          <div className="flex gap-3 rounded-2xl bg-surface p-3.5 text-sm text-muted">
            <Lock className="mt-0.5 size-4 shrink-0 text-accent" />
            <p className="leading-relaxed">{t.secrets.explainer}</p>
          </div>

          {creating && (
            <form onSubmit={create} className="space-y-3 rounded-3xl border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted">{t.secrets.name}</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })}
                    placeholder="GITHUB_TOKEN"
                    required
                    spellCheck={false}
                    className={cn(fieldClass, "font-mono text-sm")}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted">{t.secrets.value}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    required
                    className={cn(fieldClass, "font-mono text-sm")}
                  />
                </label>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted">{t.secrets.description}</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t.secrets.descriptionPlaceholder}
                  maxLength={300}
                  className={fieldClass}
                />
              </label>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted">{t.secrets.agents}</span>
                <AgentChecklist value={form.agentIds} onChange={(agentIds) => setForm({ ...form, agentIds })} />
              </div>
              {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-60"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {t.secrets.save}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="h-10 rounded-xl border border-border-strong px-4 text-sm font-medium hover:bg-surface"
                >
                  {t.agent.cancel}
                </button>
              </div>
            </form>
          )}

          {secrets === null ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted" />
          ) : secrets.length === 0 && !creating ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <KeyRound className="size-8 text-subtle" />
              <p className="text-sm text-muted">{t.secrets.empty}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {secrets.map((secret) => (
                <li key={secret.id} className="space-y-3 rounded-3xl border border-border p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <KeyRound className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-semibold">${secret.name}</p>
                      {secret.description && <p className="text-sm text-muted">{secret.description}</p>}
                      <p suppressHydrationWarning className="mt-0.5 text-xs text-subtle">
                        {secret.lastUsedAt
                          ? `${t.secrets.lastUsed} ${formatListTime(secret.lastUsedAt, locale)}`
                          : t.secrets.neverUsed}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={t.agent.delete}
                      onClick={() => setDeleting(secret)}
                      className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted">{t.secrets.agents}</span>
                    <AgentChecklist value={secret.agentIds} onChange={(agentIds) => patch(secret.id, { agentIds })} />
                    {secret.agentIds.filter((id) => getAgent(id)).length === 0 && (
                      <p className="text-xs text-warning">{t.secrets.noAgents}</p>
                    )}
                  </div>

                  {replacing?.id === secret.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="password"
                        autoComplete="off"
                        autoFocus
                        value={replacing.value}
                        onChange={(e) => setReplacing({ id: secret.id, value: e.target.value })}
                        placeholder={t.secrets.newValue}
                        className={cn(fieldClass, "font-mono text-sm")}
                      />
                      <button
                        type="button"
                        disabled={!replacing.value || busy}
                        onClick={async () => {
                          if (await patch(secret.id, { value: replacing.value })) setReplacing(null);
                        }}
                        className="h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-accent-contrast disabled:opacity-50"
                      >
                        {t.secrets.save}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReplacing({ id: secret.id, value: "" })}
                      className="text-xs font-medium text-accent"
                    >
                      {t.secrets.replace}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        title={t.secrets.deleteTitle.replace("{name}", deleting?.name ?? "")}
        description={t.secrets.deleteDescription}
        confirmLabel={t.agent.delete}
        cancelLabel={t.agent.cancel}
        pending={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
