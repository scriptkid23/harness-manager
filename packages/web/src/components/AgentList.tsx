import type { AgentRow } from "@/lib/api";
import { parseJsonArray } from "@/lib/api";
import { Card } from "@/components/ui/Card";

export function AgentList({ agents }: { agents: AgentRow[] }) {
  if (agents.length === 0) {
    return <p className="text-forest/50">No agents defined yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {agents.map((a) => {
        const tools = parseJsonArray(a.tools);
        return (
          <Card key={a.id} className="p-6">
            <div className="text-xs font-medium uppercase tracking-widest text-sage">{a.agentId}</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <h3 className="m-0 text-2xl">{a.role}</h3>
              {a.model ? <span className="text-sm text-forest/40">{a.model}</span> : null}
            </div>
            {tools.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {tools.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-clay-soft px-3 py-1 text-xs uppercase tracking-widest text-sage"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="mb-0 mt-4 whitespace-pre-wrap text-forest/70">{a.instructions}</p>
          </Card>
        );
      })}
    </div>
  );
}
