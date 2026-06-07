import { Card } from "@/components/ui/Card";

export interface RepoConfigProps {
  name: string;
  description?: string | null;
  hardConstraints: string[];
  langfuseProjectId?: string | null;
  indexedAt?: string | null;
}

export function RepoConfig({ name, description, hardConstraints, langfuseProjectId, indexedAt }: RepoConfigProps) {
  return (
    <Card className="p-8">
      <h3 className="m-0 text-3xl">{name}</h3>
      {description ? (
        <p className="mb-0 mt-3 text-lg text-forest/70">{description}</p>
      ) : (
        <p className="mb-0 mt-3 text-forest/40">No description.</p>
      )}

      <div className="mt-8">
        <h4 className="m-0 text-xs font-medium uppercase tracking-widest text-sage">Hard constraints</h4>
        {hardConstraints.length ? (
          <ul className="mb-0 mt-3 list-disc space-y-2 pl-5 text-forest">
            {hardConstraints.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : (
          <p className="mb-0 mt-3 text-forest/40">None defined.</p>
        )}
      </div>

      <dl className="mb-0 mt-8 grid gap-3 text-sm text-forest/60 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-widest text-sage">Langfuse project</dt>
          <dd className="m-0 mt-1 text-forest">{langfuseProjectId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-sage">Last indexed</dt>
          <dd className="m-0 mt-1 text-forest">{indexedAt ?? "—"}</dd>
        </div>
      </dl>
    </Card>
  );
}
