"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "lucide-react";

const noopSubscribe = () => () => {};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !pending && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!isClient) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !pending && onCancel()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            onClick={(event) => event.stopPropagation()}
            className="pb-safe w-full max-w-sm rounded-3xl border border-border bg-elevated p-5 shadow-modal"
          >
            <h2 id="confirm-title" className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
            {error && (
              <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                autoFocus
                className="h-11 flex-1 rounded-2xl border border-border-strong text-sm font-medium transition-colors hover:bg-surface disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-danger text-sm font-semibold text-accent-contrast transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
