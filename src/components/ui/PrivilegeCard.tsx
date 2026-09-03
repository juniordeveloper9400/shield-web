import { formatCurrency } from '@/lib/format';

/**
 * The privilege card, drawn the way the app and web app draw it: concentric
 * rings in the tier's own colour under a frosted panel, a gold chip, and the
 * card number, holder and load embossed on the front.
 *
 * The three tiers are told apart by finish — silver is slate, gold is amber,
 * platinum is teal — so the whole face repaints from one `tierKind`.
 */
export interface PrivilegeCardProps {
  /** `silver` · `gold` · `platinum` — anything else falls back to silver. */
  tierKind: string;
  /** e.g. `Silver Shield`. */
  tierName: string;
  /** e.g. `9010 8801 0010 4821`. */
  cardNumber: string;
  /** Member name, embossed as the holder. */
  holder: string;
  /** The load the plan was activated for. */
  amount: number;
  /** The 10% programme bonus. */
  bonus: number;
  /** Optional pill shown top-right, e.g. the approval status. */
  status?: string;
  /** Optional small line under the load, e.g. "Expires 12 Aug 2026". */
  footNote?: string;
  className?: string;
}

type Ramp = { light: string; mid: string; dark: string };

const RAMPS: Record<string, Ramp> = {
  silver: { light: '#AEB7C2', mid: '#6E7A8A', dark: '#1c2126' },
  gold: { light: '#D9B36B', mid: '#A9791B', dark: '#241a06' },
  platinum: { light: '#6FA9AD', mid: '#2F6E73', dark: '#0c1f20' },
};

export function PrivilegeCard({
  tierKind,
  tierName,
  cardNumber,
  holder,
  amount,
  bonus,
  status,
  footNote,
  className = '',
}: PrivilegeCardProps) {
  const ramp = RAMPS[tierKind?.toLowerCase()] ?? RAMPS.silver;
  const rings = `repeating-radial-gradient(circle at 3% 34%, rgba(255,255,255,0.06) 0 1.5px, transparent 1.5px 24px), radial-gradient(circle at 3% 34%, ${ramp.light} 0%, ${ramp.mid} 44%, ${ramp.dark} 100%)`;

  return (
    <div
      className={`relative aspect-[245/155] w-full overflow-hidden rounded-2xl text-white shadow-md ${className}`}
      style={{ background: rings }}
    >
      <div className="absolute inset-0 bg-white/10" />
      <div
        className="relative flex h-full flex-col p-4"
        style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] tracking-wide">
            <span className="font-extrabold">Privilege</span> card
          </span>
          <div className="flex items-center gap-2">
            {status && (
              <span className="rounded-full bg-black/25 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                {status}
              </span>
            )}
            <span className="grid h-6 w-6 place-items-center rounded-md bg-white text-[11px] font-black text-emerald-700">
              S
            </span>
          </div>
        </div>

        {/* chip */}
        <div className="mt-2 h-6 w-9 rounded-[5px] bg-gradient-to-br from-[#e7c877] to-[#b8901f] ring-1 ring-black/10">
          <div className="mx-auto mt-1 h-4 w-4 rounded-[2px] border border-[#8a6e1f]/70" />
        </div>

        <p className="mt-2.5 font-mono text-[15px] font-bold tracking-[0.18em] sm:text-base">
          {cardNumber || '•••• •••• •••• ••••'}
        </p>

        <div className="mt-auto flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-wider text-white/75">
              Holder
            </p>
            <p className="truncate text-[11px] font-semibold uppercase">
              {holder ? holder.toUpperCase() : 'SHIELD MEMBER'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[8px] font-bold uppercase tracking-wider text-white/75">
              Loaded
            </p>
            <p className="font-mono text-[15px] font-extrabold tracking-wide">
              {formatCurrency(amount)}
            </p>
          </div>
        </div>

        <p className="mt-1 text-[10px] font-bold tracking-wide">
          10% BONUS · {formatCurrency(bonus)}
          <span className="ml-2 font-semibold text-white/70">{tierName}</span>
        </p>
        {footNote && (
          <p className="text-[9px] font-medium tracking-wide text-white/70">
            {footNote}
          </p>
        )}
      </div>
    </div>
  );
}
