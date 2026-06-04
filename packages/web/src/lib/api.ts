const BASE = process.env.HARNESS_API_BASE ?? "http://127.0.0.1:4000";

export interface Repo { id: string; name: string; path: string; langfuseProjectId?: string | null }
export interface FeatureRow { id: string; featureId: string; behavior: string; verification: string; state: string; evidence?: string | null }
export interface DecisionRow { id: string; decisionId: string; date: string; title: string; rationale: string; rejected?: string | null }
export interface SessionRow { id: string; langfuseTraceId?: string | null; startedAt: string; endedAt?: string | null; summary?: string | null }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" } as RequestInit & { cache?: "default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached" });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const listRepos = () => get<Repo[]>("/repos");
export const repoContext = (id: string) => get<unknown>(`/repos/${id}/context`);
export const repoFeatures = (id: string) => get<FeatureRow[]>(`/repos/${id}/features`);
export const repoDecisions = (id: string) => get<DecisionRow[]>(`/repos/${id}/decisions`);
export const repoSessions = (id: string) => get<SessionRow[]>(`/repos/${id}/sessions`);
