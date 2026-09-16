"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { rateLimit } from "@/server/auth/rate-limit";
import { createSession, destroySession } from "@/server/auth/session";
import { seedWorkspace } from "@/server/data";
import { db, schema } from "@/server/db";

export type AuthState = { error?: "invalid" | "rate_limited" | "exists" | "weak_password" | "closed" } | undefined;

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashPassword("botlings-timing-equalizer");
  return dummyHash;
}

const credentials = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(1).max(256),
});

export async function login(_state: AuthState, formData: FormData): Promise<AuthState> {
  if (!rateLimit(`login:${await clientKey()}`, 10, 15 * 60_000).ok) return { error: "rate_limited" };

  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "invalid" };

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email)).limit(1);
  // Always run a real verification so unknown emails take as long as wrong passwords.
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), parsed.data.password);
  if (!user || !ok) return { error: "invalid" };

  await createSession(user.id);
  redirect("/");
}

const registration = credentials.extend({
  name: z.string().trim().min(1).max(64),
  password: z.string().min(10).max(256),
});

/** Creates the owner account. Only allowed while no user exists (first run). */
export async function register(_state: AuthState, formData: FormData): Promise<AuthState> {
  if (!rateLimit(`register:${await clientKey()}`, 5, 15 * 60_000).ok) return { error: "rate_limited" };

  const parsed = registration.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const weak = parsed.error.issues.some((issue) => issue.path[0] === "password");
    return { error: weak ? "weak_password" : "invalid" };
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  if (count > 0) return { error: "closed" };

  const [user] = await db
    .insert(schema.users)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "owner",
    })
    .onConflictDoNothing()
    .returning();
  if (!user) return { error: "exists" };

  await seedWorkspace(user.id);
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
