import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { encrypt, listSecrets, setSecretAccess, validateSecretName } from "@/server/secrets/secrets";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ secrets: await listSecrets(user.id) });
}

const createSchema = z.object({
  name: z.string().trim().toUpperCase(),
  value: z.string().min(1).max(10_000),
  description: z.string().trim().max(300).default(""),
  agentIds: z.array(z.uuid()).max(200).default([]),
});

/** Stores a new secret. The value is encrypted and never returned by any API. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

  const nameError = validateSecretName(parsed.data.name);
  if (nameError) return Response.json({ error: nameError }, { status: 400 });

  const [secret] = await db
    .insert(schema.secrets)
    .values({
      ownerId: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      ciphertext: encrypt(parsed.data.value),
    })
    .onConflictDoNothing()
    .returning({ id: schema.secrets.id });
  if (!secret) return Response.json({ error: "name_taken" }, { status: 409 });

  await setSecretAccess(user.id, secret.id, parsed.data.agentIds);
  return Response.json({ secrets: await listSecrets(user.id) }, { status: 201 });
}
