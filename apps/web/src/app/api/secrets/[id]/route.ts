import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { encrypt, listSecrets, setSecretAccess } from "@/server/secrets/secrets";

const patchSchema = z.object({
  value: z.string().min(1).max(10_000).optional(),
  description: z.string().trim().max(300).optional(),
  agentIds: z.array(z.uuid()).max(200).optional(),
});

async function ownedSecretId(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({ id: schema.secrets.id })
    .from(schema.secrets)
    .where(and(eq(schema.secrets.id, id), eq(schema.secrets.ownerId, userId)));
  return row?.id ?? null;
}

/** Replaces the value, description or which agents may use the secret. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/secrets/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = await ownedSecretId(user.id, (await ctx.params).id);
  if (!id) return Response.json({ error: "not_found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const set: Partial<typeof schema.secrets.$inferInsert> = {};
  if (parsed.data.value !== undefined) set.ciphertext = encrypt(parsed.data.value);
  if (parsed.data.description !== undefined) set.description = parsed.data.description;
  if (Object.keys(set).length) await db.update(schema.secrets).set(set).where(eq(schema.secrets.id, id));
  if (parsed.data.agentIds) await setSecretAccess(user.id, id, parsed.data.agentIds);

  return Response.json({ secrets: await listSecrets(user.id) });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/secrets/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = await ownedSecretId(user.id, (await ctx.params).id);
  if (!id) return Response.json({ error: "not_found" }, { status: 404 });
  await db.delete(schema.secrets).where(eq(schema.secrets.id, id));
  return Response.json({ secrets: await listSecrets(user.id) });
}
