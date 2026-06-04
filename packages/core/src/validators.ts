import type { Feature } from "./schemas/index.js";
import { HarnessError } from "./errors.js";

export interface WipCheck {
  exceeds: boolean;
  activeIds: string[];
}

/** Returns whether activating `targetId` would exceed WIP=1 (Lecture 7). */
export function checkWipLimit(features: Feature[], targetId: string): WipCheck {
  const activeIds = features.filter((f) => f.state === "active" && f.id !== targetId).map((f) => f.id);
  return { exceeds: activeIds.length > 0, activeIds };
}

/** Pass-state gating (Lecture 8): a feature may only become `passing` with evidence. */
export function assertPassEvidence(featureId: string, evidence: string | undefined): void {
  if (!evidence || evidence.trim() === "") {
    throw new HarnessError({
      path: ".harness/features.json",
      message: `feature ${featureId} cannot be set 'passing' without evidence`,
      fix: "Provide a commit hash or test-log reference as evidence, then retry.",
    });
  }
}
