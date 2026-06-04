import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function SectionHeading({
  children,
  className,
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return <Tag className={cn("text-4xl md:text-5xl tracking-tight", className)}>{children}</Tag>;
}
