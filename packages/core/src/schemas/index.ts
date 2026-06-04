import { z } from "zod";

export const AgentSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  instructions: z.string(),
});

export const FeatureStateSchema = z.enum(["not_started", "active", "blocked", "passing"]);

export const FeatureSchema = z.object({
  id: z.string().min(1),
  behavior: z.string(),
  verification: z.string(),
  state: FeatureStateSchema,
  evidence: z.string().optional(),
});

export const ProgressSchema = z.object({
  currentCommit: z.string().optional(),
  testStatus: z.string().optional(),
  updatedAt: z.string(),
  completed: z.array(z.string()).default([]),
  inProgress: z.array(z.string()).default([]),
  blocked: z.array(z.string()).default([]),
  nextSteps: z.array(z.string()).default([]),
});

export const DecisionSchema = z.object({
  id: z.string().min(1),
  date: z.string(),
  title: z.string(),
  rationale: z.string(),
  rejected: z.string().optional(),
});

export const ConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  langfuseProjectId: z.string().optional(),
  hardConstraints: z.array(z.string()).default([]),
});

export type Agent = z.infer<typeof AgentSchema>;
export type FeatureState = z.infer<typeof FeatureStateSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Config = z.infer<typeof ConfigSchema>;
