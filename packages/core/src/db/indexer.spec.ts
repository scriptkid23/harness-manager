import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma } from "./client";
import { indexSnapshot } from "./indexer";
import type { HarnessSnapshot } from "../agents-md";

let dir: string;
let dbUrl: string;
let prisma: ReturnType<typeof getPrisma>;

const snapshot: HarnessSnapshot = {
  config: { name: "demo", hardConstraints: [] },
  agents: [{ id: "planner", role: "Planner", tools: ["read"], instructions: "Plan." }],
  features: [{ id: "F01", behavior: "b", verification: "t", state: "active" }],
  progress: { updatedAt: "2026-06-04T00:00:00Z", completed: ["F0"], inProgress: ["F01"], blocked: [], nextSteps: ["x"] },
  decisions: [{ id: "D01", date: "2026-06-04", title: "t", rationale: "r" }],
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hm-idx-"));
  dbUrl = `file:${join(dir, "test.db")}`;
  execSync("pnpm exec prisma db push", {
    env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore",
  });
  prisma = getPrisma(dbUrl);
});
afterAll(async () => { await prisma.$disconnect(); await rm(dir, { recursive: true, force: true }); });

describe("indexSnapshot", () => {
  it("upserts repo, features, agents, decisions, progress", async () => {
    const repo = await prisma.repo.create({ data: { name: "demo", path: dir } });
    await indexSnapshot(prisma, repo.id, snapshot);

    expect(await prisma.feature.count({ where: { repoId: repo.id } })).toBe(1);
    expect(await prisma.agent.count({ where: { repoId: repo.id } })).toBe(1);
    const progress = await prisma.progress.findUnique({ where: { repoId: repo.id } });
    expect(JSON.parse(progress!.inProgress)).toEqual(["F01"]);
    const agent = await prisma.agent.findFirst({ where: { repoId: repo.id } });
    expect(JSON.parse(agent!.tools!)).toEqual(["read"]);
  });

  it("replaces stale rows (re-index is idempotent)", async () => {
    const repo = await prisma.repo.create({ data: { name: "demo2", path: dir + "2" } });
    await indexSnapshot(prisma, repo.id, snapshot);
    await indexSnapshot(prisma, repo.id, { ...snapshot, features: [] });
    expect(await prisma.feature.count({ where: { repoId: repo.id } })).toBe(0);
  });
});
