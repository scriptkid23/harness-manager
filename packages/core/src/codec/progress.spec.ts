import { describe, it, expect } from "vitest";
import { parseProgress, serializeProgress } from "./progress";
import type { Progress } from "../schemas/index";

const progress: Progress = {
  currentCommit: "abc123",
  testStatus: "passing",
  updatedAt: "2026-06-04T10:00:00Z",
  completed: ["F01"],
  inProgress: ["F02"],
  blocked: [],
  nextSteps: ["wire api"],
};

describe("progress codec", () => {
  it("round-trips via frontmatter", () => {
    expect(parseProgress(serializeProgress(progress))).toEqual(progress);
  });

  it("regenerated body mirrors the lists (human readable)", () => {
    const out = serializeProgress(progress);
    expect(out).toContain("## Completed");
    expect(out).toContain("- F01");
    expect(out).toContain("## Next Steps");
    expect(out).toContain("- wire api");
  });

  it("ignores edits to the body on parse", () => {
    const out = serializeProgress(progress) + "\n\nHuman scribbled notes here.";
    expect(parseProgress(out)).toEqual(progress);
  });

  it("throws HarnessError naming progress.md when updatedAt missing", () => {
    expect(() => parseProgress("---\ncompleted: []\n---\n")).toThrow(/progress\.md/);
  });
});
