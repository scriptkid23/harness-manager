import { getPrisma, HarnessService } from "@harness/core";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const prisma = getPrisma();
  const app = await buildApp(new HarnessService(prisma), prisma);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: "127.0.0.1" });
  process.stdout.write(`harness-api listening on http://127.0.0.1:${port}\n`);
}

main().catch((err) => {
  process.stderr.write(`harness-api fatal: ${String(err)}\n`);
  process.exit(1);
});
