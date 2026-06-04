# Harness Manager — Plan 04: Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Part 4 of 4 (final).** Prerequisites: **Plan 01 (`core`)** and **Plan 03 (`api`)** complete. The dashboard reads the REST endpoints from Plan 03. (Plan 02 / MCP is independent and need not be done first, but the app is most useful with all parts running.)

**Goal:** Build `packages/web` — a read-only Next.js dashboard that lists registered repos and shows per-repo features (kanban by state), decisions, and sessions (with Langfuse trace links). Writes happen via MCP, never the dashboard. The UI is dressed in the **Botanical / Organic Serif** design system: a warm rice-paper canvas, Playfair Display headlines with italic emphasis, sage/clay/terracotta palette, arch-topped imagery, staggered grids, soft diffused shadows, and a subtle paper-grain texture. Per spec §9, web gets light testing (typed API client + one render-from-mock-data component test). Finishes with the project README.

**Architecture:** Next.js App Router with Server Components fetching from the API base URL (`HARNESS_API_BASE`, default `http://127.0.0.1:4000`). A typed `lib/api.ts` client wraps `fetch`. Design tokens live centrally in Tailwind v4's `@theme` block (`src/app/globals.css`) so colors, fonts, radii, and shadows are declared once and consumed as utilities (`bg-forest`, `font-display`, `shadow-large`). Fonts load via `next/font/google` (zero layout shift, self-hosted). Small composable primitives (`PaperGrain`, `SectionHeading`, `Card`, `VineDivider`, `RepoCard`) express the system's personality without one-off styling. The repo detail page fetches all sections server-side and renders stacked panels separated by decorative vine dividers (no client-side tab framework). The only component test renders `FeatureBoard` from mock data.

**Tech Stack:** Next.js 16 (App Router, Turbopack default), React 19.2, Tailwind CSS v4 (`@tailwindcss/postcss`), `lucide-react` (thin 1.5 stroke icons), `clsx`, Vitest + jsdom + @testing-library/react.

> **Next.js 16 notes:** Requires Node.js 20.9+ and React 19.2+. Turbopack is the default bundler for both `next dev` and `next build` (no flag needed). Route `params` are async (`Promise<{ ... }>`) — already reflected in the detail page below.

**Checkpoint when done:** `npx vitest run packages/web` green; `npm run dev -w @harness/web` serves the dashboard on port 3000 with paper grain, Playfair headlines, and the botanical palette; full repo README committed.

## Design System Reference (Botanical / Organic Serif)

Centralized in `src/app/globals.css` via Tailwind v4 `@theme`. Consume as utilities — never hardcode hex values in components.

| Token | Value | Utility examples |
|---|---|---|
| `--color-bg` | `#F9F8F4` warm alabaster | `bg-bg` (set on `html`) |
| `--color-forest` | `#2D3A31` deep forest (text) | `text-forest`, `text-forest/60` |
| `--color-sage` | `#8C9A84` sage accent | `text-sage`, `border-sage` |
| `--color-clay` / `--color-clay-soft` | `#DCCFC2` / `#F2F0EB` | `bg-clay`, `bg-clay-soft` |
| `--color-stone` | `#E6E2DA` subtle border | `border-stone` |
| `--color-terracotta` | `#C27B66` interactive pop | `text-terracotta`, hover states |
| `--color-card` | `#FFFFFF` | `bg-card` |
| `--font-display` | Playfair Display 600/700 + italic | `font-display` (auto on `h1–h4`) |
| `--font-body` | Source Sans 3 400/500 | base body font |
| `--shadow-soft/medium/large/bloom` | diffused forest-tinted | `shadow-soft`, `shadow-large` |

**Signature moves:** rounded-3xl / rounded-[40px] / `rounded-t-full` arches · pill buttons & uppercase `tracking-widest` eyebrows · staggered `md:translate-y-12` on alternating cards · slow `duration-500`–`duration-700` ease-out hovers (`-translate-y-1/2`, `scale-105`) · italicized Playfair keywords · mandatory paper-grain overlay · meandering 1px vine dividers · Lucide icons at `strokeWidth={1.5}` floating in pale sage circles.

## File Structure (this plan)

```
packages/web/
├── package.json
├── next.config.mjs
├── postcss.config.mjs                # Tailwind v4 PostCSS plugin
├── tsconfig.json
├── vitest.config.ts
├── vitest.setup.ts
└── src/
    ├── app/
    │   ├── globals.css               # @theme design tokens + base layer
    │   ├── layout.tsx                # fonts (next/font), paper grain, header shell
    │   ├── page.tsx                  # repos list (arch cards, staggered grid)
    │   └── repos/[id]/page.tsx       # repo detail (features/decisions/sessions)
    ├── lib/
    │   ├── api.ts                    # typed REST client
    │   ├── api.spec.ts
    │   └── cn.ts                     # clsx class-merge helper
    └── components/
        ├── PaperGrain.tsx            # fixed SVG noise overlay
        ├── SectionHeading.tsx        # Playfair heading w/ italic emphasis slot
        ├── RepoCard.tsx              # arch-top staggered repo card
        ├── VineDivider.tsx           # meandering 1px section separator
        ├── ui/Card.tsx               # soft rounded card w/ hover lift
        ├── FeatureBoard.tsx          # botanical kanban by state
        └── FeatureBoard.spec.tsx
README.md                             # updated at the end
```

---

## Task 1: `web` skeleton + Tailwind v4 design foundation + typed API client + repos page

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/next.config.mjs`
- Create: `packages/web/postcss.config.mjs`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/vitest.setup.ts`
- Create: `packages/web/src/app/globals.css`
- Create: `packages/web/src/lib/cn.ts`
- Create: `packages/web/src/components/PaperGrain.tsx`
- Create: `packages/web/src/components/SectionHeading.tsx`
- Create: `packages/web/src/components/RepoCard.tsx`
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
    "next": "^16.2.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "lucide-react": "^1.17.0",
    "clsx": "^2.1.1"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "tailwindcss": "^4.3.0",
    "@tailwindcss/postcss": "^4.3.0"
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

- [ ] **Step 3: Create `packages/web/postcss.config.mjs`** (Tailwind v4 plugin)

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

- [ ] **Step 4: Create `packages/web/tsconfig.json`**

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

- [ ] **Step 5: Create `packages/web/vitest.config.ts`**

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

> Note: only `*.spec.{ts,tsx}` modules run under Vitest, and none of them import `globals.css` or `next/font` — so Tailwind/PostCSS and font loading never touch the test path. `FeatureBoard` uses plain `className` strings, so it renders fine in jsdom.

- [ ] **Step 6: Install deps (incl. test tooling)**

Run: `npm install`
Then: `npm install -D jsdom @testing-library/react @testing-library/jest-dom -w @harness/web`
Expected: installs succeed.

- [ ] **Step 7: Create `packages/web/src/app/globals.css`** (centralized design tokens)

```css
@import "tailwindcss";

/* Botanical / Organic Serif — single source of truth for design tokens.
   Tailwind v4 turns each --color-*/--font-*/--shadow-* into utilities
   (bg-forest, text-sage, font-display, shadow-large, …). */
@theme {
  /* Earthbound palette — every color derives from nature, no artificial brights */
  --color-bg: #f9f8f4;          /* warm alabaster / rice paper */
  --color-forest: #2d3a31;      /* deep forest green — primary text */
  --color-sage: #8c9a84;        /* sage accent */
  --color-clay: #dccfc2;        /* soft clay / mushroom */
  --color-clay-soft: #f2f0eb;   /* pale clay surface */
  --color-stone: #e6e2da;       /* delicate border */
  --color-terracotta: #c27b66;  /* interactive pop / hover */
  --color-card: #ffffff;

  /* Typography — Playfair for headings, Source Sans for body (loaded via next/font) */
  --font-display: var(--font-playfair), Georgia, serif;
  --font-body: var(--font-source-sans), system-ui, sans-serif;

  /* Soft, diffused, forest-tinted elevation — no harsh dark drops */
  --shadow-soft: 0 4px 6px -1px rgb(45 58 49 / 0.05);
  --shadow-medium: 0 10px 15px -3px rgb(45 58 49 / 0.05);
  --shadow-large: 0 20px 40px -10px rgb(45 58 49 / 0.05);
  --shadow-bloom: 0 25px 50px -12px rgb(45 58 49 / 0.15);
}

@layer base {
  html {
    background-color: var(--color-bg);
    color: var(--color-forest);
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
  }
  body { margin: 0; }
  h1, h2, h3, h4 {
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
}
```

- [ ] **Step 8: Create the shared primitives**

`packages/web/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";

export const cn = (...inputs: ClassValue[]) => clsx(inputs);
```

`packages/web/src/components/PaperGrain.tsx` (CRITICAL — the texture that makes the design tactile):

```tsx
// Fixed full-screen SVG fractal-noise overlay. opacity-[0.015] keeps it
// felt-not-seen. Without it the design reads flat and digital.
export function PaperGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 opacity-[0.015]"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        backgroundRepeat: "repeat",
      }}
    />
  );
}
```

`packages/web/src/components/SectionHeading.tsx` (Playfair, airy scale; wrap a word in `<em className="not-italic …">` or `<span className="italic">` for emphasis at the call site):

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function SectionHeading({
  children,
  className,
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return <Tag className={cn("text-4xl md:text-5xl tracking-tight", className)}>{children}</Tag>;
}
```

`packages/web/src/components/RepoCard.tsx` (arch-top image, staggered on odd index, slow hover lift + icon scale):

```tsx
import Link from "next/link";
import { ArrowRight, FolderGit2 } from "lucide-react";
import type { Repo } from "@/lib/api";
import { cn } from "@/lib/cn";

export function RepoCard({ repo, index }: { repo: Repo; index: number }) {
  return (
    <Link
      href={`/repos/${repo.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-[40px] border border-stone bg-card shadow-soft",
        "transition duration-500 ease-out hover:-translate-y-2 hover:shadow-large",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2",
        index % 2 === 1 && "md:translate-y-12", // staggered, md+ only
      )}
    >
      {/* Roman-arch "image" panel */}
      <div className="flex aspect-[4/3] items-center justify-center rounded-t-full bg-gradient-to-b from-clay to-clay-soft">
        <FolderGit2
          strokeWidth={1.5}
          className="h-12 w-12 text-sage transition duration-700 ease-out group-hover:scale-105"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-8">
        <h3 className="m-0 text-2xl">{repo.name}</h3>
        <p className="m-0 truncate text-sm text-forest/50">{repo.path}</p>
        <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-sage">
          Enter
          <ArrowRight
            strokeWidth={1.5}
            className="h-4 w-4 transition duration-300 group-hover:translate-x-1"
          />
        </span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 9: Write the failing API-client test**

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

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/api.spec.ts`
Expected: FAIL — `./api` module not found.

- [ ] **Step 11: Write `packages/web/src/lib/api.ts`**

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

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/api.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 13: Write the layout shell (fonts + paper grain + header)**

```tsx
// packages/web/src/app/layout.tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Playfair_Display, Source_Sans_3 } from "next/font/google";
import { Leaf } from "lucide-react";
import { PaperGrain } from "@/components/PaperGrain";

// Self-hosted via next/font => zero layout shift. CSS variables feed @theme.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-source-sans",
  display: "swap",
});

export const metadata = {
  title: "Harness Manager",
  description: "A quiet garden for your repositories.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${sourceSans.variable}`}>
      <body>
        <PaperGrain />
        <div className="mx-auto max-w-7xl px-6 py-12 md:px-10 md:py-20">
          <header className="mb-16 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-clay-soft">
              <Leaf strokeWidth={1.5} className="h-5 w-5 text-sage" />
            </span>
            <div>
              <h1 className="m-0 text-2xl">
                Harness <span className="font-normal italic text-sage">Manager</span>
              </h1>
              <p className="m-0 text-sm text-forest/60">A quiet garden for your repositories.</p>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 14: Write the repos page (Server Component, staggered arch cards)**

```tsx
// packages/web/src/app/page.tsx
import { listRepos } from "@/lib/api";
import { SectionHeading } from "@/components/SectionHeading";
import { RepoCard } from "@/components/RepoCard";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const repos = await listRepos();
  return (
    <main>
      <SectionHeading>
        Your <span className="font-normal italic text-sage">repositories</span>
      </SectionHeading>
      <p className="mt-3 max-w-xl text-lg text-forest/60">
        Every repo&apos;s <code className="text-terracotta">.harness/</code> files, cultivated and
        indexed. Choose one to wander its features, decisions, and sessions.
      </p>

      {repos.length === 0 ? (
        <p className="mt-16 rounded-3xl border border-dashed border-stone bg-clay-soft p-10 text-center text-forest/60">
          No repos registered yet. POST a path to <code>/repos</code> on the API to plant one.
        </p>
      ) : (
        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3">
          {repos.map((repo, i) => (
            <RepoCard key={repo.id} repo={repo} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 15: Eyeball the dev server (optional but recommended)**

Run: `npm run dev -w @harness/web` and open `http://localhost:3000`.
Expected: rice-paper background, paper-grain texture, Playfair header with italicized "Manager", arch-topped repo cards staggered on md+ screens. Stop the server when satisfied.

- [ ] **Step 16: Commit**

```bash
git add packages/web package-lock.json
git commit -m "feat(web): Next.js 16 + Tailwind v4 botanical foundation, API client, repos page"
```

---

## Task 2: Repo detail page with botanical feature board / decisions / sessions

**Files:**
- Create: `packages/web/src/components/ui/Card.tsx`
- Create: `packages/web/src/components/VineDivider.tsx`
- Create: `packages/web/src/components/FeatureBoard.tsx`
- Create: `packages/web/src/app/repos/[id]/page.tsx`
- Test: `packages/web/src/components/FeatureBoard.spec.tsx`

> The detail page fetches all sections server-side and renders stacked panels separated by vine dividers. Features become a botanical "garden" kanban whose columns are named for how well each behavior has taken root. The only component test renders `FeatureBoard` from mock data (spec §9).

- [ ] **Step 1: Create the shared `Card` and `VineDivider` primitives**

`packages/web/src/components/ui/Card.tsx` (soft rounded surface, slow hover lift + shadow bloom):

```tsx
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-stone bg-card p-8 shadow-soft",
        "transition duration-500 ease-out hover:-translate-y-1 hover:shadow-large",
        className,
      )}
      {...props}
    />
  );
}
```

`packages/web/src/components/VineDivider.tsx` (fine 1px meandering line, like a vine connecting sections):

```tsx
import { cn } from "@/lib/cn";

export function VineDivider({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 40"
      preserveAspectRatio="none"
      className={cn("h-8 w-full", className)}
    >
      <path
        d="M0 20 C 200 0, 300 40, 500 20 S 800 0, 1000 20 S 1200 40, 1200 20"
        fill="none"
        stroke="#8c9a84"
        strokeWidth={1.5}
        opacity={0.4}
      />
    </svg>
  );
}
```

- [ ] **Step 2: Write the failing component test**

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
  it("groups features into botanical columns by state and shows evidence", () => {
    render(<FeatureBoard features={features} />);
    // "active" -> "Growing", "passing" -> "Flourishing" (botanical column labels)
    expect(screen.getByText("Growing")).toBeInTheDocument();
    expect(screen.getByText("Flourishing")).toBeInTheDocument();
    expect(screen.getByText("logs in")).toBeInTheDocument();
    expect(screen.getByText("logs out")).toBeInTheDocument();
    expect(screen.getByText(/evidence: abc/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/web/src/components/FeatureBoard.spec.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Write `packages/web/src/components/FeatureBoard.tsx`**

```tsx
// packages/web/src/components/FeatureBoard.tsx
import type { FeatureRow } from "@/lib/api";
import { Sprout, Sun, Unlink, Flower2 } from "lucide-react";
import { Card } from "@/components/ui/Card";

// Columns map the raw state -> a botanical label (how well the behavior has taken root).
const COLUMNS = [
  { state: "not_started", label: "Dormant", Icon: Sprout },
  { state: "active", label: "Growing", Icon: Sun },
  { state: "blocked", label: "Tangled", Icon: Unlink },
  { state: "passing", label: "Flourishing", Icon: Flower2 },
];

export function FeatureBoard({ features }: { features: FeatureRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
      {COLUMNS.map(({ state, label, Icon }) => {
        const items = features.filter((f) => f.state === state);
        return (
          <section key={state} className="flex flex-col gap-4">
            <header className="flex items-center gap-2 border-b border-stone pb-3">
              <Icon strokeWidth={1.5} className="h-4 w-4 text-sage" />
              <h4 className="m-0 text-lg">{label}</h4>
              <span className="ml-auto text-sm text-forest/40">{items.length}</span>
            </header>

            {items.map((f) => (
              <Card key={f.id} className="p-5">
                <div className="text-xs font-medium uppercase tracking-widest text-sage">{f.featureId}</div>
                <p className="mb-3 mt-1 text-forest">{f.behavior}</p>
                <p className="m-0 text-xs text-forest/50">
                  verify <code className="text-terracotta">{f.verification}</code>
                </p>
                {f.evidence ? (
                  <p className="mb-0 mt-2 text-xs text-sage">✿ evidence: {f.evidence}</p>
                ) : null}
              </Card>
            ))}

            {items.length === 0 ? (
              <p className="m-0 rounded-2xl border border-dashed border-stone p-4 text-center text-xs text-forest/40">
                nothing here yet
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/web/src/components/FeatureBoard.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Write the repo detail page**

```tsx
// packages/web/src/app/repos/[id]/page.tsx
import Link from "next/link";
import { ArrowLeft, Clock, ExternalLink, ScrollText } from "lucide-react";
import { repoFeatures, repoDecisions, repoSessions } from "@/lib/api";
import { FeatureBoard } from "@/components/FeatureBoard";
import { SectionHeading } from "@/components/SectionHeading";
import { VineDivider } from "@/components/VineDivider";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function RepoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [features, decisions, sessions] = await Promise.all([
    repoFeatures(id),
    repoDecisions(id),
    repoSessions(id),
  ]);

  return (
    <main className="flex flex-col gap-20">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm uppercase tracking-widest text-sage transition duration-300 hover:text-terracotta"
      >
        <ArrowLeft strokeWidth={1.5} className="h-4 w-4" /> All repositories
      </Link>

      <section>
        <SectionHeading>
          The <span className="font-normal italic text-sage">feature</span> garden
        </SectionHeading>
        <p className="mb-10 mt-3 text-lg text-forest/60">
          Each behavior, sorted by how well it has taken root.
        </p>
        <FeatureBoard features={features} />
      </section>

      <VineDivider />

      <section>
        <SectionHeading>
          <span className="font-normal italic text-sage">Decisions</span>, rooted
        </SectionHeading>
        <div className="mt-10 flex flex-col gap-6">
          {decisions.length === 0 ? (
            <p className="text-forest/50">No decisions recorded yet.</p>
          ) : (
            decisions.map((d) => (
              <Card key={d.id} className="flex gap-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay-soft">
                  <ScrollText strokeWidth={1.5} className="h-5 w-5 text-sage" />
                </span>
                <div>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="m-0 text-2xl">{d.title}</h3>
                    <span className="text-sm text-forest/40">{d.date}</span>
                  </div>
                  <p className="mb-0 mt-2 text-forest/70">{d.rationale}</p>
                  {d.rejected ? (
                    <p className="mb-0 mt-2 text-sm text-terracotta">rejected: {d.rejected}</p>
                  ) : null}
                </div>
              </Card>
            ))
          )}
        </div>
      </section>

      <VineDivider />

      <section>
        <SectionHeading>
          <span className="font-normal italic text-sage">Sessions</span> in the field
        </SectionHeading>
        <div className="mt-10 flex flex-col gap-4">
          {sessions.length === 0 ? (
            <p className="text-forest/50">No sessions yet.</p>
          ) : (
            sessions.map((s) => (
              <Card key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-6">
                <Clock strokeWidth={1.5} className="h-4 w-4 text-sage" />
                <span className="text-forest">{s.startedAt}</span>
                <span className="text-forest/40">→</span>
                <span className="text-forest">{s.endedAt ?? "open"}</span>
                {s.summary ? <span className="text-forest/60">— {s.summary}</span> : null}
                {s.langfuseTraceId ? (
                  <a
                    href={`#trace-${s.langfuseTraceId}`}
                    className="ml-auto inline-flex items-center gap-1 text-sm uppercase tracking-widest text-sage transition duration-300 hover:text-terracotta"
                  >
                    trace <ExternalLink strokeWidth={1.5} className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </Card>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
```

> The Langfuse trace link uses an anchor placeholder (`#trace-<id>`) since a full Langfuse URL needs the host + project from config. If you wire it to the real console, build the href from `repoContext(id)`'s `langfuseProjectId` + `LANGFUSE_HOST`.

- [ ] **Step 7: Run the full web suite**

Run: `npx vitest run packages/web`
Expected: PASS (api client + FeatureBoard).

- [ ] **Step 8: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): botanical repo detail — feature garden, decisions, sessions"
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
- `packages/web` — Next.js 16 read-only dashboard, styled in the Botanical / Organic Serif
  design system (Tailwind v4 tokens, Playfair Display + Source Sans 3, paper-grain texture)

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
# Dashboard (port 3000) — Next.js 16 + Turbopack
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
- **Design-system coverage (Botanical / Organic Serif):** tokens centralized in Tailwind v4 `@theme` (§2); Playfair Display + Source Sans 3 via `next/font` (§2 typography); mandatory paper-grain overlay (§2 effects); `rounded-3xl`/`rounded-[40px]`/`rounded-t-full` arch shapes (§2 radius, §4 arch imagery); staggered `md:translate-y-12` cards (§5 break-the-grid); soft diffused shadows + slow `duration-500/700` ease-out hovers (§2 shadows, §7 animation); italicized Playfair emphasis (§4); meandering vine dividers (§4 decorative lines); Lucide icons at `strokeWidth={1.5}` in pale sage circles (§6); sage focus rings for accessibility (§7). Responsive grids `grid-cols-1 → md:grid-cols-3/4` with staggering disabled below `md` (§8).
- **Maintainability:** every color/font/shadow is a token consumed as a utility — no hardcoded hex in components. Primitives (`PaperGrain`, `SectionHeading`, `Card`, `VineDivider`, `RepoCard`) are composable and reused across both pages; `cn` (clsx) keeps conditional classes clean. Each component created in the task where it is first used, so no orphaned files.
- **Type consistency:** `FeatureRow`/`DecisionRow`/`SessionRow` field names match the API JSON shapes from Plan 03 (`featureId`, `decisionId`, `langfuseTraceId`). `FeatureBoard` and `RepoCard` consume their row/`Repo` types from `lib/api.ts`.
- **Test path isolation:** Vitest specs (`api.spec.ts`, `FeatureBoard.spec.tsx`) never import `globals.css` or `next/font`, so Tailwind/PostCSS and font loading stay out of the jsdom run. The component test asserts the botanical column labels (`Growing`/`Flourishing`) that correspond to the `active`/`passing` states, plus behaviors and evidence — a faithful render-from-mock test.
- **Placeholder scan:** Langfuse trace link is an explicit `#trace-<id>` anchor placeholder (flagged in Task 2 Step 6) — wire to the real console via `repoContext` + `LANGFUSE_HOST` if desired.
- **Note:** `Overview` tab (rendered AGENTS.md + agents) from spec §7 is deferred — the page renders features/decisions/sessions. If you want the Overview tab, add a `<section>` calling `repoContext(id)` and render `config.hardConstraints` + `agents` inside `Card`s with the same botanical treatment; the API already exposes `/repos/:id/context` and `/repos/:id/agents`. Flagged so the omission is explicit rather than silent.
```
