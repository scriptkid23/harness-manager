import type { FeatureRow } from "@/lib/api";
import { Circle, CircleDot, Ban, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";

const COLUMNS = [
  { state: "not_started", label: "Backlog", Icon: Circle },
  { state: "active", label: "In Progress", Icon: CircleDot },
  { state: "blocked", label: "Blocked", Icon: Ban },
  { state: "passing", label: "Verified", Icon: CheckCircle2 },
];

export function FeatureBoard({ features }: { features: FeatureRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
      {COLUMNS.map(({ state, label, Icon }) => {
        const items = features.filter((f) => f.state === state);
        return (
          <section key={state} className="flex flex-col gap-4">
            <header className="flex items-center gap-2 border-b border-stone pb-3">
              <Icon strokeWidth={1.5} className="h-4 w-4 text-sage" />
              <h4 className="m-0 text-lg">{label}</h4>
              <span className="ml-auto text-sm text-forest/40">{items.length}</span>
            </header>

            {items.map((f) => (
              <Card key={f.id} className="p-5">
                <div className="text-xs font-medium uppercase tracking-widest text-sage">{f.featureId}</div>
                <p className="mb-3 mt-1 text-forest">{f.behavior}</p>
                <p className="m-0 text-xs text-forest/50">
                  verify <code className="text-terracotta">{f.verification}</code>
                </p>
                {f.evidence ? (
                  <p className="mb-0 mt-2 text-xs text-sage">✓ evidence: {f.evidence}</p>
                ) : null}
              </Card>
            ))}

            {items.length === 0 ? (
              <p className="m-0 rounded-2xl border border-dashed border-stone p-4 text-center text-xs text-forest/40">
                nothing here yet
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
