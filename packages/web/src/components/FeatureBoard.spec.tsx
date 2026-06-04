import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureBoard } from "./FeatureBoard";
import type { FeatureRow } from "@/lib/api";

const features: FeatureRow[] = [
  { id: "1", featureId: "F01", behavior: "logs in", verification: "npm test", state: "active" },
  { id: "2", featureId: "F02", behavior: "logs out", verification: "npm test", state: "passing", evidence: "abc" },
];

describe("FeatureBoard", () => {
  it("groups features into botanical columns by state and shows evidence", () => {
    render(<FeatureBoard features={features} />);
    expect(screen.getByText("Growing")).toBeInTheDocument();
    expect(screen.getByText("Flourishing")).toBeInTheDocument();
    expect(screen.getByText("logs in")).toBeInTheDocument();
    expect(screen.getByText("logs out")).toBeInTheDocument();
    expect(screen.getByText(/evidence: abc/)).toBeInTheDocument();
  });
});
