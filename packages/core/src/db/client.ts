import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

let client: PrismaClient | undefined;

function createClient(url: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

/** Lazy singleton. Accepts an override URL for tests (temp db files). */
export function getPrisma(databaseUrl?: string): PrismaClient {
  if (databaseUrl) {
    return createClient(databaseUrl);
  }
  if (!client) {
    const url = process.env.HARNESS_DB_URL ?? "file:./prisma/dev.db";
    client = createClient(url);
  }
  return client;
}
