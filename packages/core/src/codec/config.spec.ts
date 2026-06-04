import { describe, it, expect } from "vitest";
import { parseConfig, serializeConfig } from "./config";
import type { Config } from "../schemas/index";

const sample: Config = {
  name: "my-repo",
  description: "demo",
  langfuseProjectId: "proj_1",
  hardConstraints: ["never push to main"],
};

describe("config codec", () => {
  it("round-trips", () => {
    expect(parseConfig(serializeConfig(sample))).toEqual(sample);
  });

  it("throws HarnessError on invalid JSON with path", () => {
    expect(() => parseConfig("{not json")).toThrow(/config\.json/);
  });

  it("throws HarnessError when name missing", () => {
    expect(() => parseConfig(JSON.stringify({ hardConstraints: [] }))).toThrow(/config\.json/);
  });
});
