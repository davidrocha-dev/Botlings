"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { useI18n } from "@/lib/i18n/client";

export function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-surface/40 p-8 text-center">
      <div className="flex items-end -space-x-3">
        <BotlingAvatar appearance={{ shape: "square", color: "sky", mood: "wink" }} size={56} animated />
        <BotlingAvatar appearance={{ shape: "blob", color: "violet", mood: "happy" }} size={80} animated />
        <BotlingAvatar appearance={{ shape: "flower", color: "pink", mood: "surprised" }} size={56} animated />
      </div>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t.chat.empty}</h2>
        <p className="mt-1 text-sm text-muted">{t.chat.emptyHint}</p>
      </div>
      <Link
        href="/agents/new"
        className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-contrast shadow-soft transition-all hover:bg-accent-hover active:scale-95"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        {t.nav.newAgent}
      </Link>
    </div>
  );
}
