import type { FastifyInstance } from "fastify";
import { HarnessError, type HarnessService } from "@harness/core";
import { getPrisma } from "@harness/core";

type PrismaClient = ReturnType<typeof getPrisma>;

export async function registerRepoRoutes(
  app: FastifyInstance,
  service: HarnessService,
  prisma: PrismaClient,
): Promise<void> {
  app.get("/repos", async () => {
    return prisma.repo.findMany({ orderBy: { name: "asc" } });
  });

  app.post<{ Body: { path: string; name?: string; description?: string } }>("/repos", async (req, reply) => {
    const { path, name, description } = req.body;
    try {
      await service.init(path, { name: name ?? path, description, hardConstraints: [] });
    } catch (e) {
      if (e instanceof HarnessError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    const repo = await prisma.repo.findUnique({ where: { path } });
    return reply.code(201).send(repo);
  });

  app.post<{ Params: { id: string } }>("/repos/:id/resync", async (req, reply) => {
    const repo = await prisma.repo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    return { ok: true };
  });

  const byId = async (id: string) => prisma.repo.findUnique({ where: { id } });

  app.get<{ Params: { id: string } }>("/repos/:id", async (req, reply) => {
    const repo = await byId(req.params.id);
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    return repo;
  });

  app.get<{ Params: { id: string } }>("/repos/:id/context", async (req, reply) => {
    const repo = await byId(req.params.id);
    if (!repo) return reply.code(404).send({ error: "repo not found" });
    return service.getContext(repo.path);
  });

  app.get<{ Params: { id: string } }>("/repos/:id/features", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.feature.findMany({ where: { repoId: req.params.id } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/progress", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.progress.findUnique({ where: { repoId: req.params.id } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/decisions", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.decision.findMany({ where: { repoId: req.params.id }, orderBy: { date: "desc" } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/agents", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.agent.findMany({ where: { repoId: req.params.id } });
  });

  app.get<{ Params: { id: string } }>("/repos/:id/sessions", async (req, reply) => {
    if (!(await byId(req.params.id))) return reply.code(404).send({ error: "repo not found" });
    return prisma.session.findMany({ where: { repoId: req.params.id }, orderBy: { startedAt: "desc" } });
  });
}
