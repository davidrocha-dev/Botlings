"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { login, register, type AuthState } from "@/app/(auth)/login/actions";
import { BotlingAvatar } from "@/components/avatar/botling-avatar";
import { useI18n } from "@/lib/i18n/client";

const fieldClass =
  "h-11 w-full rounded-xl border border-border-strong bg-bg px-3.5 text-[15px] outline-none transition-shadow placeholder:text-subtle focus:border-accent/50 focus:ring-4 focus:ring-accent-soft";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "login" ? login : register, undefined);
  const copy = mode === "login" ? t.auth.login : t.auth.register;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface/60 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BotlingAvatar appearance={{ shape: "blob", color: "violet", mood: "happy" }} size={72} animated />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted">{copy.subtitle}</p>
        </div>

        <form action={action} className="space-y-3 rounded-3xl border border-border bg-elevated p-5 shadow-float">
          {mode === "register" && (
            <input name="name" autoComplete="name" required placeholder={t.auth.name} className={fieldClass} />
          )}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t.auth.email}
            className={fieldClass}
          />
          <input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 10 : undefined}
            required
            placeholder={t.auth.password}
            className={fieldClass}
          />
          {mode === "register" && <p className="px-1 text-xs text-muted">{t.auth.passwordHint}</p>}

          {state?.error && (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              {t.auth.errors[state.error]}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-contrast transition-all hover:bg-accent-hover active:scale-[0.99] disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {copy.submit}
          </button>
        </form>
      </div>
    </main>
  );
}
