"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, CornerDownLeft, File, Folder, Loader2, RefreshCw, SquareTerminal, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useI18n } from "@/lib/i18n/client";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/cn";

const noopSubscribe = () => () => {};
const HOME = "/home/botling";

type Tab = "files" | "terminal";
type Listing = { path: string; entries: string[] };
type OpenFile = { path: string; content: string };
type TerminalEntry = { command: string; output: string; exitCode: number | null; pending?: boolean };

const parentOf = (path: string) => {
  const parent = path.replace(/\/[^/]+\/?$/, "");
  return parent.length >= HOME.length ? parent : HOME;
};
const displayPath = (path: string) => path.replace(HOME, "~");

function useWorkspaceApi(agentId: string) {
  const { t } = useI18n();
  const request = useCallback(
    async <T,>(input: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(`/api/agents/${agentId}/workspace${input}`, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === "not_running" ? t.workspace.notRunning : (data.error ?? "failed"));
      return data as T;
    },
    [agentId, t.workspace.notRunning],
  );
  return request;
}

function FilesTab({ agentId }: { agentId: string }) {
  const { t } = useI18n();
  const request = useWorkspaceApi(agentId);
  const [listing, setListing] = useState<Listing | null>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        setListing(await request<Listing>(`?path=${encodeURIComponent(path)}`));
        setFile(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [request],
  );

  const read = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      setFile(await request<OpenFile>(`?file=${encodeURIComponent(path)}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Data is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void open("~/workspace");
  }, [open]);

  const currentPath = file?.path ?? listing?.path ?? `${HOME}/workspace`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <IconButton
          aria-label={t.nav.back}
          disabled={loading || (!file && currentPath === HOME)}
          onClick={() => (file ? setFile(null) : open(parentOf(currentPath)))}
        >
          <ChevronLeft className="size-[18px]" />
        </IconButton>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{displayPath(currentPath)}</p>
        {loading && <Loader2 className="size-4 animate-spin text-accent" />}
        <IconButton aria-label={t.workspace.refresh} disabled={loading} onClick={() => (file ? read(file.path) : open(currentPath))}>
          <RefreshCw className="size-4" />
        </IconButton>
      </div>

      {error && <p className="bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

      <div className="min-h-0 flex-1 overflow-auto">
        {file ? (
          <pre className="p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{file.content || t.workspace.emptyFile}</pre>
        ) : listing && listing.entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">{t.workspace.emptyFolder}</p>
        ) : (
          <ul className="p-1.5">
            {listing?.entries
              .slice()
              .sort((a, b) => Number(b.endsWith("/")) - Number(a.endsWith("/")) || a.localeCompare(b))
              .map((entry) => {
                const isDir = entry.endsWith("/");
                const name = entry.replace(/\/$/, "");
                const path = `${listing.path}/${name}`;
                return (
                  <li key={entry}>
                    <button
                      type="button"
                      onClick={() => (isDir ? open(path) : read(path))}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface"
                    >
                      {isDir ? <Folder className="size-4 shrink-0 text-accent" /> : <File className="size-4 shrink-0 text-muted" />}
                      <span className="truncate">{name}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}

function TerminalTab({ agentId }: { agentId: string }) {
  const { t } = useI18n();
  const request = useWorkspaceApi(agentId);
  const [history, setHistory] = useState<TerminalEntry[]>([]);
  const [command, setCommand] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const running = history.at(-1)?.pending ?? false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [history]);

  const run = async () => {
    const cmd = command.trim();
    if (!cmd || running) return;
    setCommand("");
    setHistory((h) => [...h, { command: cmd, output: "", exitCode: null, pending: true }]);
    let entry: TerminalEntry;
    try {
      const r = await request<{ exitCode: number | null; output: string }>("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      entry = { command: cmd, output: r.output, exitCode: r.exitCode };
    } catch (e) {
      entry = { command: cmd, output: (e as Error).message, exitCode: 1 };
    }
    setHistory((h) => [...h.slice(0, -1), entry]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-terminal-bg text-terminal-text">
      <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
        {history.length === 0 && <p className="text-terminal-muted">{t.workspace.terminalHint}</p>}
        {history.map((entry, i) => (
          <div key={i} className="mb-3">
            <p>
              <span className="text-terminal-prompt">botling</span>
              <span className="text-terminal-muted">:~/workspace$ </span>
              {entry.command}
            </p>
            {entry.pending ? (
              <Loader2 className="mt-1 size-3.5 animate-spin text-terminal-muted" />
            ) : (
              <pre className={cn("break-words whitespace-pre-wrap", entry.exitCode ? "text-terminal-error" : "text-terminal-text")}>
                {entry.output}
              </pre>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="pb-safe flex items-center gap-2 border-t border-terminal-muted/20 px-3 py-2"
      >
        <span className="font-mono text-xs text-terminal-muted">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={running}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={t.workspace.commandPlaceholder}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-terminal-muted"
        />
        <button
          type="submit"
          disabled={running || !command.trim()}
          aria-label={t.workspace.run}
          className="inline-flex size-8 items-center justify-center rounded-full bg-terminal-muted/20 disabled:opacity-40"
        >
          <CornerDownLeft className="size-4" />
        </button>
      </form>
    </div>
  );
}

export function WorkspaceDialog({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [tab, setTab] = useState<Tab>("files");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
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
            className="pt-safe flex h-full w-full max-w-3xl flex-col overflow-hidden bg-elevated shadow-modal md:h-[min(calc(100dvh-4rem),44rem)] md:rounded-3xl"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-border py-2.5 pr-3 pl-5">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {t.workspace.title} · {agent.name}
              </p>
              <div className="flex rounded-xl bg-surface-2 p-1">
                {(["files", "terminal"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                      tab === key ? "bg-elevated text-text shadow-soft" : "text-muted hover:text-text",
                    )}
                  >
                    {key === "files" ? <Folder className="size-3.5" /> : <SquareTerminal className="size-3.5" />}
                    {key === "files" ? t.workspace.files : t.workspace.terminal}
                  </button>
                ))}
              </div>
              <IconButton aria-label={t.info.close} onClick={onClose}>
                <X className="size-[18px]" />
              </IconButton>
            </div>
            {tab === "files" ? <FilesTab agentId={agent.id} /> : <TerminalTab agentId={agent.id} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
