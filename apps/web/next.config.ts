import type { NextConfig } from "next";

// Env vars are read from the repo-root .env.local by src/server/env.ts.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2", "@electric-sql/pglite", "dockerode"],
};

export default nextConfig;
