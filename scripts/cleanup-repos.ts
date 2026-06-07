import { getPrisma } from "./packages/core/src/db/client.js";

const name = process.argv[2];
if (!name) {
  console.error("Usage: pnpm exec tsx scripts/cleanup-repos.ts <repo-name>");
  process.exit(1);
}

const prisma = getPrisma();
const repos = await prisma.repo.findMany({ where: { name } });
console.log("Found:", repos.map((r) => ({ id: r.id, path: r.path })));

const result = await prisma.repo.deleteMany({ where: { name } });
console.log("Deleted:", result.count);

await prisma.$disconnect();
