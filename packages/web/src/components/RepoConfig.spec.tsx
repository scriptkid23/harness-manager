import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoConfig } from "./RepoConfig";

describe("RepoConfig", () => {
  it("renders name, description, and hard constraints", () => {
    render(
      <RepoConfig
        name="socmint"
        description="Nx monorepo"
        hardConstraints={["No real network calls in unit tests"]}
        langfuseProjectId="harness-manager"
        indexedAt="2026-06-07T12:00:00.000Z"
      />,
    );
    expect(screen.getByText("socmint")).toBeInTheDocument();
    expect(screen.getByText("Nx monorepo")).toBeInTheDocument();
    expect(screen.getByText(/No real network calls/)).toBeInTheDocument();
  });
});
