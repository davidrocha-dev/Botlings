import path from "node:path";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { db, dbDriver } from "./index";

/** Applies pending SQL migrations from apps/web/drizzle. Runs once at server start. */
export async function runMigrations() {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  if (dbDriver === "pglite") {
    await migratePglite(db as unknown as PgliteDatabase, { migrationsFolder });
  } else {
    await migratePostgres(db, { migrationsFolder });
  }
}
