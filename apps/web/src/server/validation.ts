import { z } from "zod";
import { BOTLING_COLOR_KEYS, BOTLING_MOODS, BOTLING_SHAPES } from "@/components/avatar/botling-options";

export const appearanceSchema = z.object({
  shape: z.enum(BOTLING_SHAPES),
  color: z.enum(BOTLING_COLOR_KEYS as [string, ...string[]]),
  mood: z.enum(BOTLING_MOODS),
});

export const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(32),
  role: z.string().trim().max(500).default(""),
  prompt: z.string().trim().max(8_000).default(""),
  model: z.string().trim().min(3).max(200),
  appearance: appearanceSchema,
});
