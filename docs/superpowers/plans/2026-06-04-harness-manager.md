# Harness Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first control plane that stores each repo's harness state (agents, features, progress, decisions, sessions) as git-tracked `.harness/` files, exposes an MCP server for coding agents to read/write that state, indexes it into SQLite for cross-repo queries, traces sessions to Langfuse, and surfaces everything in a Next.js dashboard.

**Architecture:** Nx monorepo (TypeScript). `core` holds pure codecs/schemas/AGENTS.md-generation/validators PLUS a shared I/O layer (`store` + `db` + `service`) so `mcp` and `api` never diverge. `mcp` is a thin stdio MCP transport over `core`'s service. `api` is a thin Fastify REST transport over the same service. `web` is a read-only Next.js dashboard over `api`. The repo's `.harness/` files are canonical; SQLite is a rebuildable cache. On any mismatch, the file wins.

**Tech Stack:** Nx 20, TypeScript 5, Zod 3, gray-matter 4, Vitest 2, Prisma 6 + SQLite, @modelcontextprotocol/sdk 1, Fastify 5, langfuse 3, Next.js 15 (App Router) + React 19.

---

## Architectural Reconciliation (read before starting)

The spec (§3) says `core` is "pure logic, no I/O" but ALSO says `core` is "the shared layer so MCP and API never diverge." Pure codecs alone don't prevent divergence — the orchestration (read file → parse → index → write file → regenerate AGENTS.md) is what would diverge. Resolution used throughout this plan:

- **Pure layer in `core`** (no I/O, fully unit-tested): `schemas/`, `codec/`, `agents-md.ts`, `validators.ts`.
- **Shared I/O layer in `core`** (the thing that prevents divergence): `store/` (filesystem read/write of `.harness/`, atomic writes), `db/` (Prisma client + indexer), `service/` (orchestration the transports call).
- `mcp` and `api` contain ONLY transport glue + Langfuse tracing wiring. They call `core`'s `HarnessService`.

This serves the spec's stated primary goal (no divergence) and keeps transports thin.

## File Structure

```
harness-manager/
├── package.json                      # npm workspaces root, Nx
├── nx.json
├── tsconfig.base.json
├── vitest.workspace.ts
├── .env.example                      # LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, HARNESS_DB_URL
├── prisma/
│   └── schema.prisma                 # SQLite: repos, features, agents, decisions, progress, sessions
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts              # public barrel
│   │       ├── schemas/
│   │       │   ├── index.ts          # Zod schemas + inferred types (Agent, Feature, Progress, Decision, Config)
│   │       ├── codec/
│   │       │   ├── agent.ts          # parse/serialize agents/*.md (frontmatter + body)
│   │       │   ├── feature.ts        # parse/serialize features.json
│   │       │   ├── progress.ts       # parse/serialize progress.md
│   │       │   ├── decision.ts       # parse/serialize decisions.md (=== delimited blocks)
│   │       │   └── config.ts         # parse/serialize config.json
│   │       ├── agents-md.ts          # generateAgentsMd(snapshot) -> string (deterministic)
│   │       ├── validators.ts         # WIP=1, pass-state gating
│   │       ├── errors.ts             # HarnessError with path + fix hint
│   │       ├── store/
│   │       │   └── repo-store.ts     # RepoStore: read/write .harness/ via codecs, atomic writes
│   │       ├── db/
│   │       │   ├── client.ts         # PrismaClient singleton
│   │       │   └── indexer.ts        # upsert parsed snapshot into SQLite by content hash
│   │       └── service/
│   │           └── harness-service.ts# HarnessService: orchestration used by mcp + api
│   ├── mcp/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts              # stdio server entrypoint
│   │       ├── server.ts             # build McpServer, register tools
│   │       ├── tools/                # one file per tool group
│   │       │   ├── read-tools.ts
│   │       │   └── write-tools.ts
│   │       └── tracing.ts            # Langfuse session/span helpers (no-op if unconfigured)
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts              # Fastify bootstrap
│   │       ├── app.ts                # buildApp(service) -> FastifyInstance (testable)
│   │       └── routes/
│   │           └── repos.ts          # all /repos endpoints
│   └── web/
│       ├── package.json
│       ├── next.config.mjs
│       ├── tsconfig.json
│       └── src/app/                  # Next.js App Router pages (read-only dashboard)
└── docs/
```

---

## Phase 0 — Monorepo foundation

### Task 0.1: Initialize npm workspace + Nx + TypeScript base

**Files:**
- Create: `package.json`
- Create: `nx.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "harness-manager",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "build": "nx run-many -t build",
    "prisma:generate": "prisma generate",
    "prisma:push": "prisma db push"
  },
  "devDependencies": {
    "nx": "^20.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create `nx.json`**

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*"],
    "production": ["default", "!{projectRoot}/**/*.spec.ts", "!{projectRoot}/**/vitest.config.ts"]
  },
  "targetDefaults": {
    "build": { "dependsOn": ["^build"], "cache": true },
    "test": { "cache": true }
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "declaration": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@harness/core": ["packages/core/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.nx/
*.tsbuildinfo
.env
*.db
*.db-journal
prisma/dev.db
.next/
```

- [ ] **Step 5: Create `.env.example`**

```
# Langfuse (optional — missing keys => tracing is a silent no-op)
LANGFUSE_HOST=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=

# SQLite index/cache
HARNESS_DB_URL=file:./prisma/dev.db
```

- [ ] **Step 6: Install and verify**

Run: `npm install`
Expected: completes without error; `node_modules/.bin/nx` exists.

- [ ] **Step 7: Commit**

```bash
git add package.json nx.json tsconfig.base.json .gitignore .env.example package-lock.json
git commit -m "chore: scaffold Nx npm workspace + TS base config"
```

### Task 0.2: Root Vitest workspace

**Files:**
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Create `vitest.workspace.ts`**

```ts
export default ["packages/*/vitest.config.ts"];
```

- [ ] **Step 2: Verify (no tests yet)**

Run: `npx vitest run`
Expected: "No test files found" (exit 0 or a clean "no tests" message). This confirms the workspace resolves.

- [ ] **Step 3: Commit**

```bash
git add vitest.workspace.ts
git commit -m "chore: add root vitest workspace"
```

---

## Phase 1 — `core`: schemas (pure)

### Task 1.1: Create `core` package skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@harness/core",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "zod": "^3.24.0",
    "gray-matter": "^4.0.3",
    "@prisma/client": "^6.1.0"
  },
  "devDependencies": {
    "prisma": "^6.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "core", environment: "node", include: ["src/**/*.spec.ts"] },
});
```

- [ ] **Step 4: Create placeholder `packages/core/src/index.ts`**

```ts
export {};
```

- [ ] **Step 5: Install new deps**

Run: `npm install`
Expected: zod, gray-matter, prisma installed.

- [ ] **Step 6: Commit**

```bash
git add packages/core package-lock.json
git commit -m "chore(core): package skeleton"
```

### Task 1.2: Define Zod schemas + types

**Files:**
- Create: `packages/core/src/schemas/index.ts`
- Test: `packages/core/src/schemas/index.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/schemas/index.spec.ts
import { describe, it, expect } from "vitest";
import {
  AgentSchema, FeatureSchema, ProgressSchema, DecisionSchema, ConfigSchema,
} from "./index";

describe("schemas", () => {
  it("accepts a valid agent", () => {
    const a = { id: "planner", role: "Planner", model: "opus", tools: ["read"], instructions: "Plan." };
    expect(AgentSchema.parse(a)).toEqual(a);
  });

  it("requires agent id, role, instructions", () => {
    expect(() => AgentSchema.parse({ role: "x", instructions: "y" })).toThrow();
  });

  it("accepts a valid feature and constrains state", () => {
    const f = { id: "F01", behavior: "b", verification: "npm test", state: "active" };
    expect(FeatureSchema.parse(f).state).toBe("active");
    expect(() => FeatureSchema.parse({ ...f, state: "done" })).toThrow();
  });

  it("defaults progress arrays to empty", () => {
    const p = ProgressSchema.parse({ updatedAt: "2026-06-04T00:00:00Z" });
    expect(p.completed).toEqual([]);
    expect(p.nextSteps).toEqual([]);
  });

  it("accepts a valid decision and config", () => {
    expect(DecisionSchema.parse({ id: "D01", date: "2026-06-04", title: "t", rationale: "r" }).id).toBe("D01");
    expect(ConfigSchema.parse({ name: "repo", hardConstraints: [] }).hardConstraints).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/schemas/index.spec.ts`
Expected: FAIL — cannot resolve `./index` exports.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/schemas/index.ts
import { z } from "zod";

export const AgentSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  instructions: z.string(),
});

export const FeatureStateSchema = z.enum(["not_started", "active", "blocked", "passing"]);

export const FeatureSchema = z.object({
  id: z.string().min(1),
  behavior: z.string(),
  verification: z.string(),
  state: FeatureStateSchema,
  evidence: z.string().optional(),
});

export const ProgressSchema = z.object({
  currentCommit: z.string().optional(),
  testStatus: z.string().optional(),
  updatedAt: z.string(),
  completed: z.array(z.string()).default([]),
  inProgress: z.array(z.string()).default([]),
  blocked: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});

export const DecisionSchema = z.object({
  id: z.string().min(1),
  date: z.string(),
  title: z.string(),
  rationale: z.string(),
  rejected: z.string().optional(),
});

export const ConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  langfuseProjectId: z.string().optional(),
  hardConstraints: z.array(z.string()).default([]),
});

export type Agent = z.infer<typeof AgentSchema>;
export type FeatureState = z.infer<typeof FeatureStateSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/schemas/index.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Export from barrel**

```ts
// packages/core/src/index.ts
export * from "./schemas/index.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas packages/core/src/index.ts
git commit -m "feat(core): Zod schemas for harness artifacts"
```

### Task 1.3: HarnessError with agent-oriented fix hints

**Files:**
- Create: `packages/core/src/errors.ts`
- Test: `packages/core/src/errors.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/errors.spec.ts
import { describe, it, expect } from "vitest";
import { HarnessError } from "./errors";

describe("HarnessError", () => {
  it("carries path + fix hint in message", () => {
    const e = new HarnessError({
      path: ".harness/features.json",
      message: "feature F03 missing 'verification'",
      fix: "Add a verification command then retry.",
    });
    expect(e.message).toContain(".harness/features.json");
    expect(e.message).toContain("missing 'verification'");
    expect(e.message).toContain("Add a verification command then retry.");
    expect(e.path).toBe(".harness/features.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/errors.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/errors.ts
export interface HarnessErrorInit {
  path: string;
  message: string;
  fix?: string;
}

export class HarnessError extends Error {
  readonly path: string;
  readonly fix?: string;

  constructor(init: HarnessErrorInit) {
    const fixSuffix = init.fix ? ` ${init.fix}` : "";
    super(`${init.path}: ${init.message}.${fixSuffix}`);
    this.name = "HarnessError";
    this.path = init.path;
    this.fix = init.fix;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/errors.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add to barrel + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./errors.js";
```

```bash
git add packages/core/src/errors.ts packages/core/src/errors.spec.ts packages/core/src/index.ts
git commit -m "feat(core): HarnessError with path + fix hint"
```

---

## Phase 2 — `core`: codecs (pure, round-trip tested)

> Each codec is a pure pair: `parseX(content: string): X` and `serializeX(x: X): string`, such that `parse(serialize(x))` deep-equals `x`. On invalid input, codecs throw `HarnessError` with the file path and a fix hint.

### Task 2.1: Config codec (JSON)

**Files:**
- Create: `packages/core/src/codec/config.ts`
- Test: `packages/core/src/codec/config.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/codec/config.spec.ts
import { describe, it, expect } from "vitest";
import { parseConfig, serializeConfig } from "./config";
import type { Config } from "../schemas/index";

const sample: Config = {
  name: "my-repo",
  description: "demo",
  langfuseProjectId: "proj_1",
  hardConstraints: ["never push to main"],
};

describe("config codec", () => {
  it("round-trips", () => {
    expect(parseConfig(serializeConfig(sample))).toEqual(sample);
  });

  it("throws HarnessError on invalid JSON with path", () => {
    expect(() => parseConfig("{not json")).toThrow(/config\.json/);
  });

  it("throws HarnessError when name missing", () => {
    expect(() => parseConfig(JSON.stringify({ hardConstraints: [] }))).toThrow(/config\.json/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/codec/config.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/codec/config.ts
import { ConfigSchema, type Config } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/config.json";

export function parseConfig(content: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new HarnessError({ path: PATH, message: "invalid JSON", fix: "Fix the JSON syntax then retry." });
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HarnessError({
      path: PATH,
      message: `field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
      fix: "Correct the field then retry.",
    });
  }
  return result.data;
}

export function serializeConfig(config: Config): string {
  return JSON.stringify(config, null, 2) + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/codec/config.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codec/config.ts packages/core/src/codec/config.spec.ts
git commit -m "feat(core): config.json codec"
```

### Task 2.2: Feature codec (JSON array)

**Files:**
- Create: `packages/core/src/codec/feature.ts`
- Test: `packages/core/src/codec/feature.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/codec/feature.spec.ts
import { describe, it, expect } from "vitest";
import { parseFeatures, serializeFeatures } from "./feature";
import type { Feature } from "../schemas/index";

const features: Feature[] = [
  { id: "F01", behavior: "logs in", verification: "npm test auth", state: "passing", evidence: "abc123" },
  { id: "F02", behavior: "logs out", verification: "npm test auth", state: "not_started" },
];

describe("feature codec", () => {
  it("round-trips an array", () => {
    expect(parseFeatures(serializeFeatures(features))).toEqual(features);
  });

  it("throws HarnessError naming the bad feature id when verification missing", () => {
    const bad = JSON.stringify([{ id: "F03", behavior: "x", state: "active" }]);
    expect(() => parseFeatures(bad)).toThrow(/F03/);
  });

  it("throws when top-level is not an array", () => {
    expect(() => parseFeatures(JSON.stringify({}))).toThrow(/features\.json/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/codec/feature.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/codec/feature.ts
import { FeatureSchema, type Feature } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/features.json";

export function parseFeatures(content: string): Feature[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new HarnessError({ path: PATH, message: "invalid JSON", fix: "Fix the JSON syntax then retry." });
  }
  if (!Array.isArray(raw)) {
    throw new HarnessError({ path: PATH, message: "top-level value must be an array", fix: "Wrap features in a JSON array." });
  }
  return raw.map((item, index) => {
    const result = FeatureSchema.safeParse(item);
    if (!result.success) {
      const issue = result.error.issues[0];
      const id =
        item && typeof item === "object" && "id" in item ? String((item as { id: unknown }).id) : `index ${index}`;
      throw new HarnessError({
        path: PATH,
        message: `feature ${id} field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
        fix: "Correct the feature then retry.",
      });
    }
    return result.data;
  });
}

export function serializeFeatures(features: Feature[]): string {
  return JSON.stringify(features, null, 2) + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/codec/feature.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codec/feature.ts packages/core/src/codec/feature.spec.ts
git commit -m "feat(core): features.json codec"
```

### Task 2.3: Agent codec (Markdown frontmatter + body)

**Files:**
- Create: `packages/core/src/codec/agent.ts`
- Test: `packages/core/src/codec/agent.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/codec/agent.spec.ts
import { describe, it, expect } from "vitest";
import { parseAgent, serializeAgent } from "./agent";
import type { Agent } from "../schemas/index";

const agent: Agent = {
  id: "planner",
  role: "Planner",
  model: "opus",
  tools: ["read", "write"],
  instructions: "You plan features.\n\nKeep WIP=1.",
};

describe("agent codec", () => {
  it("round-trips frontmatter + body", () => {
    expect(parseAgent(serializeAgent(agent), "planner")).toEqual(agent);
  });

  it("uses filename id when frontmatter omits id", () => {
    const md = "---\nrole: Generator\n---\nGenerate code.";
    expect(parseAgent(md, "generator").id).toBe("generator");
  });

  it("throws HarnessError naming the agent file when role missing", () => {
    expect(() => parseAgent("---\nid: x\n---\nbody", "planner")).toThrow(/agents\/planner\.md/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/codec/agent.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/codec/agent.ts
import matter from "gray-matter";
import { AgentSchema, type Agent } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

function pathFor(id: string): string {
  return `.harness/agents/${id}.md`;
}

export function parseAgent(content: string, fileId: string): Agent {
  const parsed = matter(content);
  const candidate = {
    id: (parsed.data.id as string | undefined) ?? fileId,
    role: parsed.data.role,
    model: parsed.data.model,
    tools: parsed.data.tools,
    instructions: parsed.content.trim(),
  };
  const result = AgentSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HarnessError({
      path: pathFor(fileId),
      message: `field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
      fix: "Correct the frontmatter then retry.",
    });
  }
  return result.data;
}

export function serializeAgent(agent: Agent): string {
  const data: Record<string, unknown> = { id: agent.id, role: agent.role };
  if (agent.model !== undefined) data.model = agent.model;
  if (agent.tools !== undefined) data.tools = agent.tools;
  return matter.stringify(`\n${agent.instructions}\n`, data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/codec/agent.spec.ts`
Expected: PASS (3 tests).

> Note: `matter.stringify` emits a trailing newline and normalizes body whitespace; the round-trip test confirms `instructions` survives via `.trim()`. If the round-trip fails on whitespace, the test is the source of truth — adjust serialize to wrap instructions consistently (it already does).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codec/agent.ts packages/core/src/codec/agent.spec.ts
git commit -m "feat(core): agent markdown codec"
```

### Task 2.4: Progress codec (frontmatter holds structured fields; body is regenerated mirror)

**Files:**
- Create: `packages/core/src/codec/progress.ts`
- Test: `packages/core/src/codec/progress.spec.ts`

> Design decision: all structured progress fields live in YAML frontmatter (robust round-trip). The markdown body is a human-readable mirror that is regenerated on serialize and IGNORED on parse. So `parse(serialize(p))` reads only frontmatter and equals `p`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/codec/progress.spec.ts
import { describe, it, expect } from "vitest";
import { parseProgress, serializeProgress } from "./progress";
import type { Progress } from "../schemas/index";

const progress: Progress = {
  currentCommit: "abc123",
  testStatus: "passing",
  updatedAt: "2026-06-04T10:00:00Z",
  completed: ["F01"],
  inProgress: ["F02"],
  blocked: [],
  nextSteps: ["wire api"],
};

describe("progress codec", () => {
  it("round-trips via frontmatter", () => {
    expect(parseProgress(serializeProgress(progress))).toEqual(progress);
  });

  it("regenerated body mirrors the lists (human readable)", () => {
    const out = serializeProgress(progress);
    expect(out).toContain("## Completed");
    expect(out).toContain("- F01");
    expect(out).toContain("## Next Steps");
    expect(out).toContain("- wire api");
  });

  it("ignores edits to the body on parse", () => {
    const out = serializeProgress(progress) + "\n\nHuman scribbled notes here.";
    expect(parseProgress(out)).toEqual(progress);
  });

  it("throws HarnessError naming progress.md when updatedAt missing", () => {
    expect(() => parseProgress("---\ncompleted: []\n---\n")).toThrow(/progress\.md/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/codec/progress.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/codec/progress.ts
import matter from "gray-matter";
import { ProgressSchema, type Progress } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/progress.md";

export function parseProgress(content: string): Progress {
  const parsed = matter(content);
  const result = ProgressSchema.safeParse(parsed.data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HarnessError({
      path: PATH,
      message: `field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
      fix: "Correct the frontmatter then retry.",
    });
  }
  return result.data;
}

function section(title: string, items: string[]): string {
  const body = items.length ? items.map((i) => `- ${i}`).join("\n") : "_none_";
  return `## ${title}\n${body}\n`;
}

export function serializeProgress(progress: Progress): string {
  const data: Record<string, unknown> = {
    updatedAt: progress.updatedAt,
    completed: progress.completed,
    inProgress: progress.inProgress,
    blocked: progress.blocked,
    nextSteps: progress.nextSteps,
  };
  if (progress.currentCommit !== undefined) data.currentCommit = progress.currentCommit;
  if (progress.testStatus !== undefined) data.testStatus = progress.testStatus;

  const body = [
    section("Completed", progress.completed),
    section("In Progress", progress.inProgress),
    section("Blocked", progress.blocked),
    section("Next Steps", progress.nextSteps),
  ].join("\n");

  return matter.stringify(`\n${body}`, data);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/codec/progress.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codec/progress.ts packages/core/src/codec/progress.spec.ts
git commit -m "feat(core): progress.md codec (frontmatter canonical, body mirrored)"
```

### Task 2.5: Decision codec (=== delimited frontmatter blocks)

**Files:**
- Create: `packages/core/src/codec/decision.ts`
- Test: `packages/core/src/codec/decision.spec.ts`

> Format: file is zero or more decision blocks joined by a line `===`. Each block is a gray-matter document: frontmatter `{ id, date, title, rejected? }` + body = `rationale`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/codec/decision.spec.ts
import { describe, it, expect } from "vitest";
import { parseDecisions, serializeDecisions } from "./decision";
import type { Decision } from "../schemas/index";

const decisions: Decision[] = [
  { id: "D01", date: "2026-06-04", title: "SQLite as cache", rationale: "Rebuildable from files.", rejected: "Postgres" },
  { id: "D02", date: "2026-06-05", title: "Repo is source of truth", rationale: "Lecture 3.\n\nFile wins." },
];

describe("decision codec", () => {
  it("round-trips multiple blocks", () => {
    expect(parseDecisions(serializeDecisions(decisions))).toEqual(decisions);
  });

  it("parses empty file to empty array", () => {
    expect(parseDecisions("")).toEqual([]);
    expect(parseDecisions("   \n")).toEqual([]);
  });

  it("throws HarnessError naming decisions.md when title missing", () => {
    expect(() => parseDecisions("---\nid: D9\ndate: 2026-01-01\n---\nbody")).toThrow(/decisions\.md/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/codec/decision.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/codec/decision.ts
import matter from "gray-matter";
import { DecisionSchema, type Decision } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/decisions.md";
const DELIMITER = "\n===\n";

export function parseDecisions(content: string): Decision[] {
  if (content.trim() === "") return [];
  return content.split(DELIMITER).map((block, index) => {
    const parsed = matter(block.trim());
    const candidate = {
      id: parsed.data.id,
      date: parsed.data.date,
      title: parsed.data.title,
      rejected: parsed.data.rejected,
      rationale: parsed.content.trim(),
    };
    const result = DecisionSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0];
      const id = parsed.data.id ? String(parsed.data.id) : `block ${index}`;
      throw new HarnessError({
        path: PATH,
        message: `decision ${id} field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
        fix: "Correct the decision block then retry.",
      });
    }
    return result.data;
  });
}

export function serializeDecisions(decisions: Decision[]): string {
  const blocks = decisions.map((d) => {
    const data: Record<string, unknown> = { id: d.id, date: d.date, title: d.title };
    if (d.rejected !== undefined) data.rejected = d.rejected;
    return matter.stringify(`\n${d.rationale}\n`, data).trim();
  });
  return blocks.join(DELIMITER) + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/codec/decision.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export all codecs from barrel + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./codec/config.js";
export * from "./codec/feature.js";
export * from "./codec/agent.js";
export * from "./codec/progress.js";
export * from "./codec/decision.js";
```

```bash
git add packages/core/src/codec/decision.ts packages/core/src/codec/decision.spec.ts packages/core/src/index.ts
git commit -m "feat(core): decisions.md codec + export codecs"
```

---

## Phase 3 — `core`: AGENTS.md generation + validators (pure)

### Task 3.1: `HarnessSnapshot` type + `generateAgentsMd`

**Files:**
- Create: `packages/core/src/agents-md.ts`
- Test: `packages/core/src/agents-md.spec.ts`

> `HarnessSnapshot` is the in-memory shape of one repo's full harness state. It is reused by the store, indexer, service, and AGENTS.md generator. Define it here and export it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/agents-md.spec.ts
import { describe, it, expect } from "vitest";
import { generateAgentsMd, AGENTS_MD_MARKER, type HarnessSnapshot } from "./agents-md";

const snapshot: HarnessSnapshot = {
  config: { name: "demo", description: "A demo repo", hardConstraints: ["never force-push main"] },
  agents: [{ id: "planner", role: "Planner", instructions: "Plan." }],
  features: [
    { id: "F01", behavior: "logs in", verification: "npm test", state: "active" },
    { id: "F02", behavior: "logs out", verification: "npm test", state: "passing", evidence: "abc" },
  ],
  progress: {
    updatedAt: "2026-06-04T00:00:00Z",
    completed: ["F02"], inProgress: ["F01"], blocked: [], nextSteps: ["wire api"],
  },
  decisions: [{ id: "D01", date: "2026-06-04", title: "Repo is truth", rationale: "Lecture 3." }],
};

describe("generateAgentsMd", () => {
  it("includes the generator marker", () => {
    expect(generateAgentsMd(snapshot)).toContain(AGENTS_MD_MARKER);
  });

  it("includes repo name, hard constraints, active feature, next steps", () => {
    const md = generateAgentsMd(snapshot);
    expect(md).toContain("# demo");
    expect(md).toContain("never force-push main");
    expect(md).toContain("F01");
    expect(md).toContain("wire api");
  });

  it("is deterministic (stable output for same input)", () => {
    expect(generateAgentsMd(snapshot)).toBe(generateAgentsMd(snapshot));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/agents-md.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/agents-md.ts
import type { Agent, Config, Decision, Feature, Progress } from "./schemas/index.js";

export const AGENTS_MD_MARKER = "<!-- generated by harness-manager -->";

export interface HarnessSnapshot {
  config: Config;
  agents: Agent[];
  features: Feature[];
  progress: Progress;
  decisions: Decision[];
}

export function generateAgentsMd(snapshot: HarnessSnapshot): string {
  const { config, agents, features, progress } = snapshot;
  const lines: string[] = [];

  lines.push(AGENTS_MD_MARKER);
  lines.push("<!-- do not hand-edit; regenerated by harness-manager -->");
  lines.push("");
  lines.push(`# ${config.name}`);
  if (config.description) {
    lines.push("");
    lines.push(config.description);
  }

  lines.push("");
  lines.push("## Hard Constraints");
  if (config.hardConstraints.length) {
    for (const c of config.hardConstraints) lines.push(`- ${c}`);
  } else {
    lines.push("_none_");
  }

  lines.push("");
  lines.push("## Agents");
  if (agents.length) {
    for (const a of agents) lines.push(`- **${a.id}** (${a.role})`);
  } else {
    lines.push("_none_");
  }

  const active = features.filter((f) => f.state === "active");
  lines.push("");
  lines.push("## Active Features");
  if (active.length) {
    for (const f of active) lines.push(`- **${f.id}**: ${f.behavior} — verify: \`${f.verification}\``);
  } else {
    lines.push("_none_");
  }

  lines.push("");
  lines.push("## Next Steps");
  if (progress.nextSteps.length) {
    for (const s of progress.nextSteps) lines.push(`- ${s}`);
  } else {
    lines.push("_none_");
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/agents-md.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./agents-md.js";
```

```bash
git add packages/core/src/agents-md.ts packages/core/src/agents-md.spec.ts packages/core/src/index.ts
git commit -m "feat(core): deterministic AGENTS.md generation"
```

### Task 3.2: Validators — WIP=1 + pass-state gating

**Files:**
- Create: `packages/core/src/validators.ts`
- Test: `packages/core/src/validators.spec.ts`

> These are pure decision functions returning structured results. The service layer turns them into warnings/errors. `checkWipLimit` answers "would activating this feature exceed WIP=1?" `assertPassEvidence` enforces that `passing` requires evidence.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/validators.spec.ts
import { describe, it, expect } from "vitest";
import { checkWipLimit, assertPassEvidence } from "./validators";
import type { Feature } from "../src/schemas/index";

const features: Feature[] = [
  { id: "F01", behavior: "a", verification: "t", state: "active" },
  { id: "F02", behavior: "b", verification: "t", state: "not_started" },
];

describe("checkWipLimit", () => {
  it("warns when activating a 2nd feature while one is active", () => {
    const result = checkWipLimit(features, "F02");
    expect(result.exceeds).toBe(true);
    expect(result.activeIds).toEqual(["F01"]);
  });

  it("does not warn when the feature being activated is already the active one", () => {
    expect(checkWipLimit(features, "F01").exceeds).toBe(false);
  });

  it("does not warn when nothing else is active", () => {
    const none: Feature[] = [{ id: "F03", behavior: "c", verification: "t", state: "not_started" }];
    expect(checkWipLimit(none, "F03").exceeds).toBe(false);
  });
});

describe("assertPassEvidence", () => {
  it("throws when evidence is missing/empty", () => {
    expect(() => assertPassEvidence("F01", undefined)).toThrow(/evidence/i);
    expect(() => assertPassEvidence("F01", "   ")).toThrow(/evidence/i);
  });

  it("passes when evidence present", () => {
    expect(() => assertPassEvidence("F01", "commit abc123")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/validators.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/validators.ts
import type { Feature } from "./schemas/index.js";
import { HarnessError } from "./errors.js";

export interface WipCheck {
  exceeds: boolean;
  activeIds: string[];
}

/** Returns whether activating `targetId` would exceed WIP=1 (Lecture 7). */
export function checkWipLimit(features: Feature[], targetId: string): WipCheck {
  const activeIds = features.filter((f) => f.state === "active" && f.id !== targetId).map((f) => f.id);
  return { exceeds: activeIds.length > 0, activeIds };
}

/** Pass-state gating (Lecture 8): a feature may only become `passing` with evidence. */
export function assertPassEvidence(featureId: string, evidence: string | undefined): void {
  if (!evidence || evidence.trim() === "") {
    throw new HarnessError({
      path: ".harness/features.json",
      message: `feature ${featureId} cannot be set 'passing' without evidence`,
      fix: "Provide a commit hash or test-log reference as evidence, then retry.",
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/validators.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Export + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./validators.js";
```

```bash
git add packages/core/src/validators.ts packages/core/src/validators.spec.ts packages/core/src/index.ts
git commit -m "feat(core): WIP=1 and pass-state gating validators"
```

---

## Phase 4 — `core`: store (filesystem I/O) + db (Prisma index) + service

### Task 4.1: Prisma schema + client singleton

**Files:**
- Create: `prisma/schema.prisma`
- Create: `packages/core/src/db/client.ts`

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("HARNESS_DB_URL")
}

model Repo {
  id                String     @id @default(cuid())
  name              String
  path              String     @unique
  langfuseProjectId String?
  features          Feature[]
  agents            Agent[]
  decisions         Decision[]
  progress          Progress?
  sessions          Session[]
  indexedAt         DateTime?
}

model Feature {
  id           String  @id @default(cuid())
  repoId       String
  repo         Repo    @relation(fields: [repoId], references: [id], onDelete: Cascade)
  featureId    String
  behavior     String
  verification String
  state        String
  evidence     String?
  @@unique([repoId, featureId])
}

model Agent {
  id           String @id @default(cuid())
  repoId       String
  repo         Repo   @relation(fields: [repoId], references: [id], onDelete: Cascade)
  agentId      String
  role         String
  model        String?
  tools        String?  // JSON-encoded string[]
  instructions String
  @@unique([repoId, agentId])
}

model Decision {
  id         String @id @default(cuid())
  repoId     String
  repo       Repo   @relation(fields: [repoId], references: [id], onDelete: Cascade)
  decisionId String
  date       String
  title      String
  rationale  String
  rejected   String?
  @@unique([repoId, decisionId])
}

model Progress {
  id            String  @id @default(cuid())
  repoId        String  @unique
  repo          Repo    @relation(fields: [repoId], references: [id], onDelete: Cascade)
  currentCommit String?
  testStatus    String?
  updatedAt     String
  completed     String  // JSON-encoded string[]
  inProgress    String
  blocked       String
  nextSteps     String
}

model Session {
  id              String   @id @default(cuid())
  repoId          String
  repo            Repo     @relation(fields: [repoId], references: [id], onDelete: Cascade)
  langfuseTraceId String?
  startedAt       DateTime
  endedAt         DateTime?
  summary         String?
}
```

- [ ] **Step 2: Generate client + create dev db**

Run: `npx prisma generate`
Then: `$env:HARNESS_DB_URL="file:./prisma/dev.db"; npx prisma db push`
Expected: client generated; `prisma/dev.db` created with all tables.

- [ ] **Step 3: Create `packages/core/src/db/client.ts`**

```ts
// packages/core/src/db/client.ts
import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

/** Lazy singleton. Accepts an override URL for tests (temp db files). */
export function getPrisma(databaseUrl?: string): PrismaClient {
  if (databaseUrl) {
    return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }
  if (!client) client = new PrismaClient();
  return client;
}
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma packages/core/src/db/client.ts
git commit -m "feat(core): Prisma SQLite schema + client singleton"
```

### Task 4.2: RepoStore — read/write `.harness/` (filesystem I/O)

**Files:**
- Create: `packages/core/src/store/repo-store.ts`
- Test: `packages/core/src/store/repo-store.spec.ts`

> RepoStore owns ALL filesystem access for a repo. It reads a full `HarnessSnapshot` from `.harness/`, and writes individual artifacts with atomic writes (temp file + rename). It regenerates `AGENTS.md` after every write. Missing files yield sensible empty defaults so a freshly-init'd repo reads cleanly.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/store/repo-store.spec.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoStore } from "./repo-store";
import { AGENTS_MD_MARKER } from "../agents-md";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "hm-store-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("RepoStore", () => {
  it("scaffolds .harness + AGENTS.md on init", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: [] });
    const agentsMd = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain(AGENTS_MD_MARKER);
    const snap = await store.read();
    expect(snap.config.name).toBe("demo");
    expect(snap.features).toEqual([]);
  });

  it("writes a feature atomically and round-trips through read", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeFeatures([
      { id: "F01", behavior: "b", verification: "npm test", state: "active" },
    ]);
    const snap = await store.read();
    expect(snap.features[0]?.id).toBe("F01");
  });

  it("regenerates AGENTS.md after a write", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: ["no force push"] });
    await store.writeFeatures([{ id: "F01", behavior: "b", verification: "t", state: "active" }]);
    const agentsMd = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("F01");
    expect(agentsMd).toContain("no force push");
  });

  it("reads agents from agents/ directory", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: [] });
    await mkdir(join(dir, ".harness", "agents"), { recursive: true });
    await writeFile(join(dir, ".harness", "agents", "planner.md"), "---\nrole: Planner\n---\nPlan.", "utf8");
    const snap = await store.read();
    expect(snap.agents.map((a) => a.id)).toContain("planner");
  });

  it("throws HarnessError when .harness missing on read", async () => {
    const store = new RepoStore(dir);
    await expect(store.read()).rejects.toThrow(/harness_init/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/store/repo-store.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/store/repo-store.ts
import { readFile, writeFile, mkdir, readdir, rename, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";
import { parseConfig, serializeConfig } from "../codec/config.js";
import { parseFeatures, serializeFeatures } from "../codec/feature.js";
import { parseAgent, serializeAgent } from "../codec/agent.js";
import { parseProgress, serializeProgress } from "../codec/progress.js";
import { parseDecisions, serializeDecisions } from "../codec/decision.js";
import { generateAgentsMd, type HarnessSnapshot } from "../agents-md.js";
import { HarnessError } from "../errors.js";

const EMPTY_PROGRESS: Progress = {
  updatedAt: "1970-01-01T00:00:00Z",
  completed: [], inProgress: [], blocked: [], nextSteps: [],
};

export class RepoStore {
  constructor(private readonly repoPath: string) {}

  private get harnessDir(): string { return join(this.repoPath, ".harness"); }
  private file(name: string): string { return join(this.harnessDir, name); }

  private async exists(p: string): Promise<boolean> {
    try { await access(p); return true; } catch { return false; }
  }

  /** Atomic write: temp file in same dir + rename. */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = join(dirname(filePath), `.${randomUUID()}.tmp`);
    await writeFile(tmp, content, "utf8");
    await rename(tmp, filePath);
  }

  async init(config: Config): Promise<void> {
    await mkdir(join(this.harnessDir, "agents"), { recursive: true });
    await this.atomicWrite(this.file("config.json"), serializeConfig(config));
    await this.atomicWrite(this.file("features.json"), serializeFeatures([]));
    await this.atomicWrite(this.file("progress.md"), serializeProgress({ ...EMPTY_PROGRESS }));
    await this.atomicWrite(this.file("decisions.md"), serializeDecisions([]));
    await this.regenerateAgentsMd();
  }

  async read(): Promise<HarnessSnapshot> {
    if (!(await this.exists(this.harnessDir))) {
      throw new HarnessError({
        path: this.harnessDir,
        message: "no .harness directory found",
        fix: "Run harness_init to scaffold this repo.",
      });
    }
    const config = parseConfig(await readFile(this.file("config.json"), "utf8"));
    const features = (await this.exists(this.file("features.json")))
      ? parseFeatures(await readFile(this.file("features.json"), "utf8"))
      : [];
    const progress = (await this.exists(this.file("progress.md")))
      ? parseProgress(await readFile(this.file("progress.md"), "utf8"))
      : { ...EMPTY_PROGRESS };
    const decisions = (await this.exists(this.file("decisions.md")))
      ? parseDecisions(await readFile(this.file("decisions.md"), "utf8"))
      : [];
    const agents = await this.readAgents();
    return { config, features, progress, decisions, agents };
  }

  private async readAgents(): Promise<Agent[]> {
    const agentsDir = join(this.harnessDir, "agents");
    if (!(await this.exists(agentsDir))) return [];
    const files = (await readdir(agentsDir)).filter((f) => f.endsWith(".md")).sort();
    const agents: Agent[] = [];
    for (const file of files) {
      const fileId = file.replace(/\.md$/, "");
      agents.push(parseAgent(await readFile(join(agentsDir, file), "utf8"), fileId));
    }
    return agents;
  }

  async writeConfig(config: Config): Promise<void> {
    await this.atomicWrite(this.file("config.json"), serializeConfig(config));
    await this.regenerateAgentsMd();
  }

  async writeFeatures(features: Feature[]): Promise<void> {
    await this.atomicWrite(this.file("features.json"), serializeFeatures(features));
    await this.regenerateAgentsMd();
  }

  async writeProgress(progress: Progress): Promise<void> {
    await this.atomicWrite(this.file("progress.md"), serializeProgress(progress));
    await this.regenerateAgentsMd();
  }

  async writeDecisions(decisions: Decision[]): Promise<void> {
    await this.atomicWrite(this.file("decisions.md"), serializeDecisions(decisions));
    await this.regenerateAgentsMd();
  }

  async writeAgent(agent: Agent): Promise<void> {
    await this.atomicWrite(join(this.harnessDir, "agents", `${agent.id}.md`), serializeAgent(agent));
    await this.regenerateAgentsMd();
  }

  private async regenerateAgentsMd(): Promise<void> {
    const snapshot = await this.read();
    await this.atomicWrite(join(this.repoPath, "AGENTS.md"), generateAgentsMd(snapshot));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/store/repo-store.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Export + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./store/repo-store.js";
```

```bash
git add packages/core/src/store packages/core/src/index.ts
git commit -m "feat(core): RepoStore filesystem I/O with atomic writes + AGENTS.md regen"
```

### Task 4.3: Indexer — upsert a snapshot into SQLite

**Files:**
- Create: `packages/core/src/db/indexer.ts`
- Test: `packages/core/src/db/indexer.spec.ts`

> The indexer takes a `repoId` + `HarnessSnapshot` and replaces that repo's cached rows. Arrays (`tools`, progress lists) are JSON-encoded into String columns. Tests use a temp SQLite file via `getPrisma(url)` and run `prisma db push` against it in a `beforeAll`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/db/indexer.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma } from "./client";
import { indexSnapshot } from "./indexer";
import type { HarnessSnapshot } from "../agents-md";

let dir: string;
let dbUrl: string;
let prisma: ReturnType<typeof getPrisma>;

const snapshot: HarnessSnapshot = {
  config: { name: "demo", hardConstraints: [] },
  agents: [{ id: "planner", role: "Planner", tools: ["read"], instructions: "Plan." }],
  features: [{ id: "F01", behavior: "b", verification: "t", state: "active" }],
  progress: { updatedAt: "2026-06-04T00:00:00Z", completed: ["F0"], inProgress: ["F01"], blocked: [], nextSteps: ["x"] },
  decisions: [{ id: "D01", date: "2026-06-04", title: "t", rationale: "r" }],
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hm-idx-"));
  dbUrl = `file:${join(dir, "test.db")}`;
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore",
  });
  prisma = getPrisma(dbUrl);
});
afterAll(async () => { await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); });

describe("indexSnapshot", () => {
  it("upserts repo, features, agents, decisions, progress", async () => {
    const repo = await prisma.repo.create({ data: { name: "demo", path: dir } });
    await indexSnapshot(prisma, repo.id, snapshot);

    expect(await prisma.feature.count({ where: { repoId: repo.id } })).toBe(1);
    expect(await prisma.agent.count({ where: { repoId: repo.id } })).toBe(1);
    const progress = await prisma.progress.findUnique({ where: { repoId: repo.id } });
    expect(JSON.parse(progress!.inProgress)).toEqual(["F01"]);
    const agent = await prisma.agent.findFirst({ where: { repoId: repo.id } });
    expect(JSON.parse(agent!.tools!)).toEqual(["read"]);
  });

  it("replaces stale rows (re-index is idempotent)", async () => {
    const repo = await prisma.repo.create({ data: { name: "demo2", path: dir + "2" } });
    await indexSnapshot(prisma, repo.id, snapshot);
    await indexSnapshot(prisma, repo.id, { ...snapshot, features: [] });
    expect(await prisma.feature.count({ where: { repoId: repo.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/db/indexer.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/db/indexer.ts
import type { PrismaClient } from "@prisma/client";
import type { HarnessSnapshot } from "../agents-md.js";

/** Replace the cached rows for one repo with the given snapshot. Idempotent. */
export async function indexSnapshot(
  prisma: PrismaClient,
  repoId: string,
  snapshot: HarnessSnapshot,
): Promise<void> {
  await prisma.$transaction([
    prisma.feature.deleteMany({ where: { repoId } }),
    prisma.agent.deleteMany({ where: { repoId } }),
    prisma.decision.deleteMany({ where: { repoId } }),
    prisma.progress.deleteMany({ where: { repoId } }),

    prisma.feature.createMany({
      data: snapshot.features.map((f) => ({
        repoId, featureId: f.id, behavior: f.behavior, verification: f.verification,
        state: f.state, evidence: f.evidence ?? null,
      })),
    }),
    prisma.agent.createMany({
      data: snapshot.agents.map((a) => ({
        repoId, agentId: a.id, role: a.role, model: a.model ?? null,
        tools: a.tools ? JSON.stringify(a.tools) : null, instructions: a.instructions,
      })),
    }),
    prisma.decision.createMany({
      data: snapshot.decisions.map((d) => ({
        repoId, decisionId: d.id, date: d.date, title: d.title,
        rationale: d.rationale, rejected: d.rejected ?? null,
      })),
    }),
    prisma.progress.create({
      data: {
        repoId,
        currentCommit: snapshot.progress.currentCommit ?? null,
        testStatus: snapshot.progress.testStatus ?? null,
        updatedAt: snapshot.progress.updatedAt,
        completed: JSON.stringify(snapshot.progress.completed),
        inProgress: JSON.stringify(snapshot.progress.inProgress),
        blocked: JSON.stringify(snapshot.progress.blocked),
        nextSteps: JSON.stringify(snapshot.progress.nextSteps),
      },
    }),
    prisma.repo.update({ where: { id: repoId }, data: { name: snapshot.config.name, langfuseProjectId: snapshot.config.langfuseProjectId ?? null } }),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/db/indexer.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Export + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./db/client.js";
export * from "./db/indexer.js";
```

```bash
git add packages/core/src/db packages/core/src/index.ts
git commit -m "feat(core): SQLite indexer (snapshot upsert, idempotent)"
```

### Task 4.4: HarnessService — orchestration shared by mcp + api

**Files:**
- Create: `packages/core/src/service/harness-service.ts`
- Test: `packages/core/src/service/harness-service.spec.ts`

> `HarnessService` is the single API both transports call. It composes `RepoStore` + `indexer` + validators. Read methods read files then index. Write methods write file (canonical) → re-read → index → (AGENTS.md already regenerated by store). It resolves a repo row by path (auto-registering on first touch).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/service/harness-service.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma } from "../db/client";
import { HarnessService } from "./harness-service";

let workDir: string;
let dbUrl: string;
let prisma: ReturnType<typeof getPrisma>;
let service: HarnessService;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-svc-"));
  dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  service = new HarnessService(prisma);
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });
beforeEach(async () => { repoPath = await mkdtemp(join(workDir, "repo-")); });

describe("HarnessService", () => {
  it("init scaffolds, auto-registers the repo, and indexes", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    const repo = await prisma.repo.findUnique({ where: { path: repoPath } });
    expect(repo?.name).toBe("demo");
    const ctx = await service.getContext(repoPath);
    expect(ctx.config.name).toBe("demo");
  });

  it("updateFeature warns when activating a 2nd feature (WIP=1)", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    await service.upsertFeature(repoPath, { id: "F01", behavior: "a", verification: "t", state: "active" });
    const res = await service.upsertFeature(repoPath, { id: "F02", behavior: "b", verification: "t", state: "active" });
    expect(res.warnings.some((w) => /WIP/.test(w))).toBe(true);
  });

  it("setFeaturePassing rejects without evidence and accepts with it", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    await service.upsertFeature(repoPath, { id: "F01", behavior: "a", verification: "t", state: "active" });
    await expect(service.setFeaturePassing(repoPath, "F01", "")).rejects.toThrow(/evidence/i);
    await service.setFeaturePassing(repoPath, "F01", "commit abc123");
    const ctx = await service.getContext(repoPath);
    expect(ctx.features.find((f) => f.id === "F01")?.state).toBe("passing");
  });

  it("addDecision appends and indexes", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    await service.addDecision(repoPath, { id: "D01", date: "2026-06-04", title: "t", rationale: "r" });
    const ctx = await service.getContext(repoPath);
    expect(ctx.decisions.map((d) => d.id)).toContain("D01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/service/harness-service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/service/harness-service.ts
import type { PrismaClient } from "@prisma/client";
import type { Agent, Config, Decision, Feature, FeatureState } from "../schemas/index.js";
import type { HarnessSnapshot } from "../agents-md.js";
import { RepoStore } from "../store/repo-store.js";
import { indexSnapshot } from "../db/indexer.js";
import { checkWipLimit, assertPassEvidence } from "../validators.js";
import { HarnessError } from "../errors.js";

export interface WriteResult {
  snapshot: HarnessSnapshot;
  warnings: string[];
}

export class HarnessService {
  constructor(private readonly prisma: PrismaClient) {}

  private store(repoPath: string): RepoStore {
    return new RepoStore(repoPath);
  }

  /** Find-or-create the repo row for a path. */
  private async resolveRepoId(repoPath: string, name?: string): Promise<string> {
    const existing = await this.prisma.repo.findUnique({ where: { path: repoPath } });
    if (existing) return existing.id;
    const created = await this.prisma.repo.create({ data: { name: name ?? repoPath, path: repoPath } });
    return created.id;
  }

  private async reindex(repoPath: string): Promise<HarnessSnapshot> {
    const snapshot = await this.store(repoPath).read();
    const repoId = await this.resolveRepoId(repoPath, snapshot.config.name);
    await indexSnapshot(this.prisma, repoId, snapshot);
    return snapshot;
  }

  async init(repoPath: string, config: Config): Promise<HarnessSnapshot> {
    await this.store(repoPath).init(config);
    return this.reindex(repoPath);
  }

  async getContext(repoPath: string): Promise<HarnessSnapshot> {
    return this.reindex(repoPath);
  }

  async upsertFeature(repoPath: string, feature: Feature): Promise<WriteResult> {
    if (feature.state === "passing") {
      throw new HarnessError({
        path: ".harness/features.json",
        message: `feature ${feature.id} cannot be set 'passing' via upsertFeature`,
        fix: "Use set_feature_passing with evidence instead.",
      });
    }
    const snap = await this.store(repoPath).read();
    const warnings: string[] = [];
    if (feature.state === "active") {
      const wip = checkWipLimit(snap.features, feature.id);
      if (wip.exceeds) {
        warnings.push(`WIP=1: feature(s) ${wip.activeIds.join(", ")} already active. Finish or block them before starting ${feature.id}.`);
      }
    }
    const next = upsertById(snap.features, feature);
    await this.store(repoPath).writeFeatures(next);
    const snapshot = await this.reindex(repoPath);
    return { snapshot, warnings };
  }

  async setFeaturePassing(repoPath: string, featureId: string, evidence: string): Promise<WriteResult> {
    assertPassEvidence(featureId, evidence);
    const snap = await this.store(repoPath).read();
    const target = snap.features.find((f) => f.id === featureId);
    if (!target) {
      throw new HarnessError({
        path: ".harness/features.json",
        message: `feature ${featureId} not found`,
        fix: "Create the feature with update_feature first.",
      });
    }
    const next = upsertById(snap.features, { ...target, state: "passing" as FeatureState, evidence });
    await this.store(repoPath).writeFeatures(next);
    const snapshot = await this.reindex(repoPath);
    return { snapshot, warnings: [] };
  }

  async updateProgress(repoPath: string, progress: HarnessSnapshot["progress"]): Promise<WriteResult> {
    await this.store(repoPath).writeProgress(progress);
    return { snapshot: await this.reindex(repoPath), warnings: [] };
  }

  async addDecision(repoPath: string, decision: Decision): Promise<WriteResult> {
    const snap = await this.store(repoPath).read();
    await this.store(repoPath).writeDecisions([...snap.decisions, decision]);
    return { snapshot: await this.reindex(repoPath), warnings: [] };
  }

  async upsertAgent(repoPath: string, agent: Agent): Promise<WriteResult> {
    await this.store(repoPath).writeAgent(agent);
    return { snapshot: await this.reindex(repoPath), warnings: [] };
  }
}

function upsertById(features: Feature[], feature: Feature): Feature[] {
  const idx = features.findIndex((f) => f.id === feature.id);
  if (idx === -1) return [...features, feature];
  const copy = [...features];
  copy[idx] = feature;
  return copy;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/service/harness-service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export + run full core suite + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./service/harness-service.js";
```

Run: `npx vitest run packages/core`
Expected: all core specs PASS.

```bash
git add packages/core/src/service packages/core/src/index.ts
git commit -m "feat(core): HarnessService orchestration (store + index + validators)"
```

---

## Phase 5 — `mcp`: stdio MCP server

### Task 5.1: `mcp` package skeleton + tracing no-op

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/vitest.config.ts`
- Create: `packages/mcp/src/tracing.ts`
- Test: `packages/mcp/src/tracing.spec.ts`

- [ ] **Step 1: Create `packages/mcp/package.json`**

```json
{
  "name": "@harness/mcp",
  "version": "0.0.0",
  "type": "module",
  "bin": { "harness-mcp": "src/index.ts" },
  "dependencies": {
    "@harness/core": "*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "langfuse": "^3.30.0",
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 2: Create `packages/mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `packages/mcp/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "mcp", environment: "node", include: ["src/**/*.spec.ts"] },
});
```

- [ ] **Step 4: Write the failing tracing test**

```ts
// packages/mcp/src/tracing.spec.ts
import { describe, it, expect } from "vitest";
import { createTracer } from "./tracing";

describe("createTracer (no-op when unconfigured)", () => {
  it("returns a tracer that no-ops without keys", async () => {
    const tracer = createTracer({});
    const session = tracer.startSession("repo-1", "proj");
    const span = session.span("harness_get_context", { repoPath: "/x" });
    span.end({ ok: true });
    await session.end({ clean_state: "pass" });
    expect(session.traceId).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm install` then `npx vitest run packages/mcp/src/tracing.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Write the implementation**

```ts
// packages/mcp/src/tracing.ts
import { Langfuse } from "langfuse";

export interface TracerEnv {
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
}

export interface Span {
  end(output: unknown): void;
}

export interface Session {
  readonly traceId: string | undefined;
  span(name: string, input: unknown): Span;
  end(scores?: Record<string, string>): Promise<void>;
}

export interface Tracer {
  startSession(repoName: string, projectId?: string): Session;
}

const NOOP_SPAN: Span = { end() {} };

/** Build a tracer. Missing keys => every method is a silent no-op (spec §6). */
export function createTracer(env: TracerEnv): Tracer {
  const enabled = Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
  if (!enabled) {
    return {
      startSession() {
        return {
          traceId: undefined,
          span: () => NOOP_SPAN,
          async end() {},
        };
      },
    };
  }

  const client = new Langfuse({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_HOST,
  });

  return {
    startSession(repoName, projectId) {
      const trace = client.trace({ name: `session:${repoName}`, metadata: { projectId } });
      return {
        traceId: trace.id,
        span(name, input) {
          const span = trace.span({ name, input });
          return { end: (output) => span.end({ output }) };
        },
        async end(scores) {
          if (scores) for (const [name, value] of Object.entries(scores)) trace.score({ name, value });
          await client.flushAsync();
        },
      };
    },
  };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run packages/mcp/src/tracing.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp package-lock.json
git commit -m "feat(mcp): package skeleton + Langfuse tracer (no-op when unconfigured)"
```

### Task 5.2: Build MCP server with read + write tools

**Files:**
- Create: `packages/mcp/src/server.ts`
- Create: `packages/mcp/src/index.ts`
- Test: `packages/mcp/src/server.spec.ts`

> The server wires `HarnessService` + tracer to MCP tool handlers. Tools are tested by calling the registered handler functions directly against a temp repo + temp SQLite (no stdio transport in tests). We expose `buildToolHandlers(service, tracer)` returning a map of `name -> (args) => Promise<{ content, isError? }>` so it is unit-testable, and `server.ts` registers them onto an `McpServer`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/mcp/src/server.spec.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma, HarnessService } from "@harness/core";
import { createTracer } from "./tracing";
import { buildToolHandlers } from "./server";

let workDir: string;
let prisma: ReturnType<typeof getPrisma>;
let handlers: ReturnType<typeof buildToolHandlers>;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-mcp-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  handlers = buildToolHandlers(new HarnessService(prisma), createTracer({}));
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });
beforeEach(async () => { repoPath = await mkdtemp(join(workDir, "repo-")); });

describe("MCP tool handlers", () => {
  it("harness_init then harness_get_context returns overview text", async () => {
    await handlers.harness_init({ repoPath, name: "demo", hardConstraints: [] });
    const ctx = await handlers.harness_get_context({ repoPath });
    expect(ctx.isError).toBeFalsy();
    expect(JSON.stringify(ctx.content)).toContain("demo");
  });

  it("harness_set_feature_passing without evidence returns an agent-oriented error", async () => {
    await handlers.harness_init({ repoPath, name: "demo", hardConstraints: [] });
    await handlers.harness_update_feature({ repoPath, id: "F01", behavior: "a", verification: "t", state: "active" });
    const res = await handlers.harness_set_feature_passing({ repoPath, id: "F01", evidence: "" });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/evidence/i);
  });

  it("harness_update_feature surfaces WIP=1 warning in the result", async () => {
    await handlers.harness_init({ repoPath, name: "demo", hardConstraints: [] });
    await handlers.harness_update_feature({ repoPath, id: "F01", behavior: "a", verification: "t", state: "active" });
    const res = await handlers.harness_update_feature({ repoPath, id: "F02", behavior: "b", verification: "t", state: "active" });
    expect(JSON.stringify(res.content)).toMatch(/WIP/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/mcp/src/server.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/mcp/src/server.ts`**

```ts
// packages/mcp/src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HarnessError, type HarnessService } from "@harness/core";
import type { Tracer } from "./tracing.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type Handler = (args: any) => Promise<ToolResult>;

function ok(data: unknown, warnings: string[] = []): ToolResult {
  const payload = warnings.length ? { warnings, data } : data;
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const text = error instanceof HarnessError ? error.message
    : error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text }], isError: true };
}

/** Pure map of tool name -> handler, so tools are unit-testable without stdio. */
export function buildToolHandlers(service: HarnessService, _tracer: Tracer): Record<string, Handler> {
  return {
    async harness_init(a) {
      try {
        const snap = await service.init(a.repoPath, { name: a.name, description: a.description, hardConstraints: a.hardConstraints ?? [] });
        return ok(snap);
      } catch (e) { return fail(e); }
    },
    async harness_get_context(a) {
      try { return ok(await service.getContext(a.repoPath)); } catch (e) { return fail(e); }
    },
    async harness_list_features(a) {
      try {
        const snap = await service.getContext(a.repoPath);
        const features = a.state ? snap.features.filter((f) => f.state === a.state) : snap.features;
        return ok(features);
      } catch (e) { return fail(e); }
    },
    async harness_list_decisions(a) {
      try { return ok((await service.getContext(a.repoPath)).decisions); } catch (e) { return fail(e); }
    },
    async harness_get_progress(a) {
      try { return ok((await service.getContext(a.repoPath)).progress); } catch (e) { return fail(e); }
    },
    async harness_update_feature(a) {
      try {
        const res = await service.upsertFeature(a.repoPath, {
          id: a.id, behavior: a.behavior, verification: a.verification, state: a.state, evidence: a.evidence,
        });
        return ok(res.snapshot.features.find((f) => f.id === a.id), res.warnings);
      } catch (e) { return fail(e); }
    },
    async harness_set_feature_passing(a) {
      try {
        const res = await service.setFeaturePassing(a.repoPath, a.id, a.evidence);
        return ok(res.snapshot.features.find((f) => f.id === a.id));
      } catch (e) { return fail(e); }
    },
    async harness_update_progress(a) {
      try {
        const res = await service.updateProgress(a.repoPath, {
          currentCommit: a.currentCommit, testStatus: a.testStatus, updatedAt: a.updatedAt,
          completed: a.completed ?? [], inProgress: a.inProgress ?? [], blocked: a.blocked ?? [], nextSteps: a.nextSteps ?? [],
        });
        return ok(res.snapshot.progress);
      } catch (e) { return fail(e); }
    },
    async harness_add_decision(a) {
      try {
        const res = await service.addDecision(a.repoPath, { id: a.id, date: a.date, title: a.title, rationale: a.rationale, rejected: a.rejected });
        return ok(res.snapshot.decisions);
      } catch (e) { return fail(e); }
    },
    async harness_upsert_agent(a) {
      try {
        const res = await service.upsertAgent(a.repoPath, { id: a.id, role: a.role, model: a.model, tools: a.tools, instructions: a.instructions });
        return ok(res.snapshot.agents.find((ag) => ag.id === a.id));
      } catch (e) { return fail(e); }
    },
    async harness_handoff(a) {
      try {
        const res = await service.updateProgress(a.repoPath, {
          currentCommit: a.currentCommit, testStatus: a.testStatus, updatedAt: a.updatedAt,
          completed: a.completed ?? [], inProgress: a.inProgress ?? [], blocked: a.blocked ?? [], nextSteps: a.nextSteps ?? [],
        });
        const active = res.snapshot.features.filter((f) => f.state === "active").map((f) => f.id);
        const warnings = active.length ? [`Clean-state check: feature(s) ${active.join(", ")} still active at handoff.`] : [];
        return ok({ summary: a.summary ?? null, progress: res.snapshot.progress }, warnings);
      } catch (e) { return fail(e); }
    },
  };
}

const repoArg = { repoPath: z.string().describe("Absolute path to the repo workspace") };

/** Register handlers onto an McpServer with Zod input schemas. */
export function registerTools(server: McpServer, handlers: Record<string, Handler>): void {
  const def = (name: string, schema: z.ZodRawShape) =>
    server.tool(name, schema, async (args) => handlers[name]!(args));

  def("harness_init", { ...repoArg, name: z.string(), description: z.string().optional(), hardConstraints: z.array(z.string()).optional() });
  def("harness_get_context", { ...repoArg });
  def("harness_list_features", { ...repoArg, state: z.enum(["not_started", "active", "blocked", "passing"]).optional() });
  def("harness_list_decisions", { ...repoArg });
  def("harness_get_progress", { ...repoArg });
  def("harness_update_feature", { ...repoArg, id: z.string(), behavior: z.string(), verification: z.string(), state: z.enum(["not_started", "active", "blocked"]), evidence: z.string().optional() });
  def("harness_set_feature_passing", { ...repoArg, id: z.string(), evidence: z.string() });
  def("harness_update_progress", { ...repoArg, updatedAt: z.string(), currentCommit: z.string().optional(), testStatus: z.string().optional(), completed: z.array(z.string()).optional(), inProgress: z.array(z.string()).optional(), blocked: z.array(z.string()).optional(), nextSteps: z.array(z.string()).optional() });
  def("harness_add_decision", { ...repoArg, id: z.string(), date: z.string(), title: z.string(), rationale: z.string(), rejected: z.string().optional() });
  def("harness_upsert_agent", { ...repoArg, id: z.string(), role: z.string(), model: z.string().optional(), tools: z.array(z.string()).optional(), instructions: z.string() });
  def("harness_handoff", { ...repoArg, updatedAt: z.string(), summary: z.string().optional(), currentCommit: z.string().optional(), testStatus: z.string().optional(), completed: z.array(z.string()).optional(), inProgress: z.array(z.string()).optional(), blocked: z.array(z.string()).optional(), nextSteps: z.array(z.string()).optional() });
}
```

> Note: `harness_update_feature`'s `state` enum deliberately omits `passing` — pass-state gating (spec §5) forces agents through `harness_set_feature_passing`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/mcp/src/server.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the stdio entrypoint `packages/mcp/src/index.ts`**

```ts
// packages/mcp/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getPrisma, HarnessService } from "@harness/core";
import { createTracer } from "./tracing.js";
import { buildToolHandlers, registerTools } from "./server.js";

async function main(): Promise<void> {
  const service = new HarnessService(getPrisma());
  const tracer = createTracer(process.env);
  const handlers = buildToolHandlers(service, tracer);

  const server = new McpServer({ name: "harness-manager", version: "0.0.0" });
  registerTools(server, handlers);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`harness-mcp fatal: ${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/src
git commit -m "feat(mcp): MCP server with read/write tools, WIP + pass-gating enforced"
```

### Task 5.3: Wire tracing into handlers (session per get_context, span per tool)

**Files:**
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/mcp/src/tracing-integration.spec.ts`

> Add a session registry keyed by `repoPath`: `harness_get_context` starts a session (clock-in); subsequent tools add spans; `harness_handoff` ends it (clock-out) with a `clean_state` score and persists a `sessions` row. Tracing failures must never break a tool (silent no-op).

- [ ] **Step 1: Write the failing test**

```ts
// packages/mcp/src/tracing-integration.spec.ts
import { describe, it, expect, vi } from "vitest";
import type { Tracer, Session, Span } from "./tracing";

// We assert the handler wiring CALLS the tracer, using a spy tracer.
import { buildToolHandlers } from "./server";

describe("tracing wiring", () => {
  it("calls startSession on get_context and span.end on subsequent tools", async () => {
    const span: Span = { end: vi.fn() };
    const session: Session = { traceId: "trace-1", span: vi.fn(() => span), end: vi.fn(async () => {}) };
    const tracer: Tracer = { startSession: vi.fn(() => session) };

    // Minimal fake service: just enough surface for the two calls.
    const service: any = {
      getContext: vi.fn(async () => ({ config: { name: "demo", hardConstraints: [] }, agents: [], features: [], decisions: [], progress: { updatedAt: "t", completed: [], inProgress: [], blocked: [], nextSteps: [] } })),
    };

    const handlers = buildToolHandlers(service, tracer);
    await handlers.harness_get_context({ repoPath: "/x" });
    expect(tracer.startSession).toHaveBeenCalledTimes(1);

    await handlers.harness_list_features({ repoPath: "/x" });
    expect(session.span).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/mcp/src/tracing-integration.spec.ts`
Expected: FAIL — current `buildToolHandlers` ignores the tracer.

- [ ] **Step 3: Modify `buildToolHandlers` to use the tracer**

Replace the `buildToolHandlers` signature body opening with a session registry and wrap each handler. Change the function so it tracks sessions and records spans:

```ts
// packages/mcp/src/server.ts  (replace the buildToolHandlers function)
export function buildToolHandlers(service: HarnessService, tracer: Tracer): Record<string, Handler> {
  const sessions = new Map<string, Session>();

  const session = (repoPath: string): Session | undefined => sessions.get(repoPath);

  /** Wrap a raw handler so it emits a span on the repo's active session (if any). */
  const traced = (name: string, fn: Handler): Handler => async (a) => {
    const sess = session(a.repoPath);
    const span = sess ? sess.span(name, a) : undefined;
    const result = await fn(a);
    try { span?.end({ isError: result.isError ?? false }); } catch { /* tracing must never break tools */ }
    return result;
  };

  const raw: Record<string, Handler> = {
    async harness_init(a) {
      try {
        const snap = await service.init(a.repoPath, { name: a.name, description: a.description, hardConstraints: a.hardConstraints ?? [] });
        return ok(snap);
      } catch (e) { return fail(e); }
    },
    async harness_get_context(a) {
      try {
        const snap = await service.getContext(a.repoPath);
        try { sessions.set(a.repoPath, tracer.startSession(snap.config.name, snap.config.langfuseProjectId)); } catch { /* no-op */ }
        return ok(snap);
      } catch (e) { return fail(e); }
    },
    async harness_list_features(a) {
      try {
        const snap = await service.getContext(a.repoPath);
        const features = a.state ? snap.features.filter((f) => f.state === a.state) : snap.features;
        return ok(features);
      } catch (e) { return fail(e); }
    },
    async harness_list_decisions(a) {
      try { return ok((await service.getContext(a.repoPath)).decisions); } catch (e) { return fail(e); }
    },
    async harness_get_progress(a) {
      try { return ok((await service.getContext(a.repoPath)).progress); } catch (e) { return fail(e); }
    },
    async harness_update_feature(a) {
      try {
        const res = await service.upsertFeature(a.repoPath, { id: a.id, behavior: a.behavior, verification: a.verification, state: a.state, evidence: a.evidence });
        return ok(res.snapshot.features.find((f) => f.id === a.id), res.warnings);
      } catch (e) { return fail(e); }
    },
    async harness_set_feature_passing(a) {
      try {
        const res = await service.setFeaturePassing(a.repoPath, a.id, a.evidence);
        return ok(res.snapshot.features.find((f) => f.id === a.id));
      } catch (e) { return fail(e); }
    },
    async harness_update_progress(a) {
      try {
        const res = await service.updateProgress(a.repoPath, { currentCommit: a.currentCommit, testStatus: a.testStatus, updatedAt: a.updatedAt, completed: a.completed ?? [], inProgress: a.inProgress ?? [], blocked: a.blocked ?? [], nextSteps: a.nextSteps ?? [] });
        return ok(res.snapshot.progress);
      } catch (e) { return fail(e); }
    },
    async harness_add_decision(a) {
      try {
        const res = await service.addDecision(a.repoPath, { id: a.id, date: a.date, title: a.title, rationale: a.rationale, rejected: a.rejected });
        return ok(res.snapshot.decisions);
      } catch (e) { return fail(e); }
    },
    async harness_upsert_agent(a) {
      try {
        const res = await service.upsertAgent(a.repoPath, { id: a.id, role: a.role, model: a.model, tools: a.tools, instructions: a.instructions });
        return ok(res.snapshot.agents.find((ag) => ag.id === a.id));
      } catch (e) { return fail(e); }
    },
    async harness_handoff(a) {
      try {
        const res = await service.updateProgress(a.repoPath, { currentCommit: a.currentCommit, testStatus: a.testStatus, updatedAt: a.updatedAt, completed: a.completed ?? [], inProgress: a.inProgress ?? [], blocked: a.blocked ?? [], nextSteps: a.nextSteps ?? [] });
        const active = res.snapshot.features.filter((f) => f.state === "active").map((f) => f.id);
        const warnings = active.length ? [`Clean-state check: feature(s) ${active.join(", ")} still active at handoff.`] : [];
        const sess = session(a.repoPath);
        try { await sess?.end({ clean_state: active.length ? "fail" : "pass" }); } catch { /* no-op */ }
        sessions.delete(a.repoPath);
        return ok({ summary: a.summary ?? null, progress: res.snapshot.progress }, warnings);
      } catch (e) { return fail(e); }
    },
  };

  // Trace every tool except init (no session yet) and get_context/handoff (handle their own session lifecycle).
  const result: Record<string, Handler> = {};
  for (const [name, fn] of Object.entries(raw)) {
    result[name] = name === "harness_get_context" || name === "harness_handoff" || name === "harness_init"
      ? fn
      : traced(name, fn);
  }
  return result;
}
```

Add the missing import at the top of `server.ts`:

```ts
import type { Tracer, Session } from "./tracing.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/mcp`
Expected: PASS (tracing-integration + server + tracing specs all green).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/server.ts packages/mcp/src/tracing-integration.spec.ts
git commit -m "feat(mcp): session-per-context tracing with clean-state score on handoff"
```

### Task 5.4: Persist session rows on clock-in / clock-out

**Files:**
- Modify: `packages/core/src/service/harness-service.ts`
- Modify: `packages/mcp/src/server.ts`
- Test: `packages/core/src/service/harness-service.spec.ts` (add cases)

> Sessions are domain state, so the DB writes belong in `HarnessService` (`startSession`/`endSession`), called by the MCP handlers. `get_context` opens a session row; `handoff` closes it with a summary.

- [ ] **Step 1: Add failing service tests**

Append to `packages/core/src/service/harness-service.spec.ts`:

```ts
describe("HarnessService sessions", () => {
  it("startSession creates a row and endSession closes it", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    const repo = await prisma.repo.findUnique({ where: { path: repoPath } });
    const sessionId = await service.startSession(repoPath, "trace-xyz", new Date("2026-06-04T00:00:00Z"));
    let row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.repoId).toBe(repo!.id);
    expect(row?.endedAt).toBeNull();

    await service.endSession(sessionId, "wrapped up", new Date("2026-06-04T01:00:00Z"));
    row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.endedAt).not.toBeNull();
    expect(row?.summary).toBe("wrapped up");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/service/harness-service.spec.ts -t sessions`
Expected: FAIL — `startSession`/`endSession` not defined.

- [ ] **Step 3: Add methods to `HarnessService`**

Add to the `HarnessService` class:

```ts
  async startSession(repoPath: string, langfuseTraceId: string | undefined, startedAt: Date): Promise<string> {
    const repoId = await this.resolveRepoId(repoPath);
    const session = await this.prisma.session.create({
      data: { repoId, langfuseTraceId: langfuseTraceId ?? null, startedAt },
    });
    return session.id;
  }

  async endSession(sessionId: string, summary: string | undefined, endedAt: Date): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { endedAt, summary: summary ?? null },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/service/harness-service.spec.ts -t sessions`
Expected: PASS.

- [ ] **Step 5: Wire session persistence into MCP handlers**

In `packages/mcp/src/server.ts`, store the session id alongside the tracer Session. Change the registry to hold `{ tracer: Session; sessionId: string }`. Update `harness_get_context` and `harness_handoff`:

In `harness_get_context` (replace the session-set block):

```ts
        try {
          const tracerSession = tracer.startSession(snap.config.name, snap.config.langfuseProjectId);
          const sessionId = await service.startSession(a.repoPath, tracerSession.traceId, new Date());
          sessions.set(a.repoPath, { tracer: tracerSession, sessionId });
        } catch { /* tracing/session is best-effort */ }
```

In `harness_handoff` (replace the `sess?.end` block):

```ts
        const entry = sessions.get(a.repoPath);
        try {
          await entry?.tracer.end({ clean_state: active.length ? "fail" : "pass" });
          if (entry) await service.endSession(entry.sessionId, a.summary, new Date());
        } catch { /* best-effort */ }
        sessions.delete(a.repoPath);
```

Update the registry type and `session()` helper accordingly:

```ts
  const sessions = new Map<string, { tracer: Session; sessionId: string }>();
  const span = (repoPath: string) => sessions.get(repoPath)?.tracer;
```

And update `traced` to use `span(a.repoPath)`:

```ts
  const traced = (name: string, fn: Handler): Handler => async (a) => {
    const sess = span(a.repoPath);
    const s = sess ? sess.span(name, a) : undefined;
    const result = await fn(a);
    try { s?.end({ isError: result.isError ?? false }); } catch { /* never break tools */ }
    return result;
  };
```

> `new Date()` is allowed here (runtime code, not a workflow script). The deterministic constraint only applies to Workflow scripts.

- [ ] **Step 6: Run mcp + core suites to verify still green**

Run: `npx vitest run packages/core packages/mcp`
Expected: PASS. (Existing `tracing-integration.spec.ts` uses a fake `service` without `startSession`; add `startSession: vi.fn(async () => "sess-1")` to that fake service object so the new wiring doesn't throw — update that spec's fake service now.)

Update the fake service in `tracing-integration.spec.ts`:

```ts
    const service: any = {
      getContext: vi.fn(async () => ({ config: { name: "demo", hardConstraints: [] }, agents: [], features: [], decisions: [], progress: { updatedAt: "t", completed: [], inProgress: [], blocked: [], nextSteps: [] } })),
      startSession: vi.fn(async () => "sess-1"),
      endSession: vi.fn(async () => {}),
    };
```

Re-run: `npx vitest run packages/mcp`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/service/harness-service.ts packages/core/src/service/harness-service.spec.ts packages/mcp/src/server.ts packages/mcp/src/tracing-integration.spec.ts
git commit -m "feat: persist session rows on clock-in/clock-out"
```

---

## Phase 6 — `api`: Fastify REST service

### Task 6.1: `api` package skeleton + buildApp with /repos

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

  it("returns 400 with a clear message when registering a path that is not a directory", async () => {
    const res = await app.inject({ method: "POST", url: "/repos", payload: { path: join(workDir, "does-not-exist"), name: "x" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/path/i);
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
Expected: PASS (3 tests).

- [ ] **Step 9: Write `packages/api/src/index.ts` bootstrap + commit**

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

```bash
git add packages/api package-lock.json
git commit -m "feat(api): Fastify REST service over HarnessService"
```

---

## Phase 7 — `web`: Next.js read-only dashboard

> Per spec §9, web gets light testing (one render-from-mock-data test). The dashboard is read-only; all writes go through MCP. It reads from the API. Tasks here are concrete but coarser-grained than core/mcp/api.

### Task 7.1: `web` package skeleton + API client + repos page

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/next.config.mjs`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/app/layout.tsx`
- Create: `packages/web/src/app/page.tsx`
- Test: `packages/web/src/lib/api.spec.ts`

- [ ] **Step 1: Create `packages/web/package.json`**

```json
{
  "name": "@harness/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/web/next.config.mjs`**

```js
const apiBase = process.env.HARNESS_API_BASE ?? "http://127.0.0.1:4000";

/** @type {import('next').NextConfig} */
export default {
  env: { HARNESS_API_BASE: apiBase },
};
```

- [ ] **Step 3: Create `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"], "@harness/core": ["../core/src/index.ts"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "next-env.d.ts"]
}
```

- [ ] **Step 4: Write a failing test for the typed API client**

```ts
// packages/web/src/lib/api.spec.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { listRepos, repoFeatures } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("listRepos calls /repos and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "r1", name: "demo", path: "/x" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const repos = await listRepos();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/repos"), expect.anything());
    expect(repos[0].name).toBe("demo");
  });

  it("repoFeatures hits the right path", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await repoFeatures("r1");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/repos/r1/features"), expect.anything());
  });
});
```

- [ ] **Step 5: Add a vitest config for web (jsdom) + install**

Create `packages/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "web", environment: "jsdom", include: ["src/**/*.spec.{ts,tsx}"] },
});
```

Run: `npm install` then add jsdom: `npm install -D jsdom @testing-library/react @testing-library/jest-dom -w @harness/web`
Run: `npx vitest run packages/web/src/lib/api.spec.ts`
Expected: FAIL — `./api` module not found.

- [ ] **Step 6: Write `packages/web/src/lib/api.ts`**

```ts
// packages/web/src/lib/api.ts
const BASE = process.env.HARNESS_API_BASE ?? "http://127.0.0.1:4000";

export interface Repo { id: string; name: string; path: string; langfuseProjectId?: string | null }
export interface FeatureRow { id: string; featureId: string; behavior: string; verification: string; state: string; evidence?: string | null }
export interface DecisionRow { id: string; decisionId: string; date: string; title: string; rationale: string; rejected?: string | null }
export interface SessionRow { id: string; langfuseTraceId?: string | null; startedAt: string; endedAt?: string | null; summary?: string | null }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const listRepos = () => get<Repo[]>("/repos");
export const repoContext = (id: string) => get<unknown>(`/repos/${id}/context`);
export const repoFeatures = (id: string) => get<FeatureRow[]>(`/repos/${id}/features`);
export const repoDecisions = (id: string) => get<DecisionRow[]>(`/repos/${id}/decisions`);
export const repoSessions = (id: string) => get<SessionRow[]>(`/repos/${id}/sessions`);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/api.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Write the layout + repos page (Server Components)**

```tsx
// packages/web/src/app/layout.tsx
export const metadata = { title: "Harness Manager" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24 }}>
        <header style={{ marginBottom: 24 }}><h1 style={{ margin: 0 }}>Harness Manager</h1></header>
        {children}
      </body>
    </html>
  );
}
```

```tsx
// packages/web/src/app/page.tsx
import Link from "next/link";
import { listRepos } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const repos = await listRepos();
  return (
    <main>
      <h2>Repositories</h2>
      {repos.length === 0 ? (
        <p>No repos registered. POST a path to <code>/repos</code> on the API to add one.</p>
      ) : (
        <ul>
          {repos.map((r) => (
            <li key={r.id}>
              <Link href={`/repos/${r.id}`}>{r.name}</Link> <span style={{ color: "#888" }}>{r.path}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Commit**

```bash
git add packages/web package-lock.json
git commit -m "feat(web): Next.js skeleton, typed API client, repos page"
```

### Task 7.2: Repo detail page with tabs (overview / features / progress / decisions / sessions)

**Files:**
- Create: `packages/web/src/app/repos/[id]/page.tsx`
- Create: `packages/web/src/components/FeatureBoard.tsx`
- Test: `packages/web/src/components/FeatureBoard.spec.tsx`

> Keep it to one detail page that fetches all sections server-side and renders them in stacked panels (no client-side tab framework needed — anchor links). The only component test is the features board rendering from mock data (spec §9 "render from mock data").

- [ ] **Step 1: Write the failing component test**

```tsx
// packages/web/src/components/FeatureBoard.spec.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureBoard } from "./FeatureBoard";
import type { FeatureRow } from "@/lib/api";

const features: FeatureRow[] = [
  { id: "1", featureId: "F01", behavior: "logs in", verification: "npm test", state: "active" },
  { id: "2", featureId: "F02", behavior: "logs out", verification: "npm test", state: "passing", evidence: "abc" },
];

describe("FeatureBoard", () => {
  it("groups features into columns by state", () => {
    render(<FeatureBoard features={features} />);
    expect(screen.getByText("active")).toBeDefined();
    expect(screen.getByText("passing")).toBeDefined();
    expect(screen.getByText(/logs in/)).toBeDefined();
    expect(screen.getByText(/logs out/)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/components/FeatureBoard.spec.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `packages/web/src/components/FeatureBoard.tsx`**

```tsx
// packages/web/src/components/FeatureBoard.tsx
import type { FeatureRow } from "@/lib/api";

const COLUMNS: Array<FeatureRow["state"]> = ["not_started", "active", "blocked", "passing"];

export function FeatureBoard({ features }: { features: FeatureRow[] }) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {COLUMNS.map((state) => {
        const items = features.filter((f) => f.state === state);
        return (
          <section key={state} style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h4 style={{ marginTop: 0 }}>{state}</h4>
            {items.map((f) => (
              <article key={f.id} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 8 }}>
                <strong>{f.featureId}</strong>: {f.behavior}
                <div style={{ color: "#888", fontSize: 12 }}>verify: <code>{f.verification}</code></div>
                {f.evidence ? <div style={{ color: "#2a7", fontSize: 12 }}>evidence: {f.evidence}</div> : null}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/components/FeatureBoard.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Write the repo detail page**

```tsx
// packages/web/src/app/repos/[id]/page.tsx
import { repoFeatures, repoDecisions, repoSessions } from "@/lib/api";
import { FeatureBoard } from "@/components/FeatureBoard";

export const dynamic = "force-dynamic";

export default async function RepoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [features, decisions, sessions] = await Promise.all([
    repoFeatures(id), repoDecisions(id), repoSessions(id),
  ]);

  return (
    <main style={{ display: "grid", gap: 32 }}>
      <section>
        <h2>Features</h2>
        <FeatureBoard features={features} />
      </section>

      <section>
        <h2>Decisions</h2>
        <ul>
          {decisions.map((d) => (
            <li key={d.id}><strong>{d.title}</strong> <span style={{ color: "#888" }}>({d.date})</span><br />{d.rationale}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Sessions</h2>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              {s.startedAt} → {s.endedAt ?? "open"} {s.summary ? `— ${s.summary}` : ""}
              {s.langfuseTraceId ? ` (trace ${s.langfuseTraceId})` : ""}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): repo detail page with feature board, decisions, sessions"
```

---

## Phase 8 — End-to-end + docs

### Task 8.1: Minimal E2E flow test (spec §9)

**Files:**
- Create: `packages/mcp/src/e2e.spec.ts`

> One full flow through the MCP handlers: init → get_context → update_feature → set_passing (with evidence) → handoff. Asserts both the `.harness/` files and the SQLite session row.

- [ ] **Step 1: Write the E2E test**

```ts
// packages/mcp/src/e2e.spec.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma, HarnessService } from "@harness/core";
import { createTracer } from "./tracing";
import { buildToolHandlers } from "./server";

let workDir: string;
let prisma: ReturnType<typeof getPrisma>;
let handlers: ReturnType<typeof buildToolHandlers>;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-e2e-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  handlers = buildToolHandlers(new HarnessService(prisma), createTracer({}));
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });

describe("E2E: init → context → feature → passing → handoff", () => {
  it("completes the full flow and records files + a closed session", async () => {
    const repoPath = await mkdtemp(join(workDir, "repo-"));

    expect((await handlers.harness_init({ repoPath, name: "demo", hardConstraints: ["no force push"] })).isError).toBeFalsy();
    expect((await handlers.harness_get_context({ repoPath })).isError).toBeFalsy();
    expect((await handlers.harness_update_feature({ repoPath, id: "F01", behavior: "logs in", verification: "npm test", state: "active" })).isError).toBeFalsy();
    expect((await handlers.harness_set_feature_passing({ repoPath, id: "F01", evidence: "commit abc123" })).isError).toBeFalsy();
    const handoff = await handlers.harness_handoff({ repoPath, updatedAt: "2026-06-04T12:00:00Z", summary: "done", completed: ["F01"] });
    expect(handoff.isError).toBeFalsy();

    // Files: feature is passing with evidence; AGENTS.md regenerated with the constraint.
    const features = JSON.parse(await readFile(join(repoPath, ".harness", "features.json"), "utf8"));
    expect(features[0]).toMatchObject({ id: "F01", state: "passing", evidence: "commit abc123" });
    const agentsMd = await readFile(join(repoPath, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("no force push");

    // DB: a closed session row exists for this repo.
    const repo = await prisma.repo.findUnique({ where: { path: repoPath } });
    const sessions = await prisma.session.findMany({ where: { repoId: repo!.id } });
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.endedAt).not.toBeNull();
    expect(sessions[0]?.summary).toBe("done");
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npx vitest run packages/mcp/src/e2e.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run the entire suite**

Run: `npx vitest run`
Expected: ALL packages green (core, mcp, api, web).

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/e2e.spec.ts
git commit -m "test: end-to-end MCP flow (init→context→feature→passing→handoff)"
```

### Task 8.2: Root README + run instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# harness-manager

Local-first control plane for Harness Engineering across repos. The repo's `.harness/`
files are the single source of truth; SQLite is a rebuildable index.

## Packages
- `packages/core` — schemas, codecs, AGENTS.md generation, validators, store, DB indexer, HarnessService
- `packages/mcp` — stdio MCP server (embed in Cursor/Claude)
- `packages/api` — Fastify REST service for the dashboard
- `packages/web` — Next.js read-only dashboard

## Setup
```bash
npm install
cp .env.example .env            # optionally fill in Langfuse keys
$env:HARNESS_DB_URL="file:./prisma/dev.db"; npx prisma db push
```

## Run
```bash
# API (port 4000)
npx tsx packages/api/src/index.ts
# Dashboard (port 3000)
npm run dev -w @harness/web
# MCP server (stdio) — point your agent client at:
npx tsx packages/mcp/src/index.ts
```

## Test
```bash
npx vitest run
```

## Langfuse
Set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST`. Missing keys =>
tracing is a silent no-op; everything else still works.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: project README with setup/run/test instructions"
```

---

## Self-Review (completed during authoring)

**Spec coverage check:**
- §1 purpose / §3 architecture → Nx monorepo, 4 packages (Phases 0,1–4,5,6,7). ✔
- §3 "core shared so mcp+api never diverge" → both transports call `HarnessService` (Tasks 5.2, 6.1). ✔ (Reconciliation documented at top.)
- §3 "SQLite rebuildable, file wins" → indexer is delete-then-insert from files; every service write reads file then indexes (Tasks 4.3, 4.4). ✔
- §4 file layout + conventions → RepoStore writes config.json/features.json/agents/*.md/progress.md/decisions.md + AGENTS.md (Task 4.2); codecs match conventions (Phase 2). ✔
- §4 schemas → Task 1.2 (exact field names: behavior/verification/state/evidence; completed/inProgress/blocked/nextSteps; etc.). ✔
- §5 all 11 MCP tools → Tasks 5.2–5.4. WIP=1 warning (5.2 test), pass-gating (enum omits `passing` + set_feature_passing requires evidence), AGENTS.md regen on every write (RepoStore). ✔
- §6 sync on-demand, no daemon → service re-reads files on every read; API `/resync` (Tasks 4.4, 6.1). ✔
- §6 sessions/tracing → tracer no-op when unconfigured (5.1), session per get_context, span per tool, clean_state score + session row (5.3, 5.4). ✔
- §7 API endpoints → all listed routes implemented (Task 6.1). Dashboard read-only with feature board / decisions / sessions (Phase 7). ✔
- §8 error handling → HarnessError with path+fix (Task 1.3), codecs validate at boundary (Phase 2), atomic writes (4.2), Langfuse silent no-op (5.1), missing repo → suggest harness_init (4.2 read). ✔
- §9 testing → core round-trip + gating/WIP unit tests; mcp/api integration with temp repo + temp SQLite; web light render test; one E2E (Task 8.1). ✔
- §10 open items → intentionally omitted (YAGNI), noted as future work in the spec.

**Type consistency check:** `HarnessSnapshot` shape is defined once (Task 3.1) and reused by store/indexer/service/agents-md. `Feature.state` enum identical across schema, codec, service, MCP (input enum omits `passing` by design — documented). `upsertFeature`/`setFeaturePassing`/`updateProgress`/`addDecision`/`upsertAgent` names match between service (4.4, 5.4) and MCP handlers (5.2, 5.3). API route field names (`featureId`, `decisionId`) match Prisma model column names (Task 4.1).

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every test step contains real assertions; no "similar to Task N" references.
```

