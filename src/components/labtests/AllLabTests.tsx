import { useState } from 'react';
import { listLabTests, deleteLabTest } from '@/api/labTests';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { filterAllLabTests, TEST_TYPE_LABELS } from '@/lib/labTests';
import { formatCurrency } from '@/lib/format';
import type { LabTestSummary, LabTestType } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterSelect, SearchInput } from '@/components/ui/Filters';
import { LabTestMaster } from './LabTestMaster';

/** Packages first, then Individual, then Group — the order the user asked
 *  for, not alphabetical and not {@link TEST_TYPE_LABELS}'s own order. */
const TYPE_TABS: { key: LabTestType; label: string }[] = [
  { key: 'PACKAGE', label: 'Packages' },
  { key: 'TEST', label: 'Individual Test' },
  { key: 'GROUP', label: 'Group Test' },
];

export function AllLabTests() {
  const { accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listLabTests(accessToken), [accessToken]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeTab, setTypeTab] = useState<LabTestType>('PACKAGE');
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState('all');
  const [shown, setShown] = useState(50);
  const [deleting, setDeleting] = useState<LabTestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const tests = data ?? [];
  const categories = [...new Map(tests.filter((t) => t.categoryId)
    .map((t) => [t.categoryId, t.categoryName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const byType = tests.filter((t) => t.testType === typeTab);
  const filtered = filterAllLabTests(byType, { query, categoryId, status });
  const columns: Column<LabTestSummary>[] = [
    { key: 'name', header: 'Test', render: (t) => <><div className="font-medium">{t.name}</div><div className="text-xs text-slate-500">LIS {t.lisCode} · {TEST_TYPE_LABELS[t.testType]}</div><p className="max-w-md line-clamp-2 text-xs text-slate-500">{t.description}</p></> },
    { key: 'category', header: 'Category', render: (t) => t.categoryName || 'Uncategorized' },
    { key: 'amount', header: 'Amount', render: (t) => formatCurrency(t.amount) },
    { key: 'status', header: 'Status', render: (t) => t.isActive ? 'Active' : 'Inactive' },
    { key: 'actions', header: 'Actions', render: (t) => <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setSelectedId(t.id)}>Edit</Button><Button size="sm" variant="danger" onClick={() => { setNotice(''); setDeleting(t); }}>Delete</Button></div> },
  ];

  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteLabTest(deleting.id, accessToken);
      setDeleting(null);
      reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete the test.');
    } finally { setBusy(false); }
  }

  if (selectedId) return <LabTestMaster key={selectedId} initialTestId={selectedId} onDone={() => { setSelectedId(null); reload(); }} />;
  return <>
    <Card>
      <div className="space-y-3 border-b border-slate-200 p-4">
        <h2 className="font-semibold">All Tests</h2>
        <p className="text-sm text-slate-500">Every saved test, group and package, including imported and inactive tests. Edit a test to change its category, description and other details.</p>
        <div className="-mx-1 flex flex-wrap gap-2 rounded-lg bg-slate-50 p-2" role="tablist">
          {TYPE_TABS.map((t) => {
            const active = t.key === typeTab;
            const count = tests.filter((x) => x.testType === t.key).length;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setTypeTab(t.key); setShown(50); }}
                className={`rounded-md px-3.5 py-2 text-sm font-semibold transition ${
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-brand-700 hover:bg-brand-50'
                }`}
              >
                {t.label} · {count}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3">
          <label><span className="sr-only">Search tests</span><SearchInput value={query} onChange={(v) => { setQuery(v); setShown(50); }} placeholder="Search tests, category or LIS code" /></label>
          <label><span className="sr-only">Category</span><FilterSelect value={categoryId} onChange={(v) => { setCategoryId(v); setShown(50); }} options={[{ value: 'all', label: 'All categories' }, { value: 'uncategorized', label: 'Uncategorized' }, ...categories.map(([value, label]) => ({ value, label }))]} /></label>
          <label><span className="sr-only">Status</span><FilterSelect value={status} onChange={(v) => { setStatus(v); setShown(50); }} options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} /></label>
        </div>
        <p className="text-xs text-slate-500">{filtered.length} tests</p>
      </div>
      <DataTable columns={columns} rows={filtered.slice(0, shown)} loading={loading} error={error} empty="No tests match these filters." />
      {filtered.length > shown && <div className="p-4"><Button variant="secondary" onClick={() => setShown(shown + 50)}>Show more</Button></div>}
    </Card>
    <Modal open={!!deleting} title="Delete this test?" onClose={() => { if (!busy) setDeleting(null); }} footer={<><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete test'}</Button></>}>
      <p>Delete “{deleting?.name}”? This cannot be undone. Tests used in packages, groups or bookings must be removed from those records or deactivated instead.</p>
      {notice && <p role="alert" className="mt-3 text-rose-600">{notice}</p>}
    </Modal>
  </>;
}
