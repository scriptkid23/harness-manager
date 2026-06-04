import { describe, it, expect, vi } from "vitest";
import type { Tracer, Session, Span } from "./tracing";
import { buildToolHandlers } from "./server";

describe("tracing wiring", () => {
  it("calls startSession on get_context and span.end on subsequent tools", async () => {
    const span: Span = { end: vi.fn() };
    const session: Session = { traceId: "trace-1", span: vi.fn(() => span), end: vi.fn(async () => {}) };
    const tracer: Tracer = { startSession: vi.fn(() => session) };

    const service: any = {
      getContext: vi.fn(async () => ({ config: { name: "demo", hardConstraints: [] }, agents: [], features: [], decisions: [], progress: { updatedAt: "t", completed: [], inProgress: [], blocked: [], nextSteps: [] } })),
      startSession: vi.fn(async () => "sess-1"),
      endSession: vi.fn(async () => {}),
    };

    const handlers = buildToolHandlers(service, tracer);
    await handlers.harness_get_context({ repoPath: "/x" });
    expect(tracer.startSession).toHaveBeenCalledTimes(1);
    expect(service.startSession).toHaveBeenCalledTimes(1);

    await handlers.harness_list_features({ repoPath: "/x" });
    expect(session.span).toHaveBeenCalled();
    expect(span.end).toHaveBeenCalled();
  });
});
