import { FeatureSchema, type Feature } from "../schemas/index.js";
import { HarnessError } from "../errors.js";

const PATH = ".harness/features.json";

export function parseFeatures(content: string): Feature[] {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new HarnessError({ path: PATH, message: "invalid JSON", fix: "Fix the JSON syntax then retry." });
  }
  if (!Array.isArray(raw)) {
    throw new HarnessError({ path: PATH, message: "top-level value must be an array", fix: "Wrap features in a JSON array." });
  }
  return raw.map((item, index) => {
    const result = FeatureSchema.safeParse(item);
    if (!result.success) {
      const issue = result.error.issues[0];
      const id =
        item && typeof item === "object" && "id" in item ? String((item as { id: unknown }).id) : `index ${index}`;
      throw new HarnessError({
        path: PATH,
        message: `feature ${id} field '${issue?.path.join(".") || "(root)"}' ${issue?.message}`,
        fix: "Correct the feature then retry.",
      });
    }
    return result.data;
  });
}

export function serializeFeatures(features: Feature[]): string {
  return JSON.stringify(features, null, 2) + "\n";
}
