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
beforeEach(() => { repoPath = `/projects/api-test-${Date.now()}`; });

describe("API", () => {
  it("POST /repos registers + scaffolds, GET /repos lists it", async () => {
    const post = await app.inject({ method: "POST", url: "/repos", payload: { path: repoPath, name: "demo" } });
    expect(post.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/repos" });
    expect(list.json().some((r: { path: string }) => r.path === repoPath)).toBe(true);
  });

  it("GET /repos/:id/features returns features after service write", async () => {
    const post = await app.inject({ method: "POST", url: "/repos", payload: { path: repoPath, name: "demo" } });
    const id = post.json().id;
    await new HarnessService(prisma).upsertFeature(repoPath, { id: "F01", behavior: "b", verification: "t", state: "active" });
    const res = await app.inject({ method: "GET", url: `/repos/${id}/features` });
    expect(res.json().map((f: { featureId: string }) => f.featureId)).toContain("F01");
  });

  it("POST /repos accepts a logical path that does not exist on disk", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { path: "/projects/socmint", name: "socmint" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().path).toBe("/projects/socmint");
  });

  it("GET /repos/:id returns repo config fields", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/repos",
      payload: { path: "/projects/config-test", name: "config-test" },
    });
    const id = post.json().id;
    const res = await app.inject({ method: "GET", url: `/repos/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("config-test");
  });

  it("returns 404 for an unknown repo id", async () => {
    const res = await app.inject({ method: "GET", url: "/repos/nope/features" });
    expect(res.statusCode).toBe(404);
  });
});
