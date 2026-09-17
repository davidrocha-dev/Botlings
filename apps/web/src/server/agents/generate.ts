import { z } from "zod";
import { completeWithUtilityModel } from "@/server/utility-model";

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

function parseDraft(text: string): AgentDraft | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  try {
    const result = draftSchema.safeParse(json ? JSON.parse(json) : null);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Asks the utility model(s) for a draft agent (name, role, instructions). */
export async function generateAgentDraft(description: string): Promise<{ draft: AgentDraft } | { error: string }> {
  const result = await completeWithUtilityModel(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: description },
    ],
    { accept: (text) => parseDraft(text) !== null },
  );
  if ("error" in result) return result;
  return { draft: parseDraft(result.text)! };
}
