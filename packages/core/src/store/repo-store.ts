import { readFile, writeFile, mkdir, readdir, rename, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";
import { parseConfig, serializeConfig } from "../codec/config.js";
import { parseFeatures, serializeFeatures } from "../codec/feature.js";
import { parseAgent, serializeAgent } from "../codec/agent.js";
import { parseProgress, serializeProgress } from "../codec/progress.js";
import { parseDecisions, serializeDecisions } from "../codec/decision.js";
import { generateAgentsMd, type HarnessSnapshot } from "../agents-md.js";
import { HarnessError } from "../errors.js";

const EMPTY_PROGRESS: Progress = {
  updatedAt: "1970-01-01T00:00:00Z",
  completed: [], inProgress: [], blocked: [], nextSteps: [],
};

export class RepoStore {
  constructor(private readonly repoPath: string) {}

  private get harnessDir(): string { return join(this.repoPath, ".harness"); }
  private file(name: string): string { return join(this.harnessDir, name); }

  private async exists(p: string): Promise<boolean> {
    try { await access(p); return true; } catch { return false; }
  }

  /** Atomic write: temp file in same dir + rename. */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    const tmp = join(dirname(filePath), `.${randomUUID()}.tmp`);
    await writeFile(tmp, content, "utf8");
    await rename(tmp, filePath);
  }

  async init(config: Config): Promise<void> {
    await mkdir(join(this.harnessDir, "agents"), { recursive: true });
    await this.atomicWrite(this.file("config.json"), serializeConfig(config));
    await this.atomicWrite(this.file("features.json"), serializeFeatures([]));
    await this.atomicWrite(this.file("progress.md"), serializeProgress({ ...EMPTY_PROGRESS }));
    await this.atomicWrite(this.file("decisions.md"), serializeDecisions([]));
    await this.regenerateAgentsMd();
  }

  async read(): Promise<HarnessSnapshot> {
    if (!(await this.exists(this.harnessDir))) {
      throw new HarnessError({
        path: this.harnessDir,
        message: "no .harness directory found",
        fix: "Run harness_init to scaffold this repo.",
      });
    }
    const config = parseConfig(await readFile(this.file("config.json"), "utf8"));
    const features = (await this.exists(this.file("features.json")))
      ? parseFeatures(await readFile(this.file("features.json"), "utf8"))
      : [];
    const progress = (await this.exists(this.file("progress.md")))
      ? parseProgress(await readFile(this.file("progress.md"), "utf8"))
      : { ...EMPTY_PROGRESS };
    const decisions = (await this.exists(this.file("decisions.md")))
      ? parseDecisions(await readFile(this.file("decisions.md"), "utf8"))
      : [];
    const agents = await this.readAgents();
    return { config, features, progress, decisions, agents };
  }

  private async readAgents(): Promise<Agent[]> {
    const agentsDir = join(this.harnessDir, "agents");
    if (!(await this.exists(agentsDir))) return [];
    const files = (await readdir(agentsDir)).filter((f) => f.endsWith(".md")).sort();
    const agents: Agent[] = [];
    for (const file of files) {
      const fileId = file.replace(/\.md$/, "");
      agents.push(parseAgent(await readFile(join(agentsDir, file), "utf8"), fileId));
    }
    return agents;
  }

  async writeConfig(config: Config): Promise<void> {
    await this.atomicWrite(this.file("config.json"), serializeConfig(config));
    await this.regenerateAgentsMd();
  }

  async writeFeatures(features: Feature[]): Promise<void> {
    await this.atomicWrite(this.file("features.json"), serializeFeatures(features));
    await this.regenerateAgentsMd();
  }

  async writeProgress(progress: Progress): Promise<void> {
    await this.atomicWrite(this.file("progress.md"), serializeProgress(progress));
    await this.regenerateAgentsMd();
  }

  async writeDecisions(decisions: Decision[]): Promise<void> {
    await this.atomicWrite(this.file("decisions.md"), serializeDecisions(decisions));
    await this.regenerateAgentsMd();
  }

  async writeAgent(agent: Agent): Promise<void> {
    await this.atomicWrite(join(this.harnessDir, "agents", `${agent.id}.md`), serializeAgent(agent));
    await this.regenerateAgentsMd();
  }

  private async regenerateAgentsMd(): Promise<void> {
    const snapshot = await this.read();
    await this.atomicWrite(join(this.repoPath, "AGENTS.md"), generateAgentsMd(snapshot));
  }
}
