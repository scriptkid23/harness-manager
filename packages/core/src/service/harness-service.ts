import type { PrismaClient } from "../generated/prisma/client.js";
import type { Agent, Config, Decision, Feature, FeatureState, Progress } from "../schemas/index.js";
import type { HarnessSnapshot } from "../agents-md.js";
import { RepoStore } from "../store/repo-store.js";
import { indexSnapshot } from "../db/indexer.js";
import { checkWipLimit, assertPassEvidence } from "../validators.js";
import { HarnessError } from "../errors.js";

export interface WriteResult {
  snapshot: HarnessSnapshot;
  warnings: string[];
}

export class HarnessService {
  constructor(private readonly prisma: PrismaClient) {}

  private store(repoPath: string): RepoStore {
    return new RepoStore(repoPath);
  }

  /** Find-or-create the repo row for a path. */
  private async resolveRepoId(repoPath: string, name?: string): Promise<string> {
    const existing = await this.prisma.repo.findUnique({ where: { path: repoPath } });
    if (existing) return existing.id;
    const created = await this.prisma.repo.create({ data: { name: name ?? repoPath, path: repoPath } });
    return created.id;
  }

  private async reindex(repoPath: string): Promise<HarnessSnapshot> {
    const snapshot = await this.store(repoPath).read();
    const repoId = await this.resolveRepoId(repoPath, snapshot.config.name);
    await indexSnapshot(this.prisma, repoId, snapshot);
    return snapshot;
  }

  async init(repoPath: string, config: Config): Promise<HarnessSnapshot> {
    await this.store(repoPath).init(config);
    return this.reindex(repoPath);
  }

  async getContext(repoPath: string): Promise<HarnessSnapshot> {
    return this.reindex(repoPath);
  }

  async upsertFeature(repoPath: string, feature: Feature): Promise<WriteResult> {
    if (feature.state === "passing") {
      throw new HarnessError({
        path: ".harness/features.json",
        message: `feature ${feature.id} cannot be set 'passing' via upsertFeature`,
        fix: "Use set_feature_passing with evidence instead.",
      });
    }
    const snap = await this.store(repoPath).read();
    const warnings: string[] = [];
    if (feature.state === "active") {
      const wip = checkWipLimit(snap.features, feature.id);
      if (wip.exceeds) {
        warnings.push(`WIP=1: feature(s) ${wip.activeIds.join(", ")} already active. Finish or block them before starting ${feature.id}.`);
      }
    }
    const next = upsertById(snap.features, feature);
    await this.store(repoPath).writeFeatures(next);
    const snapshot = await this.reindex(repoPath);
    return { snapshot, warnings };
  }

  async setFeaturePassing(repoPath: string, featureId: string, evidence: string): Promise<WriteResult> {
    assertPassEvidence(featureId, evidence);
    const snap = await this.store(repoPath).read();
    const target = snap.features.find((f) => f.id === featureId);
    if (!target) {
      throw new HarnessError({
        path: ".harness/features.json",
        message: `feature ${featureId} not found`,
        fix: "Create the feature with update_feature first.",
      });
    }
    const next = upsertById(snap.features, { ...target, state: "passing" as FeatureState, evidence });
    await this.store(repoPath).writeFeatures(next);
    const snapshot = await this.reindex(repoPath);
    return { snapshot, warnings: [] };
  }

  async updateProgress(repoPath: string, progress: Progress): Promise<WriteResult> {
    await this.store(repoPath).writeProgress(progress);
    return { snapshot: await this.reindex(repoPath), warnings: [] };
  }

  async addDecision(repoPath: string, decision: Decision): Promise<WriteResult> {
    const snap = await this.store(repoPath).read();
    await this.store(repoPath).writeDecisions([...snap.decisions, decision]);
    return { snapshot: await this.reindex(repoPath), warnings: [] };
  }

  async upsertAgent(repoPath: string, agent: Agent): Promise<WriteResult> {
    await this.store(repoPath).writeAgent(agent);
    return { snapshot: await this.reindex(repoPath), warnings: [] };
  }

  async startSession(repoPath: string, langfuseTraceId: string | undefined, startedAt: Date): Promise<string> {
    const repoId = await this.resolveRepoId(repoPath);
    const session = await this.prisma.session.create({
      data: { repoId, langfuseTraceId: langfuseTraceId ?? null, startedAt },
    });
    return session.id;
  }

  async endSession(sessionId: string, summary: string | undefined, endedAt: Date): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { endedAt, summary: summary ?? null },
    });
  }
}

function upsertById(features: Feature[], feature: Feature): Feature[] {
  const idx = features.findIndex((f) => f.id === feature.id);
  if (idx === -1) return [...features, feature];
  const copy = [...features];
  copy[idx] = feature;
  return copy;
}
