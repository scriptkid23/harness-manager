import matter from "gray-matter";
import { AgentSchema, type Agent } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

function pathFor(id: string): string {
  return `.harness/agents/${id}.md`;
}

export function parseAgent(content: string, fileId: string): Agent {
  const parsed = matter(content);
  const candidate = {
    id: (parsed.data.id as string | undefined) ?? fileId,
    role: parsed.data.role,
    model: parsed.data.model,
    tools: parsed.data.tools,
    instructions: parsed.content.trim(),
  };
  const result = AgentSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HarnessError({
      path: pathFor(fileId),
      message: `field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
      fix: "Correct the frontmatter then retry.",
    });
  }
  return result.data;
}

export function serializeAgent(agent: Agent): string {
  const data: Record<string, unknown> = { id: agent.id, role: agent.role };
  if (agent.model !== undefined) data.model = agent.model;
  if (agent.tools !== undefined) data.tools = agent.tools;
  return matter.stringify(`\n${agent.instructions}\n`, data);
}
