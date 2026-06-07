import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "hm-e2e-"));
  const dbUrl = `file:${join(workDir, "test.db")}`;
  execSync("pnpm exec prisma db push", { env: { ...process.env, HARNESS_DB_URL: dbUrl }, stdio: "ignore" });
  prisma = getPrisma(dbUrl);
  handlers = buildToolHandlers(new HarnessService(prisma), createTracer({}));
});
afterAll(async () => { await prisma.$disconnect(); await rm(workDir, { recursive: true, force: true }); });

describe("E2E: init → context → feature → passing → handoff", () => {
  it("completes the full flow and records DB state + a closed session", async () => {
    const repoPath = `/projects/e2e-${Date.now()}`;

    expect((await handlers.harness_init({ repoPath, name: "demo", hardConstraints: ["no force push"] })).isError).toBeFalsy();
    expect((await handlers.harness_get_context({ repoPath })).isError).toBeFalsy();
    expect((await handlers.harness_update_feature({ repoPath, id: "F01", behavior: "logs in", verification: "npm test", state: "active" })).isError).toBeFalsy();
    expect((await handlers.harness_set_feature_passing({ repoPath, id: "F01", evidence: "commit abc123" })).isError).toBeFalsy();
    const handoff = await handlers.harness_handoff({ repoPath, updatedAt: "2026-06-04T12:00:00Z", summary: "done", completed: ["F01"] });
    expect(handoff.isError).toBeFalsy();

    const repo = await prisma.repo.findUnique({ where: { path: repoPath } });
    const features = await prisma.feature.findMany({ where: { repoId: repo!.id } });
    expect(features[0]).toMatchObject({ featureId: "F01", state: "passing", evidence: "commit abc123" });
    expect(repo?.hardConstraints).toContain("no force push");

    const sessions = await prisma.session.findMany({ where: { repoId: repo!.id } });
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.endedAt).not.toBeNull();
    expect(sessions[0]?.summary).toBe("done");
  });
});
