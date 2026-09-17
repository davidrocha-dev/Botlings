import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

/**
 * Secrets are encrypted at rest with AES-256-GCM. The key comes from BOTLINGS_SECRET_KEY
 * (base64, 32 bytes) or is generated once into <repo>/data/secret.key. Losing the key makes
 * stored secrets unreadable (they can be re-entered).
 */

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Names agents must not override (they would change how commands run). */
const RESERVED = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "DISPLAY", "LANG", "TZ", "PWD", "BOTLINGS_RUNNER_TOKEN"]);

let cachedKey: Buffer | null = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  if (env.BOTLINGS_SECRET_KEY) {
    const key = Buffer.from(env.BOTLINGS_SECRET_KEY, "base64");
    if (key.length !== 32) throw new Error("BOTLINGS_SECRET_KEY must be 32 bytes, base64-encoded");
    return (cachedKey = key);
  }
  const file = path.resolve(process.cwd(), "../../data/secret.key");
  if (fs.existsSync(file)) {
    return (cachedKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64"));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  return (cachedKey = key);
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(payload: string) {
  const data = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export function validateSecretName(name: string) {
  if (!SECRET_NAME.test(name)) return "invalid_name" as const;
  if (RESERVED.has(name) || name.startsWith("BOTLINGS_")) return "reserved_name" as const;
  return null;
}

export type SecretSummary = {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
  updatedAt: number;
  lastUsedAt: number | null;
};

/** Secrets without their values. */
export async function listSecrets(ownerId: string): Promise<SecretSummary[]> {
  const rows = await db
    .select({
      id: schema.secrets.id,
      name: schema.secrets.name,
      description: schema.secrets.description,
      updatedAt: schema.secrets.updatedAt,
      lastUsedAt: schema.secrets.lastUsedAt,
    })
    .from(schema.secrets)
    .where(eq(schema.secrets.ownerId, ownerId))
    .orderBy(asc(schema.secrets.name));
  const access = rows.length
    ? await db
        .select()
        .from(schema.secretAccess)
        .where(inArray(schema.secretAccess.secretId, rows.map((r) => r.id)))
    : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    agentIds: access.filter((a) => a.secretId === r.id).map((a) => a.agentId),
    updatedAt: r.updatedAt.getTime(),
    lastUsedAt: r.lastUsedAt?.getTime() ?? null,
  }));
}

/** Names and descriptions of the secrets an agent may use (for its system prompt). */
export async function secretNamesForAgent(agentId: string) {
  return db
    .select({ name: schema.secrets.name, description: schema.secrets.description })
    .from(schema.secretAccess)
    .innerJoin(schema.secrets, eq(schema.secrets.id, schema.secretAccess.secretId))
    .where(eq(schema.secretAccess.agentId, agentId))
    .orderBy(asc(schema.secrets.name));
}

/** Decrypted values for an agent — server-side only, never sent to a model or the browser. */
export async function secretValuesForAgent(agentId: string) {
  const rows = await db
    .select({ id: schema.secrets.id, name: schema.secrets.name, ciphertext: schema.secrets.ciphertext })
    .from(schema.secretAccess)
    .innerJoin(schema.secrets, eq(schema.secrets.id, schema.secretAccess.secretId))
    .where(eq(schema.secretAccess.agentId, agentId));
  const values: { id: string; name: string; value: string }[] = [];
  for (const row of rows) {
    try {
      values.push({ id: row.id, name: row.name, value: decrypt(row.ciphertext) });
    } catch {
      console.error(`[secrets] could not decrypt ${row.name} (wrong key?)`);
    }
  }
  return values;
}

export async function markSecretsUsed(ids: string[]) {
  if (ids.length) await db.update(schema.secrets).set({ lastUsedAt: new Date() }).where(inArray(schema.secrets.id, ids));
}

/**
 * Replaces secret values (and common encodings of them) in text coming back from a computer, so
 * they don't end up in the model context or the chat history.
 */
export function redactSecrets(text: string, secrets: { name: string; value: string }[]) {
  let out = text;
  for (const { name, value } of secrets) {
    if (value.length < 4) continue;
    const variants = new Set([
      value,
      Buffer.from(value).toString("base64"),
      Buffer.from(value).toString("base64").replace(/=+$/, ""),
      Buffer.from(value).toString("hex"),
      encodeURIComponent(value),
    ]);
    for (const variant of variants) {
      if (variant.length >= 4) out = out.split(variant).join(`[secret:${name}]`);
    }
  }
  return out;
}

export async function setSecretAccess(ownerId: string, secretId: string, agentIds: string[]) {
  const owned = agentIds.length
    ? await db
        .select({ id: schema.agents.id })
        .from(schema.agents)
        .where(and(eq(schema.agents.ownerId, ownerId), inArray(schema.agents.id, agentIds)))
    : [];
  await db.delete(schema.secretAccess).where(eq(schema.secretAccess.secretId, secretId));
  if (owned.length) await db.insert(schema.secretAccess).values(owned.map((a) => ({ secretId, agentId: a.id })));
}
