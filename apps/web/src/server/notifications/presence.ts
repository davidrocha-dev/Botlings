/**
 * Which users are looking at the app right now. Each open tab reports its visibility; a visible
 * report counts for PRESENCE_TTL_MS. Present users get no push/Telegram for things they can see.
 */
const PRESENCE_TTL_MS = 75_000;

const globalPresence = globalThis as unknown as { botlingsPresence?: Map<string, Map<string, number>> };
const presence = (globalPresence.botlingsPresence ??= new Map());

export function reportPresence(userId: string, clientId: string, visible: boolean) {
  let clients = presence.get(userId);
  if (!clients) {
    clients = new Map();
    presence.set(userId, clients);
  }
  if (visible) clients.set(clientId, Date.now());
  else clients.delete(clientId);
  if (!clients.size) presence.delete(userId);
}

export function isUserPresent(userId: string) {
  const clients = presence.get(userId);
  if (!clients) return false;
  const now = Date.now();
  for (const [clientId, seenAt] of clients) {
    if (now - seenAt < PRESENCE_TTL_MS) return true;
    clients.delete(clientId);
  }
  return false;
}
