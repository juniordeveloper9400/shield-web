import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FilterSelect, SearchInput } from '@/components/ui/Filters';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  blankLabTest,
  CUT_OFF_TIMES,
  DEPARTMENTS,
  DIVISIONS,
  netAmount,
  PERFORM_AT,
  REPORTING_TIMES,
  SCHEDULED_DAYS,
  pickInput,
  searchLabTests,
  SAMPLES,
  TECHNOLOGIES,
  TEST_MODES,
  TEST_TYPE_LABELS,
  type LabTestSearchBy,
  validateLabTest,
  VOLUMES,
} from '@/lib/labTests';
import {
  deleteLabTest,
  getLabTest,
  listLabTests,
  saveLabTest,
} from '@/api/labTests';
import { listLabCategories } from '@/api/labCategories';
import type {
  LabTestSource,
  LabGroupItem,
  LabReportUnit,
  LabSpecialRate,
  LabTestInput,
  LabTestSummary,
  LabTestType,
} from '@/types';
import {
  LisCheck,
  LisNumber,
  LisSelect,
  LisText,
  LisTextarea,
} from './fields';
import { GroupTestTab } from './GroupTestTab';
import { SpecialRateTab } from './SpecialRateTab';

type TabKey =
  | 'details'
  | 'refs'
  | 'spec1'
  | 'spec2'
  | 'spec3'
  | 'special'
  | 'group'
  | 'result';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'details', label: 'Test Details' },
  { key: 'refs', label: 'Ref1 & Ref2' },
  { key: 'spec1', label: 'Specification 1' },
  { key: 'spec2', label: 'Specification 2' },
  { key: 'spec3', label: 'Specification 3' },
  { key: 'special', label: 'Special Rate & Ref Lab' },
  { key: 'group', label: 'Set Grouptest' },
  { key: 'result', label: 'Result Template' },
];

type SearchBy = LabTestSearchBy;

const SEARCH_BY: { value: SearchBy; label: string }[] = [
  { value: 'name', label: 'Test Name' },
  { value: 'short', label: 'Short Name' },
  { value: 'lis', label: 'Lis Code' },
];

const TYPE_OPTIONS = (Object.keys(TEST_TYPE_LABELS) as LabTestType[]).map((value) => ({
  value,
  label: TEST_TYPE_LABELS[value],
}));

/** Which tests the Saved tests list shows. It opens on the tests made here; the
 *  imported rate list is a separate view, and always available to a group. */
type ListSource = LabTestSource | 'all';

const SOURCE_FILTER: { value: ListSource; label: string }[] = [
  { value: 'ADMIN', label: 'Created here' },
  { value: 'RATE_LIST', label: 'Rate list' },
  { value: 'all', label: 'Both' },
];

const LIST_TYPE_FILTER = [
  { value: 'all', label: 'All types' },
  ...TYPE_OPTIONS,
];

/** How many saved tests the list shows before "Show more". */
const LIST_PAGE = 50;

interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

interface Confirm {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}

/** Sorted, de-duplicated suggestion list: the built-ins plus whatever staff
 *  have already typed on saved tests. */
function suggestions(base: string[], extra: string[]): string[] {
  return Array.from(new Set([...base, ...extra.filter(Boolean)])).sort();
}

/**
 * The laboratory's test master, laid out like its LIS "Test" screen: search a
 * test by name, edit it across the Test Details / Ref / Specification / Special
 * Rate / Set Grouptest / Result Template tabs, then Delete, New or Save. A test
 * can be a single Test, a Group Test or a Package (the last two are built on
 * the Set Grouptest tab from other saved tests).
 */
export function LabTestMaster() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync(listLabTests, []);
  const list = useMemo(() => data ?? [], [data]);
  const { data: categoryRows } = useAsync(listLabCategories, []);
  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'No category' },
      ...(categoryRows ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [categoryRows],
  );

  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    lisCode: number;
    updatedAt: string;
    source: LabTestSource;
  } | null>(null);
  const [form, setForm] = useState<LabTestInput>(blankLabTest);
  const [items, setItems] = useState<LabGroupItem[]>([]);
  const [rates, setRates] = useState<LabSpecialRate[]>([]);
  const [tab, setTab] = useState<TabKey>('details');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const [searchBy, setSearchBy] = useState<SearchBy>('name');
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const [listSearch, setListSearch] = useState('');
  const [listType, setListType] = useState('all');
  const [listSource, setListSource] = useState<ListSource>('ADMIN');
  const [shown, setShown] = useState(LIST_PAGE);

  const userName = user?.name ?? '';

  // ---- edits ------------------------------------------------------------

  function patch(change: Partial<LabTestInput>) {
    setForm((current) => {
      const next = { ...current, ...change };
      if ('rate' in change || 'discountPercent' in change) {
        next.amount = netAmount(next.rate, next.discountPercent);
      }
      return next;
    });
    setDirty(true);
    setNotice(null);
  }

  function changeItems(next: LabGroupItem[]) {
    setItems(next);
    setDirty(true);
    setNotice(null);
  }

  function changeRates(next: LabSpecialRate[]) {
    setRates(next);
    setDirty(true);
    setNotice(null);
  }

  // ---- loading / resetting ---------------------------------------------

  function reset() {
    setLoadedId(null);
    setMeta(null);
    setForm(blankLabTest());
    setItems([]);
    setRates([]);
    setTab('details');
    setDirty(false);
    setSearchText('');
  }

  /** Loads [id] into the form. Returns false when it no longer exists. */
  async function load(id: string): Promise<boolean> {
    const test = await getLabTest(id);
    if (!test) return false;
    setLoadedId(test.id);
    setMeta({ lisCode: test.lisCode, updatedAt: test.updatedAt, source: test.source });
    setForm(pickInput(test));
    setItems(test.groupItems);
    setRates(test.specialRates);
    setDirty(false);
    return true;
  }

  /** Runs [action], first asking before it throws away unsaved edits. */
  function guarded(action: () => void) {
    if (!dirty) {
      action();
      return;
    }
    setConfirm({
      title: 'Discard unsaved changes?',
      message: 'This test has changes that have not been saved. Continue and lose them?',
      confirmLabel: 'Discard changes',
      danger: true,
      onConfirm: action,
    });
  }

  async function openTest(id: string) {
    setBusy(true);
    setNotice(null);
    try {
      const found = await load(id);
      if (found) {
        setSearchText('');
        setSearchOpen(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setNotice({ tone: 'error', text: 'That test no longer exists.' });
        reload();
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not open the test.' });
    } finally {
      setBusy(false);
    }
  }

  // ---- save / delete ----------------------------------------------------

  async function save() {
    const problem = validateLabTest(form, items, rates);
    if (problem) {
      setNotice({ tone: 'error', text: problem });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await saveLabTest(loadedId, form, items, rates, userName);
      await load(saved.id);
      reload();
      setNotice({
        tone: 'ok',
        text: `Saved "${form.name.trim()}" — Lis Code ${saved.lisCode}.`,
      });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not save the test.' });
    } finally {
      setBusy(false);
    }
  }

  function askDelete() {
    if (!loadedId) return;
    const id = loadedId;
    const name = form.name;
    setConfirm({
      title: 'Delete this test?',
      message: `"${name}" will be removed from the test master. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await deleteLabTest(id, name);
        reset();
        reload();
        setNotice({ tone: 'ok', text: `Deleted "${name}".` });
      },
    });
  }

  async function runConfirm() {
    if (!confirm) return;
    const current = confirm;
    setBusy(true);
    try {
      await current.onConfirm();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'That did not work.' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  // ---- derived ----------------------------------------------------------

  // The tests made here, and the imported rate list kept for building groups.
  const ownTests = useMemo(() => list.filter((t) => t.source === 'ADMIN'), [list]);
  const rateListCount = list.length - ownTests.length;

  // What the search box offers: every test on record — the ones made here and
  // the imported rate list alike — by name, so nothing has to be typed first to
  // see what there is. Typing narrows it. `list` is already ordered by name.
  const matches = useMemo(
    () => searchLabTests(list, searchBy, searchText),
    [list, searchBy, searchText],
  );

  const pickable = useMemo(
    () => list.filter((t) => t.testType === 'TEST' && t.isActive && t.id !== loadedId),
    [list, loadedId],
  );

  const departments = useMemo(
    () => suggestions(DEPARTMENTS, list.map((t) => t.department)),
    [list],
  );
  const samples = useMemo(() => suggestions(SAMPLES, list.map((t) => t.sample)), [list]);
  // Methods and reporting times come from the tests already on record (the
  // rate list has dozens of methods), so a new test offers what its neighbours use.
  const methods = useMemo(() => suggestions([], list.map((t) => t.method)), [list]);
  const reportingTimes = useMemo(
    () => suggestions(REPORTING_TIMES, list.map((t) => t.reportingTime)),
    [list],
  );

  const filteredList = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return list.filter((t) => {
      const matchesType = listType === 'all' || t.testType === listType;
      const matchesSource = listSource === 'all' || t.source === listSource;
      const matchesQuery =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.shortName.toLowerCase().includes(q) ||
        String(t.lisCode).includes(q) ||
        t.department.toLowerCase().includes(q) ||
        t.method.toLowerCase().includes(q) ||
        t.sample.toLowerCase().includes(q);
      return matchesType && matchesSource && matchesQuery;
    });
  }, [list, listSearch, listType, listSource]);

  // The saved list can hold hundreds of tests (the rate list alone is 500+),
  // so it shows a page at a time.
  const visibleList = useMemo(() => filteredList.slice(0, shown), [filteredList, shown]);

  const title = form.name.trim()
    ? `${form.name.trim()}${form.shortName.trim() ? ` ( ${form.shortName.trim()} )` : ''}`
    : 'New test';

  const listColumns: Column<LabTestSummary>[] = [
    { key: 'lis', header: 'Lis Code', render: (row) => row.lisCode },
    {
      key: 'name',
      header: 'Test',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          {row.shortName && <p className="text-xs text-slate-400">{row.shortName}</p>}
          {row.source === 'RATE_LIST' && listSource === 'all' && (
            <p className="text-xs text-slate-400">Rate list</p>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <Badge tone={row.testType === 'TEST' ? 'blue' : 'violet'}>
          {TEST_TYPE_LABELS[row.testType]}
          {row.testType !== 'TEST' ? ` · ${row.itemCount}` : ''}
        </Badge>
      ),
    },
    { key: 'dept', header: 'Department', render: (row) => row.department || '—' },
    { key: 'method', header: 'Method', render: (row) => row.method || '—' },
    { key: 'sample', header: 'Sample', render: (row) => row.sample || '—' },
    { key: 'reporting', header: 'Reporting', render: (row) => row.reportingTime || '—' },
    {
      key: 'amount',
      header: 'Patient rate',
      render: (row) => formatCurrency(row.amount),
      className: 'text-right',
    },
    {
      key: 'labRate',
      header: 'Lab rate',
      render: (row) => (row.labRate > 0 ? formatCurrency(row.labRate) : '—'),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.isActive ? 'green' : 'gray'}>{row.isActive ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => guarded(() => void openTest(row.id))}
        >
          Open
        </Button>
      ),
      className: 'text-right',
    },
  ];

  // ---- render -----------------------------------------------------------

  return (
    <>
      {/* A failed load is shown up here, not only in the list far below the
          form — a missing table otherwise looks like "there are no tests". */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          <p className="font-semibold">The lab tests could not be loaded.</p>
          <p className="mt-0.5">{error}</p>
          <p className="mt-1 text-xs text-rose-600">
            If it says a table or column does not exist, the lab test migrations have not been
            applied to this database yet: <code>0046_lab_test_master.sql</code>, then{' '}
            <code>0048_lab_test_rate_list_columns.sql</code>, then{' '}
            <code>0049_seed_lab_test_rate_list.sql</code> (in <code>backend/db/migrations</code>).
          </p>
        </div>
      )}
      <Card>
        <div className="space-y-5 p-4 sm:p-5">
          {/* Search By / Search Test by Name */}
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <LisSelect
              label="Search By"
              value={searchBy}
              onChange={(v) => setSearchBy(v as SearchBy)}
              options={SEARCH_BY}
            />
            <div className="relative">
              <input
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                // Also on click: after picking a test the input is still
                // focused, so a second click would otherwise show nothing.
                onClick={() => setSearchOpen(true)}
                onBlur={() => setSearchOpen(false)}
                placeholder={`Search Test by ${SEARCH_BY.find((s) => s.value === searchBy)?.label}`}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              {searchOpen && (
                <ul
                  // Keeps the input focused while the list is used — grabbing
                  // its scrollbar would otherwise blur the input, close the
                  // list, and make a few hundred names impossible to scroll.
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute z-20 mt-1 max-h-96 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                >
                  {loading && list.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-400">Loading tests…</li>
                  ) : matches.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-400">
                      {list.length === 0 ? 'No tests on record yet.' : 'No test matches.'}
                    </li>
                  ) : (
                    <>
                      <li className="sticky top-0 border-b border-slate-100 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
                        {searchText.trim()
                          ? `${matches.length} of ${list.length} tests`
                          : `All ${list.length} tests`}
                      </li>
                      {matches.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            // mousedown, not click: the input's blur would close
                            // the list first and swallow the click.
                            onMouseDown={(e) => {
                              e.preventDefault();
                              guarded(() => void openTest(t.id));
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                          >
                            <span className="font-medium text-slate-800">{t.name}</span>
                            <span className="shrink-0 text-xs text-slate-400">
                              {t.shortName ? `${t.shortName} · ` : ''}
                              {t.lisCode} · {TEST_TYPE_LABELS[t.testType]}
                              {t.source === 'RATE_LIST' ? ' · Rate list' : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </>
                  )}
                </ul>
              )}
            </div>
          </div>

          <h2 className="text-lg font-semibold uppercase tracking-wide text-slate-800">
            {title}
            {meta?.source === 'RATE_LIST' && (
              <span className="ml-3 align-middle">
                <Badge tone="gray">Rate list test</Badge>
              </span>
            )}
          </h2>

          {/* Tabs */}
          <div className="-mx-1 flex flex-wrap gap-2 rounded-lg bg-slate-50 p-2" role="tablist">
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`rounded-md px-3.5 py-2 text-sm font-semibold transition ${
                    active
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-brand-700 hover:bg-brand-50'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Test Details */}
          {tab === 'details' && (
            <div className="grid gap-x-6 gap-y-5 lg:grid-cols-[1fr_230px]">
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-12">
                  <LisText
                    label="Test Name"
                    value={form.name}
                    onChange={(v) => patch({ name: v })}
                    className="sm:col-span-6"
                  />
                  <LisText
                    label="Short Name"
                    value={form.shortName}
                    onChange={(v) => patch({ shortName: v })}
                    className="sm:col-span-3"
                  />
                  <LisText
                    label="Calc Code"
                    value={form.calcCode}
                    onChange={(v) => patch({ calcCode: v })}
                    className="sm:col-span-3"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <LisSelect
                    label="Test Type"
                    value={form.testType}
                    onChange={(v) => patch({ testType: v as LabTestType })}
                    options={TYPE_OPTIONS}
                  />
                  <LisText
                    label="Division"
                    value={form.division}
                    onChange={(v) => patch({ division: v })}
                    suggestions={DIVISIONS}
                  />
                  <LisText
                    label="Department"
                    value={form.department}
                    onChange={(v) => patch({ department: v })}
                    suggestions={departments}
                  />
                  <LisText
                    label="Method"
                    value={form.method}
                    onChange={(v) => patch({ method: v })}
                    suggestions={methods}
                  />
                  <LisSelect
                    label="Category"
                    value={form.categoryId}
                    onChange={(v) => patch({ categoryId: v })}
                    options={categoryOptions}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <LisNumber label="Rate" value={form.rate} onChange={(v) => patch({ rate: v })} />
                  <LisNumber
                    label="Disc%"
                    value={form.discountPercent}
                    onChange={(v) => patch({ discountPercent: v })}
                  />
                  <LisNumber label="Amount" value={form.amount} onChange={() => {}} readOnly />
                  <LisNumber
                    label="Lab Rate"
                    value={form.labRate}
                    onChange={(v) => patch({ labRate: v })}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <LisText
                    label="Sample"
                    value={form.sample}
                    onChange={(v) => patch({ sample: v })}
                    suggestions={samples}
                  />
                  <LisText
                    label="Volume"
                    value={form.volume}
                    onChange={(v) => patch({ volume: v })}
                    suggestions={VOLUMES}
                  />
                  <LisText
                    label="Unit"
                    value={form.unit}
                    onChange={(v) => patch({ unit: v })}
                  />
                  <LisText
                    label="Technology"
                    value={form.technology}
                    onChange={(v) => patch({ technology: v })}
                    suggestions={TECHNOLOGIES}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <LisText
                    label="Scheduled Days"
                    value={form.scheduledDays}
                    onChange={(v) => patch({ scheduledDays: v })}
                    suggestions={SCHEDULED_DAYS}
                  />
                  <LisText
                    label="Cut of time"
                    value={form.cutOfTime}
                    onChange={(v) => patch({ cutOfTime: v })}
                    suggestions={CUT_OFF_TIMES}
                  />
                  <LisText
                    label="Reporting Time"
                    value={form.reportingTime}
                    onChange={(v) => patch({ reportingTime: v })}
                    suggestions={reportingTimes}
                  />
                  <LisText
                    label="Test Mode"
                    value={form.testMode}
                    onChange={(v) => patch({ testMode: v })}
                    suggestions={TEST_MODES}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <LisNumber
                    label="Report On"
                    integer
                    value={form.reportOnValue}
                    onChange={(v) => patch({ reportOnValue: v })}
                  />
                  <LisSelect
                    label="Report unit"
                    value={form.reportOnUnit}
                    onChange={(v) => patch({ reportOnUnit: v as LabReportUnit })}
                    options={[
                      { value: 'Minutes', label: 'Minutes' },
                      { value: 'Hours', label: 'Hours' },
                      { value: 'Days', label: 'Days' },
                    ]}
                  />
                  <LisText
                    label="Perform At"
                    value={form.performAt}
                    onChange={(v) => patch({ performAt: v })}
                    suggestions={PERFORM_AT}
                  />
                </div>

                <LisTextarea
                  label="Internal Note"
                  value={form.internalNote}
                  onChange={(v) => patch({ internalNote: v })}
                  rows={4}
                />
              </div>

              {/* Right-hand column: Lis Code and the switches */}
              <div className="space-y-3 lg:pl-2">
                <p className="text-sm font-semibold text-slate-700">
                  Lis Code:{' '}
                  <span className="text-slate-900">
                    {meta ? meta.lisCode : <span className="font-normal text-slate-400">assigned on save</span>}
                  </span>
                </p>
                <LisCheck label="NABL Accredited" checked={form.nablAccredited} onChange={(c) => patch({ nablAccredited: c })} />
                <LisCheck label="Send SMS" checked={form.sendSms} onChange={(c) => patch({ sendSms: c })} />
                <LisCheck label="Sample Type(Barcode)" checked={form.sampleTypeBarcode} onChange={(c) => patch({ sampleTypeBarcode: c })} />
                <LisCheck label="Free Test" checked={form.freeTest} onChange={(c) => patch({ freeTest: c })} />
                <LisCheck label="Avoid Incentive" checked={form.avoidIncentive} onChange={(c) => patch({ avoidIncentive: c })} />
                <LisCheck label="Alphanumeric Critical" checked={form.alphanumericCritical} onChange={(c) => patch({ alphanumericCritical: c })} />
                <LisCheck label="Common Technology" checked={form.commonTechnology} onChange={(c) => patch({ commonTechnology: c })} />
                <LisCheck label="Avoid Result Entry" checked={form.avoidResultEntry} onChange={(c) => patch({ avoidResultEntry: c })} />
                <LisCheck label="Hide Head" checked={form.hideHead} onChange={(c) => patch({ hideHead: c })} />
                <LisCheck label="Edit TestRate" checked={form.editTestRate} onChange={(c) => patch({ editTestRate: c })} />
                <div className="border-t border-slate-200 pt-3">
                  <LisCheck label="Active" checked={form.isActive} onChange={(c) => patch({ isActive: c })} />
                  <p className="mt-1 text-xs text-slate-400">
                    Inactive tests stay on record but cannot be added to a group.
                  </p>
                </div>
              </div>
            </div>
          )}

          {tab === 'refs' && (
            <div className="grid gap-5 md:grid-cols-2">
              <LisTextarea
                label="Ref 1"
                value={form.ref1}
                onChange={(v) => patch({ ref1: v })}
                rows={10}
                placeholder="Reference range, e.g. Adult male: 0.7 – 1.3 mg/dL"
              />
              <LisTextarea
                label="Ref 2"
                value={form.ref2}
                onChange={(v) => patch({ ref2: v })}
                rows={10}
                placeholder="A second reference range, e.g. Adult female: 0.6 – 1.1 mg/dL"
              />
            </div>
          )}

          {tab === 'spec1' && (
            <LisTextarea
              label="Specifications"
              value={form.specification1}
              onChange={(v) => patch({ specification1: v })}
              rows={12}
            />
          )}
          {tab === 'spec2' && (
            <LisTextarea
              label="Specifications 2"
              value={form.specification2}
              onChange={(v) => patch({ specification2: v })}
              rows={12}
            />
          )}
          {tab === 'spec3' && (
            <LisTextarea
              label="Specifications 3"
              value={form.specification3}
              onChange={(v) => patch({ specification3: v })}
              rows={12}
            />
          )}

          {tab === 'special' && (
            <SpecialRateTab rates={rates} onChange={changeRates} standardAmount={form.amount} />
          )}

          {tab === 'group' && (
            <GroupTestTab
              testType={form.testType}
              items={items}
              onChange={changeItems}
              pickable={pickable}
              totalAmount={form.amount}
            />
          )}

          {tab === 'result' && (
            <LisTextarea
              label="Result Template"
              value={form.resultTemplate}
              onChange={(v) => patch({ resultTemplate: v })}
              rows={14}
              placeholder="The text a result is pre-filled with when it is entered for this test."
            />
          )}

          {notice && (
            <p
              role="status"
              className={`rounded-lg px-3 py-2 text-sm ${
                notice.tone === 'ok'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              {notice.text}
            </p>
          )}

          {/* Footer: UserInfo and Delete / New / Save */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span>
                <strong className="font-semibold text-slate-700">UserInfo:</strong>{' '}
                {meta ? (
                  <>
                    {userName || '—'} {formatDateTime(meta.updatedAt)}
                  </>
                ) : (
                  // A blank/new test has no save to report yet — showing "now" here
                  // used to look exactly like a save confirmation and nothing else
                  // on screen said otherwise, which is exactly backwards: this test
                  // has not been saved.
                  <span className="italic text-slate-400">Not saved yet</span>
                )}
              </span>
              {dirty && <Badge tone="amber">Unsaved changes</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="danger" disabled={busy || !loadedId} onClick={askDelete}>
                Delete
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => guarded(reset)}>
                New
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Saved tests */}
      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Saved tests</h3>
            <p className="text-xs text-slate-400">
              {ownTests.length} created here
              {rateListCount > 0 ? ` · ${rateListCount} in the rate list` : ''} — Open one to edit it
              in the form above.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <SearchInput
              value={listSearch}
              onChange={(value) => {
                setListSearch(value);
                setShown(LIST_PAGE);
              }}
              placeholder="Search name, code, method, sample…"
            />
            <FilterSelect
              value={listSource}
              onChange={(value) => {
                setListSource(value as ListSource);
                setShown(LIST_PAGE);
              }}
              options={SOURCE_FILTER}
            />
            <FilterSelect
              value={listType}
              onChange={(value) => {
                setListType(value);
                setShown(LIST_PAGE);
              }}
              options={LIST_TYPE_FILTER}
            />
          </div>
        </div>
        <DataTable
          columns={listColumns}
          rows={visibleList}
          loading={loading}
          error={error}
          empty={
            listSource === 'ADMIN' && ownTests.length === 0 && !listSearch.trim()
              ? rateListCount > 0
                ? `Nothing created here yet — fill in the form above and press Save. The ${rateListCount} rate-list tests are still there to pick from when you build a Group Test or Package (Set Grouptest tab); switch the filter to Rate list to browse them.`
                : 'Nothing created here yet — fill in the form above and press Save.'
              : 'No tests match.'
          }
        />
        {filteredList.length > visibleList.length && (
          <div className="border-t border-slate-200 p-3 text-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShown((count) => count + LIST_PAGE)}
            >
              Show more ({filteredList.length - visibleList.length} more)
            </Button>
          </div>
        )}
      </Card>

      <Modal
        open={confirm !== null}
        onClose={() => (busy ? undefined : setConfirm(null))}
        title={confirm?.title ?? ''}
        footer={
          <>
            <div className="flex-1" />
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.danger ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => void runConfirm()}
            >
              {confirm?.confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{confirm?.message}</p>
      </Modal>
    </>
  );
}
