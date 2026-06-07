import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma } from "../db/client.js";
import { HarnessService } from "./harness-service.js";

let workDir: string;
let dbUrl: string;
let prisma: ReturnType<typeof getPrisma>;
let service: HarnessService;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-svc-"));
  dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("pnpm exec prisma db push", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  service = new HarnessService(prisma);
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });
beforeEach(() => { repoPath = `/projects/test-${Date.now()}`; });

describe("HarnessService", () => {
  it("init scaffolds, auto-registers the repo, and indexes", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    const repo = await prisma.repo.findUnique({ where: { path: repoPath } });
    expect(repo?.name).toBe("demo");
    const ctx = await service.getContext(repoPath);
    expect(ctx.config.name).toBe("demo");
  });

  it("updateFeature warns when activating a 2nd feature (WIP=1)", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    await service.upsertFeature(repoPath, { id: "F01", behavior: "a", verification: "t", state: "active" });
    const res = await service.upsertFeature(repoPath, { id: "F02", behavior: "b", verification: "t", state: "active" });
    expect(res.warnings.some((w) => /WIP/.test(w))).toBe(true);
  });

  it("setFeaturePassing rejects without evidence and accepts with it", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    await service.upsertFeature(repoPath, { id: "F01", behavior: "a", verification: "t", state: "active" });
    await expect(service.setFeaturePassing(repoPath, "F01", "")).rejects.toThrow(/evidence/i);
    await service.setFeaturePassing(repoPath, "F01", "commit abc123");
    const ctx = await service.getContext(repoPath);
    expect(ctx.features.find((f) => f.id === "F01")?.state).toBe("passing");
  });

  it("updateConfig patches description and hardConstraints without wiping agents", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    await service.upsertAgent(repoPath, { id: "planner", role: "planner", instructions: "plan" });
    const updated = await service.updateConfig(repoPath, {
      description: "Nx monorepo",
      hardConstraints: ["no network in tests"],
    });
    expect(updated.config.description).toBe("Nx monorepo");
    expect(updated.config.hardConstraints).toEqual(["no network in tests"]);
    expect(updated.agents).toHaveLength(1);
  });

  it("addDecision appends and indexes", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    await service.addDecision(repoPath, { id: "D01", date: "2026-06-04", title: "t", rationale: "r" });
    const ctx = await service.getContext(repoPath);
    expect(ctx.decisions.map((d) => d.id)).toContain("D01");
  });
});

describe("HarnessService sessions", () => {
  it("startSession creates a row and endSession closes it", async () => {
    await service.init(repoPath, { name: "demo", hardConstraints: [] });
    const repo = await prisma.repo.findUnique({ where: { path: repoPath } });
    const sessionId = await service.startSession(repoPath, "trace-xyz", new Date("2026-06-04T00:00:00Z"));
    let row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.repoId).toBe(repo!.id);
    expect(row?.endedAt).toBeNull();

    await service.endSession(sessionId, "wrapped up", new Date("2026-06-04T01:00:00Z"));
    row = await prisma.session.findUnique({ where: { id: sessionId } });
    expect(row?.endedAt).not.toBeNull();
    expect(row?.summary).toBe("wrapped up");
  });
});
