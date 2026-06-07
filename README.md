# Harness Manager

A local-first dashboard for **Harness Engineering** across multiple repositories.
The source of truth lives in the **central SQLite database**; `repoPath` is a logical key (e.g. `/projects/socmint`), not a filesystem path.


| Package         | Role                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `packages/core` | Schema, codec, validators, DB store, `HarnessService` |
| `packages/mcp`  | MCP server (stdio + HTTP) — agents read/write the harness via Cursor/Claude   |
| `packages/api`  | REST API (Fastify) — serves the dashboard                                     |
| `packages/web`  | Next.js dashboard (read-only) — view repos, features, decisions, sessions     |


**Typical flow:** register a repo via the API or MCP → an agent writes harness state via MCP → the dashboard reads it through the API.

See **[Workflow guide](#workflow-guide--using-harness-mcp-on-your-repo)** for step-by-step prompts when you already have a repo.
For the **recommended minimal setup** (planner / coder / reviewer / architect + Superpowers), see **[Recommended setup](#recommended-setup-minimal)**.

---

## Requirements

- **Node.js** ≥ 20.9
- **pnpm** 9.x (`corepack enable`, then `corepack prepare pnpm@9.15.4 --activate` if needed)
- Windows / macOS / Linux

---

## Setup (first time)

### 1. Clone and install dependencies

```bash
cd harness-manager
pnpm install
```

`postinstall` automatically runs `prisma generate` and builds the MCP bundles.

### 2. Environment variables

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Adjust `.env` if needed:


| Variable              | Default                      | Meaning                          |
| --------------------- | ---------------------------- | -------------------------------- |
| `HARNESS_DB_URL`      | `file:./prisma/dev.db`       | SQLite index (cache)             |
| `LANGFUSE_HOST`       | `https://cloud.langfuse.com` | Langfuse host (optional)         |
| `LANGFUSE_PUBLIC_KEY` | (empty)                      | Enables session tracing over MCP |
| `LANGFUSE_SECRET_KEY` | (empty)                      | Paired with the public key       |


No Langfuse keys → tracing is a **silent no-op**, everything else still works.

### 3. Create the database

**Windows (PowerShell):**

```powershell
$env:HARNESS_DB_URL = "file:./prisma/dev.db"
pnpm exec prisma db push
```

**macOS / Linux:**

```bash
export HARNESS_DB_URL="file:./prisma/dev.db"
pnpm exec prisma db push
```

Or use the bundled script (reads `HARNESS_DB_URL` from `.env` if it's loaded):

```bash
pnpm prisma:push
```

---

## Running the project

A full dashboard needs **two terminals** (API + Web). MCP runs separately when you configure an agent.

### Terminal 1 — API (port 4000)

```bash
pnpm exec tsx packages/api/src/index.ts
```

You should see: `harness-api listening on http://127.0.0.1:4000`

Change the port: `$env:PORT=5000` (PowerShell) or `PORT=5000` (bash) before running.

### Terminal 2 — Dashboard (port 3000)

```bash
pnpm --filter @harness/web dev
```

Open your browser: **[http://localhost:3000](http://localhost:3000)**

The dashboard calls the API at `http://127.0.0.1:4000`. Override the API URL:

```bash
# PowerShell
$env:HARNESS_API_BASE = "http://127.0.0.1:4000"
pnpm --filter @harness/web dev
```

### MCP server (stdio) — for Cursor / Claude

The MCP server runs from a **prebuilt bundle** (`packages/mcp/dist/harness-mcp.mjs`), so `tsx` is no longer required.
The build runs automatically in `postinstall`; rebuild manually after changing MCP code:

```bash
pnpm --filter @harness/mcp build
```

Run it directly (debug):

```bash
node packages/mcp/dist/harness-mcp.mjs --path .
```

**Cursor config** — the repo ships a very lean `.cursor/mcp.json` (no `env`, no `cwd`):
the server derives the DB as `file:<path>/prisma/dev.db` (absolute) and loads `<path>/.env` for the Langfuse keys.

```json
{
  "mcpServers": {
    "harness": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "${workspaceFolder}/packages/mcp/dist/harness-mcp.mjs",
        "--path",
        "${workspaceFolder}"
      ]
    }
  }
}
```

Cursor replaces `${workspaceFolder}` with the repo path, so the config works on any machine without editing paths.

**Why still `node.exe` rather than a bare `harness-mcp` command?** On Windows, Cursor spawns MCP servers **without a shell**, so the `.cmd`/`.ps1` shims (the only thing `pnpm/npm link` produces for a Node tool) cause `Connection closed`. A bare command only works reliably as a native `.exe`. The explicit `node.exe` path also pins Node 20 — the same Node that built `better-sqlite3` (Node 22 throws `NODE_MODULE_VERSION`).

Keep all secrets (Langfuse keys) in the root `.env`, **not** in `mcp.json`. After editing the config: **toggle** the `harness` server off/on in MCP settings.

---

## Running with Docker (whole stack)

Instead of running each process by hand, you can bring up the whole stack with compose. A single image is shared by all three services (api/web/mcp), with one central SQLite index on the `harness_db` volume.

```bash
# Build + run the harness app (api 4000, web 3000, mcp 8765)
docker compose up -d harness-api harness-web harness-mcp

# Open the dashboard
#   http://localhost:3000
# MCP Streamable HTTP:
#   http://localhost:8765/mcp   (health: http://localhost:8765/health)
```

`harness-migrate` (a one-shot service that runs `prisma db push`) initializes the schema before `api`/`mcp` start.

**`repoPath` is a logical key** (e.g. `/projects/socmint`). It does not need to exist on disk — all harness state lives in the `harness_db` volume.

**Cursor config for MCP over HTTP** (the "just connect to a port" style):

```json
{
  "mcpServers": {
    "harness": { "url": "http://127.0.0.1:8765/mcp" }
  }
}
```

If your Cursor build doesn't support the `url` field yet, use the `mcp-remote` proxy (like `docgraph`):

```json
{
  "mcpServers": {
    "harness": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "http://127.0.0.1:8765/mcp"]
    }
  }
}
```

Langfuse: the MCP image reads `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` from `.env` (compose interpolates them), while `LANGFUSE_HOST` points at the in-cluster `langfuse-web` service. To also run the Langfuse stack: `docker compose up -d` (without naming a service).

> **Choosing a transport:** use **Docker + HTTP** when you want isolation/packaging (no native `better-sqlite3` worries); use the **stdio bundle** (section above) for a local MCP process sharing the same SQLite database.

---

## Workflow guide — using harness MCP on your repo

The harness MCP server gives an AI agent (Cursor / Claude) a **structured, persistent memory** for a project. Instead of losing context between chats, the agent reads and writes harness state in the central database and follows a disciplined session lifecycle.

### What gets stored

| Artifact | Purpose |
| -------- | ------- |
| **config** | Project name, description, **hard constraints** (rules the agent must never break) |
| **features** | Specs as *behavior + verification + state + evidence* — a feature is only "passing" with proof |
| **progress** | Current commit, test status, completed / in-progress / blocked / next steps |
| **decisions** | Architectural choices with rationale and **rejected** alternatives |
| **sessions** | Clock-in / clock-out per work session (optional Langfuse trace) |

The dashboard at **[http://localhost:3000](http://localhost:3000)** is read-only; agents write via MCP, humans observe via the API.

### MCP tools (11)

| Tool | When to use |
| ---- | ----------- |
| `harness_init` | Once per repo — seed config, progress, and register in DB |
| `harness_get_context` | **Start of every session** — load full snapshot + open session |
| `harness_list_features` | List features (optional `state` filter) |
| `harness_list_decisions` | List recorded decisions |
| `harness_get_progress` | Read current progress |
| `harness_update_feature` | Create or update a feature; set `active` when working on it |
| `harness_set_feature_passing` | Mark done — **requires `evidence`** (test output) |
| `harness_update_progress` | Update commit, test status, next steps |
| `harness_add_decision` | Record a significant decision (+ `rejected`) |
| `harness_upsert_agent` | Define agent roles and instructions |
| `harness_handoff` | **End of every session** — summary + clean-state check |

### `repoPath` — pick the right path

Every tool takes `repoPath` — a **stable logical identifier** for the project:

| Example `repoPath` | Notes |
| ------------------ | ----- |
| `/projects/socmint` | Recommended convention |
| `socmint` | Also valid — pick one and stay consistent |

The path does not need to exist on disk. Use the same `repoPath` in every session for that project.

### Step-by-step workflow

#### Step 0 — Prerequisites

1. Harness Manager is running (local terminals or `docker compose up -d harness-api harness-web harness-mcp`).
2. Cursor has the `harness` MCP server connected (stdio bundle or `http://127.0.0.1:8765/mcp`).
3. You know your repo's `repoPath` (see table above).

#### Step 1 — One-time init (repo not registered yet)

Use the **[recommended multi-agent init](#step-1b--multi-agent-init-paste-once-per-repo)** below (planner / coder / reviewer / architect).
For a single-agent repo, see **[docs/HARNESS_PROMPTS.md](docs/HARNESS_PROMPTS.md)** (builder-only init).

`harness_init` registers the repo and seeds config, progress, features, agents, and decisions in the central database.

#### Step 2 — Register for the dashboard (if the card doesn't appear)

The dashboard only shows registered repos. If needed:

```bash
# Local — host path
curl -X POST http://127.0.0.1:4000/repos \
  -H "Content-Type: application/json" \
  -d '{"path": "C:/Users/you/project/my-app", "name": "my-app"}'

# Docker — container path (must match the mount)
curl -X POST http://127.0.0.1:4000/repos \
  -H "Content-Type: application/json" \
  -d '{"path": "/projects/my-app", "name": "my-app"}'
```

Refresh **[http://localhost:3000](http://localhost:3000)** — click the repo card for features, decisions, and sessions.

**Re-sync index after agent edits `.harness/`:**

```bash
curl -X POST http://127.0.0.1:4000/repos/<repo-id>/resync
```

#### Step 3 — Start every work session

```text
Start a work session on repo <REPO_PATH>.

1. harness_get_context — summarize: hard constraints, agents, active features, nextSteps, recent decisions.
2. Today I want to work on: "<TASK>".
3. Acting as: <planner|coder|reviewer|architect> — follow that agent's instructions from the snapshot.
4. Map to a feature (or create one with behavior + verification), set state "active".
5. Propose a short plan, then start. Update harness_update_progress as you go.
```

#### Step 4 — During work

- **Feature in progress:** keep it `active` via `harness_update_progress`.
- **Architecture choice:** `harness_add_decision` with `rationale` and `rejected`.
- **Feature done:** run its `verification`, capture output as `evidence`, then `harness_set_feature_passing`. Never set passing without evidence.

#### Step 5 — End every work session (handoff)

```text
End session on repo <REPO_PATH>.

1. Completed features: run verification → evidence → harness_set_feature_passing.
2. Unfinished features: move out of "active" (not_started or blocked), note reason in progress.
3. Significant decisions: harness_add_decision.
4. harness_handoff with updatedAt, currentCommit, testStatus, completed, nextSteps, summary.
5. If clean-state check warns about active features, resolve and handoff again until clean.
```

A **clean handoff** means no feature left in `active` state.

### Session lifecycle (diagram)

```text
┌─────────────────────────────────────────────────────────────┐
│  ONCE PER REPO                                              │
│  harness_init → harness_upsert_agent → harness_update_feature│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  EVERY SESSION                                              │
│  harness_get_context                                        │
│       ↓                                                     │
│  harness_update_feature (active) → code + tests              │
│       ↓                                                     │
│  harness_update_progress / harness_add_decision              │
│       ↓                                                     │
│  harness_set_feature_passing (if done, with evidence)        │
│       ↓                                                     │
│  harness_handoff (must be clean)                            │
└─────────────────────────────────────────────────────────────┘
```

### Recommended setup (minimal)

Three layers, each with a **single responsibility**. Do not duplicate agent instructions across layers.

| Layer | Responsibility | Where it lives |
| ----- | -------------- | -------------- |
| **Harness** (`.harness/`) | Source of truth: agents, features, decisions, progress, constraints | Git-tracked in each repo |
| **Superpowers** | How to work: skills + subagents (brainstorm, plan, code, review) | Referenced inside `.harness/agents/*.md` |
| **Cursor rules** | When to call harness: lifecycle trigger only | **One** `.cursor/rules/harness-lifecycle.mdc` |

**Why one Cursor rule, not three?** Harness already stores full agent instructions in `.harness/agents/`.
`AGENTS.md` is a thin entry file (id + role only). Copying role routing or Superpowers lists into
`.cursor/rules/` duplicates harness and drifts out of sync. The rule's only job is to make the agent
call `harness_get_context` every session and read instructions from the snapshot.

Cursor uses **one agent** that acts as planner / coder / reviewer / architect — you do not need four separate Cursor agents.

#### Architecture (diagram)

```text
Cursor Agent
    ├── Cursor Rule (1 file)  → "start: get_context, end: handoff"
    ├── Superpowers Skills    → invoked per role (defined in .harness/agents/)
    └── Harness MCP             → read/write .harness/ (source of truth)
            └── AGENTS.md       → auto-generated thin overview
```

#### Step 1b — Multi-agent init prompt (paste once per repo)

Replace every `<PLACEHOLDER>`. Requires the **Superpowers** plugin enabled in Cursor.

```text
Initialize harness for repo at <REPO_PATH>.

1. harness_init:
   name: "<PROJECT_NAME>"
   description: "<SHORT_DESCRIPTION>"
   hardConstraints: [
     "No real network calls in unit tests",
     "Any DB schema change must go through a migration",
     "Architecture changes require harness_add_decision before implementation"
   ]

2. harness_upsert_agent — create four agents:

   id: "planner", role: "planner"
   instructions: |
     You plan work only — do not write production code.
     REQUIRED SKILLS (in order):
     1. superpowers:brainstorming — explore requirements and design
     2. superpowers:writing-plans — write plan to docs/superpowers/plans/
     Save plans as docs/superpowers/plans/YYYY-MM-DD-<feature>.md
     After plan: harness_update_feature for each task, state "not_started"
     End with harness_update_progress (nextSteps)

   id: "coder", role: "implementer"
   instructions: |
     You implement code from approved plans only.
     REQUIRED SKILLS:
     - superpowers:executing-plans OR superpowers:subagent-driven-development
     - superpowers:test-driven-development when adding behavior
     - superpowers:verification-before-completion before claiming done
     Rules:
     - One active feature at a time (WIP=1)
     - Set feature "active" before coding
     - harness_set_feature_passing only with real evidence (test output)
     - Do NOT change architecture without harness_add_decision

   id: "reviewer", role: "reviewer"
   instructions: |
     You review code quality — do not implement unless fixing review findings.
     REQUIRED SKILL: superpowers:requesting-code-review
     Dispatch superpowers:code-reviewer subagent with BASE_SHA/HEAD_SHA
     Output: Critical / Important / Minor issues
     Record significant findings via harness_add_decision if architectural

   id: "architect", role: "architect"
   instructions: |
     You own system design and trade-offs — no feature implementation.
     Workflow:
     1. Read harness_get_context + existing decisions
     2. Propose design (components, boundaries, data flow)
     3. harness_add_decision for every significant choice (include "rejected" alternatives)
     4. Update feature specs (behavior + verification) if design changes scope
     Use superpowers:brainstorming for greenfield design

3. harness_update_feature — declare initial features (state: "not_started"),
   each with behavior + a concrete verification command

4. harness_get_context — print snapshot for my confirmation.
```

After init, the repo layout looks like:

```text
my-repo/
├── AGENTS.md              # auto-generated — do not hand-edit
└── .harness/
    ├── config.json
    ├── agents/
    │   ├── planner.md
    │   ├── coder.md
    │   ├── reviewer.md
    │   └── architect.md
    ├── features.json
    ├── progress.md
    └── decisions.md
```

#### Step 1c — One Cursor rule (create in the target repo)

Create **one file** in your project repo (not in harness-manager):

**`.cursor/rules/harness-lifecycle.mdc`** (`alwaysApply: true`):

```markdown
---
description: Harness lifecycle — read agents from .harness via MCP
alwaysApply: true
---

# Harness Lifecycle

Repo path: <REPO_PATH>

Every session:
1. harness_get_context — read agents, hardConstraints, features, progress from snapshot
2. State which harness agent role you are acting as (planner / coder / reviewer / architect)
3. Follow that agent's instructions from the snapshot — do not duplicate them here
4. End: harness_handoff (clean — no active features)

Route by user intent: plan → planner, code → coder, review → reviewer, architecture → architect.
Never set feature "passing" without evidence. Record decisions via harness_add_decision.
```

Do **not** create separate rules for agent roles or Superpowers — that content belongs in
`.harness/agents/*.md` and is loaded via `harness_get_context`.

#### Role → Superpowers → Harness mapping (put this in harness agents, not Cursor rules)

| Harness role | Superpowers skill / subagent | Primary harness tools |
| ------------ | ---------------------------- | --------------------- |
| **planner** | `brainstorming` → `writing-plans` | `update_feature`, `update_progress` |
| **coder** | `executing-plans`, `subagent-driven-development`, `TDD`, `verification-before-completion` | `update_feature` (active), `set_feature_passing`, `update_progress` |
| **reviewer** | `requesting-code-review` → `code-reviewer` subagent | `add_decision` (if architectural issues found) |
| **architect** | `brainstorming` | `add_decision`, `update_feature` (spec) |

Architecture is not a separate Superpowers subagent — it is a Harness role backed by `harness_add_decision` in `.harness/decisions.md`.

Use the table above when writing `harness_upsert_agent` instructions. The agent reads them from the `get_context` snapshot at runtime.

#### Daily workflow with roles

**Session start** (add role to the existing session-start prompt):

```text
Start work session on repo <REPO_PATH>.
1. harness_get_context — summarize constraints, active features, nextSteps
2. Today: "<TASK>"
3. Acting as: <planner|coder|reviewer|architect>
```

**Example — new feature end-to-end:**

```text
Phase 1 — Architect (if needed):
  "Act as architect: evaluate auth approach for this app"
  → harness_add_decision (JWT vs session, rejected alternatives)

Phase 2 — Planner:
  "Act as planner: create implementation plan for user-auth"
  → brainstorming → writing-plans → docs/superpowers/plans/...
  → harness_update_feature (each task)

Phase 3 — Coder:
  "Act as coder: implement Task 1 from plan"
  → harness_update_feature (active) → code + tests
  → harness_set_feature_passing (with evidence)

Phase 4 — Reviewer:
  "Act as reviewer: review commits for user-auth"
  → requesting-code-review → code-reviewer subagent

Phase 5 — Handoff:
  "End session" → harness_handoff (clean state)
```

### Checklist — fully optimized harness

- [ ] Every feature has a concrete `verification` command
- [ ] `hardConstraints` declared at `init`
- [ ] No feature set to `passing` without `evidence`
- [ ] Each session opens with `get_context` and ends with a clean `handoff`
- [ ] Major decisions recorded with `rejected` alternatives
- [ ] `AGENTS.md` reflects constraints + active features + next steps
- [ ] Dashboard shows the repo (registered + resynced if needed)
- [ ] Four agents in `.harness/agents/` with Superpowers skills in their instructions
- [ ] **One** Cursor rule: `.cursor/rules/harness-lifecycle.mdc` (no duplicate role/superpowers rules)
- [ ] `docs/superpowers/plans/` exists for planner output

More copy-paste prompts: **[docs/HARNESS_PROMPTS.md](docs/HARNESS_PROMPTS.md)**

---

## Running tests

```bash
# Whole workspace (core, mcp, api, web)
pnpm exec vitest run

# Per package
pnpm exec vitest run packages/core
pnpm exec vitest run packages/mcp
pnpm exec vitest run packages/api
pnpm exec vitest run packages/web
```

## Production build (web)

```bash
pnpm --filter @harness/web build
pnpm --filter @harness/web start
```

The API still needs to run alongside it.

---

## Troubleshooting

| Symptom                       | Fix                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Empty dashboard / fetch error | Check the API is running on `4000` and `HARNESS_API_BASE` matches                                  |
| `prisma db push` fails        | Set `HARNESS_DB_URL` and run from the repo root                                                    |
| MCP `Connection closed`       | Windows: use `node.exe` + the built bundle (see the MCP section), not `pnpm`; pass an absolute `--path`; rebuild `better-sqlite3` with the same Node version |
| MCP won't connect             | Make sure `--path` points at the repo root; check the MCP log in Cursor Output                     |
| Repo doesn't show up          | POST `/repos` with a `path` that **exists on disk** (or `/projects/...` in Docker)                 |

---

## Langfuse (optional)

Fill in `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` in `.env`.
The MCP server writes a trace when an agent clocks in/out of a session; the dashboard shows a placeholder trace link (`#trace-<id>`) — you can wire it to the real Langfuse URL later.

---

## Quick command reference

```powershell
# One-time setup
pnpm install
Copy-Item .env.example .env
$env:HARNESS_DB_URL = "file:./prisma/dev.db"
pnpm exec prisma db push

# Daily run (2 terminals)
pnpm exec tsx packages/api/src/index.ts
pnpm --filter @harness/web dev
```
