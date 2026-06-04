# Harness Manager — Implementation Plans (Index)

Source spec: [2026-06-04-harness-manager-design.md](../specs/2026-06-04-harness-manager-design.md)

The work is split into 4 sequential plans. The packages form a dependency chain
(`core` ← `mcp`/`api` ← `web`), so build in order. Each plan ends at a working,
fully-tested checkpoint and can be executed (or reviewed) on its own.

| # | Plan | Builds | Prerequisite |
|---|------|--------|--------------|
| 01 | [Foundation + core](2026-06-04-harness-manager-01-foundation-core.md) | Nx monorepo, `@harness/core` (schemas, codecs, AGENTS.md gen, validators, RepoStore, Prisma indexer, HarnessService) | none |
| 02 | [MCP server](2026-06-04-harness-manager-02-mcp.md) | `@harness/mcp` stdio server, 11 tools, Langfuse tracing, sessions, E2E | Plan 01 |
| 03 | [API service](2026-06-04-harness-manager-03-api.md) | `@harness/api` Fastify REST over HarnessService | Plan 01 |
| 04 | [Web dashboard](2026-06-04-harness-manager-04-web.md) | `@harness/web` Next.js read-only dashboard + README | Plans 01, 03 |

Plans 02 and 03 are independent of each other (both depend only on 01) and could be
done in either order or in parallel.

## Cross-plan contract

Plans 02–04 consume `@harness/core`'s public surface from Plan 01. Do not rename these
without updating the dependent plans:

- Exports: `getPrisma`, `HarnessService`, `HarnessError`, `HarnessSnapshot`, and the
  Zod schemas/types (`Feature`, `Agent`, `Progress`, `Decision`, `Config`).
- `HarnessService` methods: `init`, `getContext`, `upsertFeature`, `setFeaturePassing`,
  `updateProgress`, `addDecision`, `upsertAgent`, `startSession`, `endSession`.
- Prisma column names (consumed by API/web JSON): `featureId`, `decisionId`, `langfuseTraceId`.

## Architectural reconciliation (applies to all plans)

The spec calls `core` "pure, no I/O" yet also "the shared layer so MCP and API never
diverge." Those conflict — the divergence risk lives in the read→parse→index→write→regen
orchestration, not the pure codecs. Resolution: `core`'s codec/schema/AGENTS.md/validator
layer stays pure; a shared `store`/`db`/`service` layer also lives in `core` and is what
both transports call. Full rationale at the top of Plan 01.
