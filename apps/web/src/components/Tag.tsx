import type { ReactNode } from "react";

export type TagTone = "neutral" | "success" | "danger" | "info" | "warning" | "violet" | "pink";

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: TagTone }) {
  return <span className={"mark mark-" + tone}>{children}</span>;
}
