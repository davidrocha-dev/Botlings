"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Globe, Loader2, Maximize2, MonitorOff, Power, TriangleAlert, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";
import type { Agent, ComputerState } from "@/lib/types";
import { cn } from "@/lib/cn";

const noopSubscribe = () => () => {};
const POLL_MS = 15_000;

type ComputerAction = "start" | "stop" | "browser";

function useComputer(agentId: string, watching: boolean) {
  const { computerTicks } = useStore();
  const tick = computerTicks[agentId] ?? 0;
  const [state, setState] = useState<ComputerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The action currently in flight, so only its button shows progress. */
  const [pending, setPending] = useState<ComputerAction | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/computer${watching ? "?watch=1" : ""}`);
      if (res.ok) setState(await res.json());
    } catch {}
  }, [agentId, watching]);

  useEffect(() => {
    // Refresh on mount, whenever the agent used its computer, and periodically.
    // State is only set after the fetch resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, tick]);

  const act = useCallback(
    async (action: ComputerAction) => {
      setPending(action);
      setError(null);
      if (action === "start") setState({ status: "starting" });
      try {
        const res = await fetch(`/api/agents/${agentId}/computer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (!res.ok) setError(data.error ?? "failed");
        await refresh();
      } finally {
        setPending(null);
      }
    },
    [agentId, refresh],
  );

  return { state, error, pending, act };
}

function Screen({
  state,
  interactive,
  onStart,
  pending,
  error,
}: {
  state: ComputerState | null;
  interactive: boolean;
  onStart: () => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useI18n();

  if (state?.status === "running" && state.vncPath) {
    // The gateway runs on the same host the app was opened from (works from a phone or Tailscale too).
    const base = `${window.location.protocol}//${window.location.hostname}:${state.gatewayPort}`;
    return (
      <iframe
        src={`${base}${state.vncPath}&view_only=${interactive ? 0 : 1}&show_dot=${interactive ? 1 : 0}`}
        title={t.info.computer}
        className={cn("h-full w-full border-0 bg-black", !interactive && "pointer-events-none")}
      />
    );
  }

  const message =
    !state || state.status === "starting"
      ? t.info.starting
      : state.status === "unavailable"
        ? t.info.dockerUnavailable
        : state.status === "no_image"
          ? t.info.imageMissing
          : t.info.computerStopped;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 p-4 text-center">
      {!state || state.status === "starting" ? (
        <Loader2 className="size-5 animate-spin text-accent" />
      ) : state.status === "stopped" ? (
        <MonitorOff className="size-5 text-subtle" />
      ) : (
        <TriangleAlert className="size-5 text-warning" />
      )}
      <p className="max-w-60 text-xs leading-relaxed text-muted">{error ? `${t.info.computerError} ${error}` : message}</p>
      {state?.status === "stopped" && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              onStart();
            }
          }}
          aria-disabled={pending}
          className="mt-1 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-medium text-accent-contrast hover:bg-accent-hover"
        >
          <Power className="size-3.5" />
          {t.info.startComputer}
        </span>
      )}
    </div>
  );
}

export function VmPreview({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [fullscreen, setFullscreen] = useState(false);
  const { state, error, pending, act } = useComputer(agent.id, fullscreen);
  const running = state?.status === "running";

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFullscreen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => running && setFullscreen(true)}
        onKeyDown={(e) => e.key === "Enter" && running && setFullscreen(true)}
        aria-label={t.info.openFullscreen}
        title={running ? t.info.viewOnlyHint : undefined}
        className={cn(
          "group relative block aspect-video w-full overflow-hidden rounded-2xl border border-border shadow-soft",
          running && "cursor-pointer transition-transform hover:scale-[1.01]",
        )}
      >
        <Screen state={state} interactive={false} onStart={() => act("start")} pending={pending !== null} error={error} />
        {running && (
          <>
            <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur">
              <span className="size-1.5 animate-pulse rounded-full bg-danger" />
              {t.info.live}
            </span>
            <span className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
              <Maximize2 className="size-3.5" />
            </span>
          </>
        )}
      </div>

      {isClient &&
        createPortal(
          <AnimatePresence>
            {fullscreen && (
              <motion.div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm md:p-8"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setFullscreen(false)}
              >
                <motion.div
                  initial={{ scale: 0.94, y: 12 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.94, y: 12 }}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  onClick={(event) => event.stopPropagation()}
                  className="pt-safe flex h-full w-full max-w-6xl flex-col overflow-hidden bg-elevated shadow-modal md:h-[min(calc(100dvh-4rem),52rem)] md:rounded-3xl"
                >
                  <div className="flex shrink-0 items-center gap-3 border-b border-border py-3 pr-3 pl-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-semibold">
                        {running && <span className="size-2 shrink-0 animate-pulse rounded-full bg-success" />}
                        {t.info.computer} · {agent.name}
                      </p>
                      <p className="hidden truncate text-xs text-muted sm:block">{t.info.desktopHint}</p>
                    </div>
                    {running && (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={pending !== null}
                          onClick={() => act("browser")}
                          className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-3.5 text-sm font-medium text-accent-contrast shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-80"
                        >
                          {pending === "browser" ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                          <span className="hidden sm:inline">{t.info.openBrowser}</span>
                        </button>
                        <button
                          type="button"
                          disabled={pending !== null}
                          onClick={() => act("stop").then(() => setFullscreen(false))}
                          className="inline-flex h-9 items-center gap-2 rounded-full border border-border-strong px-3.5 text-sm font-medium text-text transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:cursor-default disabled:opacity-60"
                        >
                          {pending === "stop" ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
                          <span className="hidden sm:inline">{t.info.stopComputer}</span>
                        </button>
                      </div>
                    )}
                    <div className="mx-1 h-6 w-px shrink-0 bg-border" />
                    <IconButton aria-label={t.info.close} onClick={() => setFullscreen(false)}>
                      <X className="size-[18px]" />
                    </IconButton>
                  </div>
                  {error && running && (
                    <p role="alert" className="bg-danger/10 px-4 py-1.5 text-xs text-danger">
                      {t.info.computerError} {error}
                    </p>
                  )}
                  <div className="relative min-h-0 w-full flex-1 bg-black">
                    <Screen state={state} interactive onStart={() => act("start")} pending={pending !== null} error={error} />
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
