import type { ReactNode } from 'react';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';

type StatTone = 'blue' | 'green' | 'amber' | 'violet' | 'rose';

const TONES: Record<StatTone, string> = {
  blue: 'bg-brand-50 text-brand-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  rose: 'bg-rose-50 text-rose-600',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: IconName;
  tone?: StatTone;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        {icon && (
          <span className={`shrink-0 rounded-lg p-2 ${TONES[tone]}`}>
            <Icon name={icon} className="h-5 w-5" />
          </span>
        )}
      </div>
    </Card>
  );
}
