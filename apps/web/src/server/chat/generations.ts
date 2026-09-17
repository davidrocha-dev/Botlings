/**
 * Work in progress per conversation (chat replies, delegated tasks, routine runs), so /stop can
 * abort all of it. Aborting with STOPPED_REASON ends the turn quietly (no error card).
 */
export const STOPPED_REASON = "Stopped by user";

const globalGenerations = globalThis as unknown as { botlingsGenerations?: Map<string, Set<AbortController>> };
const generations = (globalGenerations.botlingsGenerations ??= new Map());

/** Registers a controller for a conversation; call the returned function when the work ends. */
export function trackGeneration(conversationId: string, controller: AbortController) {
  let set = generations.get(conversationId);
  if (!set) {
    set = new Set();
    generations.set(conversationId, set);
  }
  set.add(controller);
  return () => {
    set.delete(controller);
    if (!set.size) generations.delete(conversationId);
  };
}

/** Aborts everything running in the conversation; returns how many were stopped. */
export function stopGenerations(conversationId: string) {
  const set = generations.get(conversationId);
  if (!set) return 0;
  let stopped = 0;
  for (const controller of set) {
    if (controller.signal.aborted) continue;
    controller.abort(new Error(STOPPED_REASON));
    stopped += 1;
  }
  return stopped;
}

export function isStopped(signal: AbortSignal) {
  return signal.aborted && signal.reason instanceof Error && signal.reason.message === STOPPED_REASON;
}
