"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Wrench } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import type { ModelOption } from "@/lib/types";
import { cn } from "@/lib/cn";

let catalogPromise: Promise<ModelOption[]> | null = null;

export function loadModelCatalog() {
  catalogPromise ??= fetch("/api/models")
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
    .then((data: { models: ModelOption[] }) => data.models)
    .catch((error) => {
      catalogPromise = null;
      throw error;
    });
  return catalogPromise;
}

export function useModelCatalog() {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  useEffect(() => {
    let active = true;
    loadModelCatalog()
      .then((list) => active && setModels(list))
      .catch(() => active && setModels([]));
    return () => {
      active = false;
    };
  }, []);
  return models;
}

export function formatPrice(model: Pick<ModelOption, "promptPrice" | "completionPrice" | "free">, freeLabel: string) {
  if (model.free) return freeLabel;
  const fmt = (v: number) => `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`;
  return `${fmt(model.promptPrice)} / ${fmt(model.completionPrice)}`;
}

export function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useI18n();
  const models = useModelCatalog();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [toolsOnly, setToolsOnly] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const selected = models?.find((m) => m.id === value);

  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    return models
      .filter((m) => (!freeOnly || m.free) && (!toolsOnly || m.tools))
      .filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
      .sort((a, b) => a.promptPrice + a.completionPrice - (b.promptPrice + b.completionPrice))
      .slice(0, 80);
  }, [models, query, freeOnly, toolsOnly]);

  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted hover:text-text",
      )}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border-strong bg-bg px-3.5 py-2 text-left transition-shadow focus-visible:ring-4 focus-visible:ring-accent-soft"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px]">{selected?.name ?? value}</p>
          <p className="truncate font-mono text-[11px] text-muted">
            {value}
            {selected && ` · ${formatPrice(selected, t.info.free)}`}
          </p>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-border bg-elevated shadow-float">
          <div className="space-y-2 border-b border-border p-2.5">
            <label className="flex h-9 items-center gap-2 rounded-xl bg-surface-2 px-3 text-muted">
              <Search className="size-4 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Allow pasting any exact ID, even if it is not in the filtered list.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const exact = models?.find((m) => m.id === query.trim());
                    const pick = exact ?? filtered[0];
                    if (pick) {
                      onChange(pick.id);
                      setOpen(false);
                    }
                  }
                }}
                placeholder={t.agent.modelPlaceholder}
                spellCheck={false}
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-subtle"
              />
            </label>
            <div className="flex gap-1.5">
              {chip(freeOnly, t.agent.freeOnly, () => setFreeOnly((v) => !v))}
              {chip(toolsOnly, t.agent.toolsOnly, () => setToolsOnly((v) => !v))}
            </div>
          </div>
          <ul className="max-h-72 overflow-y-auto p-1.5">
            {models === null && <li className="px-3 py-6 text-center text-sm text-muted">…</li>}
            {models !== null && filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted">{t.agent.noModels}</li>
            )}
            {filtered.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface",
                    m.id === value && "bg-accent-soft",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted">{m.id}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className={cn("text-xs tabular-nums", m.free ? "font-semibold text-success" : "text-muted")}>
                      {formatPrice(m, t.info.free)}
                    </span>
                    {m.tools && <Wrench className="size-3 text-subtle" />}
                  </div>
                  {m.id === value && <Check className="size-4 shrink-0 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-3 py-2 text-[11px] text-subtle">{t.info.perMillion}</p>
        </div>
      )}
    </div>
  );
}
