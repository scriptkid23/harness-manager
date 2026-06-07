import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma } from "../db/client.js";
import { DbStore } from "./db-store.js";

let workDir: string;
let prisma: ReturnType<typeof getPrisma>;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-dbstore-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("pnpm exec prisma db push", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });
beforeEach(() => { repoPath = `/projects/demo-${Date.now()}`; });

describe("DbStore", () => {
  it("init seeds repo config and empty snapshot", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({
      name: "socmint",
      description: "Nx monorepo",
      hardConstraints: ["no network in tests"],
    });
    const snap = await store.read();
    expect(snap.config.name).toBe("socmint");
    expect(snap.config.description).toBe("Nx monorepo");
    expect(snap.config.hardConstraints).toEqual(["no network in tests"]);
    expect(snap.features).toEqual([]);
    expect(snap.agents).toEqual([]);
    expect(snap.decisions).toEqual([]);
  });

  it("read throws when repo not initialized", async () => {
    const store = new DbStore(prisma, "/projects/never-inited");
    await expect(store.read()).rejects.toThrow(/harness_init/i);
  });

  it("writeFeatures round-trips through read", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeFeatures([
      { id: "F01", behavior: "logs in", verification: "pnpm test", state: "active" },
    ]);
    const snap = await store.read();
    expect(snap.features[0]).toMatchObject({ id: "F01", state: "active" });
  });

  it("writeAgent upserts a single agent", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeAgent({
      id: "planner",
      role: "planner",
      instructions: "Plan only.",
      tools: ["brainstorming"],
    });
    const snap = await store.read();
    expect(snap.agents[0]?.id).toBe("planner");
    expect(snap.agents[0]?.tools).toEqual(["brainstorming"]);
  });

  it("writeDecisions and writeProgress round-trip", async () => {
    const store = new DbStore(prisma, repoPath);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeDecisions([
      { id: "D01", date: "2026-06-07", title: "DB canonical", rationale: "no mount pain" },
    ]);
    await store.writeProgress({
      updatedAt: "2026-06-07T12:00:00Z",
      completed: ["F01"],
      inProgress: [],
      blocked: [],
      nextSteps: ["ship dashboard"],
      testStatus: "42 passed",
    });
    const snap = await store.read();
    expect(snap.decisions[0]?.id).toBe("D01");
    expect(snap.progress.completed).toEqual(["F01"]);
    expect(snap.progress.testStatus).toBe("42 passed");
  });
});
