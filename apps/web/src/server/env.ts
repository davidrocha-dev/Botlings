import { z } from "zod";

const schema = z.object({
  /** Optional — without it Botlings uses an embedded PGlite database. */
  DATABASE_URL: z.string().optional(),
  BOTLINGS_DATA_DIR: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  BOTLINGS_MODE: z.enum(["personal", "commercial"]).default("personal"),
  BOTLINGS_DEFAULT_MODEL: z.string().default("google/gemma-4-31b-it:free"),
  BOTLINGS_LICENSE_PUBLIC_KEY: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

export const env = schema.parse(process.env);
