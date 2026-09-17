import { z } from "zod";
import { generateAgentDraft } from "@/server/agents/generate";
import { getCurrentUser } from "@/server/auth/session";
import { rateLimit } from "@/server/auth/rate-limit";

const bodySchema = z.object({ description: z.string().trim().min(3).max(500) });

/** Suggests name, role and instructions for a new agent. The user reviews them before creating. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit(`generate-agent:${user.id}`, 10, 60_000).ok) return Response.json({ error: "rate_limited" }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const result = await generateAgentDraft(parsed.data.description);
  if ("error" in result) return Response.json({ error: "generation_failed", detail: result.error }, { status: 502 });
  return Response.json({ draft: result.draft });
}
