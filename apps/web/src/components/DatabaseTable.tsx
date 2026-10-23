import type { ReactNode } from "react";

export type DatabaseColumn<Row> = {
  key: string;
  label: string;
  className?: string;
  render: (row: Row) => ReactNode;
};

export function DatabaseTable<Row extends { id: string }>({
  columns,
  rows,
  empty,
  footer,
  rowState,
  rowClassName
}: {
  columns: DatabaseColumn<Row>[];
  rows: Row[];
  empty: ReactNode;
  footer?: ReactNode;
  rowState?: (row: Row) => "saving" | "failed" | undefined;
  rowClassName?: (row: Row) => string | undefined;
}) {
  return (
    <div className="database">
      <div className="database-scroll">
        <table className="database-table">
          <thead>
            <tr>{columns.map((column) => <th className={column.className} key={column.key}>{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td className="database-empty" colSpan={columns.length}>{empty}</td></tr>
              : rows.map((row) => {
                  const state = rowState?.(row);
                  const customClass = rowClassName?.(row);
                  const trClass = [state ? `is-${state}` : "", customClass || ""].filter(Boolean).join(" ") || undefined;
                  return (
                    <tr className={trClass} key={row.id}>
                      {columns.map((column) => <td className={column.className} key={column.key}>{column.render(row)}</td>)}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}
