import { useState } from 'react';
import { listLabTests, deleteLabTest, getLabTest, saveLabTest } from '@/api/labTests';
import { listLabPackages, setLabPackageActive } from '@/api/labPackages';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import { filterAllLabTests, pickInput, TEST_TYPE_LABELS } from '@/lib/labTests';
import { formatCurrency } from '@/lib/format';
import type { LabPackage, LabTestSummary, LabTestType } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterSelect, SearchInput } from '@/components/ui/Filters';
import { LabTestMaster } from './LabTestMaster';
import { LabPackageBuilderModal } from './LabPackageBuilderModal';

/** A tab key is either a real `testType`, or the synthetic 'TOP_PROFILES' —
 *  not a type at all, but every test currently flagged "Show in the app"
 *  (any type), the same set that fills "Top Profiles and Tests" in the Lab
 *  section. Staff could only see that by opening each test's own form before;
 *  this tab lists the whole thing in one place. */
type TestTab = LabTestType | 'TOP_PROFILES';

/** Packages first, then Individual, then Group, then the cross-type "what's
 *  actually listed" view — the order the user asked for, not alphabetical
 *  and not {@link TEST_TYPE_LABELS}'s own order. */
const TYPE_TABS: { key: TestTab; label: string }[] = [
  { key: 'PACKAGE', label: 'Packages' },
  { key: 'TEST', label: 'Individual Test' },
  { key: 'GROUP', label: 'Group Test' },
  { key: 'TOP_PROFILES', label: 'Top Profiles' },
];

export function AllLabTests() {
  const { accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listLabTests(accessToken), [accessToken]);
  // Builder-made packages (app.lab_package, source_test_id null) — a
  // different thing from a Test Master row whose Test Type is Package.
  // listLabTests never carries these at all, so without this the Packages
  // tab only ever showed the Test-Master kind and a package built from the
  // "+ New package" flow (like "muzaa") had nowhere in the console to appear
  // or be edited.
  const { data: builderData, loading: builderLoading, reload: reloadBuilderPackages } =
    useAsync(() => listLabPackages(accessToken), [accessToken]);
  const builderPackages = builderData ?? [];
  const [editingPackage, setEditingPackage] = useState<LabPackage | 'new' | null>(null);
  const [togglingPackageId, setTogglingPackageId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeTab, setTypeTab] = useState<TestTab>('PACKAGE');
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [status, setStatus] = useState('all');
  const [shown, setShown] = useState(50);
  const [deleting, setDeleting] = useState<LabTestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const tests = data ?? [];
  const categories = [...new Map(tests.filter((t) => t.categoryId)
    .map((t) => [t.categoryId, t.categoryName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const byType = typeTab === 'TOP_PROFILES'
    ? tests.filter((t) => t.showInApp)
    : tests.filter((t) => t.testType === typeTab);
  const filtered = filterAllLabTests(byType, { query, categoryId, status });
  const columns: Column<LabTestSummary>[] = [
    { key: 'name', header: 'Test', render: (t) => <><div className="font-medium">{t.name}</div><div className="text-xs text-slate-500">LIS {t.lisCode} · {TEST_TYPE_LABELS[t.testType]}</div><p className="max-w-md line-clamp-2 text-xs text-slate-500">{t.description}</p></> },
    { key: 'category', header: 'Category', render: (t) => t.categoryName || 'Uncategorized' },
    { key: 'amount', header: 'Amount', render: (t) => formatCurrency(t.amount) },
    { key: 'status', header: 'Status', render: (t) => t.isActive ? 'Active' : 'Inactive' },
    {
      key: 'listing',
      header: 'Listing',
      render: (t) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.showInApp && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Top Profiles</span>}
          {t.isMostCommon && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Most Common</span>}
          <Button
            size="sm"
            variant={t.showInApp ? 'secondary' : 'primary'}
            disabled={togglingId === t.id}
            onClick={() => void toggleShowInApp(t)}
          >
            {togglingId === t.id ? '…' : t.showInApp ? 'Remove' : '+ Top Profiles'}
          </Button>
        </div>
      ),
    },
    { key: 'actions', header: 'Actions', render: (t) => <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setSelectedId(t.id)}>Edit</Button><Button size="sm" variant="danger" onClick={() => { setNotice(''); setDeleting(t); }}>Delete</Button></div> },
  ];

  /** Flips "Show in the app" straight from the list — the same field the
   *  Test Master form's own switch writes, just reached without opening the
   *  full form first. Reads the test's current full record so every other
   *  field (group members, special rates, every other tab) round-trips
   *  untouched — saveLabTest always writes a complete record, never a
   *  partial one, so this has to post everything back, not just the one
   *  flag that changed. Works the same for a Test, a Group Test or a
   *  Package: nothing here is type-gated, so a package can be added to Top
   *  Profiles too if staff choose to. */
  async function toggleShowInApp(t: LabTestSummary) {
    if (togglingId) return;
    setTogglingId(t.id);
    setNotice('');
    try {
      const full = await getLabTest(t.id, accessToken);
      if (!full) {
        setNotice(`"${t.name}" could not be found — try reloading the list.`);
        return;
      }
      const input = { ...pickInput(full), showInApp: !t.showInApp };
      await saveLabTest(t.id, input, full.groupItems, full.specialRates, accessToken);
      reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update that test.');
    } finally {
      setTogglingId(null);
    }
  }

  async function togglePackageActive(p: LabPackage) {
    if (togglingPackageId) return;
    setTogglingPackageId(p.id);
    setNotice('');
    try {
      await setLabPackageActive(p.id, !p.isActive, accessToken);
      reloadBuilderPackages();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not update that package.');
    } finally {
      setTogglingPackageId(null);
    }
  }

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
            const count = t.key === 'TOP_PROFILES'
              ? tests.filter((x) => x.showInApp).length
              : tests.filter((x) => x.testType === t.key).length;
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
        {notice && !deleting && <p role="alert" className="text-sm text-rose-600">{notice}</p>}
      </div>
      <DataTable columns={columns} rows={filtered.slice(0, shown)} loading={loading} error={error} empty="No tests match these filters." />
      {filtered.length > shown && <div className="p-4"><Button variant="secondary" onClick={() => setShown(shown + 50)}>Show more</Button></div>}
    </Card>
    {typeTab === 'PACKAGE' && (
      <Card>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <h2 className="font-semibold">Packages built in the Package Builder</h2>
            <p className="text-sm text-slate-500">
              Member-bookable packages assembled from real tests under “+ New package” — a
              different thing from a Test Master row whose Test Type is Package, and edited here
              rather than on the Test Master form.
            </p>
          </div>
          <Button size="sm" onClick={() => setEditingPackage('new')}>+ New package</Button>
        </div>
        <DataTable
          columns={[
            { key: 'name', header: 'Package', render: (p: LabPackage) => <><div className="font-medium">{p.name}</div><p className="max-w-md line-clamp-2 text-xs text-slate-500">{p.about}</p></> },
            { key: 'category', header: 'Category', render: (p: LabPackage) => categories.find(([id]) => id === p.categoryId)?.[1] || 'Uncategorized' },
            { key: 'tests', header: 'Tests', render: (p: LabPackage) => `${p.testCount} tests` },
            { key: 'price', header: 'Price', render: (p: LabPackage) => formatCurrency(p.price) },
            { key: 'status', header: 'Status', render: (p: LabPackage) => p.isActive ? 'Active' : 'Inactive' },
            {
              key: 'actions',
              header: 'Actions',
              render: (p: LabPackage) => (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditingPackage(p)}>Edit</Button>
                  <Button
                    size="sm"
                    variant={p.isActive ? 'danger' : 'secondary'}
                    disabled={togglingPackageId === p.id}
                    onClick={() => void togglePackageActive(p)}
                  >
                    {togglingPackageId === p.id ? '…' : p.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ),
            },
          ]}
          rows={builderPackages}
          loading={builderLoading}
          empty="No packages built here yet — press “+ New package” to make one."
        />
      </Card>
    )}
    <Modal open={!!deleting} title="Delete this test?" onClose={() => { if (!busy) setDeleting(null); }} footer={<><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete test'}</Button></>}>
      <p>Delete “{deleting?.name}”? This cannot be undone. Tests used in packages, groups or bookings must be removed from those records or deactivated instead.</p>
      {notice && <p role="alert" className="mt-3 text-rose-600">{notice}</p>}
    </Modal>
    <LabPackageBuilderModal
      open={editingPackage !== null}
      editing={editingPackage === 'new' || editingPackage === null ? null : editingPackage}
      onClose={() => setEditingPackage(null)}
      onSaved={() => { setEditingPackage(null); reloadBuilderPackages(); }}
    />
  </>;
}
