import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { groupTotal, nextSetOrder, TEST_TYPE_LABELS } from '@/lib/labTests';
import type { LabGroupItem, LabTestSummary, LabTestType } from '@/types';

const cell = 'border-b border-slate-200 px-3 py-2';
const numberInput =
  'w-20 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

/**
 * "Set Grouptest": the tests a Group Test or Package is made of — one row each
 * with the test, what it costs inside this group, its order on the report and
 * whether it is a sub-heading. Total Amount is the group's own selling price;
 * Group Amount is what its tests add up to, so the difference is the saving.
 */
export function GroupTestTab({
  testType,
  items,
  onChange,
  pickable,
  totalAmount,
}: {
  testType: LabTestType;
  items: LabGroupItem[];
  onChange: (items: LabGroupItem[]) => void;
  /** Saved, active single tests that can be added (the group itself excluded). */
  pickable: LabTestSummary[];
  totalAmount: number;
}) {
  const byId = useMemo(() => new Map(pickable.map((t) => [t.id, t])), [pickable]);

  if (testType === 'TEST') {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
        This is a single test. Set <strong>Test Type</strong> to{' '}
        <strong>{TEST_TYPE_LABELS.GROUP}</strong> or{' '}
        <strong>{TEST_TYPE_LABELS.PACKAGE}</strong> on the Test Details tab to
        build it from other tests.
      </div>
    );
  }

  function patch(index: number, change: Partial<LabGroupItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  }

  function choose(index: number, testId: string) {
    const test = byId.get(testId);
    if (!test) return;
    patch(index, {
      testId: test.id,
      name: test.name,
      department: test.department,
      sample: test.sample,
      // A row starts at the test's own price; staff can change it for this group.
      amount: test.amount,
    });
  }

  const groupAmount = groupTotal(items);
  const saving = groupAmount - totalAmount;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">SINO</th>
              <th className="px-3 py-2">Test Name</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Setorder</th>
              <th className="px-3 py-2">Is Subhead</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Sampletype</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">
                  No tests yet — press Add Row.
                </td>
              </tr>
            )}
            {items.map((item, index) => {
              const taken = new Set(
                items.filter((_, i) => i !== index).map((other) => other.testId),
              );
              const options = pickable
                .filter((t) => !taken.has(t.id))
                .map((t) => ({ value: t.id, label: t.name }));
              return (
                <tr key={`${item.testId || 'new'}-${index}`}>
                  <td className={`${cell} text-slate-500`}>{index + 1}</td>
                  <td className={`${cell} min-w-[220px]`}>
                    <Combobox
                      value={item.testId}
                      onChange={(id) => choose(index, id)}
                      options={options}
                      placeholder="Choose a test…"
                      searchPlaceholder="Search tests…"
                    />
                  </td>
                  <td className={cell}>
                    <input
                      inputMode="decimal"
                      value={item.amount === 0 && !item.testId ? '' : String(item.amount)}
                      onChange={(e) => {
                        const text = e.target.value;
                        if (!/^\d*\.?\d{0,2}$/.test(text)) return;
                        patch(index, { amount: text === '' || text === '.' ? 0 : Number(text) });
                      }}
                      className={numberInput}
                    />
                  </td>
                  <td className={cell}>
                    <input
                      inputMode="numeric"
                      value={String(item.setOrder)}
                      onChange={(e) => {
                        const text = e.target.value;
                        if (!/^\d*$/.test(text)) return;
                        patch(index, { setOrder: text === '' ? 0 : Number(text) });
                      }}
                      className={numberInput}
                    />
                  </td>
                  <td className={cell}>
                    <input
                      type="checkbox"
                      checked={item.isSubhead}
                      onChange={(e) => patch(index, { isSubhead: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      aria-label={`${item.name || 'Row'} is a subhead`}
                    />
                  </td>
                  <td className={`${cell} text-slate-600`}>{item.department || '—'}</td>
                  <td className={`${cell} text-slate-600`}>{item.sample || '—'}</td>
                  <td className={`${cell} text-right`}>
                    <button
                      type="button"
                      onClick={() => onChange(items.filter((_, i) => i !== index))}
                      className="text-xs font-medium text-rose-600 hover:underline"
                      aria-label={`Delete row ${index + 1}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            onChange([
              ...items,
              {
                testId: '',
                name: '',
                department: '',
                sample: '',
                amount: 0,
                setOrder: nextSetOrder(items),
                isSubhead: false,
              },
            ])
          }
          disabled={pickable.length === 0}
        >
          <Icon name="plus" className="h-3.5 w-3.5" /> Add Row
        </Button>

        <dl className="text-right text-sm">
          <div className="flex justify-end gap-2">
            <dt className="font-medium text-slate-500">Total Amount:</dt>
            <dd className="w-24 font-semibold text-slate-800">{formatCurrency(totalAmount)}</dd>
          </div>
          <div className="flex justify-end gap-2">
            <dt className="font-medium text-slate-500">Group Amount:</dt>
            <dd className="w-24 font-semibold text-slate-800">{formatCurrency(groupAmount)}</dd>
          </div>
          {items.length > 0 && (
            <p className={`mt-1 text-xs ${saving >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {saving >= 0
                ? `Sold ${formatCurrency(saving)} below the sum of its tests`
                : `Sold ${formatCurrency(-saving)} above the sum of its tests`}
            </p>
          )}
        </dl>
      </div>

      {pickable.length === 0 && (
        <p className="mt-2 text-xs text-amber-600">
          There are no saved single tests to add yet. Save some tests first, then
          come back to build the group.
        </p>
      )}
    </div>
  );
}
