# Harness Manager — Plan 04: Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 4 of 4 (final).** Prerequisites: **Plan 01 (`core`)** and **Plan 03 (`api`)** complete. The dashboard reads the REST endpoints from Plan 03. (Plan 02 / MCP is independent and need not be done first, but the app is most useful with all parts running.)

**Goal:** Build `packages/web` — a read-only Next.js dashboard that lists registered repos and shows per-repo features (kanban by state), decisions, and sessions (with Langfuse trace links). Writes happen via MCP, never the dashboard. Per spec §9, web gets light testing (typed API client + one render-from-mock-data component test). Finishes with the project README.

**Architecture:** Next.js App Router with Server Components fetching from the API base URL (`HARNESS_API_BASE`, default `http://127.0.0.1:4000`). A typed `lib/api.ts` client wraps `fetch`. The repo detail page fetches all sections server-side and renders stacked panels (no client-side tab framework). The only component test renders `FeatureBoard` from mock data.

**Tech Stack:** Next.js 15 (App Router), React 19, Vitest 2 + jsdom + @testing-library/react.

**Checkpoint when done:** `npx vitest run packages/web` green; `npm run dev -w @harness/web` serves the dashboard on port 3000; full repo README committed.

## File Structure (this plan)

```
packages/web/
├── package.json
├── next.config.mjs
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── lib/api.ts                    # typed REST client
    ├── lib/api.spec.ts
    ├── components/FeatureBoard.tsx
    ├── components/FeatureBoard.spec.tsx
    └── app/
        ├── layout.tsx
        ├── page.tsx                  # repos list
        └── repos/[id]/page.tsx       # repo detail (features/decisions/sessions)
README.md                             # updated at the end
```

---

## Task 1: `web` skeleton + typed API client + repos page

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/next.config.mjs`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vitest.config.ts`
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

- [ ] **Step 4: Create `packages/web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.spec.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
```

Create `packages/web/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Install deps (incl. test tooling)**

Run: `npm install`
Then: `npm install -D jsdom @testing-library/react @testing-library/jest-dom -w @harness/web`
Expected: installs succeed.

- [ ] **Step 6: Write the failing API-client test**

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

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/api.spec.ts`
Expected: FAIL — `./api` module not found.

- [ ] **Step 8: Write `packages/web/src/lib/api.ts`**

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

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/api.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Write layout + repos page (Server Components)**

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

- [ ] **Step 11: Commit**

```bash
git add packages/web package-lock.json
git commit -m "feat(web): Next.js skeleton, typed API client, repos page"
```

---

## Task 2: Repo detail page with feature board / decisions / sessions

**Files:**
- Create: `packages/web/src/components/FeatureBoard.tsx`
- Create: `packages/web/src/app/repos/[id]/page.tsx`
- Test: `packages/web/src/components/FeatureBoard.spec.tsx`

> The detail page fetches all sections server-side and renders stacked panels. The only component test renders `FeatureBoard` from mock data (spec §9).

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
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("passing")).toBeInTheDocument();
    expect(screen.getByText(/logs in/)).toBeInTheDocument();
    expect(screen.getByText(/logs out/)).toBeInTheDocument();
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

const COLUMNS = ["not_started", "active", "blocked", "passing"];

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

- [ ] **Step 6: Run the full web suite**

Run: `npx vitest run packages/web`
Expected: PASS (api client + FeatureBoard).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): repo detail page with feature board, decisions, sessions"
```

---

## Task 3: Project README + run instructions

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

- [ ] **Step 2: Run the entire workspace suite**

Run: `npx vitest run`
Expected: ALL packages green (core, mcp, api, web).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: project README with setup/run/test instructions"
```

---

## Self-Review (this plan)

- **Spec coverage (§7 dashboard):** repos page (list + path); repo detail with Features kanban by state, Decisions timeline, Sessions list with Langfuse trace link. Read-only — no write paths (§7). Light testing per §9 (api client + one render-from-mock-data test).
- **Type consistency:** `FeatureRow`/`DecisionRow`/`SessionRow` field names match the API JSON shapes from Plan 03 (`featureId`, `decisionId`, `langfuseTraceId`). `FeatureBoard` consumes `FeatureRow` from `lib/api.ts`.
- **Placeholder scan:** none.
- **Note:** `Overview` tab (rendered AGENTS.md + agents) from spec §7 is deferred — the page renders features/decisions/sessions. If you want the Overview tab, add a section calling `repoContext(id)` and render `config.hardConstraints` + `agents`; the API already exposes `/repos/:id/context` and `/repos/:id/agents`. Flagged so the omission is explicit rather than silent.
```

