"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader2, Send, Smartphone, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useI18n } from "@/lib/i18n/client";
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from "@/lib/push";
import { cn } from "@/lib/cn";

type Prefs = { approvals: boolean; routines: boolean; replies: boolean };
type State = { publicKey: string; prefs: Prefs; devices: number };

function Switch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60", checked ? "bg-accent" : "bg-surface-2")}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-elevated shadow-soft transition-all",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}

export function NotificationsPage() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [busy, setBusy] = useState<"toggle" | "test" | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/notifications")
      .then((res) => res.json())
      .then(setState)
      .catch(() => {});
    // Browser capabilities are only known on the client, after hydration.
    const detected = pushSupport();
    (detected === "supported" ? currentSubscription() : Promise.resolve(null))
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {})
      .finally(() => {
        if (detected === "supported") setPermission(Notification.permission);
        setSupport(detected);
      });
  }, []);

  const refresh = async () => setState(await (await fetch("/api/notifications")).json());

  const toggleDevice = async () => {
    if (!state) return;
    setBusy("toggle");
    setNotice(null);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
      } else {
        const result = await enablePush(state.publicKey, locale);
        setPermission(Notification.permission);
        if (result === "granted") setSubscribed(true);
        else setNotice({ tone: "bad", text: t.notifications.denied });
      }
      await refresh();
    } catch {
      setNotice({ tone: "bad", text: t.notifications.failed });
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy("test");
    setNotice(null);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.sent > 0) setNotice({ tone: "good", text: t.notifications.testSent });
      else setNotice({ tone: "bad", text: t.notifications.failed });
      await refresh();
    } catch {
      setNotice({ tone: "bad", text: t.notifications.failed });
    } finally {
      setBusy(null);
    }
  };

  const setPref = async (key: keyof Prefs) => {
    if (!state) return;
    const prefs = { ...state.prefs, [key]: !state.prefs[key] };
    setState({ ...state, prefs });
    const res = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: { [key]: prefs[key] } }),
    });
    if (res.ok) setState(await res.json());
  };

  const categories: { key: keyof Prefs; title: string; hint: string }[] = [
    { key: "approvals", title: t.notifications.approvals, hint: t.notifications.approvalsHint },
    { key: "routines", title: t.notifications.routines, hint: t.notifications.routinesHint },
    { key: "replies", title: t.notifications.replies, hint: t.notifications.repliesHint },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.notifications.title} subtitle={t.notifications.subtitle} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-8">
          {!state || !support ? (
            <Loader2 className="mx-auto size-5 animate-spin text-muted" />
          ) : (
            <>
              <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    {subscribed ? <Bell className="size-5" /> : <BellOff className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t.notifications.thisDevice}</p>
                    <p className="text-sm text-muted">
                      {support === "needs-install"
                        ? t.notifications.needsInstall
                        : support === "unsupported"
                          ? t.notifications.unsupported
                          : permission === "denied"
                            ? t.notifications.blocked
                            : subscribed
                              ? t.notifications.on
                              : t.notifications.off}
                    </p>
                  </div>
                </div>

                {support === "supported" && permission !== "denied" && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={toggleDevice}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium disabled:opacity-60",
                        subscribed
                          ? "border border-border-strong hover:bg-surface-2"
                          : "bg-accent text-accent-contrast hover:bg-accent-hover",
                      )}
                    >
                      {busy === "toggle" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : subscribed ? (
                        <BellOff className="size-4" />
                      ) : (
                        <Bell className="size-4" />
                      )}
                      {subscribed ? t.notifications.disable : t.notifications.enable}
                    </button>
                    {state.devices > 0 && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={sendTest}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border-strong px-4 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
                      >
                        {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                        {t.notifications.test}
                      </button>
                    )}
                  </div>
                )}

                {notice && (
                  <p className={cn("flex items-center gap-1.5 text-sm", notice.tone === "good" ? "text-success" : "text-danger")}>
                    {notice.tone === "good" ? <Check className="size-4" /> : <TriangleAlert className="size-4" />}
                    {notice.text}
                  </p>
                )}

                <p className="flex items-center gap-1.5 border-t border-border pt-3 text-xs text-subtle">
                  <Smartphone className="size-3.5" />
                  {t.notifications.devices.replace("{count}", String(state.devices))}
                </p>
              </section>

              <section className="space-y-1">
                <h2 className="px-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{t.notifications.whatTitle}</h2>
                <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
                  {categories.map((category) => (
                    <div key={category.key} className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{category.title}</p>
                        <p className="text-xs text-muted">{category.hint}</p>
                      </div>
                      <Switch checked={state.prefs[category.key]} label={category.title} onChange={() => setPref(category.key)} />
                    </div>
                  ))}
                </div>
                <p className="px-1 pt-1 text-xs text-subtle">{t.notifications.presenceHint}</p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
