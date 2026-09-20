import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import type { LabSpecialRate } from '@/types';

const input =
  'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

/**
 * "Special Rate & Ref Lab": a referring lab's own price for this test, in place
 * of the standard amount when the sample comes from that lab.
 */
export function SpecialRateTab({
  rates,
  onChange,
  standardAmount,
}: {
  rates: LabSpecialRate[];
  onChange: (rates: LabSpecialRate[]) => void;
  standardAmount: number;
}) {
  function patch(index: number, change: Partial<LabSpecialRate>) {
    onChange(rates.map((rate, i) => (i === index ? { ...rate, ...change } : rate)));
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        Standard amount: <strong className="text-slate-700">{formatCurrency(standardAmount)}</strong>.
        Add a row for each referring lab that has its own rate for this test.
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">SINO</th>
              <th className="px-3 py-2">Ref Lab</th>
              <th className="px-3 py-2">Special Rate</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">
                  No special rates — every lab pays the standard amount.
                </td>
              </tr>
            )}
            {rates.map((rate, index) => (
              <tr key={index}>
                <td className="border-b border-slate-200 px-3 py-2 text-slate-500">{index + 1}</td>
                <td className="border-b border-slate-200 px-3 py-2">
                  <input
                    value={rate.refLab}
                    onChange={(e) => patch(index, { refLab: e.target.value })}
                    placeholder="Referring lab name"
                    className={input}
                  />
                </td>
                <td className="border-b border-slate-200 px-3 py-2">
                  <input
                    inputMode="decimal"
                    value={String(rate.rate)}
                    onChange={(e) => {
                      const text = e.target.value;
                      if (!/^\d*\.?\d{0,2}$/.test(text)) return;
                      patch(index, { rate: text === '' || text === '.' ? 0 : Number(text) });
                    }}
                    className={`${input} w-32`}
                  />
                </td>
                <td className="border-b border-slate-200 px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onChange(rates.filter((_, i) => i !== index))}
                    className="text-xs font-medium text-rose-600 hover:underline"
                    aria-label={`Delete row ${index + 1}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onChange([...rates, { refLab: '', rate: standardAmount }])}
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> Add Row
        </Button>
      </div>
    </div>
  );
}
