"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { AlarmClock, Bell, KeyRound, Languages, LogOut, Monitor, Moon, Settings, Sun, Wallet } from "lucide-react";
import { logout } from "@/app/(auth)/login/actions";
import { useStore } from "@/lib/store";
import { IconButton } from "@/components/ui/icon-button";
import { useI18n } from "@/lib/i18n/client";
import { locales } from "@/lib/i18n/dictionaries";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/cn";

const LOCALE_LABELS = { en: "English", pt: "Português" } as const;

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface-2 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all",
            value === option.value ? "bg-elevated text-text shadow-soft" : "text-muted hover:text-text",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsMenu() {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const { user } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton aria-label={t.nav.settings} aria-expanded={open} active={open} onClick={() => setOpen((o) => !o)}>
        <Settings className="size-[18px]" />
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ type: "spring", stiffness: 500, damping: 32 }}
            className="absolute top-11 right-0 z-50 w-64 origin-top-right space-y-4 rounded-2xl border border-border bg-elevated p-3 shadow-float"
          >
            <div className="space-y-2">
              <p className="px-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.theme.label}</p>
              <Segmented<ThemePreference>
                value={preference}
                onChange={setPreference}
                options={[
                  { value: "system", label: t.theme.system, icon: <Monitor className="size-3.5" /> },
                  { value: "light", label: t.theme.light, icon: <Sun className="size-3.5" /> },
                  { value: "dark", label: t.theme.dark, icon: <Moon className="size-3.5" /> },
                ]}
              />
            </div>
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
                <Languages className="size-3.5" />
                {t.language.label}
              </p>
              <Segmented
                value={locale}
                onChange={setLocale}
                options={locales.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))}
              />
            </div>
            <nav className="-mx-1 space-y-0.5 border-t border-border pt-2">
              <Link
                href="/routines"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-surface"
              >
                <AlarmClock className="size-4 text-muted" />
                {t.nav.routines}
              </Link>
              <Link
                href="/settings/notifications"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-surface"
              >
                <Bell className="size-4 text-muted" />
                {t.nav.notifications}
              </Link>
              <Link
                href="/settings/secrets"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-surface"
              >
                <KeyRound className="size-4 text-muted" />
                {t.nav.secrets}
              </Link>
              <Link
                href="/usage"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm hover:bg-surface"
              >
                <Wallet className="size-4 text-muted" />
                {t.nav.usage}
              </Link>
            </nav>
            <form action={logout} className="flex items-center justify-between gap-2 border-t border-border pt-3">
              <div className="min-w-0 px-1">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
              <button
                type="submit"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-medium text-muted hover:text-danger"
              >
                <LogOut className="size-3.5" />
                {t.nav.logout}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
