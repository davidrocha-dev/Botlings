# Botlings

Your crew of AI agents, each with its own computer. Self-hosted, low cost, powered by OpenRouter.

> Private project — all rights reserved.

## Requirements

- Node.js 22+
- pnpm 10+
- Docker Desktop (WSL2) — for Postgres/Redis now, and agent containers later

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 — the first visit creates the owner account.

Put `OPENROUTER_API_KEY` in `.env.local` at the repo root (see `.env.example`). The database is an embedded PGlite in `data/` by default.

Optional Postgres (set `DATABASE_URL`):

```bash
pnpm infra:up
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Web app in development mode |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript checks |
| `pnpm infra:up` / `infra:down` | Start/stop Postgres + Redis |

## Structure

```
apps/web        Next.js PWA (UI, API routes)
packages/       Shared packages (coming: db, agent-runner, orchestrator)
docs/PROJETO.md Full product spec and roadmap
```

## Status

Phase 1 — owner auth, license scaffolding, database, real streaming chat via OpenRouter with cost tracking and explicit model switching (`/model <id>` or asking the agent).
See [docs/PROJETO.md](docs/PROJETO.md) for the roadmap.
