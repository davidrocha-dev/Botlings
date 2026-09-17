"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Paperclip } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { CHAT_COMMANDS, type ChatCommand } from "@/lib/commands";
import { useI18n } from "@/lib/i18n/client";
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
  const { t, locale } = useI18n();
  const [value, setValue] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0;

  const commandName = (command: ChatCommand) => (locale === "pt" ? command.pt : command.en);
  // Menu while typing the command word itself ("/", "/ro"…), matching either language.
  const query = !dismissed && /^\/[\p{L}_]*$/u.test(value) ? value.slice(1).toLowerCase() : null;
  const suggestions =
    query === null ? [] : CHAT_COMMANDS.filter((c) => c.en.startsWith(query) || c.pt.startsWith(query));
  const active = Math.min(highlight, Math.max(suggestions.length - 1, 0));

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const send = (text: string) => {
    onSend(text);
    setValue("");
    setDismissed(false);
    requestAnimationFrame(resize);
  };

  const submit = () => {
    if (canSend) send(value.trim());
  };

  const pick = (command: ChatCommand) => {
    const name = `/${commandName(command)}`;
    if (!command.args) return send(name);
    setValue(`${name} `);
    setHighlight(0);
    textareaRef.current?.focus();
  };

  return (
    <div className="glass pb-safe border-t border-border px-3 pt-2 md:px-6">
      <div className="relative mx-auto flex max-w-3xl items-end gap-2">
        <AnimatePresence>
          {suggestions.length > 0 && (
            <motion.div
              role="listbox"
              aria-label={t.chat.commandsTitle}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-border bg-elevated p-1.5 shadow-float md:left-11 md:w-96 md:right-auto"
            >
              <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.chat.commandsTitle}</p>
              {suggestions.map((command, index) => (
                <button
                  key={command.key}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(command)}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded-xl px-2.5 py-2 text-left text-sm",
                    index === active ? "bg-accent-soft" : "hover:bg-surface",
                  )}
                >
                  <span className="shrink-0 font-mono font-medium text-accent">
                    /{commandName(command)}
                    {command.args && (
                      <span className="ml-1 text-subtle">{command.key === "model" ? t.commands.argModel : t.commands.argRoutine}</span>
                    )}
                  </span>
                  <span className="truncate text-muted">{t.commands[command.key]}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <IconButton aria-label="Attach" className="mb-0.5" disabled>
          <Paperclip className="size-[18px]" />
        </IconButton>
        <div className="flex min-h-10 flex-1 items-end rounded-[22px] border border-border-strong bg-bg py-1 pr-1 pl-4 transition-shadow focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent-soft">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={placeholder}
            aria-autocomplete="list"
            onChange={(event) => {
              setValue(event.target.value);
              setHighlight(0);
              if (!event.target.value) setDismissed(false);
              resize();
            }}
            onKeyDown={(event) => {
              if (suggestions.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setHighlight((active + step + suggestions.length) % suggestions.length);
                  return;
                }
                if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)) {
                  event.preventDefault();
                  pick(suggestions[active]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDismissed(true);
                  return;
                }
              }
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
