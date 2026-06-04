# harness-manager

Local-first control plane for Harness Engineering across repos. The repo's `.harness/`
files are the single source of truth; SQLite is a rebuildable index.

## Packages
- `packages/core` — schemas, codecs, AGENTS.md generation, validators, store, DB indexer, HarnessService
- `packages/mcp` — stdio MCP server (embed in Cursor/Claude)
- `packages/api` — Fastify REST service for the dashboard
- `packages/web` — Next.js 16 read-only dashboard, styled in the Botanical / Organic Serif
  design system (Tailwind v4 tokens, Playfair Display + Source Sans 3, paper-grain texture)

## Setup
```bash
pnpm install
cp .env.example .env            # optionally fill in Langfuse keys
$env:HARNESS_DB_URL="file:./prisma/dev.db"; pnpm exec prisma db push
```

## Run
```bash
# API (port 4000)
pnpm exec tsx packages/api/src/index.ts
# Dashboard (port 3000) — Next.js 16 + Turbopack
pnpm --filter @harness/web dev
# MCP server (stdio) — point your agent client at:
pnpm exec tsx packages/mcp/src/index.ts
```

## Test
```bash
pnpm exec vitest run
```

## Langfuse
Set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST`. Missing keys =>
tracing is a silent no-op; everything else still works.
