import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { callRunner, getComputer } from "@/server/computers/manager";
import { db, schema } from "@/server/db";

/**
 * The user's own access to an agent's computer: browse/read files and run terminal commands.
 * Only works while the computer is running, so opening the panel never boots a computer.
 */
async function authorise(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!z.uuid().safeParse(id).success) return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  const [agent] = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, id), eq(schema.agents.ownerId, user.id)));
  if (!agent) return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  if ((await getComputer(agent.id)).status !== "running") {
    return { error: Response.json({ error: "not_running" }, { status: 409 }) };
  }
  return { agentId: agent.id };
}

const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "failed" }, { status: 400 });

/** `?path=` lists a folder; `?file=` reads a text file. */
export async function GET(request: Request, ctx: RouteContext<"/api/agents/[id]/workspace">) {
  const auth = await authorise((await ctx.params).id);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const file = url.searchParams.get("file");
  try {
    if (file) return Response.json(await callRunner(auth.agentId, "/files/read", { path: file }, 30_000));
    return Response.json(
      await callRunner(auth.agentId, "/files/list", { path: url.searchParams.get("path") || "~/workspace" }, 30_000),
    );
  } catch (error) {
    return fail(error);
  }
}

const commandSchema = z.object({ command: z.string().trim().min(1).max(4_000) });

/** Runs a terminal command typed by the user. */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/[id]/workspace">) {
  const auth = await authorise((await ctx.params).id);
  if (auth.error) return auth.error;
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  try {
    return Response.json(
      await callRunner(auth.agentId, "/exec", { command: parsed.data.command, timeoutMs: 120_000 }, 140_000),
    );
  } catch (error) {
    return fail(error);
  }
}
