import { getPrisma, HarnessService } from "@harness/core";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const prisma = getPrisma();
  const app = await buildApp(new HarnessService(prisma), prisma);
  const port = Number(process.env.PORT ?? 4000);
  // Default to loopback for local dev; containers set HOST=0.0.0.0 so sibling
  // services (web, mcp) on the compose network can reach the API.
  const host = process.env.HOST ?? "127.0.0.1";
  await app.listen({ port, host });
  process.stdout.write(`harness-api listening on http://${host}:${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`harness-api fatal: ${String(err)}\n`);
  process.exit(1);
});
