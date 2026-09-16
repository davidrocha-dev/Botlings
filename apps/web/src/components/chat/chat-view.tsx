"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import { ChevronLeft, PanelRight } from "lucide-react";
import { ConversationAvatar } from "@/components/avatar/conversation-avatar";
import { IconButton } from "@/components/ui/icon-button";
import { Composer } from "./composer";
import { InfoPanel } from "./info-panel";
import { MessageList } from "./message-list";
import { useI18n } from "@/lib/i18n/client";
import { useStore } from "@/lib/store";

export function ChatView({ conversationId }: { conversationId: string }) {
  const { t, f } = useI18n();
  const { conversations, getAgent, sendMessage, markRead, loadMessages, messagesByConversation, infoOpen, setInfoOpen } =
    useStore();
  const conversation = conversations.find((c) => c.id === conversationId);
  const exists = !!conversation;
  const loaded = !!messagesByConversation[conversationId];
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    if (!exists) return;
    markRead(conversationId);
    if (!loaded) void loadMessages(conversationId);
  }, [conversationId, exists, loaded, markRead, loadMessages]);

  if (!conversation) {
    return <div className="flex flex-1 items-center justify-center text-muted">404</div>;
  }

  const agent = conversation.type === "direct" ? getAgent(conversation.memberIds[0]) : undefined;
  const title = agent?.name ?? conversation.title ?? "";
  const subtitle = agent
    ? t.status[agent.status]
    : conversation.memberIds
        .map((id) => getAgent(id)?.name)
        .filter(Boolean)
        .join(", ");

  return (
    <div className="flex h-full min-w-0 flex-1">
      <section className="relative flex h-full min-w-0 flex-1 flex-col">
        <header className="glass pt-safe absolute inset-x-0 top-0 z-20 border-b border-border">
          <div className="flex h-14 items-center gap-2 px-2 md:px-4">
            <Link
              href="/"
              aria-label={t.nav.back}
              className="inline-flex h-9 items-center rounded-full pr-1 text-accent md:hidden"
            >
              <ChevronLeft className="size-7" />
            </Link>
            <button
              type="button"
              onClick={() => setInfoOpen(!infoOpen)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left"
            >
              <ConversationAvatar conversation={conversation} size={36} animated />
              <div className="min-w-0">
                <p className="truncate leading-tight font-semibold">{title}</p>
                <p className="truncate text-xs text-muted">{subtitle}</p>
              </div>
            </button>
            <IconButton aria-label={t.info.toggle} active={infoOpen} onClick={() => setInfoOpen(!infoOpen)}>
              <PanelRight className="size-[18px]" />
            </IconButton>
          </div>
        </header>

        <div className="pt-safe flex min-h-0 flex-1 flex-col">
          <div className="h-14 shrink-0" />
          <MessageList conversation={conversation} />
        </div>

        {sendError && (
          <p role="alert" className="bg-danger/10 px-4 py-1.5 text-center text-xs text-danger">
            {t.chat.sendFailed}
          </p>
        )}
        <Composer
          placeholder={agent ? f(t.chat.placeholder, { name: agent.name }) : t.chat.groupPlaceholder}
          sendLabel={t.chat.send}
          onSend={(text) => {
            setSendError(false);
            sendMessage(conversation.id, text).catch(() => setSendError(true));
          }}
        />
      </section>

      <AnimatePresence>
        {infoOpen && <InfoPanel key="info" conversation={conversation} onClose={() => setInfoOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
