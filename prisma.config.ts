import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma v7: URL lives in prisma.config.ts, not schema.prisma (see upgrade guide)
    url: process.env.HARNESS_DB_URL ?? "file:./prisma/dev.db",
  },
});
