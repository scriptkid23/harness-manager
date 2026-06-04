# Harness Manager — Plan 02: MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 2 of 4.** Prerequisite: **Plan 01 (Foundation + `core`) must be complete** — this plan imports `getPrisma`, `HarnessService`, `HarnessError`, and schema types from `@harness/core`.

**Goal:** Build the stdio MCP server `packages/mcp` — a thin transport over `core`'s `HarnessService` that exposes the 11 harness tools, enforces WIP=1 / pass-state gating, traces each work session to Langfuse (silent no-op when unconfigured), and persists session rows. Ends with a full end-to-end flow test.

**Architecture:** `buildToolHandlers(service, tracer)` returns a pure `name -> handler` map (unit-testable without stdio). `registerTools` binds them onto an `McpServer` with Zod input schemas. A per-`repoPath` session registry opens a Langfuse trace + session row on `harness_get_context` (clock-in), records a span per tool, and closes both on `harness_handoff` (clock-out) with a `clean_state` score.

**Tech Stack:** @modelcontextprotocol/sdk 1, langfuse 3, Zod 3, Vitest 2, `@harness/core`.

**Checkpoint when done:** `npx vitest run packages/mcp` green, including the E2E flow; `npx tsx packages/mcp/src/index.ts` starts a stdio server.

## File Structure (this plan)

```
packages/mcp/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts            # stdio entrypoint
    ├── server.ts           # buildToolHandlers + registerTools
    ├── tracing.ts          # Langfuse tracer (no-op if unconfigured)
    ├── tracing.spec.ts
    ├── tracing-integration.spec.ts
    ├── server.spec.ts
    └── e2e.spec.ts
```

---

## Task 1: `mcp` package skeleton + tracing no-op

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

---

## Task 2: Build MCP server with read + write tools (tracing-wired)

**Files:**
- Create: `packages/mcp/src/server.ts`
- Create: `packages/mcp/src/index.ts`
- Test: `packages/mcp/src/server.spec.ts`
- Test: `packages/mcp/src/tracing-integration.spec.ts`

> The server wires `HarnessService` + tracer + session/DB lifecycle. Tools are tested by calling the registered handler functions directly against a temp repo + temp SQLite (no stdio in tests). The session registry holds `{ tracer: Session; sessionId: string }` per `repoPath`. `harness_get_context` clocks in (Langfuse trace + `service.startSession`), every other tool (except init/handoff) emits a span, and `harness_handoff` clocks out (`tracer.end` with `clean_state` score + `service.endSession`). Tracing/session failures must never break a tool.

- [ ] **Step 1: Write the failing handler test**

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
import type { Tracer, Session } from "./tracing.js";

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
export function buildToolHandlers(service: HarnessService, tracer: Tracer): Record<string, Handler> {
  const sessions = new Map<string, { tracer: Session; sessionId: string }>();
  const span = (repoPath: string) => sessions.get(repoPath)?.tracer;

  /** Wrap a raw handler so it emits a span on the repo's active session (if any). */
  const traced = (name: string, fn: Handler): Handler => async (a) => {
    const sess = span(a.repoPath);
    const s = sess ? sess.span(name, a) : undefined;
    const result = await fn(a);
    try { s?.end({ isError: result.isError ?? false }); } catch { /* never break tools */ }
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
        try {
          const tracerSession = tracer.startSession(snap.config.name, snap.config.langfuseProjectId);
          const sessionId = await service.startSession(a.repoPath, tracerSession.traceId, new Date());
          sessions.set(a.repoPath, { tracer: tracerSession, sessionId });
        } catch { /* tracing/session is best-effort */ }
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
        const entry = sessions.get(a.repoPath);
        try {
          await entry?.tracer.end({ clean_state: active.length ? "fail" : "pass" });
          if (entry) await service.endSession(entry.sessionId, a.summary, new Date());
        } catch { /* best-effort */ }
        sessions.delete(a.repoPath);
        return ok({ summary: a.summary ?? null, progress: res.snapshot.progress }, warnings);
      } catch (e) { return fail(e); }
    },
  };

  // Trace every tool except init (no session) and get_context/handoff (own their session lifecycle).
  const result: Record<string, Handler> = {};
  for (const [name, fn] of Object.entries(raw)) {
    result[name] = name === "harness_get_context" || name === "harness_handoff" || name === "harness_init"
      ? fn
      : traced(name, fn);
  }
  return result;
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

> Note: `harness_update_feature`'s `state` enum deliberately omits `passing` — pass-state gating (spec §5) forces agents through `harness_set_feature_passing`. `new Date()` is fine here (runtime code, not a Workflow script).

- [ ] **Step 4: Run handler test to verify it passes**

Run: `npx vitest run packages/mcp/src/server.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the tracing-wiring test (spy tracer + fake service)**

```ts
// packages/mcp/src/tracing-integration.spec.ts
import { describe, it, expect, vi } from "vitest";
import type { Tracer, Session, Span } from "./tracing";
import { buildToolHandlers } from "./server";

describe("tracing wiring", () => {
  it("calls startSession on get_context and span.end on subsequent tools", async () => {
    const span: Span = { end: vi.fn() };
    const session: Session = { traceId: "trace-1", span: vi.fn(() => span), end: vi.fn(async () => {}) };
    const tracer: Tracer = { startSession: vi.fn(() => session) };

    const service: any = {
      getContext: vi.fn(async () => ({ config: { name: "demo", hardConstraints: [] }, agents: [], features: [], decisions: [], progress: { updatedAt: "t", completed: [], inProgress: [], blocked: [], nextSteps: [] } })),
      startSession: vi.fn(async () => "sess-1"),
      endSession: vi.fn(async () => {}),
    };

    const handlers = buildToolHandlers(service, tracer);
    await handlers.harness_get_context({ repoPath: "/x" });
    expect(tracer.startSession).toHaveBeenCalledTimes(1);
    expect(service.startSession).toHaveBeenCalledTimes(1);

    await handlers.harness_list_features({ repoPath: "/x" });
    expect(session.span).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run all mcp tests so far**

Run: `npx vitest run packages/mcp`
Expected: PASS (tracing + server + tracing-integration green).

- [ ] **Step 7: Write the stdio entrypoint `packages/mcp/src/index.ts`**

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

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/src
git commit -m "feat(mcp): MCP server with 11 tools, WIP/pass-gating, session tracing"
```

---

## Task 3: Minimal end-to-end flow test (spec §9)

**Files:**
- Create: `packages/mcp/src/e2e.spec.ts`

> One full flow through the MCP handlers: init → get_context → update_feature → set_passing (with evidence) → handoff. Asserts both the `.harness/` files AND the SQLite session row.

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

- [ ] **Step 3: Run the full mcp suite**

Run: `npx vitest run packages/mcp`
Expected: ALL green (tracing, server, tracing-integration, e2e).

- [ ] **Step 4: Commit**

```bash
git add packages/mcp/src/e2e.spec.ts
git commit -m "test(mcp): end-to-end flow (init→context→feature→passing→handoff)"
```

---

## Self-Review (this plan)

- **Spec coverage:** all 11 tools (§5) implemented; WIP=1 warning surfaced (Task 2 test); pass-gating enforced via enum omission + evidence requirement; AGENTS.md regen on every write (inherited from `core` RepoStore); session-per-context tracing + clean_state score + session row (§6); Langfuse silent no-op (§6, Task 1); agent-oriented error text (§8). E2E (§9) in Task 3.
- **Type consistency:** handler arg names match `HarnessService` method params from Plan 01 (`upsertFeature`, `setFeaturePassing`, `updateProgress`, `addDecision`, `upsertAgent`, `startSession`, `endSession`). `Session`/`Span`/`Tracer` interfaces defined once in `tracing.ts` and reused by `server.ts` + both tracing tests.
- **Placeholder scan:** none.
