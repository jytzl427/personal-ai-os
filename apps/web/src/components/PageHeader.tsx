import type { ReactNode } from "react";

export function PageHeader({
  title,
  meta,
  children
}: {
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <div className="page-header-side">
        {meta ? <span className="page-meta">{meta}</span> : null}
        {children}
      </div>
    </header>
  );
}
