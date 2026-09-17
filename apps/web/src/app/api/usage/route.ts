import { getCurrentUser } from "@/server/auth/session";
import { getUsageReport } from "@/server/usage/usage";

/** Spend report: `?days=` 7–90 (default 30). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days")) || 30, 7), 90);
  return Response.json(await getUsageReport(user.id, days));
}
