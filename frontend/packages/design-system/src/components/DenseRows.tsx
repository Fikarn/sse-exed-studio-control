import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from "react";

import styles from "./DenseRows.module.css";

export type DenseRowTone = "default" | "muted" | "ready" | "warning" | "error";

export interface DenseListProps extends HTMLAttributes<HTMLUListElement> {
  children: ReactNode;
}

export function DenseList({ children, className, ...props }: DenseListProps) {
  return (
    <ul className={[styles.list, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </ul>
  );
}

export interface DenseListRowProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
  actions?: ReactNode;
  detail?: ReactNode;
  leading?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
  tone?: DenseRowTone;
}

export function DenseListRow({
  actions,
  className,
  detail,
  leading,
  meta,
  title,
  tone = "default",
  ...props
}: DenseListRowProps) {
  return (
    <li className={[styles.listRow, styles[tone], className].filter(Boolean).join(" ")} {...props}>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
      <span className={styles.rowCopy}>
        <strong className={styles.rowTitle}>{title}</strong>
        {detail ? <span className={styles.rowDetail}>{detail}</span> : null}
      </span>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </li>
  );
}

export interface DenseTableColumn {
  align?: "start" | "end";
  key: string;
  label: ReactNode;
}

export interface DenseTableRow {
  cells: Record<string, ReactNode>;
  id: string;
  tone?: DenseRowTone;
}

export interface DenseTableProps extends TableHTMLAttributes<HTMLTableElement> {
  caption?: ReactNode;
  columns: DenseTableColumn[];
  rows: DenseTableRow[];
}

export function DenseTable({ caption, className, columns, rows, ...props }: DenseTableProps) {
  return (
    <table className={[styles.table, className].filter(Boolean).join(" ")} {...props}>
      {caption ? <caption className={styles.caption}>{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th className={column.align === "end" ? styles.alignEnd : undefined} key={column.key} scope="col">
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className={styles[row.tone ?? "default"]} key={row.id}>
            {columns.map((column) => (
              <td className={column.align === "end" ? styles.alignEnd : undefined} key={column.key}>
                {row.cells[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
