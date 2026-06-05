# Harness Manager

A local-first dashboard for **Harness Engineering** across multiple repositories.
The source of truth lives in each repo's `.harness/` directory; SQLite is only a **rebuildable index**.


| Package         | Role                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `packages/core` | Schema, codec, validators, `.harness/` file writes, index DB, `HarnessService` |
| `packages/mcp`  | MCP server (stdio + HTTP) — agents read/write the harness via Cursor/Claude   |
| `packages/api`  | REST API (Fastify) — serves the dashboard                                     |
| `packages/web`  | Next.js dashboard (read-only) — view repos, features, decisions, sessions     |


**Typical flow:** register a repo via the API or MCP → an agent edits `.harness/` via MCP → the dashboard reads it through the API.

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

**Repos you want to manage must be mounted into the container.** Set this in the root `.env`:

```bash
HARNESS_PROJECTS_DIR=C:/Users/hoan.do/Documents/project   # PARENT folder that contains your repos
```

This folder is mounted as `/projects` inside the container. **Important:** when calling MCP tools, pass `repoPath` as a **container path**, e.g. `/projects/lua-dag-consensus` (not the host path) — the MCP server has an isolated filesystem.

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

> **Choosing a transport:** use **Docker + HTTP** when you want isolation/packaging (no native `better-sqlite3` worries); use the **stdio bundle** (section above) when you want the agent to operate directly on `.harness/` files on the host disk using host paths.

---

## Register a repo so the dashboard sees it

The dashboard is **read-only**; a repo must be registered first.

**Via the API:**

```bash
curl -X POST http://127.0.0.1:4000/repos `
  -H "Content-Type: application/json" `
  -d '{\"path\": \"D:/your-project\", \"name\": \"display-name\"}'
```

(PowerShell: use a backtick for line continuation, or put it on one line.)

**Via MCP:** use the `harness_init` tool with `repoPath` pointing to an existing git directory.

Then refresh **[http://localhost:3000](http://localhost:3000)** — the repo card appears; click it to see the feature garden, decisions, and sessions.

**Re-sync the index from files** (after an agent edits `.harness/`):

```bash
curl -X POST http://127.0.0.1:4000/repos/<repo-id>/resync
```

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
