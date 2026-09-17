import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { callRunner, ensureRunning, getComputer, stopComputer, touchComputer } from "@/server/computers/manager";
import { db, schema } from "@/server/db";

async function ownedAgent(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [agent] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.ownerId, userId)));
  return agent ?? null;
}

/** Computer state. `?watch=1` keeps the computer awake while the user is watching it fullscreen. */
export async function GET(request: Request, ctx: RouteContext<"/api/agents/[id]/computer">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const agent = await ownedAgent(user.id, (await ctx.params).id);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });

  const state = await getComputer(agent.id);
  if (state.status === "running" && new URL(request.url).searchParams.has("watch")) touchComputer(agent.id);
  return Response.json(state);
}

const bodySchema = z.object({ action: z.enum(["start", "stop", "browser"]) });

export async function POST(request: Request, ctx: RouteContext<"/api/agents/[id]/computer">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const agent = await ownedAgent(user.id, (await ctx.params).id);
  if (!agent) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  try {
    if (parsed.data.action === "start") await ensureRunning(agent.id);
    else if (parsed.data.action === "browser") await callRunner(agent.id, "/browser/show", {}, 60_000);
    else await stopComputer(agent.id);
    return Response.json(await getComputer(agent.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "failed" }, { status: 500 });
  }
}
