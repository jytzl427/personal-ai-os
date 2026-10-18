import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  meta,
  children
}: {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      <div className="page-header-side">
        {meta ? <span className="page-meta-badge">{meta}</span> : null}
        {children}
      </div>
    </header>
  );
}
