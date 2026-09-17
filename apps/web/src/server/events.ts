import type { ChatStreamEvent } from "@/lib/types";

/**
 * In-process pub/sub for work that happens outside a user's request (delegated tasks, the
 * orchestrator's follow-up summary). Delivered to the browser through GET /api/events.
 * Single-process by design (self-hosted); swap for Redis pub/sub if the app is ever scaled out.
 */
export type ServerEvent = { conversationId: string; event: ChatStreamEvent };
type Listener = (event: ServerEvent) => void;

const globalBus = globalThis as unknown as { botlingsBus?: Map<string, Set<Listener>> };
const listeners = (globalBus.botlingsBus ??= new Map());

export function subscribe(userId: string, listener: Listener) {
  let set = listeners.get(userId);
  if (!set) {
    set = new Set();
    listeners.set(userId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(userId);
  };
}

export function publish(userId: string, conversationId: string, event: ChatStreamEvent) {
  for (const listener of listeners.get(userId) ?? []) {
    try {
      listener({ conversationId, event });
    } catch {}
  }
}
