import matter from "gray-matter";
import { ProgressSchema, type Progress } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/progress.md";

export function parseProgress(content: string): Progress {
  const parsed = matter(content);
  const result = ProgressSchema.safeParse(parsed.data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HarnessError({
      path: PATH,
      message: `field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
      fix: "Correct the frontmatter then retry.",
    });
  }
  return result.data;
}

function section(title: string, items: string[]): string {
  const body = items.length ? items.map((i) => `- ${i}`).join("\n") : "_none_";
  return `## ${title}\n${body}\n`;
}

export function serializeProgress(progress: Progress): string {
  const data: Record<string, unknown> = {
    updatedAt: progress.updatedAt,
    completed: progress.completed,
    inProgress: progress.inProgress,
    blocked: progress.blocked,
    nextSteps: progress.nextSteps,
  };
  if (progress.currentCommit !== undefined) data.currentCommit = progress.currentCommit;
  if (progress.testStatus !== undefined) data.testStatus = progress.testStatus;

  const body = [
    section("Completed", progress.completed),
    section("In Progress", progress.inProgress),
    section("Blocked", progress.blocked),
    section("Next Steps", progress.nextSteps),
  ].join("\n");

  return matter.stringify(`\n${body}`, data);
}
