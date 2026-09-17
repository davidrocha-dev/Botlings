"use client";

import { usePathname } from "next/navigation";
import { PresenceReporter } from "@/components/pwa/presence";
import { Sidebar } from "./sidebar";
import { cn } from "@/lib/cn";

/**
 * Desktop: sidebar | content (content may render its own right-hand info panel).
 * Mobile: one screen at a time — the chat list on "/", everything else full-screen.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const atRoot = pathname === "/";

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <PresenceReporter />
      <aside
        className={cn(
          "h-full w-full shrink-0 border-border bg-bg md:w-[320px] md:border-r lg:w-[360px]",
          atRoot ? "block" : "hidden md:block",
        )}
      >
        <Sidebar />
      </aside>
      <main className={cn("h-full min-w-0 flex-1", atRoot ? "hidden md:flex" : "flex")}>{children}</main>
    </div>
  );
}
