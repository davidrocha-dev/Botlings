import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { getUsageReport, saveBudgets } from "@/server/usage/usage";

const limit = z.number().min(0).max(100_000).nullable();
const bodySchema = z.object({
  dailyUsd: limit,
  monthlyUsd: limit,
  agents: z.array(z.object({ agentId: z.uuid(), monthlyUsd: limit })).max(200).default([]),
});

/** Replaces spending limits; null removes a limit. */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  await saveBudgets(user.id, parsed.data);
  return Response.json(await getUsageReport(user.id));
}
