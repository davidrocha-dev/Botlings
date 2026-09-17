import { z } from "zod";
import { BOTLING_COLOR_KEYS, BOTLING_MOODS, BOTLING_SHAPES } from "@/components/avatar/botling-options";

export const appearanceSchema = z.object({
  shape: z.enum(BOTLING_SHAPES),
  color: z.enum(BOTLING_COLOR_KEYS as [string, ...string[]]),
  mood: z.enum(BOTLING_MOODS),
});

const fields = {
  name: z.string().trim().min(1).max(32),
  role: z.string().trim().max(500),
  prompt: z.string().trim().max(8_000),
  model: z.string().trim().min(3).max(200),
  appearance: appearanceSchema,
};

export const agentInputSchema = z.object({
  ...fields,
  role: fields.role.default(""),
  prompt: fields.prompt.default(""),
});

/**
 * Partial update. Deliberately built without defaults: zod's `.partial()` still applies
 * `.default()`, which would wipe fields the client didn't send.
 */
export const agentPatchSchema = z
  .object(fields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
