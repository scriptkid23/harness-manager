import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-stone bg-card p-8 shadow-soft",
        "transition duration-500 ease-out hover:-translate-y-1 hover:shadow-large",
        className,
      )}
      {...props}
    />
  );
}
