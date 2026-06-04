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

```bash
pnpm exec tsx packages/mcp/src/index.ts
```

**Ví dụ cấu hình Cursor** — copy `.cursor/mcp.json` trong repo, hoặc thêm vào Settings → MCP.

macOS / Linux (`pnpm` trên PATH):

```json
{
  "mcpServers": {
    "harness": {
      "command": "pnpm",
      "args": ["exec", "tsx", "packages/mcp/src/index.ts"],
      "cwd": "/absolute/path/to/harness-manager",
      "env": { "HARNESS_DB_URL": "file:./prisma/dev.db" }
    }
  }
}
```

Windows — Cursor spawn **không qua shell**, nên `"command": "pnpm"` thường gây `Connection closed`. Dùng `node.exe` + `tsx` (cùng Node với API, ví dụ 20.x):

```json
{
  "mcpServers": {
    "harness": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/absolute/path/to/harness-manager/node_modules/tsx/dist/cli.mjs",
        "packages/mcp/src/index.ts"
      ],
      "cwd": "C:/absolute/path/to/harness-manager",
      "env": { "HARNESS_DB_URL": "file:./prisma/dev.db" }
    }
  }
}
```

Đổi mọi đường dẫn `C:/...` cho khớp máy bạn. Sau khi sửa config: **tắt/bật lại** server `harness` trong MCP settings.

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

