import type { ReactNode } from 'react';

export function DetailList({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="divide-y divide-slate-100">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-3 gap-3 py-2.5 text-sm"
        >
          <dt className="text-slate-500">{row.label}</dt>
          <dd className="col-span-2 font-medium text-slate-800">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
