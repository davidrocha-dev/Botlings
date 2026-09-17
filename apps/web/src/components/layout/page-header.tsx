"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

/** Sticky header for full-page screens (settings, usage…), with a back link on mobile. */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="glass pt-safe sticky top-0 z-10 border-b border-border">
      <div className="flex h-14 items-center gap-2 px-2 md:px-6">
        <Link href="/" aria-label={t.nav.back} className="inline-flex h-9 items-center text-accent md:hidden">
          <ChevronLeft className="size-7" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate leading-tight font-semibold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </header>
  );
}
