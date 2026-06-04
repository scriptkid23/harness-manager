import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma, HarnessService } from "@harness/core";
import { createTracer } from "./tracing";
import { buildToolHandlers } from "./server";

let workDir: string;
let prisma: ReturnType<typeof getPrisma>;
let handlers: ReturnType<typeof buildToolHandlers>;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-mcp-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("pnpm exec prisma db push", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  handlers = buildToolHandlers(new HarnessService(prisma), createTracer({}));
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });
beforeEach(async () => { repoPath = await mkdtemp(join(workDir, "repo-")); });

describe("MCP tool handlers", () => {
  it("harness_init then harness_get_context returns overview text", async () => {
    await handlers.harness_init({ repoPath, name: "demo", hardConstraints: [] });
    const ctx = await handlers.harness_get_context({ repoPath });
    expect(ctx.isError).toBeFalsy();
    expect(JSON.stringify(ctx.content)).toContain("demo");
  });

  it("harness_set_feature_passing without evidence returns an agent-oriented error", async () => {
    await handlers.harness_init({ repoPath, name: "demo", hardConstraints: [] });
    await handlers.harness_update_feature({ repoPath, id: "F01", behavior: "a", verification: "t", state: "active" });
    const res = await handlers.harness_set_feature_passing({ repoPath, id: "F01", evidence: "" });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/evidence/i);
  });

  it("harness_update_feature surfaces WIP=1 warning in the result", async () => {
    await handlers.harness_init({ repoPath, name: "demo", hardConstraints: [] });
    await handlers.harness_update_feature({ repoPath, id: "F01", behavior: "a", verification: "t", state: "active" });
    const res = await handlers.harness_update_feature({ repoPath, id: "F02", behavior: "b", verification: "t", state: "active" });
    expect(JSON.stringify(res.content)).toMatch(/WIP/);
  });
});
