"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Hand, Maximize2, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useI18n } from "@/lib/i18n/client";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/cn";

/**
 * Placeholder for the agent's live screen.
 * Phase 2 swaps the mock screen for a noVNC canvas streamed from the agent's container.
 */
function MockScreen({ agent, large = false }: { agent: Agent; large?: boolean }) {
  const active = agent.status === "working" || agent.status === "thinking";
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#1a1a22] text-[#d9d9e3]">
      <div className={cn("flex items-center gap-1.5 bg-[#23232d]", large ? "h-9 px-3" : "h-5 px-2")}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} className={cn("rounded-full", large ? "size-3" : "size-1.5")} style={{ background: c }} />
        ))}
        <div className={cn("ml-2 flex-1 truncate rounded bg-[#15151c] text-[#8b8b99]", large ? "px-3 py-1 text-xs" : "h-2.5")}>
          {large && "github.com/botlings/landing — Pull request"}
        </div>
      </div>
      <div className={cn("flex-1 space-y-2", large ? "p-8" : "p-2.5")}>
        {[72, 94, 58, 86, 40].map((w, i) => (
          <motion.div
            key={i}
            className={cn("rounded bg-[#2c2c38]", large ? "h-4" : "h-1.5")}
            style={{ width: `${w}%` }}
            animate={active ? { opacity: [0.5, 1, 0.5] } : { opacity: 0.6 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
      {active && (
        <motion.svg
          viewBox="0 0 24 24"
          className={cn("absolute drop-shadow", large ? "size-6" : "size-3")}
          animate={{ left: ["20%", "64%", "42%", "20%"], top: ["30%", "52%", "72%", "30%"] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          <path d="M4 2 L4 20 L9 15 L13 22 L16 20 L12 13 L19 13 Z" fill="white" stroke="black" strokeWidth="1.2" />
        </motion.svg>
      )}
    </div>
  );
}

const noopSubscribe = () => () => {};

export function VmPreview({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [fullscreen, setFullscreen] = useState(false);
  const live = agent.status !== "paused" && agent.status !== "offline";

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFullscreen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setFullscreen(true)}
        aria-label={t.info.openFullscreen}
        className="group relative block aspect-video w-full overflow-hidden rounded-2xl border border-border shadow-soft transition-transform hover:scale-[1.01] active:scale-[0.99]"
      >
        <MockScreen agent={agent} />
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur">
          <span className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-danger" : "bg-white/50")} />
          {live ? t.info.live : t.status[agent.status]}
        </span>
        <span className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
          <Maximize2 className="size-3.5" />
        </span>
      </button>

      {isClient &&
        createPortal(
          <AnimatePresence>
            {fullscreen && (
              <motion.div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-0 backdrop-blur-sm md:p-8"
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
                  className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-elevated shadow-modal md:h-auto md:rounded-3xl"
                >
                  <div className="pt-safe flex items-center justify-between border-b border-border px-4 py-2.5">
                    <div>
                      <p className="text-sm font-semibold">
                        {t.info.computer} · {agent.name}
                      </p>
                      <p className="text-xs text-muted">{t.status[agent.status]}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled
                        title={t.info.screenPlaceholder}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-medium text-muted disabled:opacity-60"
                      >
                        <Hand className="size-3.5" />
                        {t.info.takeControl}
                      </button>
                      <IconButton aria-label={t.info.close} onClick={() => setFullscreen(false)}>
                        <X className="size-[18px]" />
                      </IconButton>
                    </div>
                  </div>
                  <div className="relative aspect-video w-full flex-1 md:flex-none">
                    <MockScreen agent={agent} large />
                  </div>
                  <p className="pb-safe px-4 py-2 text-center text-xs text-subtle">{t.info.screenPlaceholder}</p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
