import type { PrismaClient } from "../generated/prisma/client.js";
import type { HarnessSnapshot } from "../agents-md.js";

/** Replace the cached rows for one repo with the given snapshot. Idempotent. */
export async function indexSnapshot(
  prisma: PrismaClient,
  repoId: string,
  snapshot: HarnessSnapshot,
): Promise<void> {
  await prisma.$transaction([
    prisma.feature.deleteMany({ where: { repoId } }),
    prisma.agent.deleteMany({ where: { repoId } }),
    prisma.decision.deleteMany({ where: { repoId } }),
    prisma.progress.deleteMany({ where: { repoId } }),

    prisma.feature.createMany({
      data: snapshot.features.map((f) => ({
        repoId, featureId: f.id, behavior: f.behavior, verification: f.verification,
        state: f.state, evidence: f.evidence ?? null,
      })),
    }),
    prisma.agent.createMany({
      data: snapshot.agents.map((a) => ({
        repoId, agentId: a.id, role: a.role, model: a.model ?? null,
        tools: a.tools ? JSON.stringify(a.tools) : null, instructions: a.instructions,
      })),
    }),
    prisma.decision.createMany({
      data: snapshot.decisions.map((d) => ({
        repoId, decisionId: d.id, date: d.date, title: d.title,
        rationale: d.rationale, rejected: d.rejected ?? null,
      })),
    }),
    prisma.progress.create({
      data: {
        repoId,
        currentCommit: snapshot.progress.currentCommit ?? null,
        testStatus: snapshot.progress.testStatus ?? null,
        updatedAt: snapshot.progress.updatedAt,
        completed: JSON.stringify(snapshot.progress.completed),
        inProgress: JSON.stringify(snapshot.progress.inProgress),
        blocked: JSON.stringify(snapshot.progress.blocked),
        nextSteps: JSON.stringify(snapshot.progress.nextSteps),
      },
    }),
    prisma.repo.update({ where: { id: repoId }, data: { name: snapshot.config.name, langfuseProjectId: snapshot.config.langfuseProjectId ?? null } }),
  ]);
}
