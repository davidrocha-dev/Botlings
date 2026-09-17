"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Brain, Cpu, FileText, Globe, Loader2, MousePointerClick, SquareTerminal } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { useI18n } from "@/lib/i18n/client";
import { formatMessageTime } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Conversation, Message } from "@/lib/types";
import { cn } from "@/lib/cn";
import { ApprovalCard } from "./approval-card";
import { ProposalCard } from "./proposal-card";
import { TaskCard } from "./task-card";

const GROUP_GAP_MS = 5 * 60_000;

function authorKey(message: Message) {
  return message.author.type === "user" ? "user" : message.author.agentId;
}

function TypingBubble({ agentId }: { agentId: string }) {
  const { getAgent } = useStore();
  const agent = getAgent(agentId);
  if (!agent) return null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="mt-3 flex items-end gap-2"
    >
      <BotlingAvatar appearance={{ ...agent.appearance, mood: "thinking" }} size={28} animated />
      <div className="flex h-9 items-center gap-1 rounded-[20px] rounded-bl-md bg-bubble-in px-4">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-2 rounded-full bg-subtle"
            animate={{ opacity: [0.35, 1, 0.35], y: [0, -2, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16 }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function EventRow({ message }: { message: Message }) {
  const { t } = useI18n();
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="my-3 flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-muted"
    >
      <Cpu className="size-3.5 text-accent" />
      <span className="font-medium">{t.chat.modelChanged}</span>
      <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px]">{message.metadata?.fromModel}</code>
      →
      <code className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent">
        {message.metadata?.toModel}
      </code>
    </motion.div>
  );
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  run_command: <SquareTerminal className="size-3.5" />,
  read_file: <FileText className="size-3.5" />,
  write_file: <FileText className="size-3.5" />,
  list_files: <FileText className="size-3.5" />,
  browser_open: <Globe className="size-3.5" />,
  browser_snapshot: <Globe className="size-3.5" />,
  browser_click: <MousePointerClick className="size-3.5" />,
  browser_type: <MousePointerClick className="size-3.5" />,
};

function ToolRow({ message }: { message: Message }) {
  const { t } = useI18n();
  const tool = message.metadata?.tool ?? "";
  const label = t.tools[tool as keyof typeof t.tools] ?? tool;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="my-1 ml-9 flex max-w-[85%] items-center gap-2 text-xs text-muted"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent">
        {TOOL_ICONS[tool] ?? <Cpu className="size-3.5" />}
      </span>
      <span className="shrink-0 font-medium">{label}</span>
      <code className="truncate rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px]">{message.text}</code>
    </motion.div>
  );
}

function MemoryRow({ message }: { message: Message }) {
  const { t } = useI18n();
  const forgot = message.metadata?.tool === "forget";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="my-1 ml-9 flex max-w-[85%] items-start gap-2 text-xs text-muted"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Brain className="size-3.5" />
      </span>
      <span className="pt-1">
        <span className="font-medium">{forgot ? t.memory.forgot : t.memory.remembered}</span>{" "}
        <span className={cn(forgot && "line-through")}>{message.text}</span>
      </span>
    </motion.div>
  );
}

function ErrorRow({ message }: { message: Message }) {
  const { t } = useI18n();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto my-3 flex max-w-md gap-2.5 rounded-2xl border border-danger/25 bg-danger/8 px-3.5 py-2.5 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="font-medium text-danger">{t.chat.errorTitle}</p>
        <p className="mt-0.5 break-words text-muted">{message.text}</p>
        {message.metadata?.errorCode === 402 ? (
          <Link href="/usage" className="mt-1 inline-block text-xs font-medium text-accent">
            {t.chat.budgetHint}
          </Link>
        ) : (
          <p className="mt-1 text-xs text-subtle">{t.chat.errorHint}</p>
        )}
      </div>
    </motion.div>
  );
}

export function MessageList({ conversation }: { conversation: Conversation }) {
  const { t, locale } = useI18n();
  const { messagesByConversation, getAgent, typing, drafts } = useStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const loaded = messagesByConversation[conversation.id];
  const draft = drafts[conversation.id];
  const typingAgentId = typing[conversation.id];
  const isGroup = conversation.type === "group";

  const list: Message[] = loaded ? [...loaded] : [];
  if (draft) {
    list.push({
      id: draft.id,
      conversationId: conversation.id,
      author: { type: "agent", agentId: draft.agentId },
      text: draft.text,
      createdAt: loaded?.at(-1)?.createdAt ?? 0,
      kind: "text",
      streaming: true,
    });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: loaded ? "smooth" : "auto", block: "end" });
  }, [list.length, draft?.text, typingAgentId, loaded]);

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" />
        {t.chat.loading}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 md:px-6">
      <div className="mx-auto flex max-w-3xl flex-col">
        <AnimatePresence initial={false}>
          {list.map((message, index) => {
            if (message.kind === "event") return <EventRow key={message.id} message={message} />;
            if (message.kind === "error") return <ErrorRow key={message.id} message={message} />;
            if (message.kind === "tool") return <ToolRow key={message.id} message={message} />;
            if (message.kind === "task") return <TaskCard key={message.id} message={message} />;
            if (message.kind === "proposal") return <ProposalCard key={message.id} message={message} />;
            if (message.kind === "approval") return <ApprovalCard key={message.id} message={message} />;
            if (message.kind === "memory") return <MemoryRow key={message.id} message={message} />;

            const prev = list[index - 1];
            const next = list[index + 1];
            const mine = message.author.type === "user";
            const agent = message.author.type === "agent" ? getAgent(message.author.agentId) : undefined;
            const sameBlock = (a?: Message, b?: Message) =>
              !!a && !!b && a.kind === "text" && b.kind === "text" && authorKey(a) === authorKey(b) && Math.abs(b.createdAt - a.createdAt) <= GROUP_GAP_MS;
            const startsBlock = !sameBlock(prev, message);
            const endsBlock = !sameBlock(message, next);
            const showTime = !prev || message.createdAt - prev.createdAt > GROUP_GAP_MS;

            return (
              <motion.div
                key={message.id}
                layout="position"
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
                className={cn(startsBlock ? "mt-3" : "mt-0.5")}
              >
                {showTime && !message.streaming && (
                  <p suppressHydrationWarning className="mb-2 text-center text-[11px] font-medium text-subtle">
                    {formatMessageTime(message.createdAt, locale)}
                  </p>
                )}
                {isGroup && !mine && startsBlock && agent && (
                  <p className="mb-1 ml-11 text-xs font-medium text-muted">{agent.name}</p>
                )}
                <div className={cn("flex items-end gap-2", mine && "justify-end")}>
                  {!mine && (
                    <div className="w-7 shrink-0">
                      {endsBlock && agent && (
                        <BotlingAvatar
                          appearance={message.streaming ? { ...agent.appearance, mood: "focused" } : agent.appearance}
                          size={28}
                          animated={message.streaming}
                          title={agent.name}
                        />
                      )}
                    </div>
                  )}
                  <div
                    title={message.model ?? undefined}
                    className={cn(
                      "max-w-[78%] rounded-[20px] px-3.5 py-2 text-[15px] leading-snug break-words whitespace-pre-wrap md:max-w-[70%]",
                      mine ? "bg-accent text-accent-contrast" : "bg-bubble-in text-bubble-in-text",
                      mine ? "rounded-br-md" : "rounded-bl-md",
                      !startsBlock && (mine ? "rounded-tr-md" : "rounded-tl-md"),
                    )}
                  >
                    {message.text}
                    {message.streaming && (
                      <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-current opacity-60" />
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
          {typingAgentId && !draft && <TypingBubble key="typing" agentId={typingAgentId} />}
        </AnimatePresence>
        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
}
