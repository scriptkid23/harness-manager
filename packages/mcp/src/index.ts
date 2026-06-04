import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getPrisma, HarnessService } from "@harness/core";
import { createTracer } from "./tracing.js";
import { buildToolHandlers, registerTools } from "./server.js";

const log = (msg: string) => process.stderr.write(`[harness-mcp] ${msg}\n`);

async function main(): Promise<void> {
  log("starting…");

  const dbUrl = process.env.HARNESS_DB_URL ?? "file:./prisma/dev.db";
  const langfuseOn = Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
  log(`db=${dbUrl} langfuse=${langfuseOn ? "on" : "off"}`);

  const service = new HarnessService(getPrisma());
  const tracer = createTracer(process.env);
  const handlers = buildToolHandlers(service, tracer);

  const server = new McpServer({ name: "harness-manager", version: "0.0.0" });
  registerTools(server, handlers);
  log(`${Object.keys(handlers).length} tools registered, connecting stdio…`);

  await server.connect(new StdioServerTransport());
  log("ready (stdio connected)");
}

main().catch((err) => {
  process.stderr.write(`harness-mcp fatal: ${String(err)}\n`);
  process.exit(1);
});
