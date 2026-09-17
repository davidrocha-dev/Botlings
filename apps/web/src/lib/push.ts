"use client";

/** In development the worker only handles push (no caching, so hot reload keeps working). */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  const url = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1";
  return navigator.serviceWorker.register(url, { scope: "/", updateViaCache: "none" });
}

export type PushSupport = "supported" | "unsupported" | "needs-install";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // iOS only offers Web Push to apps added to the Home Screen.
  if (ios && !standalone) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "supported";
}

function base64UrlToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function readyRegistration() {
  await registerServiceWorker();
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (pushSupport() !== "supported") return null;
  return (await readyRegistration()).pushManager.getSubscription();
}

/** Asks permission (must run from a click) and saves the subscription on the server. */
export async function enablePush(publicKey: string, locale: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const registration = await readyRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    // Keys changed on the server (e.g. data/vapid.json was reset): subscribe again.
    const key = subscription.options.applicationServerKey;
    const current = key ? btoa(String.fromCharCode(...new Uint8Array(key))) : "";
    const expected = btoa(String.fromCharCode(...base64UrlToBytes(publicKey)));
    if (current !== expected) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
  const res = await fetch("/api/notifications/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...subscription.toJSON(), locale }),
  });
  if (!res.ok) throw new Error("subscribe_failed");
  return "granted" as const;
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await fetch("/api/notifications/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}
