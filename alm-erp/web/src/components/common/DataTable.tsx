import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { formatNumber } from '../../utils/format';
import { Button } from './Button';
import { EmptyState, ErrorState, LoadingState } from './States';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'right';
  width?: string;
  /** Server sort key; enables a sortable header. */
  sortKey?: string;
  hideBelow?: number;
}

interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: { message: string } | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyText?: ReactNode;
  onRowClick?: (row: T) => void;
  paging?: { page: number; pageSize: number; total: number; onPage: (p: number) => void };
  sort?: { value: string; onChange: (s: string) => void };
}

export function DataTable<T>({ caption, columns, rows, rowKey, loading, error, onRetry, emptyTitle = 'No data', emptyText, onRowClick, paging, sort }: DataTableProps<T>) {
  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <LoadingState />;
  const items = rows ?? [];
  const onKey = (e: KeyboardEvent, row: T) => {
    if (onRowClick && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      onRowClick(row);
    }
  };
  return (
    <div aria-busy={loading || undefined}>
      {error && <ErrorState error={error} onRetry={onRetry} inline />}
      <div className="table-wrap">
        <table className="dt">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort && c.sortKey && sort.value.replace(/^-/, '') === c.sortKey;
                const desc = active && sort!.value.startsWith('-');
                return (
                  <th key={c.key} scope="col" className={c.align === 'right' ? 'num' : undefined} style={{ width: c.width }}
                    aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}>
                    {sort && c.sortKey ? (
                      <button className="sort" onClick={() => sort.onChange(active && !desc ? `-${c.sortKey}` : c.sortKey!)}>
                        {c.header}{active && (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={rowKey(row)} className={onRowClick ? 'clickable' : undefined} tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined} onKeyDown={(e) => onKey(e, row)}>
                {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>{c.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && !loading && <EmptyState title={emptyTitle} inline>{emptyText}</EmptyState>}
      {paging && paging.total > 0 && <Pagination {...paging} />}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="table-footer" aria-label="Pagination">
      <span className="muted">{formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}</span>
      <div className="pagination">
        <Button size="sm" variant="transparent" iconOnly aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="transparent" iconOnly aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></Button>
      </div>
    </nav>
  );
}
