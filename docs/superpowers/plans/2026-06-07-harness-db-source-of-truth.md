# DB as Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make central SQLite the canonical harness store (no `.harness/` files in managed repos), and display full repo config + agents read-only on the dashboard.

**Architecture:** Introduce a `HarnessStore` interface with a Prisma-backed `DbStore` implementation. Refactor `HarnessService` to read/write DB directly (remove `RepoStore`, `indexer`, and `AGENTS.md` generation). Extend `Repo` with config columns; add dashboard sections via new API reads.

**Tech Stack:** TypeScript, Prisma/SQLite, Fastify, Next.js, Vitest, Docker Compose

**Spec:** `docs/superpowers/specs/2026-06-07-harness-db-source-of-truth-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `prisma/schema.prisma` | Add `description`, `hardConstraints` to `Repo` |
| `packages/core/src/store/types.ts` | `HarnessSnapshot` type (moved from `agents-md.ts`) |
| `packages/core/src/store/harness-store.ts` | `HarnessStore` interface |
| `packages/core/src/store/db-store.ts` | Prisma-backed store (canonical) |
| `packages/core/src/store/db-store.spec.ts` | Round-trip tests |
| `packages/core/src/service/harness-service.ts` | Use `DbStore`, drop `reindex` |
| `packages/api/src/routes/repos.ts` | `GET /repos/:id`, drop path check, simplify resync |
| `packages/web/src/components/RepoConfig.tsx` | Config section UI |
| `packages/web/src/components/AgentList.tsx` | Agents section UI |
| `packages/web/src/lib/api.ts` | `repo()`, `repoAgents()`, extended types |
| `docker-compose.yml` | Remove `/projects` mount from `harness-mcp` |

**Delete:** `repo-store.ts`, `repo-store.spec.ts`, `indexer.ts`, `indexer.spec.ts`, `agents-md.ts`, `agents-md.spec.ts`

---

### Task 1: Schema — add config columns to Repo

**Files:**
- Modify: `prisma/schema.prisma`
- Test: (migration only)

- [ ] **Step 1: Add columns to Repo model**

In `prisma/schema.prisma`, inside `model Repo {`:

```prisma
  description     String?
  hardConstraints String  @default("[]")
```

- [ ] **Step 2: Push schema**

Run from repo root:

```bash
pnpm exec prisma db push
```

Expected: schema applied without errors.

- [ ] **Step 3: Regenerate client**

```bash
pnpm exec prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add description and hardConstraints to Repo"
```

---

### Task 2: HarnessSnapshot type + HarnessStore interface

**Files:**
- Create: `packages/core/src/store/types.ts`
- Create: `packages/core/src/store/harness-store.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `types.ts`**

```ts
// packages/core/src/store/types.ts
import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";

export interface HarnessSnapshot {
  config: Config;
  agents: Agent[];
  features: Feature[];
  progress: Progress;
  decisions: Decision[];
}
```

- [ ] **Step 2: Create `harness-store.ts`**

```ts
// packages/core/src/store/harness-store.ts
import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";
import type { HarnessSnapshot } from "./types.js";

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

- [ ] **Step 3: Export from `index.ts`**

Add:

```ts
export * from "./store/types.js";
export * from "./store/harness-store.js";
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/store/types.ts packages/core/src/store/harness-store.ts packages/core/src/index.ts
git commit -m "feat(core): add HarnessStore interface and HarnessSnapshot type"
```

---

### Task 3: DbStore — init + read (TDD)

**Files:**
- Create: `packages/core/src/store/db-store.spec.ts`
- Create: `packages/core/src/store/db-store.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests for init + read**

```ts
// packages/core/src/store/db-store.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma } from "../db/client.js";
import { DbStore } from "./db-store.js";

let workDir: string;
let prisma: ReturnType<typeof getPrisma>;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-dbstore-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("pnpm exec prisma db push", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });
beforeEach(() => { repoPath = `/projects/demo-${Date.now()}`; });

describe("DbStore", () => {
  it("init seeds repo config and empty snapshot", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({
      name: "socmint",
      description: "Nx monorepo",
      hardConstraints: ["no network in tests"],
    });
    const snap = await store.read();
    expect(snap.config.name).toBe("socmint");
    expect(snap.config.description).toBe("Nx monorepo");
    expect(snap.config.hardConstraints).toEqual(["no network in tests"]);
    expect(snap.features).toEqual([]);
    expect(snap.agents).toEqual([]);
    expect(snap.decisions).toEqual([]);
  });

  it("read throws when repo not initialized", async () => {
    const store = new DbStore(prisma, "/projects/never-inited");
    await expect(store.read()).rejects.toThrow(/harness_init/i);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm exec vitest run packages/core/src/store/db-store.spec.ts
```

Expected: FAIL — `DbStore` not defined.

- [ ] **Step 3: Implement DbStore skeleton with init + read**

```ts
// packages/core/src/store/db-store.ts
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";
import type { HarnessStore } from "./harness-store.js";
import type { HarnessSnapshot } from "./types.js";
import { HarnessError } from "../errors.js";

const EMPTY_PROGRESS: Progress = {
  updatedAt: "1970-01-01T00:00:00Z",
  completed: [], inProgress: [], blocked: [], nextSteps: [],
};

export class DbStore implements HarnessStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repoPath: string,
  ) {}

  private async resolveRepoId(name?: string): Promise<string> {
    const existing = await this.prisma.repo.findUnique({ where: { path: this.repoPath } });
    if (existing) return existing.id;
    const created = await this.prisma.repo.create({
      data: { name: name ?? this.repoPath, path: this.repoPath },
    });
    return created.id;
  }

  async init(config: Config): Promise<void> {
    const repoId = await this.resolveRepoId(config.name);
    await this.prisma.$transaction([
      this.prisma.repo.update({
        where: { id: repoId },
        data: {
          name: config.name,
          description: config.description ?? null,
          hardConstraints: JSON.stringify(config.hardConstraints),
          langfuseProjectId: config.langfuseProjectId ?? null,
          indexedAt: new Date(),
        },
      }),
      this.prisma.progress.deleteMany({ where: { repoId } }),
      this.prisma.progress.create({
        data: {
          repoId,
          updatedAt: EMPTY_PROGRESS.updatedAt,
          completed: JSON.stringify(EMPTY_PROGRESS.completed),
          inProgress: JSON.stringify(EMPTY_PROGRESS.inProgress),
          blocked: JSON.stringify(EMPTY_PROGRESS.blocked),
          nextSteps: JSON.stringify(EMPTY_PROGRESS.nextSteps),
        },
      }),
      this.prisma.feature.deleteMany({ where: { repoId } }),
      this.prisma.agent.deleteMany({ where: { repoId } }),
      this.prisma.decision.deleteMany({ where: { repoId } }),
    ]);
  }

  async read(): Promise<HarnessSnapshot> {
    const repo = await this.prisma.repo.findUnique({ where: { path: this.repoPath } });
    if (!repo) {
      throw new HarnessError({
        path: this.repoPath,
        message: "repo not found",
        fix: "Run harness_init to scaffold this repo.",
      });
    }
    const progress = await this.prisma.progress.findUnique({ where: { repoId: repo.id } });
    if (!progress) {
      throw new HarnessError({
        path: this.repoPath,
        message: "repo not initialized",
        fix: "Run harness_init to scaffold this repo.",
      });
    }
    const [features, agents, decisions] = await Promise.all([
      this.prisma.feature.findMany({ where: { repoId: repo.id } }),
      this.prisma.agent.findMany({ where: { repoId: repo.id } }),
      this.prisma.decision.findMany({ where: { repoId: repo.id }, orderBy: { date: "desc" } }),
    ]);

    return {
      config: {
        name: repo.name,
        description: repo.description ?? undefined,
        langfuseProjectId: repo.langfuseProjectId ?? undefined,
        hardConstraints: JSON.parse(repo.hardConstraints) as string[],
      },
      features: features.map((f) => ({
        id: f.featureId,
        behavior: f.behavior,
        verification: f.verification,
        state: f.state as Feature["state"],
        evidence: f.evidence ?? undefined,
      })),
      agents: agents.map((a) => ({
        id: a.agentId,
        role: a.role,
        model: a.model ?? undefined,
        tools: a.tools ? (JSON.parse(a.tools) as string[]) : undefined,
        instructions: a.instructions,
      })),
      progress: {
        currentCommit: progress.currentCommit ?? undefined,
        testStatus: progress.testStatus ?? undefined,
        updatedAt: progress.updatedAt,
        completed: JSON.parse(progress.completed) as string[],
        inProgress: JSON.parse(progress.inProgress) as string[],
        blocked: JSON.parse(progress.blocked) as string[],
        nextSteps: JSON.parse(progress.nextSteps) as string[],
      },
      decisions: decisions.map((d) => ({
        id: d.decisionId,
        date: d.date,
        title: d.title,
        rationale: d.rationale,
        rejected: d.rejected ?? undefined,
      })),
    };
  }

  async writeConfig(_config: Config): Promise<void> {
    throw new Error("not implemented");
  }
  async writeFeatures(_features: Feature[]): Promise<void> {
    throw new Error("not implemented");
  }
  async writeProgress(_progress: Progress): Promise<void> {
    throw new Error("not implemented");
  }
  async writeDecisions(_decisions: Decision[]): Promise<void> {
    throw new Error("not implemented");
  }
  async writeAgent(_agent: Agent): Promise<void> {
    throw new Error("not implemented");
  }
}
```

Export from `packages/core/src/index.ts`:

```ts
export * from "./store/db-store.js";
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm exec vitest run packages/core/src/store/db-store.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/db-store.ts packages/core/src/store/db-store.spec.ts packages/core/src/index.ts
git commit -m "feat(core): add DbStore init and read"
```

---

### Task 4: DbStore — write methods (TDD)

**Files:**
- Modify: `packages/core/src/store/db-store.ts`
- Modify: `packages/core/src/store/db-store.spec.ts`

- [ ] **Step 1: Add failing tests for writes**

Append to `db-store.spec.ts`:

```ts
  it("writeFeatures round-trips through read", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeFeatures([
      { id: "F01", behavior: "logs in", verification: "pnpm test", state: "active" },
    ]);
    const snap = await store.read();
    expect(snap.features[0]).toMatchObject({ id: "F01", state: "active" });
  });

  it("writeAgent upserts a single agent", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeAgent({
      id: "planner",
      role: "planner",
      instructions: "Plan only.",
      tools: ["brainstorming"],
    });
    const snap = await store.read();
    expect(snap.agents[0]?.id).toBe("planner");
    expect(snap.agents[0]?.tools).toEqual(["brainstorming"]);
  });

  it("writeDecisions and writeProgress round-trip", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeDecisions([
      { id: "D01", date: "2026-06-07", title: "DB canonical", rationale: "no mount pain" },
    ]);
    await store.writeProgress({
      updatedAt: "2026-06-07T12:00:00Z",
      completed: ["F01"],
      inProgress: [],
      blocked: [],
      nextSteps: ["ship dashboard"],
      testStatus: "42 passed",
    });
    const snap = await store.read();
    expect(snap.decisions[0]?.id).toBe("D01");
    expect(snap.progress.completed).toEqual(["F01"]);
    expect(snap.progress.testStatus).toBe("42 passed");
  });
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm exec vitest run packages/core/src/store/db-store.spec.ts
```

- [ ] **Step 3: Implement write methods**

Replace stubs in `db-store.ts`:

```ts
  private async repoId(): Promise<string> {
    const repo = await this.prisma.repo.findUnique({ where: { path: this.repoPath } });
    if (!repo) {
      throw new HarnessError({
        path: this.repoPath,
        message: "repo not found",
        fix: "Run harness_init first.",
      });
    }
    return repo.id;
  }

  async writeConfig(config: Config): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.repo.update({
      where: { id: repoId },
      data: {
        name: config.name,
        description: config.description ?? null,
        hardConstraints: JSON.stringify(config.hardConstraints),
        langfuseProjectId: config.langfuseProjectId ?? null,
        indexedAt: new Date(),
      },
    });
  }

  async writeFeatures(features: Feature[]): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.$transaction([
      this.prisma.feature.deleteMany({ where: { repoId } }),
      this.prisma.feature.createMany({
        data: features.map((f) => ({
          repoId,
          featureId: f.id,
          behavior: f.behavior,
          verification: f.verification,
          state: f.state,
          evidence: f.evidence ?? null,
        })),
      }),
      this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } }),
    ]);
  }

  async writeProgress(progress: Progress): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.progress.upsert({
      where: { repoId },
      create: {
        repoId,
        currentCommit: progress.currentCommit ?? null,
        testStatus: progress.testStatus ?? null,
        updatedAt: progress.updatedAt,
        completed: JSON.stringify(progress.completed),
        inProgress: JSON.stringify(progress.inProgress),
        blocked: JSON.stringify(progress.blocked),
        nextSteps: JSON.stringify(progress.nextSteps),
      },
      update: {
        currentCommit: progress.currentCommit ?? null,
        testStatus: progress.testStatus ?? null,
        updatedAt: progress.updatedAt,
        completed: JSON.stringify(progress.completed),
        inProgress: JSON.stringify(progress.inProgress),
        blocked: JSON.stringify(progress.blocked),
        nextSteps: JSON.stringify(progress.nextSteps),
      },
    });
    await this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } });
  }

  async writeDecisions(decisions: Decision[]): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.$transaction([
      this.prisma.decision.deleteMany({ where: { repoId } }),
      this.prisma.decision.createMany({
        data: decisions.map((d) => ({
          repoId,
          decisionId: d.id,
          date: d.date,
          title: d.title,
          rationale: d.rationale,
          rejected: d.rejected ?? null,
        })),
      }),
      this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } }),
    ]);
  }

  async writeAgent(agent: Agent): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.agent.upsert({
      where: { repoId_agentId: { repoId, agentId: agent.id } },
      create: {
        repoId,
        agentId: agent.id,
        role: agent.role,
        model: agent.model ?? null,
        tools: agent.tools ? JSON.stringify(agent.tools) : null,
        instructions: agent.instructions,
      },
      update: {
        role: agent.role,
        model: agent.model ?? null,
        tools: agent.tools ? JSON.stringify(agent.tools) : null,
        instructions: agent.instructions,
      },
    });
    await this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } });
  }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm exec vitest run packages/core/src/store/db-store.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/db-store.ts packages/core/src/store/db-store.spec.ts
git commit -m "feat(core): add DbStore write methods"
```

---

### Task 5: Refactor HarnessService to use DbStore

**Files:**
- Modify: `packages/core/src/service/harness-service.ts`
- Modify: `packages/core/src/service/harness-service.spec.ts`
- Modify: `packages/core/src/validators.ts` (error paths, if any)

- [ ] **Step 1: Update HarnessService**

Replace `RepoStore` + `reindex` with `DbStore`:

```ts
import { DbStore } from "../store/db-store.js";
import type { HarnessSnapshot } from "../store/types.js";

// Remove: import { RepoStore } from "../store/repo-store.js";
// Remove: import { indexSnapshot } from "../db/indexer.js";

export class HarnessService {
  constructor(private readonly prisma: PrismaClient) {}

  private store(repoPath: string): DbStore {
    return new DbStore(this.prisma, repoPath);
  }

  private async resolveRepoId(repoPath: string, name?: string): Promise<string> {
    const existing = await this.prisma.repo.findUnique({ where: { path: repoPath } });
    if (existing) return existing.id;
    const created = await this.prisma.repo.create({ data: { name: name ?? repoPath, path: repoPath } });
    return created.id;
  }

  async init(repoPath: string, config: Config): Promise<HarnessSnapshot> {
    await this.store(repoPath).init(config);
    return this.store(repoPath).read();
  }

  async getContext(repoPath: string): Promise<HarnessSnapshot> {
    return this.store(repoPath).read();
  }

  // In upsertFeature / setFeaturePassing: change HarnessError path to "features"
  // After each writeX: return { snapshot: await this.store(repoPath).read(), warnings }
}
```

Key removals:
- Delete `reindex()` entirely.
- `init` no longer needs a temp filesystem directory — `repoPath` is a logical key string.

- [ ] **Step 2: Update harness-service.spec.ts**

Change `beforeEach`:

```ts
beforeEach(() => { repoPath = `/projects/test-${Date.now()}`; });
```

Remove `mkdtemp` for repo paths. Tests should still pass without creating directories.

- [ ] **Step 3: Run core service tests**

```bash
pnpm exec vitest run packages/core/src/service/harness-service.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/service/harness-service.ts packages/core/src/service/harness-service.spec.ts
git commit -m "refactor(core): HarnessService uses DbStore as canonical store"
```

---

### Task 6: Remove file-based artifacts

**Files:**
- Delete: `packages/core/src/store/repo-store.ts`, `repo-store.spec.ts`
- Delete: `packages/core/src/db/indexer.ts`, `indexer.spec.ts`
- Delete: `packages/core/src/agents-md.ts`, `agents-md.spec.ts`
- Modify: `packages/core/src/index.ts`
- Modify: any imports of `HarnessSnapshot` from `agents-md.js` → `store/types.js`

- [ ] **Step 1: Delete files listed above**

- [ ] **Step 2: Fix `index.ts` exports**

Remove:

```ts
export * from "./store/repo-store.js";
export * from "./db/indexer.js";
export * from "./agents-md.js";
```

Ensure these remain:

```ts
export * from "./store/types.js";
export * from "./store/harness-store.js";
export * from "./store/db-store.js";
```

- [ ] **Step 3: Grep for broken imports**

```bash
rg "agents-md|repo-store|indexSnapshot|indexer" packages/
```

Fix any remaining imports to use `store/types.js`.

- [ ] **Step 4: Run all core tests**

```bash
pnpm exec vitest run packages/core
```

- [ ] **Step 5: Commit**

```bash
git add -A packages/core
git commit -m "refactor(core): remove file-based RepoStore, indexer, and AGENTS.md generation"
```

---

### Task 7: API updates

**Files:**
- Modify: `packages/api/src/routes/repos.ts`
- Modify: `packages/api/src/app.spec.ts`

- [ ] **Step 1: Update routes**

In `repos.ts`:

1. Remove `import { access } from "node:fs/promises"` and the `access(path)` check in `POST /repos`.
2. Add `GET /repos/:id`:

```ts
  app.get<{ Params: { id: string } }>("/repos/:id", async (req, reply) => {
    const repo = await byId(req.params.id);
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    return repo;
  });
```

3. Simplify `POST /repos/:id/resync` to a no-op (keeps dashboard button working):

```ts
  app.post<{ Params: { id: string } }>("/repos/:id/resync", async (req, reply) => {
    const repo = await byId(req.params.id);
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    return { ok: true };
  });
```

4. Remove `service.getContext(repo.path)` call from old resync handler.

- [ ] **Step 2: Update app.spec.ts**

Replace path-existence test:

```ts
  it("POST /repos accepts a logical path that does not exist on disk", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { path: "/projects/socmint", name: "socmint" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().path).toBe("/projects/socmint");
  });

  it("GET /repos/:id returns repo config fields", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/repos",
      payload: {
        path: "/projects/config-test",
        name: "config-test",
        description: "test repo",
      },
    });
    const id = post.json().id;
    const res = await app.inject({ method: "GET", url: `/repos/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("config-test");
  });
```

Update `beforeEach`:

```ts
beforeEach(() => { repoPath = `/projects/api-test-${Date.now()}`; });
```

Update features test — resync no longer re-reads files; upsert via service still indexes to DB via DbStore:

```ts
  it("GET /repos/:id/features returns features after service write", async () => {
    const post = await app.inject({ method: "POST", url: "/repos", payload: { path: repoPath, name: "demo" } });
    const id = post.json().id;
    await new HarnessService(prisma).upsertFeature(repoPath, { id: "F01", behavior: "b", verification: "t", state: "active" });
    const res = await app.inject({ method: "GET", url: `/repos/${id}/features` });
    expect(res.json().map((f: { featureId: string }) => f.featureId)).toContain("F01");
  });
```

- [ ] **Step 3: Run API tests**

```bash
pnpm exec vitest run packages/api/src/app.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/repos.ts packages/api/src/app.spec.ts
git commit -m "feat(api): GET /repos/:id, logical paths, resync no-op"
```

---

### Task 8: MCP test updates

**Files:**
- Modify: `packages/mcp/src/e2e.spec.ts`
- Modify: `packages/mcp/src/server.spec.ts` (if it reads files)

- [ ] **Step 1: Update e2e.spec.ts**

Replace file assertions with DB assertions:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// Remove readFile import

describe("E2E: init → context → feature → passing → handoff", () => {
  it("completes the full flow and records DB state + a closed session", async () => {
    const repoPath = `/projects/e2e-${Date.now()}`;

    expect((await handlers.harness_init({ repoPath, name: "demo", hardConstraints: ["no force push"] })).isError).toBeFalsy();
    expect((await handlers.harness_get_context({ repoPath })).isError).toBeFalsy();
    expect((await handlers.harness_update_feature({ repoPath, id: "F01", behavior: "logs in", verification: "npm test", state: "active" })).isError).toBeFalsy();
    expect((await handlers.harness_set_feature_passing({ repoPath, id: "F01", evidence: "commit abc123" })).isError).toBeFalsy();
    const handoff = await handlers.harness_handoff({ repoPath, updatedAt: "2026-06-04T12:00:00Z", summary: "done", completed: ["F01"] });
    expect(handoff.isError).toBeFalsy();

    const repo = await prisma.repo.findUnique({ where: { path: repoPath } });
    const features = await prisma.feature.findMany({ where: { repoId: repo!.id } });
    expect(features[0]).toMatchObject({ featureId: "F01", state: "passing", evidence: "commit abc123" });
    expect(repo?.hardConstraints).toContain("no force push");

    const sessions = await prisma.session.findMany({ where: { repoId: repo!.id } });
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.endedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run MCP tests**

```bash
pnpm exec vitest run packages/mcp
```

- [ ] **Step 3: Commit**

```bash
git add packages/mcp
git commit -m "test(mcp): assert DB state instead of .harness files"
```

---

### Task 9: Docker — remove projects mount

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md` (HARNESS_PROJECTS_DIR section)
- Modify: `.env.example` (if HARNESS_PROJECTS_DIR documented there)

- [ ] **Step 1: Remove mount from harness-mcp**

In `docker-compose.yml`, delete:

```yaml
      - ${HARNESS_PROJECTS_DIR:-./projects}:/projects
```

Update comment above `harness-mcp` to note `repoPath` is a logical key (e.g. `/projects/socmint` or `socmint`).

- [ ] **Step 2: Update README**

In the "Repos you want to manage" section, replace mount instructions with:

> `repoPath` is a **logical identifier** for the repo (e.g. `/projects/socmint`). It does not need to exist on disk. All harness state lives in the central SQLite database.

Remove `HARNESS_PROJECTS_DIR` requirement.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml README.md .env.example
git commit -m "docs(docker): remove projects bind mount; repoPath is logical key"
```

---

### Task 10: Frontend — API types + components (TDD)

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/components/RepoConfig.tsx`
- Create: `packages/web/src/components/AgentList.tsx`
- Create: `packages/web/src/components/RepoConfig.spec.tsx`
- Create: `packages/web/src/components/AgentList.spec.tsx`

- [ ] **Step 1: Extend api.ts**

```ts
export interface Repo {
  id: string;
  name: string;
  path: string;
  description?: string | null;
  hardConstraints?: string; // JSON string from API
  langfuseProjectId?: string | null;
  indexedAt?: string | null;
}

export interface AgentRow {
  id: string;
  agentId: string;
  role: string;
  model?: string | null;
  tools?: string | null; // JSON string
  instructions: string;
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export const repo = (id: string) => get<Repo>(`/repos/${id}`);
export const repoAgents = (id: string) => get<AgentRow[]>(`/repos/${id}/agents`);
```

- [ ] **Step 2: Write failing component tests**

`RepoConfig.spec.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoConfig } from "./RepoConfig";

describe("RepoConfig", () => {
  it("renders name, description, and hard constraints", () => {
    render(
      <RepoConfig
        name="socmint"
        description="Nx monorepo"
        hardConstraints={["No real network calls in unit tests"]}
        langfuseProjectId="harness-manager"
        indexedAt="2026-06-07T12:00:00.000Z"
      />,
    );
    expect(screen.getByText("socmint")).toBeInTheDocument();
    expect(screen.getByText("Nx monorepo")).toBeInTheDocument();
    expect(screen.getByText(/No real network calls/)).toBeInTheDocument();
  });
});
```

`AgentList.spec.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentList } from "./AgentList";

describe("AgentList", () => {
  it("renders agent id, role, tools, and instructions", () => {
    render(
      <AgentList
        agents={[
          {
            id: "1",
            agentId: "planner",
            role: "planner",
            model: null,
            tools: JSON.stringify(["brainstorming"]),
            instructions: "Plan only.",
          },
        ]}
      />,
    );
    expect(screen.getByText("planner")).toBeInTheDocument();
    expect(screen.getByText("Plan only.")).toBeInTheDocument();
    expect(screen.getByText("brainstorming")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
pnpm exec vitest run packages/web/src/components/RepoConfig.spec.tsx packages/web/src/components/AgentList.spec.tsx
```

- [ ] **Step 4: Implement components**

`RepoConfig.tsx` — Card with name (h3), description, hardConstraints as `<ul>`, metadata row for langfuseProjectId + indexedAt.

`AgentList.tsx` — map agents to Cards: agentId (uppercase label), role, model (if set), tools as pill spans, instructions in `<pre>` or `<p>` with `whitespace-pre-wrap`.

Follow `FeatureBoard.tsx` / `Card` styling (`text-sage`, `text-forest/60`, etc.).

- [ ] **Step 5: Run component tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/components/RepoConfig.tsx packages/web/src/components/AgentList.tsx packages/web/src/components/RepoConfig.spec.tsx packages/web/src/components/AgentList.spec.tsx
git commit -m "feat(web): RepoConfig and AgentList components"
```

---

### Task 11: Frontend — integrate into repo detail page

**Files:**
- Modify: `packages/web/src/app/repos/[id]/page.tsx`

- [ ] **Step 1: Fetch repo + agents, render sections**

```tsx
import { RepoConfig } from "@/components/RepoConfig";
import { AgentList } from "@/components/AgentList";
import { repoFeatures, repoDecisions, repoSessions, repo, repoAgents, parseJsonArray } from "@/lib/api";

// In component:
const [repoRow, features, decisions, sessions, agents] = await Promise.all([
  repo(id),
  repoFeatures(id),
  repoDecisions(id),
  repoSessions(id),
  repoAgents(id),
]);

// After back link, before Feature board:
<section>
  <SectionHeading>Repository <span className="font-normal italic text-sage">config</span></SectionHeading>
  <div className="mt-10">
    <RepoConfig
      name={repoRow.name}
      description={repoRow.description}
      hardConstraints={parseJsonArray(repoRow.hardConstraints)}
      langfuseProjectId={repoRow.langfuseProjectId}
      indexedAt={repoRow.indexedAt}
    />
  </div>
</section>

<VineDivider />

<section>
  <SectionHeading><span className="font-normal italic text-sage">Agents</span></SectionHeading>
  <div className="mt-10">
    <AgentList agents={agents} />
  </div>
</section>

<VineDivider />
```

- [ ] **Step 2: Run web tests**

```bash
pnpm exec vitest run packages/web
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/repos/[id]/page.tsx
git commit -m "feat(web): show repo config and agents on detail page"
```

---

### Task 12: Final verification + docs touch-up

**Files:**
- Modify: `docs/HARNESS_PROMPTS.md` (repoPath note)
- Modify: `README.md` (workflow section if it still mentions `.harness/` files as canonical)

- [ ] **Step 1: Update HARNESS_PROMPTS.md**

Add note under system prompt:

> `repoPath` is a logical key (e.g. `/projects/socmint`). Harness state is stored in the central database, not in repo files.

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all packages pass.

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: all Nx build targets succeed.

- [ ] **Step 4: Smoke test Docker (optional)**

```bash
docker compose up -d harness-api harness-web harness-mcp
curl -X POST http://127.0.0.1:4000/repos -H "Content-Type: application/json" -d "{\"path\":\"/projects/socmint\",\"name\":\"socmint\"}"
curl http://127.0.0.1:4000/repos
```

Expected: repo created without host path existing.

- [ ] **Step 5: Commit docs**

```bash
git add docs/HARNESS_PROMPTS.md README.md
git commit -m "docs: repoPath is logical key; DB is canonical store"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| DB canonical, no `.harness/` files | Tasks 5–6 |
| `description` + `hardConstraints` on Repo | Task 1 |
| `HarnessStore` + `DbStore` | Tasks 2–4 |
| Remove `AGENTS.md` generation | Task 6 |
| Remove indexer | Task 6 |
| MCP logical `repoPath` | Tasks 5, 8 |
| Remove Docker `/projects` mount | Task 9 |
| `GET /repos/:id` | Task 7 |
| Drop path existence check | Task 7 |
| Resync no-op | Task 7 |
| Dashboard config + agents (read-only) | Tasks 10–11 |
| Tests updated | Tasks 3–8, 10–12 |

## Risks (unchanged from spec)

- Backup `harness_db` volume — all state lives there.
- One-way: no file fallback after this ships.
