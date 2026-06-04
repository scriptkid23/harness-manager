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
        Every repo&apos;s <code className="text-terracotta">.harness/</code> files, cultivated and
        indexed. Choose one to wander its features, decisions, and sessions.
      </p>

      {repos.length === 0 ? (
        <p className="mt-16 rounded-3xl border border-dashed border-stone bg-clay-soft p-10 text-center text-forest/60">
          No repos registered yet. POST a path to <code>/repos</code> on the API to plant one.
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
