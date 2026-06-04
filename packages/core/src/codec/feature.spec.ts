import { describe, it, expect } from "vitest";
import { parseFeatures, serializeFeatures } from "./feature";
import type { Feature } from "../schemas/index";

const features: Feature[] = [
  { id: "F01", behavior: "logs in", verification: "npm test auth", state: "passing", evidence: "abc123" },
  { id: "F02", behavior: "logs out", verification: "npm test auth", state: "not_started" },
];

describe("feature codec", () => {
  it("round-trips an array", () => {
    expect(parseFeatures(serializeFeatures(features))).toEqual(features);
  });

  it("throws HarnessError naming the bad feature id when verification missing", () => {
    const bad = JSON.stringify([{ id: "F03", behavior: "x", state: "active" }]);
    expect(() => parseFeatures(bad)).toThrow(/F03/);
  });

  it("throws when top-level is not an array", () => {
    expect(() => parseFeatures(JSON.stringify({}))).toThrow(/features\.json/);
  });
});
