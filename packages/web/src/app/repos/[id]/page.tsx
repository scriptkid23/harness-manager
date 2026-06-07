import Link from "next/link";
import { ArrowLeft, Clock, ExternalLink, ScrollText } from "lucide-react";
import { repoFeatures, repoDecisions, repoSessions } from "@/lib/api";
import { FeatureBoard } from "@/components/FeatureBoard";
import { SectionHeading } from "@/components/SectionHeading";
import { VineDivider } from "@/components/VineDivider";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function RepoDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [features, decisions, sessions] = await Promise.all([
    repoFeatures(id),
    repoDecisions(id),
    repoSessions(id),
  ]);

  return (
    <main className="flex flex-col gap-20">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm uppercase tracking-widest text-sage transition duration-300 hover:text-terracotta"
      >
        <ArrowLeft strokeWidth={1.5} className="h-4 w-4" /> All repositories
      </Link>

      <section>
        <SectionHeading>
          Feature <span className="font-normal italic text-sage">board</span>
        </SectionHeading>
        <p className="mb-10 mt-3 text-lg text-forest/60">
          Each behavior, grouped by status — verified only with evidence.
        </p>
        <FeatureBoard features={features} />
      </section>

      <VineDivider />

      <section>
        <SectionHeading>
          <span className="font-normal italic text-sage">Decisions</span>, rooted
        </SectionHeading>
        <div className="mt-10 flex flex-col gap-6">
          {decisions.length === 0 ? (
            <p className="text-forest/50">No decisions recorded yet.</p>
          ) : (
            decisions.map((d) => (
              <Card key={d.id} className="flex gap-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay-soft">
                  <ScrollText strokeWidth={1.5} className="h-5 w-5 text-sage" />
                </span>
                <div>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="m-0 text-2xl">{d.title}</h3>
                    <span className="text-sm text-forest/40">{d.date}</span>
                  </div>
                  <p className="mb-0 mt-2 text-forest/70">{d.rationale}</p>
                  {d.rejected ? (
                    <p className="mb-0 mt-2 text-sm text-terracotta">rejected: {d.rejected}</p>
                  ) : null}
                </div>
              </Card>
            ))
          )}
        </div>
      </section>

      <VineDivider />

      <section>
        <SectionHeading>
          <span className="font-normal italic text-sage">Sessions</span> in the field
        </SectionHeading>
        <div className="mt-10 flex flex-col gap-4">
          {sessions.length === 0 ? (
            <p className="text-forest/50">No sessions yet.</p>
          ) : (
            sessions.map((s) => (
              <Card key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-6">
                <Clock strokeWidth={1.5} className="h-4 w-4 text-sage" />
                <span className="text-forest">{s.startedAt}</span>
                <span className="text-forest/40">→</span>
                <span className="text-forest">{s.endedAt ?? "open"}</span>
                {s.summary ? <span className="text-forest/60">— {s.summary}</span> : null}
                {s.langfuseTraceId ? (
                  <a
                    href={`#trace-${s.langfuseTraceId}`}
                    className="ml-auto inline-flex items-center gap-1 text-sm uppercase tracking-widest text-sage transition duration-300 hover:text-terracotta"
                  >
                    trace <ExternalLink strokeWidth={1.5} className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </Card>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
