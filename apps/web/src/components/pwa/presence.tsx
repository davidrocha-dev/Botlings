"use client";

import { useEffect } from "react";

const HEARTBEAT_MS = 30_000;

/** Tells the server while this tab is visible, so it doesn't push notifications for what you're watching. */
export function PresenceReporter() {
  useEffect(() => {
    const clientId = crypto.randomUUID();
    const report = (visible: boolean) => {
      const body = JSON.stringify({ clientId, visible });
      if (!visible && navigator.sendBeacon) {
        navigator.sendBeacon("/api/presence", new Blob([body], { type: "application/json" }));
        return;
      }
      fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    const onChange = () => report(document.visibilityState === "visible");
    onChange();
    const timer = setInterval(() => document.visibilityState === "visible" && report(true), HEARTBEAT_MS);
    const onHide = () => report(false);
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("pagehide", onHide);
      report(false);
    };
  }, []);
  return null;
}
