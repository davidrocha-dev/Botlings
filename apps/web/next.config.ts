import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Env files live at the monorepo root (.env.local), shared by all apps.
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "@electric-sql/pglite"],
};

export default nextConfig;
