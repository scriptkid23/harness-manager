import { describe, it, expect } from "vitest";
import { checkWipLimit, assertPassEvidence } from "./validators";
import type { Feature } from "./schemas/index";

const features: Feature[] = [
  { id: "F01", behavior: "a", verification: "t", state: "active" },
  { id: "F02", behavior: "b", verification: "t", state: "not_started" },
];

describe("checkWipLimit", () => {
  it("warns when activating a 2nd feature while one is active", () => {
    const result = checkWipLimit(features, "F02");
    expect(result.exceeds).toBe(true);
    expect(result.activeIds).toEqual(["F01"]);
  });

  it("does not warn when the feature being activated is already the active one", () => {
    expect(checkWipLimit(features, "F01").exceeds).toBe(false);
  });

  it("does not warn when nothing else is active", () => {
    const none: Feature[] = [{ id: "F03", behavior: "c", verification: "t", state: "not_started" }];
    expect(checkWipLimit(none, "F03").exceeds).toBe(false);
  });
});

describe("assertPassEvidence", () => {
  it("throws when evidence is missing/empty", () => {
    expect(() => assertPassEvidence("F01", undefined)).toThrow(/evidence/i);
    expect(() => assertPassEvidence("F01", "   ")).toThrow(/evidence/i);
  });

  it("passes when evidence present", () => {
    expect(() => assertPassEvidence("F01", "commit abc123")).not.toThrow();
  });
});
