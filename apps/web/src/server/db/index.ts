import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Postgres when DATABASE_URL is set (docker-compose / server installs);
 * otherwise an embedded PGlite database stored in <repo>/data/pglite — zero setup.
 */
function createDatabase(): { db: Database; driver: "postgres" | "pglite" } {
  if (env.DATABASE_URL) {
    const client = postgres(env.DATABASE_URL, { max: 10 });
    return { db: drizzlePostgres(client, { schema }), driver: "postgres" };
  }
  const dataDir = env.BOTLINGS_DATA_DIR ?? path.resolve(process.cwd(), "../../data/pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  // Both drivers expose the same Postgres query builder at runtime.
  return { db: drizzlePglite(client, { schema }) as unknown as Database, driver: "pglite" };
}

// Reuse a single instance across dev hot reloads (PGlite allows one owner per data dir).
const globalForDb = globalThis as unknown as { botlingsDb?: ReturnType<typeof createDatabase> };
const instance = globalForDb.botlingsDb ?? createDatabase();
globalForDb.botlingsDb = instance;

export const db = instance.db;
export const dbDriver = instance.driver;
export { schema };
