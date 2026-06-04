import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RepoStore } from "./repo-store";
import { AGENTS_MD_MARKER } from "../agents-md";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "hm-store-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("RepoStore", () => {
  it("scaffolds .harness + AGENTS.md on init", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: [] });
    const agentsMd = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain(AGENTS_MD_MARKER);
    const snap = await store.read();
    expect(snap.config.name).toBe("demo");
    expect(snap.features).toEqual([]);
  });

  it("writes a feature atomically and round-trips through read", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: [] });
    await store.writeFeatures([
      { id: "F01", behavior: "b", verification: "npm test", state: "active" },
    ]);
    const snap = await store.read();
    expect(snap.features[0]?.id).toBe("F01");
  });

  it("regenerates AGENTS.md after a write", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: ["no force push"] });
    await store.writeFeatures([{ id: "F01", behavior: "b", verification: "t", state: "active" }]);
    const agentsMd = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("F01");
    expect(agentsMd).toContain("no force push");
  });

  it("reads agents from agents/ directory", async () => {
    const store = new RepoStore(dir);
    await store.init({ name: "demo", hardConstraints: [] });
    await mkdir(join(dir, ".harness", "agents"), { recursive: true });
    await writeFile(join(dir, ".harness", "agents", "planner.md"), "---\nrole: Planner\n---\nPlan.", "utf8");
    const snap = await store.read();
    expect(snap.agents.map((a) => a.id)).toContain("planner");
  });

  it("throws HarnessError when .harness missing on read", async () => {
    const store = new RepoStore(dir);
    await expect(store.read()).rejects.toThrow(/harness_init/);
  });
});
