import { env } from "@/server/env";
import { OpenRouterError, streamChat, type ChatMessage } from "@/server/openrouter";

/**
 * Small helper jobs (agent drafts, conversation summaries) run on BOTLINGS_UTILITY_MODEL: a
 * comma-separated list of (usually free) models tried in order, since free models are often
 * rate-limited. Their cost is not charged to any agent.
 */

/** Routers can pick a content-moderation model, which answers with a verdict instead of text. */
function looksLikeModeration(text: string) {
  return /^\s*(user|agent|response|prompt)?\s*safety\s*:/i.test(text) || /^\s*(safe|unsafe)\s*$/i.test(text);
}

export async function completeWithUtilityModel(
  messages: ChatMessage[],
  opts: { timeoutMs?: number; accept?: (text: string) => boolean } = {},
): Promise<{ text: string; model: string } | { error: string }> {
  const models = env.BOTLINGS_UTILITY_MODEL.split(",").map((m) => m.trim()).filter(Boolean);
  let lastError = "generation_failed";
  for (const model of models) {
    let text = "";
    try {
      for await (const event of streamChat({ model, messages, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) })) {
        if (event.type === "delta") text += event.text;
      }
    } catch (error) {
      lastError = error instanceof OpenRouterError ? error.message : "generation_failed";
      continue;
    }
    if (text.trim() && !looksLikeModeration(text) && (!opts.accept || opts.accept(text))) return { text: text.trim(), model };
    lastError = "unusable_output";
  }
  return { error: lastError };
}
