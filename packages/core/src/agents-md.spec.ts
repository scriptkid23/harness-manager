import { describe, it, expect } from "vitest";
import { generateAgentsMd, AGENTS_MD_MARKER, type HarnessSnapshot } from "./agents-md";

const snapshot: HarnessSnapshot = {
  config: { name: "demo", description: "A demo repo", hardConstraints: ["never force-push main"] },
  agents: [{ id: "planner", role: "Planner", instructions: "Plan." }],
  features: [
    { id: "F01", behavior: "logs in", verification: "npm test", state: "active" },
    { id: "F02", behavior: "logs out", verification: "npm test", state: "passing", evidence: "abc" },
  ],
  progress: {
    updatedAt: "2026-06-04T00:00:00Z",
    completed: ["F02"], inProgress: ["F01"], blocked: [], nextSteps: ["wire api"],
  },
  decisions: [{ id: "D01", date: "2026-06-04", title: "Repo is truth", rationale: "Lecture 3." }],
};

describe("generateAgentsMd", () => {
  it("includes the generator marker", () => {
    expect(generateAgentsMd(snapshot)).toContain(AGENTS_MD_MARKER);
  });

  it("includes repo name, hard constraints, active feature, next steps", () => {
    const md = generateAgentsMd(snapshot);
    expect(md).toContain("# demo");
    expect(md).toContain("never force-push main");
    expect(md).toContain("F01");
    expect(md).toContain("wire api");
  });

  it("is deterministic (stable output for same input)", () => {
    expect(generateAgentsMd(snapshot)).toBe(generateAgentsMd(snapshot));
  });
});
