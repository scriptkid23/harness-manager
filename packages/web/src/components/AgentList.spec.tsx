import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentList } from "./AgentList";

describe("AgentList", () => {
  it("renders agent id, role, tools, and instructions", () => {
    render(
      <AgentList
        agents={[
          {
            id: "1",
            agentId: "planner",
            role: "planning lead",
            model: null,
            tools: JSON.stringify(["brainstorming"]),
            instructions: "Plan only.",
          },
        ]}
      />,
    );
    expect(screen.getByText("planning lead")).toBeInTheDocument();
    expect(screen.getByText("Plan only.")).toBeInTheDocument();
    expect(screen.getByText("brainstorming")).toBeInTheDocument();
  });
});
