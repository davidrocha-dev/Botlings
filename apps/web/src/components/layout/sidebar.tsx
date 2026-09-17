"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Pin, Plus, Search } from "lucide-react";
import { ConversationAvatar } from "@/components/avatar/conversation-avatar";
import { SettingsMenu } from "./settings-menu";
import { useI18n } from "@/lib/i18n/client";
import { formatListTime } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function Sidebar() {
  const { t, f, locale } = useI18n();
  const { conversations, getAgent, typing } = useStore();
  const params = useParams<{ id?: string }>();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    return conversations
      .map((conversation) => {
        const title =
          conversation.type === "group"
            ? (conversation.title ?? "")
            : (getAgent(conversation.memberIds[0])?.name ?? "");
        const last = conversation.lastMessage;
        const lastAuthor = last?.author.type === "agent" ? getAgent(last.author.agentId)?.name : undefined;
        return { conversation, title, last, lastAuthor };
      })
      .filter((row) => row.title.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => {
        if (a.conversation.pinned !== b.conversation.pinned) return a.conversation.pinned ? -1 : 1;
        return (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0);
      });
  }, [conversations, getAgent, query]);

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe px-4">
        <div className="flex h-14 items-center justify-between">
          <h1 className="text-[22px] font-semibold tracking-tight">{t.nav.chats}</h1>
          <div className="flex items-center gap-1">
            <SettingsMenu />
            <Link
              href="/agents/new"
              aria-label={t.nav.newAgent}
              className="inline-flex size-9 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-soft transition-all hover:bg-accent-hover active:scale-95"
            >
              <Plus className="size-[18px]" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
        <label className="mb-2 flex h-9 items-center gap-2 rounded-xl bg-surface-2 px-3 text-muted focus-within:ring-2 focus-within:ring-accent/40">
          <Search className="size-4 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.nav.search}
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-subtle"
          />
        </label>
      </header>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <ul className="space-y-0.5">
          {rows.map(({ conversation, title, last, lastAuthor }) => {
            const active = params.id === conversation.id;
            const typingAgent = typing[conversation.id] ? getAgent(typing[conversation.id]!) : undefined;
            const preview = typingAgent
              ? f(t.chat.typing, { name: typingAgent.name }) + "…"
              : last
                ? last.kind === "event"
                  ? `${t.chat.modelChanged}: ${last.metadata?.toModel ?? ""}`
                  : last.kind === "task"
                  ? `${t.tasks.status[last.metadata?.taskStatus ?? "running"]}: ${last.text}`
                  : last.kind === "tool"
                  ? `${t.tools[last.metadata?.tool as keyof typeof t.tools] ?? ""} ${last.text}`
                  : `${conversation.type === "group" && lastAuthor ? `${lastAuthor}: ` : ""}${last.text}`
                : "";

            return (
              <li key={conversation.id}>
                <Link
                  href={`/c/${conversation.id}`}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors",
                    active ? "bg-accent-soft" : "hover:bg-surface",
                  )}
                >
                  <ConversationAvatar conversation={conversation} size={48} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1 truncate font-medium">
                        {title}
                        {conversation.pinned && <Pin className="size-3 shrink-0 rotate-45 text-subtle" />}
                      </span>
                      {last && (
                        <span suppressHydrationWarning className={cn("shrink-0 text-xs", conversation.unread ? "text-accent" : "text-subtle")}>
                          {formatListTime(last.createdAt, locale)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("truncate text-sm", typingAgent ? "text-accent" : "text-muted")}>{preview}</p>
                      {conversation.unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-contrast">
                          {conversation.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
