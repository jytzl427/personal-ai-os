import type { ReactNode } from "react";

export type TagTone = "neutral" | "success" | "danger" | "info" | "warning" | "violet" | "pink";

export function Tag({
  children,
  tone = "neutral",
  size = "md"
}: {
  children: ReactNode;
  tone?: TagTone;
  size?: "sm" | "md";
}) {
  return <span className={`mark mark-${tone} mark-${size}`}>{children}</span>;
}
