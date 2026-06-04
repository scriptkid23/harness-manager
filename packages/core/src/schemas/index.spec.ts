import { describe, it, expect } from "vitest";
import {
  AgentSchema, FeatureSchema, ProgressSchema, DecisionSchema, ConfigSchema,
} from "./index";

describe("schemas", () => {
  it("accepts a valid agent", () => {
    const a = { id: "planner", role: "Planner", model: "opus", tools: ["read"], instructions: "Plan." };
    expect(AgentSchema.parse(a)).toEqual(a);
  });

  it("requires agent id, role, instructions", () => {
    expect(() => AgentSchema.parse({ role: "x", instructions: "y" })).toThrow();
  });

  it("accepts a valid feature and constrains state", () => {
    const f = { id: "F01", behavior: "b", verification: "npm test", state: "active" };
    expect(FeatureSchema.parse(f).state).toBe("active");
    expect(() => FeatureSchema.parse({ ...f, state: "done" })).toThrow();
  });

  it("defaults progress arrays to empty", () => {
    const p = ProgressSchema.parse({ updatedAt: "2026-06-04T00:00:00Z" });
    expect(p.completed).toEqual([]);
    expect(p.nextSteps).toEqual([]);
  });

  it("accepts a valid decision and config", () => {
    expect(DecisionSchema.parse({ id: "D01", date: "2026-06-04", title: "t", rationale: "r" }).id).toBe("D01");
    expect(ConfigSchema.parse({ name: "repo", hardConstraints: [] }).hardConstraints).toEqual([]);
  });
});
