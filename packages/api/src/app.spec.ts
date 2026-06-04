import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPrisma, HarnessService } from "@harness/core";
import { buildApp } from "./app";

let workDir: string;
let prisma: ReturnType<typeof getPrisma>;
let app: Awaited<ReturnType<typeof buildApp>>;
let repoPath: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-api-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("pnpm exec prisma db push", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  app = await buildApp(new HarnessService(prisma), prisma);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(workDir, { recursive: true, force: true });
});
beforeEach(async () => {
  repoPath = await mkdtemp(join(workDir, "repo-"));
});

describe("API", () => {
  it("POST /repos registers + scaffolds, GET /repos lists it", async () => {
    const post = await app.inject({ method: "POST", url: "/repos", payload: { path: repoPath, name: "demo" } });
    expect(post.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/repos" });
    expect(list.json().some((r: { path: string }) => r.path === repoPath)).toBe(true);
  });

  it("GET /repos/:id/features returns indexed features after resync", async () => {
    const post = await app.inject({ method: "POST", url: "/repos", payload: { path: repoPath, name: "demo" } });
    const id = post.json().id;
    await new HarnessService(prisma).upsertFeature(repoPath, { id: "F01", behavior: "b", verification: "t", state: "active" });
    await app.inject({ method: "POST", url: `/repos/${id}/resync` });
    const res = await app.inject({ method: "GET", url: `/repos/${id}/features` });
    expect(res.json().map((f: { featureId: string }) => f.featureId)).toContain("F01");
  });

  it("returns 400 with a clear message when registering a path that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { path: join(workDir, "does-not-exist"), name: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/path/i);
  });

  it("returns 404 for an unknown repo id", async () => {
    const res = await app.inject({ method: "GET", url: "/repos/nope/features" });
    expect(res.statusCode).toBe(404);
  });
});
