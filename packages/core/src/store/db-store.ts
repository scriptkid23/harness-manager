import type { PrismaClient } from "../generated/prisma/client.js";
import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";
import { HarnessError } from "../errors.js";
import type { HarnessStore } from "./harness-store.js";
import type { HarnessSnapshot } from "./types.js";

const EMPTY_PROGRESS: Progress = {
  updatedAt: "1970-01-01T00:00:00Z",
  completed: [], inProgress: [], blocked: [], nextSteps: [],
};

export class DbStore implements HarnessStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repoPath: string,
  ) {}

  private async resolveRepoId(name?: string): Promise<string> {
    const existing = await this.prisma.repo.findUnique({ where: { path: this.repoPath } });
    if (existing) return existing.id;
    const created = await this.prisma.repo.create({
      data: { name: name ?? this.repoPath, path: this.repoPath },
    });
    return created.id;
  }

  private async repoId(): Promise<string> {
    const repo = await this.prisma.repo.findUnique({ where: { path: this.repoPath } });
    if (!repo) {
      throw new HarnessError({
        path: this.repoPath,
        message: "repo not found",
        fix: "Run harness_init first.",
      });
    }
    return repo.id;
  }

  async init(config: Config): Promise<void> {
    const repoId = await this.resolveRepoId(config.name);
    await this.prisma.$transaction([
      this.prisma.repo.update({
        where: { id: repoId },
        data: {
          name: config.name,
          description: config.description ?? null,
          hardConstraints: JSON.stringify(config.hardConstraints),
          langfuseProjectId: config.langfuseProjectId ?? null,
          indexedAt: new Date(),
        },
      }),
      this.prisma.progress.deleteMany({ where: { repoId } }),
      this.prisma.progress.create({
        data: {
          repoId,
          updatedAt: EMPTY_PROGRESS.updatedAt,
          completed: JSON.stringify(EMPTY_PROGRESS.completed),
          inProgress: JSON.stringify(EMPTY_PROGRESS.inProgress),
          blocked: JSON.stringify(EMPTY_PROGRESS.blocked),
          nextSteps: JSON.stringify(EMPTY_PROGRESS.nextSteps),
        },
      }),
      this.prisma.feature.deleteMany({ where: { repoId } }),
      this.prisma.agent.deleteMany({ where: { repoId } }),
      this.prisma.decision.deleteMany({ where: { repoId } }),
    ]);
  }

  async read(): Promise<HarnessSnapshot> {
    const repo = await this.prisma.repo.findUnique({ where: { path: this.repoPath } });
    if (!repo) {
      throw new HarnessError({
        path: this.repoPath,
        message: "repo not found",
        fix: "Run harness_init to scaffold this repo.",
      });
    }
    const progress = await this.prisma.progress.findUnique({ where: { repoId: repo.id } });
    if (!progress) {
      throw new HarnessError({
        path: this.repoPath,
        message: "repo not initialized",
        fix: "Run harness_init to scaffold this repo.",
      });
    }
    const [features, agents, decisions] = await Promise.all([
      this.prisma.feature.findMany({ where: { repoId: repo.id } }),
      this.prisma.agent.findMany({ where: { repoId: repo.id } }),
      this.prisma.decision.findMany({ where: { repoId: repo.id }, orderBy: { date: "desc" } }),
    ]);

    return {
      config: {
        name: repo.name,
        description: repo.description ?? undefined,
        langfuseProjectId: repo.langfuseProjectId ?? undefined,
        hardConstraints: JSON.parse(repo.hardConstraints) as string[],
      },
      features: features.map((f) => ({
        id: f.featureId,
        behavior: f.behavior,
        verification: f.verification,
        state: f.state as Feature["state"],
        evidence: f.evidence ?? undefined,
      })),
      agents: agents.map((a) => ({
        id: a.agentId,
        role: a.role,
        model: a.model ?? undefined,
        tools: a.tools ? (JSON.parse(a.tools) as string[]) : undefined,
        instructions: a.instructions,
      })),
      progress: {
        currentCommit: progress.currentCommit ?? undefined,
        testStatus: progress.testStatus ?? undefined,
        updatedAt: progress.updatedAt,
        completed: JSON.parse(progress.completed) as string[],
        inProgress: JSON.parse(progress.inProgress) as string[],
        blocked: JSON.parse(progress.blocked) as string[],
        nextSteps: JSON.parse(progress.nextSteps) as string[],
      },
      decisions: decisions.map((d) => ({
        id: d.decisionId,
        date: d.date,
        title: d.title,
        rationale: d.rationale,
        rejected: d.rejected ?? undefined,
      })),
    };
  }

  async writeConfig(config: Config): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.repo.update({
      where: { id: repoId },
      data: {
        name: config.name,
        description: config.description ?? null,
        hardConstraints: JSON.stringify(config.hardConstraints),
        langfuseProjectId: config.langfuseProjectId ?? null,
        indexedAt: new Date(),
      },
    });
  }

  async writeFeatures(features: Feature[]): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.$transaction([
      this.prisma.feature.deleteMany({ where: { repoId } }),
      this.prisma.feature.createMany({
        data: features.map((f) => ({
          repoId,
          featureId: f.id,
          behavior: f.behavior,
          verification: f.verification,
          state: f.state,
          evidence: f.evidence ?? null,
        })),
      }),
      this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } }),
    ]);
  }

  async writeProgress(progress: Progress): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.progress.upsert({
      where: { repoId },
      create: {
        repoId,
        currentCommit: progress.currentCommit ?? null,
        testStatus: progress.testStatus ?? null,
        updatedAt: progress.updatedAt,
        completed: JSON.stringify(progress.completed),
        inProgress: JSON.stringify(progress.inProgress),
        blocked: JSON.stringify(progress.blocked),
        nextSteps: JSON.stringify(progress.nextSteps),
      },
      update: {
        currentCommit: progress.currentCommit ?? null,
        testStatus: progress.testStatus ?? null,
        updatedAt: progress.updatedAt,
        completed: JSON.stringify(progress.completed),
        inProgress: JSON.stringify(progress.inProgress),
        blocked: JSON.stringify(progress.blocked),
        nextSteps: JSON.stringify(progress.nextSteps),
      },
    });
    await this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } });
  }

  async writeDecisions(decisions: Decision[]): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.$transaction([
      this.prisma.decision.deleteMany({ where: { repoId } }),
      this.prisma.decision.createMany({
        data: decisions.map((d) => ({
          repoId,
          decisionId: d.id,
          date: d.date,
          title: d.title,
          rationale: d.rationale,
          rejected: d.rejected ?? null,
        })),
      }),
      this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } }),
    ]);
  }

  async writeAgent(agent: Agent): Promise<void> {
    const repoId = await this.repoId();
    await this.prisma.agent.upsert({
      where: { repoId_agentId: { repoId, agentId: agent.id } },
      create: {
        repoId,
        agentId: agent.id,
        role: agent.role,
        model: agent.model ?? null,
        tools: agent.tools ? JSON.stringify(agent.tools) : null,
        instructions: agent.instructions,
      },
      update: {
        role: agent.role,
        model: agent.model ?? null,
        tools: agent.tools ? JSON.stringify(agent.tools) : null,
        instructions: agent.instructions,
      },
    });
    await this.prisma.repo.update({ where: { id: repoId }, data: { indexedAt: new Date() } });
  }
}
