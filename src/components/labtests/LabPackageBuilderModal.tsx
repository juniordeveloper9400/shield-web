import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { blankLabPackage, validateLabPackage } from '@/lib/labPackages';
import { useAsync } from '@/lib/useAsync';
import { listLabCategories } from '@/api/labCategories';
import {
  createLabPackage,
  getLabPackageTestIds,
  listLabTestsForPicker,
  updateLabPackageBuild,
} from '@/api/labPackages';
import type { LabPackage, LabPackageInput } from '@/types';

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

function fromPackage(pkg: LabPackage): LabPackageInput {
  return {
    name: pkg.name,
    categoryId: pkg.categoryId,
    price: pkg.price,
    mrp: pkg.mrp,
    forWhom: pkg.forWhom,
    sample: pkg.sample,
    preparation: pkg.preparation,
    reportIn: pkg.reportIn,
    about: pkg.about,
    testIds: [],
  };
}

/**
 * "+ New package" and "Edit tests" — the one form for both, since a package
 * is a name, an optional category, pricing and the set of `app.lab_test`
 * rows it's built from either way. Saving writes the real link
 * (`app.lab_package_test_item`) and, derived from the same tests,
 * `app.lab_profile` — the app's own package card needs nothing new to render
 * what this creates (see `createLabPackage`'s own doc).
 */
export function LabPackageBuilderModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null creates a new package; a package edits its tests and pricing. */
  editing: LabPackage | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: categoryRows } = useAsync(listLabCategories, []);
  const { data: testRows } = useAsync(listLabTestsForPicker, []);
  const categories = categoryRows ?? [];
  const tests = testRows ?? [];

  const [form, setForm] = useState<LabPackageInput>(blankLabPackage);
  const [initialTestIds, setInitialTestIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resets to the package being edited (or blank, for a new one) each time
  // the modal opens — including its already-chosen tests, read back by the
  // real link rather than guessed from lab_profile's free-text rows.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearch('');
    if (editing) {
      setForm(fromPackage(editing));
      let alive = true;
      getLabPackageTestIds(editing.id).then((ids) => {
        if (!alive) return;
        setForm((f) => ({ ...f, testIds: ids }));
        setInitialTestIds(ids);
      });
      return () => {
        alive = false;
      };
    }
    setForm(blankLabPackage());
    setInitialTestIds([]);
  }, [open, editing]);

  const chosen = useMemo(
    () => form.testIds.map((id) => tests.find((t) => t.id === id)).filter((t) => t != null),
    [form.testIds, tests],
  );
  const chosenTotal = useMemo(() => chosen.reduce((sum, t) => sum + t.amount, 0), [chosen]);

  const filteredTests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tests.filter(
      (t) =>
        !form.testIds.includes(t.id) &&
        (!q || t.name.toLowerCase().includes(q) || t.department.toLowerCase().includes(q)),
    );
  }, [tests, form.testIds, search]);

  function toggleTest(id: string) {
    setForm((f) => ({ ...f, testIds: [...f.testIds, id] }));
  }

  function removeTest(id: string) {
    setForm((f) => ({ ...f, testIds: f.testIds.filter((t) => t !== id) }));
  }

  async function save() {
    const problem = validateLabPackage(form);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const testsChanged =
        editing == null ||
        form.testIds.length !== initialTestIds.length ||
        form.testIds.some((id, i) => id !== initialTestIds[i]);
      if (editing) {
        await updateLabPackageBuild(editing.id, form, testsChanged);
      } else {
        await createLabPackage(form);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this package.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${editing.name}` : 'New package'}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create package'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Diabetes Check"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Category</span>
            <select
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              className={inputClass}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Price (₹)</span>
            <input
              inputMode="numeric"
              value={form.price || ''}
              onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) || 0 }))}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">MRP (₹)</span>
            <input
              inputMode="numeric"
              value={form.mrp || ''}
              onChange={(e) => setForm((f) => ({ ...f, mrp: Number(e.target.value) || 0 }))}
              className={inputClass}
            />
          </label>
        </div>
        <p className="text-xs text-slate-400">
          Saving is recalculated as MRP − price on save
          {chosenTotal > 0 && ` · chosen tests add up to ${formatCurrency(chosenTotal)}`}.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">For whom</span>
            <input
              value={form.forWhom}
              onChange={(e) => setForm((f) => ({ ...f, forWhom: e.target.value }))}
              placeholder="For Male & Female"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Report in</span>
            <input
              value={form.reportIn}
              onChange={(e) => setForm((f) => ({ ...f, reportIn: e.target.value }))}
              placeholder="24 hrs"
              className={inputClass}
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Sample</span>
            <input
              value={form.sample}
              onChange={(e) => setForm((f) => ({ ...f, sample: e.target.value }))}
              placeholder="Blood"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Preparation</span>
            <input
              value={form.preparation}
              onChange={(e) => setForm((f) => ({ ...f, preparation: e.target.value }))}
              placeholder="12 hrs fasting"
              className={inputClass}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">About</span>
          <textarea
            value={form.about}
            onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))}
            rows={2}
            className={inputClass}
          />
        </label>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">
            Tests in this package ({chosen.length})
          </p>
          {chosen.length === 0 ? (
            <p className="text-xs text-slate-400">
              Choose from the test master below to build the package.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {chosen.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                >
                  {t.name}
                  <button
                    type="button"
                    onClick={() => removeTest(t.id)}
                    aria-label={`Remove ${t.name}`}
                    className="text-brand-500 hover:text-brand-700"
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tests to add by name or department…"
            className={inputClass}
          />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            {filteredTests.length === 0 ? (
              <p className="p-3 text-center text-xs text-slate-400">
                {tests.length === 0
                  ? 'No tests in the Test Master yet — add some on the Test Master tab first.'
                  : 'No matching tests.'}
              </p>
            ) : (
              filteredTests.slice(0, 30).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTest(t.id)}
                  className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                >
                  <span>
                    <span className="text-slate-800">{t.name}</span>
                    {t.department && <span className="text-xs text-slate-400"> · {t.department}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    {formatCurrency(t.amount)}
                    <Icon name="plus" className="h-3.5 w-3.5 text-brand-600" />
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}
      </div>
    </Modal>
  );
}
