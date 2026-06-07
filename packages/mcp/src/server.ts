import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HarnessError, type HarnessService } from "@harness/core";
import type { Tracer, Session } from "./tracing.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

type Handler = (args: any) => Promise<ToolResult>;

function ok(data: unknown, warnings: string[] = []): ToolResult {
  const payload = warnings.length ? { warnings, data } : data;
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const text = error instanceof HarnessError ? error.message
    : error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text }], isError: true };
}

/** Pure map of tool name -> handler, so tools are unit-testable without stdio. */
export function buildToolHandlers(service: HarnessService, tracer: Tracer): Record<string, Handler> {
  const sessions = new Map<string, { tracer: Session; sessionId: string }>();
  const span = (repoPath: string) => sessions.get(repoPath)?.tracer;

  /** Wrap a raw handler so it emits a span on the repo's active session (if any). */
  const traced = (name: string, fn: Handler): Handler => async (a) => {
    const sess = span(a.repoPath);
    const s = sess ? sess.span(name, a) : undefined;
    const result = await fn(a);
    try { s?.end({ isError: result.isError ?? false }); } catch { /* never break tools */ }
    return result;
  };

  const raw: Record<string, Handler> = {
    async harness_init(a) {
      try {
        const snap = await service.init(a.repoPath, { name: a.name, description: a.description, hardConstraints: a.hardConstraints ?? [] });
        return ok(snap);
      } catch (e) { return fail(e); }
    },
    async harness_update_config(a) {
      try {
        const snap = await service.updateConfig(a.repoPath, {
          name: a.name,
          description: a.description,
          hardConstraints: a.hardConstraints,
          langfuseProjectId: a.langfuseProjectId,
        });
        return ok(snap.config);
      } catch (e) { return fail(e); }
    },
    async harness_get_context(a) {
      try {
        const snap = await service.getContext(a.repoPath);
        try {
          const tracerSession = tracer.startSession(snap.config.name, snap.config.langfuseProjectId);
          const sessionId = await service.startSession(a.repoPath, tracerSession.traceId, new Date());
          sessions.set(a.repoPath, { tracer: tracerSession, sessionId });
        } catch { /* tracing/session is best-effort */ }
        return ok(snap);
      } catch (e) { return fail(e); }
    },
    async harness_list_features(a) {
      try {
        const snap = await service.getContext(a.repoPath);
        const features = a.state ? snap.features.filter((f) => f.state === a.state) : snap.features;
        return ok(features);
      } catch (e) { return fail(e); }
    },
    async harness_list_decisions(a) {
      try { return ok((await service.getContext(a.repoPath)).decisions); } catch (e) { return fail(e); }
    },
    async harness_get_progress(a) {
      try { return ok((await service.getContext(a.repoPath)).progress); } catch (e) { return fail(e); }
    },
    async harness_update_feature(a) {
      try {
        const res = await service.upsertFeature(a.repoPath, { id: a.id, behavior: a.behavior, verification: a.verification, state: a.state, evidence: a.evidence });
        return ok(res.snapshot.features.find((f) => f.id === a.id), res.warnings);
      } catch (e) { return fail(e); }
    },
    async harness_set_feature_passing(a) {
      try {
        const res = await service.setFeaturePassing(a.repoPath, a.id, a.evidence);
        return ok(res.snapshot.features.find((f) => f.id === a.id));
      } catch (e) { return fail(e); }
    },
    async harness_update_progress(a) {
      try {
        const res = await service.updateProgress(a.repoPath, { currentCommit: a.currentCommit, testStatus: a.testStatus, updatedAt: a.updatedAt, completed: a.completed ?? [], inProgress: a.inProgress ?? [], blocked: a.blocked ?? [], nextSteps: a.nextSteps ?? [] });
        return ok(res.snapshot.progress);
      } catch (e) { return fail(e); }
    },
    async harness_add_decision(a) {
      try {
        const res = await service.addDecision(a.repoPath, { id: a.id, date: a.date, title: a.title, rationale: a.rationale, rejected: a.rejected });
        return ok(res.snapshot.decisions);
      } catch (e) { return fail(e); }
    },
    async harness_upsert_agent(a) {
      try {
        const res = await service.upsertAgent(a.repoPath, { id: a.id, role: a.role, model: a.model, tools: a.tools, instructions: a.instructions });
        return ok(res.snapshot.agents.find((ag) => ag.id === a.id));
      } catch (e) { return fail(e); }
    },
    async harness_handoff(a) {
      try {
        const res = await service.updateProgress(a.repoPath, { currentCommit: a.currentCommit, testStatus: a.testStatus, updatedAt: a.updatedAt, completed: a.completed ?? [], inProgress: a.inProgress ?? [], blocked: a.blocked ?? [], nextSteps: a.nextSteps ?? [] });
        const active = res.snapshot.features.filter((f) => f.state === "active").map((f) => f.id);
        const warnings = active.length ? [`Clean-state check: feature(s) ${active.join(", ")} still active at handoff.`] : [];
        const entry = sessions.get(a.repoPath);
        try {
          await entry?.tracer.end({ clean_state: active.length ? "fail" : "pass" });
          if (entry) await service.endSession(entry.sessionId, a.summary, new Date());
        } catch { /* best-effort */ }
        sessions.delete(a.repoPath);
        return ok({ summary: a.summary ?? null, progress: res.snapshot.progress }, warnings);
      } catch (e) { return fail(e); }
    },
  };

  // Trace every tool except init (no session) and get_context/handoff (own their session lifecycle).
  const result: Record<string, Handler> = {};
  for (const [name, fn] of Object.entries(raw)) {
    result[name] = name === "harness_get_context" || name === "harness_handoff" || name === "harness_init"
      ? fn
      : traced(name, fn);
  }
  return result;
}

const repoArg = { repoPath: z.string().describe("Logical project key, e.g. /projects/socmint (must match the registered repo path)") };

/** Register handlers onto an McpServer with Zod input schemas. */
export function registerTools(server: McpServer, handlers: Record<string, Handler>): void {
  const def = (name: string, schema: z.ZodRawShape) =>
    server.tool(name, schema, async (args) => handlers[name]!(args));

  def("harness_init", {
    ...repoArg,
    name: z.string().describe("Project display name"),
    description: z.string().optional().describe("Short project description"),
    hardConstraints: z.array(z.string()).optional().describe("Rules the agent must never break"),
  });
  def("harness_update_config", {
    ...repoArg,
    name: z.string().optional().describe("Project display name"),
    description: z.string().optional().describe("Short project description"),
    hardConstraints: z.array(z.string()).optional().describe("Replace the full hard-constraints list"),
    langfuseProjectId: z.string().optional().describe("Langfuse project id for tracing"),
  });
  def("harness_get_context", { ...repoArg });
  def("harness_list_features", { ...repoArg, state: z.enum(["not_started", "active", "blocked", "passing"]).optional() });
  def("harness_list_decisions", { ...repoArg });
  def("harness_get_progress", { ...repoArg });
  def("harness_update_feature", { ...repoArg, id: z.string(), behavior: z.string(), verification: z.string(), state: z.enum(["not_started", "active", "blocked"]), evidence: z.string().optional() });
  def("harness_set_feature_passing", { ...repoArg, id: z.string(), evidence: z.string() });
  def("harness_update_progress", { ...repoArg, updatedAt: z.string(), currentCommit: z.string().optional(), testStatus: z.string().optional(), completed: z.array(z.string()).optional(), inProgress: z.array(z.string()).optional(), blocked: z.array(z.string()).optional(), nextSteps: z.array(z.string()).optional() });
  def("harness_add_decision", { ...repoArg, id: z.string(), date: z.string(), title: z.string(), rationale: z.string(), rejected: z.string().optional() });
  def("harness_upsert_agent", { ...repoArg, id: z.string(), role: z.string(), model: z.string().optional(), tools: z.array(z.string()).optional(), instructions: z.string() });
  def("harness_handoff", { ...repoArg, updatedAt: z.string(), summary: z.string().optional(), currentCommit: z.string().optional(), testStatus: z.string().optional(), completed: z.array(z.string()).optional(), inProgress: z.array(z.string()).optional(), blocked: z.array(z.string()).optional(), nextSteps: z.array(z.string()).optional() });
}
