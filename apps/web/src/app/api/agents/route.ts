import { getCurrentUser } from "@/server/auth/session";
import { createAgent, toAgentDto } from "@/server/data";
import { LicenseLimitError } from "@/server/license";
import { findModel } from "@/server/openrouter";
import { agentInputSchema } from "@/server/validation";
import type { BotlingAppearance } from "@/components/avatar/botling-options";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = agentInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const model = await findModel(parsed.data.model).catch(() => undefined);
  if (!model) return Response.json({ error: "unknown_model" }, { status: 400 });

  try {
    const { agent, conversation } = await createAgent(user.id, {
      ...parsed.data,
      appearance: parsed.data.appearance as BotlingAppearance,
      greeting: `Hi, I'm ${parsed.data.name}! 👋`,
    });
    return Response.json({ agent: toAgentDto(agent), conversationId: conversation.id }, { status: 201 });
  } catch (error) {
    if (error instanceof LicenseLimitError) return Response.json({ error: "license_limit" }, { status: 402 });
    throw error;
  }
}
