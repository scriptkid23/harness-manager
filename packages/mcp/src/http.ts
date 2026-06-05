import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getPrisma, HarnessService } from "@harness/core";
import { createTracer } from "./tracing.js";
import { buildToolHandlers, registerTools } from "./server.js";
import { resolveBaseDir, applyRuntimeEnv } from "./runtime.js";

const log = (msg: string) => process.stderr.write(`[harness-http] ${msg}\n`);

/** Read and JSON-parse the request body (POST only). */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

async function main(): Promise<void> {
  // In Docker, HARNESS_DB_URL is set explicitly (e.g. file:/data/dev.db); --path
  // only seeds the .env / DB defaults when nothing is provided.
  const baseDir = resolveBaseDir(process.argv.slice(2));
  applyRuntimeEnv(baseDir);

  const port = Number(process.env.PORT ?? 8765);
  const host = process.env.HOST ?? "0.0.0.0";
  const langfuseOn = Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
  log(`db=${process.env.HARNESS_DB_URL} langfuse=${langfuseOn ? "on" : "off"}`);

  // Shared across all client sessions; only the per-connection session map
  // (inside buildToolHandlers) needs to be per transport.
  const service = new HarnessService(getPrisma());
  const tracer = createTracer(process.env);

  // One transport per MCP session id; a fresh McpServer/handlers per session so
  // the get_context -> handoff lifecycle stays isolated to one client.
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = createServer(async (req, res) => {
    try {
      setCors(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: transports.size }));
        return;
      }

      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (req.method === "POST") {
        const body = await readBody(req);
        if (!transport) {
          if (!isInitializeRequest(body)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session" }, id: null }));
            return;
          }
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => transports.set(id, transport!),
          });
          transport.onclose = () => {
            if (transport!.sessionId) transports.delete(transport!.sessionId);
          };
          const mcp = new McpServer({ name: "harness-manager", version: "0.0.0" });
          registerTools(mcp, buildToolHandlers(service, tracer));
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res, body);
        return;
      }

      // GET (SSE stream) / DELETE (terminate) require an existing session.
      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unknown or missing mcp-session-id" }));
        return;
      }
      await transport.handleRequest(req, res);
    } catch (err) {
      log(`request error: ${String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    }
  });

  server.listen(port, host, () => log(`ready on http://${host}:${port}/mcp`));
}

main().catch((err) => {
  process.stderr.write(`harness-http fatal: ${String(err)}\n`);
  process.exit(1);
});
