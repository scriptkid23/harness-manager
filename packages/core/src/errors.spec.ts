import { describe, it, expect } from "vitest";
import { HarnessError } from "./errors";

describe("HarnessError", () => {
  it("carries path + fix hint in message", () => {
    const e = new HarnessError({
      path: ".harness/features.json",
      message: "feature F03 missing 'verification'",
      fix: "Add a verification command then retry.",
    });
    expect(e.message).toContain(".harness/features.json");
    expect(e.message).toContain("missing 'verification'");
    expect(e.message).toContain("Add a verification command then retry.");
    expect(e.path).toBe(".harness/features.json");
  });
});
