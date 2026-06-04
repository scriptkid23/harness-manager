import { describe, it, expect } from "vitest";
import { createTracer } from "./tracing";

describe("createTracer (no-op when unconfigured)", () => {
  it("returns a tracer that no-ops without keys", async () => {
    const tracer = createTracer({});
    const session = tracer.startSession("repo-1", "proj");
    const span = session.span("harness_get_context", { repoPath: "/x" });
    span.end({ ok: true });
    await session.end({ clean_state: "pass" });
    expect(session.traceId).toBeUndefined();
  });
});
