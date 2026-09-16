import { createPublicKey, verify } from "node:crypto";
import { desc } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";

export type PlanLimits = {
  agents: number;
  groups: number;
  concurrentAgents: number;
  integrations: boolean;
};

export type LicenseState = {
  mode: "personal" | "commercial";
  plan: string;
  valid: boolean;
  expiresAt: Date | null;
  limits: PlanLimits;
};

const UNLIMITED: PlanLimits = { agents: Infinity, groups: Infinity, concurrentAgents: 4, integrations: true };

/** Plans for the future subscription offer. Values are placeholders until pricing is defined. */
export const PLANS: Record<string, PlanLimits> = {
  starter: { agents: 3, groups: 1, concurrentAgents: 1, integrations: false },
  pro: { agents: 10, groups: 5, concurrentAgents: 4, integrations: true },
  team: { agents: 50, groups: 25, concurrentAgents: 8, integrations: true },
};

/**
 * License key format: base64url(JSON payload) + "." + base64url(Ed25519 signature).
 * Payload: { plan, email, exp (unix seconds) }. Keys are short-lived and renewed by the
 * license server while the subscription is active.
 */
export function verifyLicenseKey(key: string, publicKeyPem: string) {
  const [payloadPart, signaturePart] = key.split(".");
  if (!payloadPart || !signaturePart) return null;
  const payload = Buffer.from(payloadPart, "base64url");
  const signature = Buffer.from(signaturePart, "base64url");
  const ok = verify(null, payload, createPublicKey(publicKeyPem), signature);
  if (!ok) return null;
  try {
    const data = JSON.parse(payload.toString("utf8")) as { plan: string; email: string; exp: number };
    return { plan: data.plan, email: data.email, expiresAt: new Date(data.exp * 1000) };
  } catch {
    return null;
  }
}

export async function getLicense(): Promise<LicenseState> {
  if (env.BOTLINGS_MODE === "personal") {
    return { mode: "personal", plan: "personal", valid: true, expiresAt: null, limits: UNLIMITED };
  }

  const [row] = await db.select().from(schema.licenses).orderBy(desc(schema.licenses.createdAt)).limit(1);
  const parsed = row && env.BOTLINGS_LICENSE_PUBLIC_KEY ? verifyLicenseKey(row.key, env.BOTLINGS_LICENSE_PUBLIC_KEY) : null;
  const valid = !!parsed && parsed.expiresAt.getTime() > Date.now() && parsed.plan in PLANS;

  return {
    mode: "commercial",
    plan: parsed?.plan ?? "none",
    valid,
    expiresAt: parsed?.expiresAt ?? null,
    limits: valid ? PLANS[parsed!.plan] : { agents: 0, groups: 0, concurrentAgents: 0, integrations: false },
  };
}

export class LicenseLimitError extends Error {
  constructor(public limit: keyof PlanLimits) {
    super(`License limit reached: ${limit}`);
  }
}

export async function assertWithinLimit(limit: "agents" | "groups", current: number) {
  const license = await getLicense();
  if (!license.valid || current >= license.limits[limit]) throw new LicenseLimitError(limit);
}
