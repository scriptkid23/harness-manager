# Harness Manager

Bảng điều khiển local-first cho **Harness Engineering** trên nhiều repository.  
Dữ liệu gốc nằm trong thư mục `.harness/` của từng repo; SQLite chỉ là **index có thể build lại**.


| Gói             | Vai trò                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `packages/core` | Schema, codec, validators, ghi file `.harness/`, index DB, `HarnessService` |
| `packages/mcp`  | MCP server (stdio) — agent đọc/ghi harness qua Cursor/Claude                |
| `packages/api`  | REST API (Fastify) — phục vụ dashboard                                      |
| `packages/web`  | Dashboard Next.js (chỉ đọc) — xem repo, features, decisions, sessions       |


**Luồng dùng thường gặp:** đăng ký repo qua API hoặc MCP → agent chỉnh `.harness/` qua MCP → dashboard đọc qua API.

---

## Yêu cầu

- **Node.js** ≥ 20.9
- **pnpm** 9.x (`corepack enable` rồi `corepack prepare pnpm@9.15.4 --activate` nếu chưa có)
- Windows / macOS / Linux

---

## Cài đặt (lần đầu)

### 1. Clone và cài dependency

```bash
cd harness-manager
pnpm install
```

Lệnh `postinstall` sẽ tự chạy `prisma generate`.

### 2. Biến môi trường

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Chỉnh `.env` nếu cần:


| Biến                  | Mặc định                     | Ý nghĩa                     |
| --------------------- | ---------------------------- | --------------------------- |
| `HARNESS_DB_URL`      | `file:./prisma/dev.db`       | SQLite index (cache)        |
| `LANGFUSE_HOST`       | `https://cloud.langfuse.com` | Host Langfuse (tùy chọn)    |
| `LANGFUSE_PUBLIC_KEY` | (trống)                      | Bật tracing session qua MCP |
| `LANGFUSE_SECRET_KEY` | (trống)                      | Cặp với public key          |


Không có key Langfuse → tracing **tắt im lặng**, mọi thứ khác vẫn chạy.

### 3. Tạo database

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

Hoặc dùng script có sẵn (đọc `HARNESS_DB_URL` từ `.env` nếu đã load):

```bash
pnpm prisma:push
```

---

## Chạy dự án

Cần **hai terminal** cho dashboard đầy đủ (API + Web). MCP chạy riêng khi cấu hình agent.

### Terminal 1 — API (cổng 4000)

```bash
pnpm exec tsx packages/api/src/index.ts
```

Thấy dòng: `harness-api listening on http://127.0.0.1:4000`

Đổi cổng: `$env:PORT=5000` (PowerShell) hoặc `PORT=5000` (bash) trước khi chạy.

### Terminal 2 — Dashboard (cổng 3000)

```bash
pnpm --filter @harness/web dev
```

Mở trình duyệt: **[http://localhost:3000](http://localhost:3000)**

Dashboard gọi API tại `http://127.0.0.1:4000`. Đổi URL API:

```bash
# PowerShell
$env:HARNESS_API_BASE = "http://127.0.0.1:4000"
pnpm --filter @harness/web dev
```

### MCP server (stdio) — cho Cursor / Claude

MCP server chạy từ **một file bundle đã build** (`packages/mcp/dist/harness-mcp.mjs`), không cần `tsx` nữa.
Build chạy tự động trong `postinstall`; build lại thủ công khi sửa code MCP:

```bash
pnpm --filter @harness/mcp build
```

Chạy trực tiếp (debug):

```bash
node packages/mcp/dist/harness-mcp.mjs --path .
```

**Cấu hình Cursor** — repo đã có sẵn `.cursor/mcp.json` rất gọn (không `env`, không `cwd`):
server tự suy DB ra `file:<path>/prisma/dev.db` (tuyệt đối) và tự nạp `<path>/.env` để lấy key Langfuse.

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

`${workspaceFolder}` được Cursor thay bằng đường dẫn repo, nên config dùng được trên mọi máy mà không sửa path.

**Vì sao vẫn là `node.exe` chứ không phải lệnh trần `harness-mcp`?** Trên Windows, Cursor spawn MCP **không qua shell**, nên các shim `.cmd`/`.ps1` (thứ duy nhất `pnpm/npm link` tạo ra cho tool Node) gây `Connection closed`. Lệnh trần chỉ chạy ổn nếu là **native `.exe`**. Ngoài ra đường dẫn `node.exe` còn ghim đúng Node 20 — cùng Node đã build `better-sqlite3` (Node 22 sẽ lỗi `NODE_MODULE_VERSION`).

Mọi secret (key Langfuse) để trong `.env` ở root repo, **không** đặt trong `mcp.json`. Sau khi sửa config: **tắt/bật lại** server `harness` trong MCP settings.

---

## Chạy bằng Docker (cả cụm)

Thay vì chạy tay từng tiến trình, có thể dựng cả cụm bằng compose. Image chung cho 3 service (api/web/mcp), một index SQLite trung tâm nằm trên volume `harness_db`.

```bash
# Build + chạy app harness (api 4000, web 3000, mcp 8765)
docker compose up -d harness-api harness-web harness-mcp

# Mở dashboard
#   http://localhost:3000
# MCP Streamable HTTP:
#   http://localhost:8765/mcp   (health: http://localhost:8765/health)
```

`harness-migrate` (chạy một lần, tự `prisma db push`) khởi tạo schema trước khi `api`/`mcp` lên.

**Repo cần quản lý phải được mount vào container.** Đặt trong `.env` ở root:

```bash
HARNESS_PROJECTS_DIR=C:/Users/hoan.do/Documents/project   # thư mục CHA chứa các repo
```

Thư mục này được mount thành `/projects` trong container. **Quan trọng:** khi gọi tool MCP, truyền `repoPath` theo **đường dẫn trong container**, ví dụ `/projects/lua-dag-consensus` (không phải path host) — vì MCP chạy cô lập filesystem.

**Cấu hình Cursor cho MCP qua HTTP** (đúng kiểu "chỉ connect tới 1 port"):

```json
{
  "mcpServers": {
    "harness": { "url": "http://127.0.0.1:8765/mcp" }
  }
}
```

Nếu bản Cursor chưa hỗ trợ trường `url`, dùng proxy `mcp-remote` (giống `docgraph`):

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

Langfuse: image MCP đọc `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` từ `.env` (compose tự nội suy), còn `LANGFUSE_HOST` trỏ tới service `langfuse-web` trong cụm. Muốn chạy luôn stack Langfuse: `docker compose up -d` (không kèm tên service).

> **Chọn transport:** dùng **Docker + HTTP** khi muốn cô lập/đóng gói (hết lo native `better-sqlite3`); dùng **stdio bundle** (mục trên) khi muốn agent thao tác trực tiếp file `.harness/` trên đĩa host bằng đường dẫn host.

---

## Đăng ký repo để dashboard thấy

Dashboard **chỉ đọc**; repo phải được đăng ký trước.

**Qua API:**

```bash
curl -X POST http://127.0.0.1:4000/repos `
  -H "Content-Type: application/json" `
  -d '{\"path\": \"D:/du-an-cua-ban\", \"name\": \"ten-hien-thi\"}'
```

(PowerShell: dùng backtick xuống dòng hoặc gộp một dòng.)

**Qua MCP:** dùng tool `harness_init` với `repoPath` trỏ tới thư mục git đã tồn tại.

Sau đó refresh **[http://localhost:3000](http://localhost:3000)** — card repo xuất hiện; bấm vào để xem feature garden, decisions, sessions.

**Đồng bộ lại index từ file** (sau khi agent sửa `.harness/`):

```bash
curl -X POST http://127.0.0.1:4000/repos/<repo-id>/resync
```

---

## Chạy test

```bash
# Toàn workspace (core, mcp, api, web)
pnpm exec vitest run

# Từng gói
pnpm exec vitest run packages/core
pnpm exec vitest run packages/mcp
pnpm exec vitest run packages/api
pnpm exec vitest run packages/web
```

## Build production (web)

```bash
pnpm --filter @harness/web build
pnpm --filter @harness/web start
```

Vẫn cần API chạy song song.

---

## Xử lý lỗi thường gặp


| Triệu chứng                 | Cách xử lý                                                 |
| --------------------------- | ---------------------------------------------------------- |
| Dashboard trống / lỗi fetch | Kiểm tra API đang chạy ở `4000`, `HARNESS_API_BASE` khớp   |
| `prisma db push` lỗi        | Đặt `HARNESS_DB_URL`, chạy từ root repo                    |
| MCP `Connection closed`     | Windows: dùng `node.exe` + `tsx` (xem mục MCP), không dùng `pnpm`; `cwd` tuyệt đối; cùng Node khi `pnpm rebuild better-sqlite3` |
| MCP không kết nối           | `cwd` trỏ đúng root repo; xem log MCP trong Cursor Output |
| Repo không hiện             | POST `/repos` với `path` **tồn tại trên đĩa**              |


---

## Langfuse (tùy chọn)

Điền `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` trong `.env`.  
MCP ghi trace khi agent clock-in/clock-out session; dashboard hiện link trace dạng placeholder (`#trace-<id>`) — có thể nối URL Langfuse thật sau.

---

## Tóm tắt lệnh nhanh

```powershell
# Setup một lần
pnpm install
Copy-Item .env.example .env
$env:HARNESS_DB_URL = "file:./prisma/dev.db"
pnpm exec prisma db push

# Chạy hàng ngày (2 terminal)
pnpm exec tsx packages/api/src/index.ts
pnpm --filter @harness/web dev
```

