import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/server/auth/session";
import { db, schema } from "@/server/db";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  return <AuthForm mode={count === 0 ? "register" : "login"} />;
}
