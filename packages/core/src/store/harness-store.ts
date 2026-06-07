import type { Agent, Config, Decision, Feature, Progress } from "../schemas/index.js";
import type { HarnessSnapshot } from "./types.js";

export interface HarnessStore {
  init(config: Config): Promise<void>;
  read(): Promise<HarnessSnapshot>;
  writeConfig(config: Config): Promise<void>;
  writeFeatures(features: Feature[]): Promise<void>;
  writeProgress(progress: Progress): Promise<void>;
  writeDecisions(decisions: Decision[]): Promise<void>;
  writeAgent(agent: Agent): Promise<void>;
}
