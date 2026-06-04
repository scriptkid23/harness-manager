# Harness Manager — Plan 03: API Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 3 of 4.** Prerequisite: **Plan 01 (Foundation + `core`) must be complete** — this plan imports `getPrisma`, `HarnessService`, and `HarnessError` from `@harness/core`. Independent of Plan 02 (MCP). Plan 04 (web) depends on this.

**Goal:** Build `packages/api` — a thin localhost Fastify REST service over `core`'s `HarnessService` for the dashboard: register repos, on-demand re-index ("resync"), and read indexed harness state cross-repo. No auth.

**Architecture:** `buildApp(service, prisma)` returns a configured `FastifyInstance` (testable via `app.inject`). Routes read the SQLite cache for list endpoints and call `HarnessService.getContext` for resync/context (which re-reads files → re-indexes, keeping the repo canonical). `index.ts` is a thin bootstrap.

**Tech Stack:** Fastify 5, @fastify/cors 10, Vitest 2, `@harness/core`.

**Checkpoint when done:** `npx vitest run packages/api` green; `npx tsx packages/api/src/index.ts` serves on `http://127.0.0.1:4000`.

## File Structure (this plan)

```
packages/api/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts            # bootstrap
    ├── app.ts              # buildApp(service, prisma) -> FastifyInstance
    ├── app.spec.ts
    └── routes/repos.ts     # all /repos endpoints
```

---

## Task 1: `api` package skeleton + buildApp with /repos routes

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/vitest.config.ts`
- Create: `packages/api/src/app.ts`
- Create: `packages/api/src/routes/repos.ts`
- Test: `packages/api/src/app.spec.ts`

- [ ] **Step 1: Create `packages/api/package.json`**

```json
{
  "name": "@harness/api",
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "@harness/core": "*",
    "fastify": "^5.2.0",
    "@fastify/cors": "^10.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/api/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "api", environment: "node", include: ["src/**/*.spec.ts"] },
});
```

- [ ] **Step 4: Write the failing test**

```ts
// packages/api/src/app.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma, HarnessService } from "@harness/core";
import { buildApp } from "./app";

let workDir: string;
let prisma: ReturnType<typeof getPrisma>;
let app: Awaited<ReturnType<typeof buildApp>>;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-api-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  app = await buildApp(new HarnessService(prisma), prisma);
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });
beforeEach(async () => { repoPath = await mkdtemp(join(workDir, "repo-")); });

describe("API", () => {
  it("POST /repos registers + scaffolds, GET /repos lists it", async () => {
    const post = await app.inject({ method: "POST", url: "/repos", payload: { path: repoPath, name: "demo" } });
    expect(post.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/repos" });
    expect(list.json().some((r: any) => r.path === repoPath)).toBe(true);
  });

  it("GET /repos/:id/features returns indexed features after resync", async () => {
    const post = await app.inject({ method: "POST", url: "/repos", payload: { path: repoPath, name: "demo" } });
    const id = post.json().id;
    // simulate an agent writing a feature via the service directly
    await new HarnessService(prisma).upsertFeature(repoPath, { id: "F01", behavior: "b", verification: "t", state: "active" });
    await app.inject({ method: "POST", url: `/repos/${id}/resync` });
    const res = await app.inject({ method: "GET", url: `/repos/${id}/features` });
    expect(res.json().map((f: any) => f.featureId)).toContain("F01");
  });

  it("returns 400 with a clear message when registering a path that does not exist", async () => {
    const res = await app.inject({ method: "POST", url: "/repos", payload: { path: join(workDir, "does-not-exist"), name: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/path/i);
  });

  it("returns 404 for an unknown repo id", async () => {
    const res = await app.inject({ method: "GET", url: "/repos/nope/features" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm install` then `npx vitest run packages/api/src/app.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Write `packages/api/src/routes/repos.ts`**

```ts
// packages/api/src/routes/repos.ts
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { HarnessError, type HarnessService } from "@harness/core";
import { access } from "node:fs/promises";

export async function registerRepoRoutes(app: FastifyInstance, service: HarnessService, prisma: PrismaClient): Promise<void> {
  app.get("/repos", async () => {
    return prisma.repo.findMany({ orderBy: { name: "asc" } });
  });

  app.post<{ Body: { path: string; name?: string; description?: string } }>("/repos", async (req, reply) => {
    const { path, name, description } = req.body;
    try {
      await access(path);
    } catch {
      return reply.code(400).send({ error: `path '${path}' does not exist or is not accessible` });
    }
    try {
      await service.init(path, { name: name ?? path, description, hardConstraints: [] });
    } catch (e) {
      if (e instanceof HarnessError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    const repo = await prisma.repo.findUnique({ where: { path } });
    return reply.code(201).send(repo);
  });

  app.post<{ Params: { id: string } }>("/repos/:id/resync", async (req, reply) => {
    const repo = await prisma.repo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    try {
      await service.getContext(repo.path); // read + re-index
    } catch (e) {
      if (e instanceof HarnessError) return reply.code(409).send({ error: e.message });
      throw e;
    }
    return { ok: true };
  });

  const byId = async (id: string) => prisma.repo.findUnique({ where: { id } });

  app.get<{ Params: { id: string } }>("/repos/:id/context", async (req, reply) => {
    const repo = await byId(req.params.id);
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    return service.getContext(repo.path);
  });

  app.get<{ Params: { id: string } }>("/repos/:id/features", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.feature.findMany({ where: { repoId: req.params.id } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/progress", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.progress.findUnique({ where: { repoId: req.params.id } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/decisions", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.decision.findMany({ where: { repoId: req.params.id }, orderBy: { date: "desc" } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/agents", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.agent.findMany({ where: { repoId: req.params.id } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/sessions", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.session.findMany({ where: { repoId: req.params.id }, orderBy: { startedAt: "desc" } });
  });
}
```

- [ ] **Step 7: Write `packages/api/src/app.ts`**

```ts
// packages/api/src/app.ts
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { PrismaClient } from "@prisma/client";
import type { HarnessService } from "@harness/core";
import { registerRepoRoutes } from "./routes/repos.js";

export async function buildApp(service: HarnessService, prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await registerRepoRoutes(app, service, prisma);
  return app;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run packages/api/src/app.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Write `packages/api/src/index.ts` bootstrap**

```ts
// packages/api/src/index.ts
import { getPrisma, HarnessService } from "@harness/core";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const prisma = getPrisma();
  const app = await buildApp(new HarnessService(prisma), prisma);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "127.0.0.1" });
  process.stdout.write(`harness-api listening on http://127.0.0.1:${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`harness-api fatal: ${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 10: Commit**

```bash
git add packages/api package-lock.json
git commit -m "feat(api): Fastify REST service over HarnessService"
```

---

## Self-Review (this plan)

- **Spec coverage (§7 API):** `GET/POST /repos`, `POST /repos/:id/resync`, `GET /repos/:id/{context,features,progress,decisions,agents,sessions}` all implemented. Uses `core` for read/validate so it never diverges from MCP (§3). Errors map `HarnessError` → 400/409 with clear message (§8). On-demand resync re-reads files (§6, repo canonical).
- **Type consistency:** route field names (`featureId`, `decisionId`) match the Prisma column names from Plan 01's schema. `buildApp(service, prisma)` signature matches the test and is reused by `index.ts` and Plan 04's run instructions.
- **Placeholder scan:** none.
- **Downstream contract:** Plan 04 (web) reads these exact endpoints and JSON shapes (`{ id, name, path }` for repos; `{ featureId, behavior, verification, state, evidence }` for features; etc.).
