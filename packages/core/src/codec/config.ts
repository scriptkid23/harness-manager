import { ConfigSchema, type Config } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/config.json";

export function parseConfig(content: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new HarnessError({ path: PATH, message: "invalid JSON", fix: "Fix the JSON syntax then retry." });
  }
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HarnessError({
      path: PATH,
      message: `field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
      fix: "Correct the field then retry.",
    });
  }
  return result.data;
}

export function serializeConfig(config: Config): string {
  return JSON.stringify(config, null, 2) + "\n";
}
