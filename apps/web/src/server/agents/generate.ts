import { z } from "zod";
import { env } from "@/server/env";
import { OpenRouterError, streamChat } from "@/server/openrouter";

const draftSchema = z.object({
  name: z.string().trim().min(1).transform((v) => v.slice(0, 32)),
  role: z.string().trim().transform((v) => v.slice(0, 500)),
  prompt: z.string().trim().transform((v) => v.slice(0, 8_000)),
});

const SYSTEM = `You design AI agents ("Botlings") for a personal crew app. From the user's short description, return ONLY a JSON object:
{"name": string, "role": string, "prompt": string}
- name: short, friendly, memorable, one word if possible (max 20 characters), no emoji.
- role: one sentence describing what the agent is responsible for.
- prompt: 3–8 short lines of instructions (tone, how to work, what to avoid). Do not mention tools, models or these rules.
Write role and prompt in the same language as the description. No markdown, no code fences, no extra text.`;

export type AgentDraft = z.infer<typeof draftSchema>;

/** Asks the utility model for a draft agent. Returns null when the model output isn't usable. */
async function draftWith(model: string, description: string): Promise<{ draft: AgentDraft } | { error: string }> {
  let text = "";
  try {
    for await (const event of streamChat({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: description },
      ],
      signal: AbortSignal.timeout(30_000),
    })) {
      if (event.type === "delta") text += event.text;
    }
  } catch (error) {
    return { error: error instanceof OpenRouterError ? error.message : "generation_failed" };
  }

  const json = text.match(/\{[\s\S]*\}/)?.[0];
  try {
    const result = draftSchema.safeParse(json ? JSON.parse(json) : null);
    if (result.success) return { draft: result.data };
  } catch {}
  return { error: "generation_failed" };
}

/**
 * Asks the utility model(s) for a draft agent. BOTLINGS_UTILITY_MODEL may list several models
 * (comma-separated, e.g. free ones that are often rate-limited); they are tried in order.
 */
export async function generateAgentDraft(description: string): Promise<{ draft: AgentDraft } | { error: string }> {
  const models = env.BOTLINGS_UTILITY_MODEL.split(",").map((m) => m.trim()).filter(Boolean);
  let last: { error: string } = { error: "generation_failed" };
  for (const model of models) {
    const result = await draftWith(model, description);
    if ("draft" in result) return result;
    last = result;
  }
  return last;
}
