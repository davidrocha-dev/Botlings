# Botlings

Your crew of AI agents, each with its own computer. Self-hosted, low cost, powered by OpenRouter.

> **Status: work in progress.** Personal project, not production-ready.

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

Agent computers (Docker Desktop must be running):

```bash
pnpm computers:build
```

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
| `pnpm computers:build` | Build the agent computer image |

## Structure

```
apps/web          Next.js PWA (UI, API routes)
infra/agent-image Docker image for each agent's computer
packages/       Shared packages (coming: db, agent-runner, orchestrator)
docs/PROJETO.md Full product spec and roadmap
```

## Features

- **Agent computers**: each agent runs in its own Docker container with a live screen, files and terminal, behind a LAN firewall.
- **Streaming chat** with any OpenRouter model, cost tracking, usage dashboard and per-agent budgets.
- **Orchestrator** that delegates tasks to the rest of the crew, with live task cards and summaries.
- **Group discussions** with a moderator, short panels per round and votes.
- **Approvals**: a server-enforced gate before risky agent actions.
- **Secrets** stored per agent, with the runner API locked against in-container callers.
- **Memory** and conversation summaries per agent.
- **Scheduled routines**, Web Push notifications and a Telegram bot (chat, approvals, slash commands).
- **Per-agent web research** so agents look facts up instead of guessing.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Drizzle ORM · PostgreSQL / PGlite · Redis · Docker · OpenRouter · pnpm monorepo

## Roadmap

See [docs/PROJETO.md](docs/PROJETO.md) (in Portuguese) for the full spec and roadmap.
