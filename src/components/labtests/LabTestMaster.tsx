import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  blankLabTest,
  DIVISIONS,
  netAmount,
  pickInput,
  searchLabTests,
  TEST_TYPE_LABELS,
  type LabTestSearchBy,
  validateLabTest,
} from '@/lib/labTests';
import {
  createLabTestFieldOption,
  deleteLabTest,
  deleteLabTestFieldOption,
  getLabTest,
  listLabTestFieldOptions,
  listLabTests,
  saveLabTest,
  updateLabTestFieldOption,
  type LabTestFieldKey,
  type LabTestFieldOption,
} from '@/api/labTests';
import { createLabCategory, listLabCategories } from '@/api/labCategories';
import type {
  LabTestSource,
  LabGroupItem,
  LabReportUnit,
  LabSpecialRate,
  LabTestInput,
  LabTestType,
} from '@/types';
import {
  LisCheck,
  LisCombobox,
  LisNumber,
  LisSelect,
  LisText,
  LisTextarea,
} from './fields';
import { GroupTestTab } from './GroupTestTab';

type TabKey = 'details' | 'spec1' | 'spec2' | 'group';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'details', label: 'Test Details' },
  { key: 'spec1', label: 'About' },
  { key: 'spec2', label: 'Why this test' },
  { key: 'group', label: 'Set Grouptest' },
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

/**
 * The laboratory's test master, laid out like its LIS "Test" screen: search a
 * test by name, edit it across the Test Details / Ref / Specification / Special
 * Rate / Set Grouptest / Result Template tabs, then Delete, New or Save. A test
 * can be a single Test, a Group Test or a Package (the last two are built on
 * the Set Grouptest tab from other saved tests).
 */
export function LabTestMaster({
  initialTestId,
  initialType,
  onDone,
}: { initialTestId?: string; initialType?: LabTestType; onDone?: () => void } = {}) {
  const { user, accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listLabTests(accessToken), [accessToken]);
  const list = useMemo(() => data ?? [], [data]);
  const { data: categoryRows, reload: reloadCategories } = useAsync(() => listLabCategories(accessToken), [accessToken]);
  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'No category' },
      ...(categoryRows ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [categoryRows],
  );

  // Department / Method / Sample / Volume / Scheduled Days / Cut of time /
  // Reporting Time / Technology / Test Mode / Perform At's own pick lists —
  // managed independently of any one test (see LisCombobox's own doc).
  const { data: fieldOptionsData, reload: reloadFieldOptions } = useAsync(
    () => listLabTestFieldOptions(accessToken),
    [accessToken],
  );
  const EMPTY_OPTIONS: LabTestFieldOption[] = [];
  const optionsFor = (key: LabTestFieldKey) => fieldOptionsData?.[key] ?? EMPTY_OPTIONS;

  async function addFieldOption(key: LabTestFieldKey, value: string) {
    try {
      await createLabTestFieldOption(key, value, accessToken);
      reloadFieldOptions();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not add that.' });
    }
  }

  async function renameFieldOption(id: string, value: string) {
    try {
      await updateLabTestFieldOption(id, value, accessToken);
      reloadFieldOptions();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not rename that.' });
    }
  }

  async function removeFieldOption(id: string) {
    try {
      await deleteLabTestFieldOption(id, accessToken);
      reloadFieldOptions();
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not delete that.' });
    }
  }

  async function addCategoryOption(name: string) {
    try {
      const id = await createLabCategory({ name, image: '', sort: 0, isActive: true }, accessToken);
      if (id) {
        reloadCategories();
        patch({ categoryId: id });
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Could not add that category.' });
    }
  }

  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    lisCode: number;
    updatedAt: string;
    source: LabTestSource;
  } | null>(null);
  const [form, setForm] = useState<LabTestInput>(() =>
    initialType ? { ...blankLabTest(), testType: initialType } : blankLabTest(),
  );
  const [items, setItems] = useState<LabGroupItem[]>([]);
  const [rates, setRates] = useState<LabSpecialRate[]>([]);
  const [tab, setTab] = useState<TabKey>('details');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(!!initialTestId);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const [searchBy, setSearchBy] = useState<SearchBy>('name');
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

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
    const test = await getLabTest(id, accessToken);
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

  useEffect(() => {
    if (initialTestId) void openTest(initialTestId);
    // Load the selected record once when this editor mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTestId]);

  async function save() {
    const problem = validateLabTest(form, items, rates);
    if (problem) {
      setNotice({ tone: 'error', text: problem });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await saveLabTest(loadedId, form, items, rates, accessToken);
      if (onDone) { onDone(); return; }
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
        await deleteLabTest(id, accessToken);
        if (onDone) { onDone(); return; }
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

  // What the search box offers: every test on record — the ones made here and
  // the imported rate list alike — by name, so nothing has to be typed first to
  // see what there is. Typing narrows it. `list` is already ordered by name.
  const matches = useMemo(
    () => searchLabTests(list, searchBy, searchText),
    [list, searchBy, searchText],
  );

  // Every saved single test can go into a group or package, active or not —
  // "Inactive" means off the app on its own, not unusable as a line inside
  // someone else's group/package (GroupTestTab marks which ones are
  // inactive so that's still visible while picking). A GROUP/PACKAGE itself
  // is excluded — no nesting a group inside another group.
  const pickable = useMemo(
    () => list.filter((t) => t.testType === 'TEST' && t.id !== loadedId),
    [list, loadedId],
  );

  const title = form.name.trim()
    ? `${form.name.trim()}${form.shortName.trim() ? ` ( ${form.shortName.trim()} )` : ''}`
    : 'New test';

  // ---- render -----------------------------------------------------------

  return (
    <>
      {onDone && <Button variant="secondary" disabled={busy} onClick={() => guarded(onDone)}>Back to All Tests</Button>}
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
        <fieldset disabled={busy || (!!initialTestId && !loadedId)} className="min-w-0 space-y-5 p-4 sm:p-5">
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
              const isGroupTab = t.key === 'group';
              const isGroupOrPackage = form.testType === 'PACKAGE' || form.testType === 'GROUP';
              const disabled = isGroupTab && !isGroupOrPackage;
              const label =
                isGroupTab
                  ? form.testType === 'PACKAGE'
                    ? 'Set Packagetest'
                    : 'Set Grouptest'
                  : t.label;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  disabled={disabled}
                  aria-selected={active}
                  onClick={() => {
                    if (!disabled) setTab(t.key);
                  }}
                  title={
                    disabled
                      ? 'Select Test Type as Group or Package to enable'
                      : undefined
                  }
                  className={`rounded-md px-3.5 py-2 text-sm font-semibold transition ${
                    disabled
                      ? 'cursor-not-allowed bg-transparent text-slate-400 opacity-50'
                      : active
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-brand-700 hover:bg-brand-50'
                  }`}
                >
                  {label}
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
                    label="Alias Name"
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
                  <LisCombobox
                    label="Department"
                    value={form.department}
                    onChange={(v) => patch({ department: v })}
                    options={optionsFor('department')}
                    onAddOption={(v) => void addFieldOption('department', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                  <LisCombobox
                    label="Method"
                    value={form.method}
                    onChange={(v) => patch({ method: v })}
                    options={optionsFor('method')}
                    onAddOption={(v) => void addFieldOption('method', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                  <LisSelect
                    label="Category"
                    value={form.categoryId}
                    onChange={(v) => patch({ categoryId: v })}
                    options={categoryOptions}
                    onAddOption={(name) => void addCategoryOption(name)}
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
                  <LisCombobox
                    label="Sample"
                    value={form.sample}
                    onChange={(v) => patch({ sample: v })}
                    options={optionsFor('sample')}
                    onAddOption={(v) => void addFieldOption('sample', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                  <LisCombobox
                    label="Volume"
                    value={form.volume}
                    onChange={(v) => patch({ volume: v })}
                    options={optionsFor('volume')}
                    onAddOption={(v) => void addFieldOption('volume', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                  <LisText
                    label="Unit"
                    value={form.unit}
                    onChange={(v) => patch({ unit: v })}
                  />
                  <LisCombobox
                    label="Technology"
                    value={form.technology}
                    onChange={(v) => patch({ technology: v })}
                    options={optionsFor('technology')}
                    onAddOption={(v) => void addFieldOption('technology', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <LisCombobox
                    label="Scheduled Days"
                    value={form.scheduledDays}
                    onChange={(v) => patch({ scheduledDays: v })}
                    options={optionsFor('scheduledDays')}
                    onAddOption={(v) => void addFieldOption('scheduledDays', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                  <LisCombobox
                    label="Cut of time"
                    value={form.cutOfTime}
                    onChange={(v) => patch({ cutOfTime: v })}
                    options={optionsFor('cutOfTime')}
                    onAddOption={(v) => void addFieldOption('cutOfTime', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                  <LisCombobox
                    label="Reporting Time"
                    value={form.reportingTime}
                    onChange={(v) => patch({ reportingTime: v })}
                    options={optionsFor('reportingTime')}
                    onAddOption={(v) => void addFieldOption('reportingTime', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                  <LisCombobox
                    label="Test Mode"
                    value={form.testMode}
                    onChange={(v) => patch({ testMode: v })}
                    options={optionsFor('testMode')}
                    onAddOption={(v) => void addFieldOption('testMode', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
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
                  <LisCombobox
                    label="Perform At"
                    value={form.performAt}
                    onChange={(v) => patch({ performAt: v })}
                    options={optionsFor('performAt')}
                    onAddOption={(v) => void addFieldOption('performAt', v)}
                    onRenameOption={(id, v) => void renameFieldOption(id, v)}
                    onDeleteOption={(id) => void removeFieldOption(id)}
                  />
                </div>

                <LisTextarea
                  label="Description (shown in the app)"
                  value={form.description}
                  onChange={(value) => patch({ description: value })}
                />
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
                  <div className="mt-3">
                    <LisCheck
                      label="Show in the app"
                      checked={form.showInApp}
                      onChange={(c) => patch({ showInApp: c })}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Members see this{' '}
                    {form.testType === 'GROUP'
                      ? 'group test'
                      : form.testType === 'PACKAGE'
                        ? 'package'
                        : 'test'}{' '}
                    under “Top Profiles and Tests” in the Lab section and can book it. It
                    needs to be Active too.
                  </p>
                  <div className="mt-3">
                    <LisCheck
                      label="Most Common Test"
                      checked={form.isMostCommon}
                      disabled={!form.showInApp}
                      onChange={(c) => patch({ isMostCommon: c })}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Also leads the colourful “Most Common Tests” banner above the package
                    cards in the Lab section — needs “Show in the app” switched on too.
                  </p>
                  {form.testType === 'PACKAGE' && (
                    <div className="mt-3">
                      <LisText
                        label="Fasting"
                        value={form.fasting}
                        onChange={(v) => patch({ fasting: v })}
                        placeholder="e.g. 12 hrs fasting"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'spec1' && (
            <LisTextarea
              label="About"
              value={form.specification1}
              onChange={(v) => patch({ specification1: v })}
              rows={12}
            />
          )}
          {tab === 'spec2' && (
            <div className="space-y-5">
              <LisTextarea
                label="Why this test"
                value={form.specification2}
                onChange={(v) => patch({ specification2: v })}
                rows={12}
              />
              <SymptomsInput
                value={form.symptoms}
                onChange={(v) => patch({ symptoms: v })}
              />
            </div>
          )}
          {tab === 'group' && (
            <GroupTestTab
              testType={form.testType}
              items={items}
              onChange={changeItems}
              pickable={pickable}
              totalAmount={form.amount}
              categories={categoryRows ?? []}
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
              {!onDone && <Button variant="secondary" disabled={busy} onClick={() => guarded(reset)}>
                New
              </Button>}
              <Button variant="primary" disabled={busy} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </div>
        </fieldset>
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

/**
 * "Symptoms that may indicate this test" — the chips shown on the
 * member-facing detail screen, entered here rather than hardcoded in either
 * app. Type a symptom and press Enter (or comma) to add it as a chip.
 */
function SymptomsInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const symptom = draft.trim();
    setDraft('');
    if (!symptom || value.some((s) => s.toLowerCase() === symptom.toLowerCase())) return;
    onChange([...value, symptom]);
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        Symptoms that may indicate this test
      </span>
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-300 p-2">
        {value.map((symptom, index) => (
          <span
            key={`${symptom}-${index}`}
            className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
          >
            {symptom}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="text-slate-400 hover:text-slate-700"
              aria-label={`Remove ${symptom}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          placeholder="Type a symptom and press Enter…"
          className="min-w-[180px] flex-1 border-none px-1 py-1 text-sm outline-none"
        />
      </div>
    </div>
  );
}
