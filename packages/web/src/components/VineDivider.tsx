import { cn } from "@/lib/cn";

export function VineDivider({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 40"
      preserveAspectRatio="none"
      className={cn("h-8 w-full", className)}
    >
      <path
        d="M0 20 C 200 0, 300 40, 500 20 S 800 0, 1000 20 S 1200 40, 1200 20"
        fill="none"
        stroke="#8c9a84"
        strokeWidth={1.5}
        opacity={0.4}
      />
    </svg>
  );
}
