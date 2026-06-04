import matter from "gray-matter";
import { DecisionSchema, type Decision } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/decisions.md";
const DELIMITER = "\n===\n";

export function parseDecisions(content: string): Decision[] {
  if (content.trim() === "") return [];
  return content.split(DELIMITER).map((block, index) => {
    const parsed = matter(block.trim());
    const candidate = {
      id: parsed.data.id,
      date: parsed.data.date,
      title: parsed.data.title,
      rejected: parsed.data.rejected,
      rationale: parsed.content.trim(),
    };
    const result = DecisionSchema.safeParse(candidate);
    if (!result.success) {
      const issue = result.error.issues[0];
      const id = parsed.data.id ? String(parsed.data.id) : `block ${index}`;
      throw new HarnessError({
        path: PATH,
        message: `decision ${id} field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
        fix: "Correct the decision block then retry.",
      });
    }
    return result.data;
  });
}

export function serializeDecisions(decisions: Decision[]): string {
  const blocks = decisions.map((d) => {
    const data: Record<string, unknown> = { id: d.id, date: d.date, title: d.title };
    if (d.rejected !== undefined) data.rejected = d.rejected;
    return matter.stringify(`\n${d.rationale}\n`, data).trim();
  });
  return blocks.join(DELIMITER) + "\n";
}
