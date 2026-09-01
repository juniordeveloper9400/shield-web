import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Extra classes applied to both the header cell and body cells. */
  className?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty = 'No records found.',
  loading = false,
  error = null,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  loading?: boolean;
  error?: string | null;
}) {
  const message = loading
    ? 'Loading…'
    : error
      ? error
      : empty;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`whitespace-nowrap px-4 py-3 ${column.className ?? ''}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className={`px-4 py-14 text-center ${
                  error ? 'text-rose-500' : 'text-slate-400'
                }`}
              >
                {message}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="transition hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`whitespace-nowrap px-4 py-3 align-middle ${column.className ?? ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
