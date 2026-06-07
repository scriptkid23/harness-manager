# Harness Manager — DB as Source of Truth

**Date:** 2026-06-07
**Status:** Approved (design), pending implementation plan

## 1. Summary

Invert the harness storage model. Today each managed repo holds a canonical
`.harness/` directory (config, features, agents, decisions, progress) plus a
generated `AGENTS.md`, and SQLite is a rebuildable cache ("on conflict, the file
wins"). This change makes the **central SQLite database the single source of
truth** and removes all harness files from managed repos.

Additionally, the per-repo **config** (`description`, `hardConstraints`) and the
**agents** a repo defines become first-class, fully displayed (read-only) on the
dashboard repo-detail page.

## 2. Motivation

- **Path / mount fragility:** writing files into a repo requires a writable path
  that the MCP process can reach. Under Docker this needs a `/projects` bind mount;
  a missing/misconfigured `HARNESS_PROJECTS_DIR` silently writes nowhere. Making
  `repoPath` a pure logical key removes this entire failure class.
- **Centralization:** one consistent store, no resync, no file/DB divergence, no
  `.harness/` clutter in managed repos, trivial cross-repo queries.

## 3. Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Where is the source of truth? | **Central SQLite DB** (canonical). No `.harness/` files in repos. |
| Editable from dashboard? | **No** — read-only. Agents write via MCP only. One-way flow preserved. |
| `AGENTS.md`? | **Not written** to repos at all. Agents get context 100% via MCP `harness_get_context`. |
| Config persistence | Add `description` + `hardConstraints` columns to `Repo` (Approach A). |
| Config display | Full: name, description, hardConstraints, langfuseProjectId, indexedAt. |
| Agents display | Full: id, role, model, tools (chips), full instructions. |
| Implementation approach | **Approach 1** — `HarnessStore` interface + `DbStore` (Prisma) replaces `RepoStore`. |
| Existing `.harness/` data | Assume none to migrate (fresh start). Optional one-time importer can be added later. |

## 4. Key insight

The SQLite schema is already a **complete mirror** of the `.harness/` snapshot
(tables for features, agents, decisions, progress, sessions). Promoting it to
canonical therefore needs **no new tables** — only two config columns on `Repo`.
The real work is the **store layer** (`DbStore`) and **removing file I/O**.

## 5. Architecture

### 5.1 Store layer (core)

New interface capturing the current `RepoStore` surface:

```ts
// core/src/store/harness-store.ts
export interface HarnessStore {
  init(config: Config): Promise<void>;
  read(): Promise<HarnessSnapshot>;
  writeConfig(config: Config): Promise<void>;
  writeFeatures(features: Feature[]): Promise<void>;
  writeProgress(progress: Progress): Promise<void>;
  writeDecisions(decisions: Decision[]): Promise<void>;
  writeAgent(agent: Agent): Promise<void>;
}
```

`DbStore` (`core/src/store/db-store.ts`), backed by Prisma, keyed by `repoPath`:

- `resolveRepoId(repoPath, name?)` — find-or-create the `Repo` row (moved from service).
- `init(config)` — create/seed the `Repo` row + empty `Progress`.
- `read()` — query all tables for `repoId`, build a `HarnessSnapshot`, parsing
  JSON-encoded columns (`hardConstraints`, agent `tools`, progress arrays). This is
  the inverse of today's `indexer.ts`.
- `writeFeatures` / `writeDecisions` / `writeAgent` / `writeProgress` / `writeConfig`
  — transactional upserts into the corresponding tables (logic lifted from
  `indexSnapshot`, split per entity).

`RepoStore` (file-based) is **removed** from the main flow. Given no existing data,
it is deleted; an importer can be reintroduced later if needed.

### 5.2 HarnessService (core)

- `store(repoPath)` returns a `DbStore`.
- Remove `reindex()` and `indexSnapshot()`: the DB *is* the store. After each write,
  return `store.read()` for the resulting snapshot.
- Business rules unchanged: WIP=1 (`checkWipLimit`), pass-state gating
  (`assertPassEvidence`), session start/end.
- `HarnessError` `path` fields become store-neutral (e.g. `"features"` instead of
  `".harness/features.json"`).

### 5.3 Schema (prisma/schema.prisma)

```prisma
model Repo {
  // ...existing fields...
  description     String?
  hardConstraints String  @default("[]") // JSON-encoded string[]
}
```

All other models unchanged. Migration via `pnpm exec prisma db push` (the project's
existing migration mechanism — see `harness-migrate` in docker-compose).

### 5.4 Removal / cleanup

- Stop generating `AGENTS.md`; delete `generateAgentsMd` file-writing. Move the
  `HarnessSnapshot` type out of `agents-md.ts` into `core/src/store/types.ts` (or
  `schemas/`).
- Delete `core/src/db/indexer.ts` (logic absorbed into `DbStore`).
- `core/src/index.ts`: drop `repo-store` / `indexer` exports; add `harness-store` /
  `db-store`.

### 5.5 MCP & API

- **MCP:** `repoPath` is purely a logical key; no file reads/writes. The Docker
  `/projects` bind mount in `docker-compose.yml` is no longer required and is removed.
- **API:**
  - `POST /repos` — drop the `access(path)` filesystem existence check.
  - `GET /repos/:id` — new; returns the repo row (now including config fields).
  - `GET /repos/:id/agents` — already exists; reused.
  - `/repos/:id/resync` — becomes a no-op or is removed (nothing to re-read).

### 5.6 Frontend (web)

- `lib/api.ts`: extend `Repo` (`description`, `hardConstraints`); add `AgentRow`,
  `repoAgents(id)`, `repo(id)`. Parse `hardConstraints` / `tools` JSON → arrays.
- `app/repos/[id]/page.tsx`: fetch repo + agents; add two read-only sections:
  - **Config** (top, before the feature board): name, description, hardConstraints
    (prominent list), langfuseProjectId, indexedAt.
  - **Agents**: one card per agent — id, role, model, tools (chips), full instructions.
- New components `RepoConfig.tsx` + `AgentList.tsx`, following the existing `Card`
  pattern.

## 6. Data flow (after change)

```
agent → MCP tool (repoPath = key) → HarnessService → DbStore → SQLite (canonical)
dashboard → API → SQLite → render (read-only)
```

## 7. Testing

- **core:** `db-store.spec.ts` (init/read/write round-trip on a temp SQLite DB);
  update `harness-service.spec.ts` to use `DbStore`; delete `repo-store.spec.ts` and
  `indexer.spec.ts`.
- **mcp:** update `e2e.spec.ts` / `server.spec.ts` to assert via DB rather than
  reading `.harness/` files.
- **api:** `GET /repos/:id` returns config fields; `POST /repos` succeeds without the
  path existing on disk.
- **web:** render specs for `RepoConfig` + `AgentList` (mock data, like
  `FeatureBoard.spec.tsx`).
- **Overall verification:** `pnpm test && pnpm build`.

## 8. Out of scope (YAGNI)

- No editing of config/agents from the dashboard.
- No files of any kind written into managed repos.
- No data importer in this iteration (add later if a file-based repo appears).
- No changes to Langfuse tracing.

## 9. Risks

- Harness state no longer travels with git/clone — it lives only in the central DB.
  The `harness_db` volume must be backed up; losing it loses all context (previously
  the in-repo files were a fallback).
- One-way migration: once files are removed and code no longer reads them, reverting
  to file-canonical would require restoring `RepoStore` and a DB→file export.
