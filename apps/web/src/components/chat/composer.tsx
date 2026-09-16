"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Paperclip } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

export function Composer({
  placeholder,
  sendLabel,
  onSend,
}: {
  placeholder: string;
  sendLabel: string;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0;

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
    requestAnimationFrame(resize);
  };

  return (
    <div className="glass pb-safe border-t border-border px-3 pt-2 md:px-6">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <IconButton aria-label="Attach" className="mb-0.5" disabled>
          <Paperclip className="size-[18px]" />
        </IconButton>
        <div className="flex min-h-10 flex-1 items-end rounded-[22px] border border-border-strong bg-bg py-1 pr-1 pl-4 transition-shadow focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent-soft">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              resize();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-snug outline-none placeholder:text-subtle"
          />
          <AnimatePresence>
            {canSend && (
              <motion.button
                type="button"
                aria-label={sendLabel}
                onClick={submit}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 600, damping: 30 }}
                className={cn(
                  "mb-0.5 ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast",
                  "hover:bg-accent-hover active:scale-90",
                )}
              >
                <ArrowUp className="size-[18px]" strokeWidth={2.75} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
