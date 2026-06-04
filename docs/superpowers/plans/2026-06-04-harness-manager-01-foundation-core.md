# Harness Manager — Plan 01: Foundation + `core` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 1 of 4.** Prerequisite: none. Downstream plans (`02-mcp`, `03-api`, `04-web`) all depend on this one.

**Goal:** Scaffold the Nx monorepo and build the `core` package — Zod schemas, pure codecs for `.harness/` files, deterministic AGENTS.md generation, WIP/pass-gating validators, a filesystem `RepoStore`, a Prisma/SQLite indexer, and the `HarnessService` orchestration that both `mcp` and `api` will call.

**Architecture:** `core` holds the pure layer (`schemas/`, `codec/`, `agents-md.ts`, `validators.ts`) PLUS a shared I/O layer (`store/`, `db/`, `service/`) so the transports never diverge. The repo's `.harness/` files are canonical; SQLite is a rebuildable cache. On mismatch, the file wins.

**Tech Stack:** Nx 20, TypeScript 5, Zod 3, gray-matter 4, Vitest 2, Prisma 6 + SQLite.

**Checkpoint when done:** `npx vitest run packages/core` is fully green; `core` exports schemas, codecs, validators, `RepoStore`, `indexSnapshot`, and `HarnessService`.

---

## Architectural Reconciliation (read before starting)

The spec (§3) says `core` is "pure logic, no I/O" but ALSO says `core` is "the shared layer so MCP and API never diverge." Pure codecs alone don't prevent divergence — the orchestration (read file → parse → index → write file → regenerate AGENTS.md) is what would diverge. Resolution:

- **Pure layer in `core`** (no I/O, fully unit-tested): `schemas/`, `codec/`, `agents-md.ts`, `validators.ts`.
- **Shared I/O layer in `core`** (the thing that prevents divergence): `store/`, `db/`, `service/`.
- `mcp` and `api` (later plans) contain ONLY transport glue + tracing. They call `core`'s `HarnessService`.

## File Structure (this plan)

```
harness-manager/
├── package.json                      # npm workspaces root, Nx
├── nx.json
├── tsconfig.base.json
├── vitest.workspace.ts
├── .env.example
├── prisma/
│   └── schema.prisma                 # SQLite: repos, features, agents, decisions, progress, sessions
└── packages/core/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/
        ├── index.ts                  # public barrel
        ├── schemas/index.ts          # Zod schemas + inferred types
        ├── codec/{config,feature,agent,progress,decision}.ts
        ├── agents-md.ts              # generateAgentsMd + HarnessSnapshot type
        ├── validators.ts             # WIP=1, pass-state gating
        ├── errors.ts                 # HarnessError with path + fix hint
        ├── store/repo-store.ts       # RepoStore: read/write .harness/, atomic writes
        ├── db/{client,indexer}.ts    # Prisma client + snapshot indexer
        └── service/harness-service.ts# HarnessService orchestration
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
Expected: "No test files found" (clean exit). Confirms the workspace resolves.

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

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codec/agent.ts packages/core/src/codec/agent.spec.ts
git commit -m "feat(core): agent markdown codec"
```

### Task 2.4: Progress codec (frontmatter canonical; body is regenerated mirror)

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

> Pure decision functions. `checkWipLimit` answers "would activating this feature exceed WIP=1?" `assertPassEvidence` enforces that `passing` requires evidence.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/validators.spec.ts
import { describe, it, expect } from "vitest";
import { checkWipLimit, assertPassEvidence } from "./validators";
import type { Feature } from "./schemas/index";

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

> RepoStore owns ALL filesystem access for a repo. It reads a full `HarnessSnapshot` from `.harness/`, writes individual artifacts with atomic writes (temp file + rename), and regenerates `AGENTS.md` after every write. Missing files yield empty defaults so a freshly-init'd repo reads cleanly.

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

> The indexer takes a `repoId` + `HarnessSnapshot` and replaces that repo's cached rows. Arrays are JSON-encoded into String columns. Tests use a temp SQLite file via `getPrisma(url)` after running `prisma db push` against it.

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

> `HarnessService` is the single API both transports call. It composes `RepoStore` + `indexer` + validators. Read methods read files then index. Write methods write file (canonical) → re-read → index → (AGENTS.md already regenerated by store). It resolves a repo row by path (auto-registering on first touch). It also owns session rows (`startSession`/`endSession`), used by the MCP plan.

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

Run: `npx vitest run packages/core/src/service/harness-service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/service/harness-service.ts
import type { PrismaClient } from "@prisma/client";
import type { Agent, Config, Decision, Feature, FeatureState, Progress } from "../schemas/index.js";
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

  async updateProgress(repoPath: string, progress: Progress): Promise<WriteResult> {
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
Expected: PASS (5 tests).

- [ ] **Step 5: Export + run full core suite + commit**

Append to `packages/core/src/index.ts`:

```ts
export * from "./service/harness-service.js";
```

Run: `npx vitest run packages/core`
Expected: all core specs PASS.

```bash
git add packages/core/src/service packages/core/src/index.ts
git commit -m "feat(core): HarnessService orchestration (store + index + validators + sessions)"
```

---

## Self-Review (this plan)

- **Spec coverage:** schemas (§4), codecs honoring JSON/markdown conventions (§4), AGENTS.md generation (§4), WIP/pass-gating (§5), atomic writes + validate-at-boundary + missing-repo guidance (§8), SQLite rebuildable/file-wins (§3/§6), session row model (§6). All have tasks.
- **Type consistency:** `HarnessSnapshot` defined once (Task 3.1), reused by store/indexer/service. `Feature.state` enum identical everywhere. Service method names (`init`, `getContext`, `upsertFeature`, `setFeaturePassing`, `updateProgress`, `addDecision`, `upsertAgent`, `startSession`, `endSession`) are the contract consumed by Plans 02–03.
- **Placeholder scan:** none — every step has complete code/tests/commands.
- **Downstream contract:** Plan 02 (`mcp`) and Plan 03 (`api`) import `getPrisma`, `HarnessService`, `HarnessError`, and the schema types from `@harness/core`. Do not rename these without updating those plans.
