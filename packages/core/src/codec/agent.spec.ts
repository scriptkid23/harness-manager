import { describe, it, expect } from "vitest";
import { parseAgent, serializeAgent } from "./agent";
import type { Agent } from "../schemas/index";

const agent: Agent = {
  id: "planner",
  role: "Planner",
  model: "opus",
  tools: ["read", "write"],
  instructions: "You plan features.\n\nKeep WIP=1.",
};

describe("agent codec", () => {
  it("round-trips frontmatter + body", () => {
    expect(parseAgent(serializeAgent(agent), "planner")).toEqual(agent);
  });

  it("uses filename id when frontmatter omits id", () => {
    const md = "---\nrole: Generator\n---\nGenerate code.";
    expect(parseAgent(md, "generator").id).toBe("generator");
  });

  it("throws HarnessError naming the agent file when role missing", () => {
    expect(() => parseAgent("---\nid: x\n---\nbody", "planner")).toThrow(/agents\/planner\.md/);
  });
});
