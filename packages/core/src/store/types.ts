import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";

export interface HarnessSnapshot {
  config: Config;
  agents: Agent[];
  features: Feature[];
  progress: Progress;
  decisions: Decision[];
}
