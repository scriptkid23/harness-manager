import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { type HarnessService, getPrisma } from "@harness/core";
import { registerRepoRoutes } from "./routes/repos.js";

type PrismaClient = ReturnType<typeof getPrisma>;

export async function buildApp(service: HarnessService, prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await registerRepoRoutes(app, service, prisma);
  return app;
}
