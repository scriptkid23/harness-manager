import Link from "next/link";
import { ArrowRight, FolderGit2 } from "lucide-react";
import type { Repo } from "@/lib/api";
import { cn } from "@/lib/cn";

export function RepoCard({ repo, index }: { repo: Repo; index: number }) {
  return (
    <Link
      href={`/repos/${repo.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-[40px] border border-stone bg-card shadow-soft",
        "transition duration-500 ease-out hover:-translate-y-2 hover:shadow-large",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2",
        index % 2 === 1 && "md:translate-y-12",
      )}
    >
      <div className="flex aspect-[4/3] items-center justify-center rounded-t-full bg-gradient-to-b from-clay to-clay-soft">
        <FolderGit2
          strokeWidth={1.5}
          className="h-12 w-12 text-sage transition duration-700 ease-out group-hover:scale-105"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-8">
        <h3 className="m-0 text-2xl">{repo.name}</h3>
        <p className="m-0 truncate text-sm text-forest/50">{repo.path}</p>
        <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-sage">
          Enter
          <ArrowRight
            strokeWidth={1.5}
            className="h-4 w-4 transition duration-300 group-hover:translate-x-1"
          />
        </span>
      </div>
    </Link>
  );
}
