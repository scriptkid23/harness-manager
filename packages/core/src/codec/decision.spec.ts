import { describe, it, expect } from "vitest";
import { parseDecisions, serializeDecisions } from "./decision";
import type { Decision } from "../schemas/index";

const decisions: Decision[] = [
  { id: "D01", date: "2026-06-04", title: "SQLite as cache", rationale: "Rebuildable from files.", rejected: "Postgres" },
  { id: "D02", date: "2026-06-05", title: "Repo is source of truth", rationale: "Lecture 3.\n\nFile wins." },
];

describe("decision codec", () => {
  it("round-trips multiple blocks", () => {
    expect(parseDecisions(serializeDecisions(decisions))).toEqual(decisions);
  });

  it("parses empty file to empty array", () => {
    expect(parseDecisions("")).toEqual([]);
    expect(parseDecisions("   \n")).toEqual([]);
  });

  it("throws HarnessError naming decisions.md when title missing", () => {
    expect(() => parseDecisions("---\nid: D9\ndate: 2026-01-01\n---\nbody")).toThrow(/decisions\.md/);
  });
});
