import { listRepos } from "@/lib/api";
import { SectionHeading } from "@/components/SectionHeading";
import { RepoCard } from "@/components/RepoCard";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const repos = await listRepos();
  return (
    <main>
      <SectionHeading>
        Your <span className="font-normal italic text-sage">repositories</span>
      </SectionHeading>
      <p className="mt-3 max-w-xl text-lg text-forest/60">
        Harness state for each repo — config, agents, features, decisions, and sessions.
        Choose one to explore.
      </p>

      {repos.length === 0 ? (
        <p className="mt-16 rounded-3xl border border-dashed border-stone bg-clay-soft p-10 text-center text-forest/60">
          No repos registered yet. POST a logical <code>repoPath</code> to <code>/repos</code> on the API to register one.
        </p>
      ) : (
        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3">
          {repos.map((repo, i) => (
            <RepoCard key={repo.id} repo={repo} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
