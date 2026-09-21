import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { fileToResizedDataUrl } from '@/lib/images';
import { useAsync } from '@/lib/useAsync';
import {
  createLabCategory,
  deleteLabCategory,
  listLabCategories,
  moveLabCategory,
  setLabCategoryActive,
  updateLabCategory,
} from '@/api/labCategories';
import type { LabCategory, NewLabCategory } from '@/types';

const ICON_MAX = 240;
const ICON_QUALITY = 0.85;

function blank(sort: number): NewLabCategory {
  return { name: '', image: '', sort, isActive: true };
}

/**
 * "Explore by health concern" — the categories both apps' Lab section grids
 * tiles come from (`app.lab_category`, migration 0055). A test or a package
 * carries one of these; the count each row shows here is a live tally of its
 * active packages, the same figure Member packages itself would show.
 */
export function LabCategoriesPanel() {
  const { data, loading, error, reload } = useAsync(listLabCategories, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewLabCategory>(blank(0));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  function openAdd() {
    setDraft(blank(rows.length));
    setFormError(null);
    setEditingId(null);
    setAdding(true);
  }

  function openEdit(row: LabCategory) {
    setDraft({ name: row.name, image: row.image, sort: row.sort, isActive: row.isActive });
    setFormError(null);
    setEditingId(row.id);
    setAdding(false);
  }

  function close() {
    setAdding(false);
    setEditingId(null);
  }

  async function handlePick(file: File) {
    setFormError(null);
    try {
      const url = await fileToResizedDataUrl(file, ICON_MAX, ICON_QUALITY, true);
      setDraft((d) => ({ ...d, image: url }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load the image.');
    }
  }

  async function save() {
    if (!draft.name.trim()) {
      setFormError('Give the category a name.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const ok = editingId
        ? await updateLabCategory(editingId, draft)
        : (await createLabCategory(draft)) !== null;
      if (!ok) {
        setFormError(`A category named "${draft.name.trim()}" already exists.`);
        return;
      }
      close();
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the category.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: LabCategory) {
    await setLabCategoryActive(row.id, !row.isActive);
    reload();
  }

  async function move(row: LabCategory, direction: 'up' | 'down') {
    await moveLabCategory(row.id, direction, rows);
    reload();
  }

  async function remove(row: LabCategory) {
    setRowError(null);
    try {
      await deleteLabCategory(row.id, row.name);
      reload();
    } catch (err) {
      setRowError({
        id: row.id,
        message: err instanceof Error ? err.message : 'Could not delete this category.',
      });
    }
  }

  const columns: Column<LabCategory>[] = [
    {
      key: 'icon',
      header: '',
      render: (row) =>
        row.image ? (
          <img src={row.image} alt="" className="h-10 w-10 rounded-lg border border-slate-200 object-contain bg-slate-50" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-300">
            <Icon name="labs" className="h-5 w-5" />
          </div>
        ),
    },
    {
      key: 'name',
      header: 'Category',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">
            {row.testCount} test{row.testCount === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <button onClick={() => void toggleActive(row)} className="cursor-pointer">
          <Badge tone={row.isActive ? 'green' : 'gray'}>{row.isActive ? 'Active' : 'Hidden'}</Badge>
        </button>
      ),
    },
    {
      key: 'order',
      header: 'Order',
      render: (row) => {
        const index = rows.findIndex((r) => r.id === row.id);
        return (
          <div className="flex items-center gap-1">
            <button
              disabled={index <= 0}
              onClick={() => void move(row, 'up')}
              className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="Move up"
            >
              <Icon name="chevron-down" className="h-4 w-4 rotate-180" />
            </button>
            <button
              disabled={index >= rows.length - 1}
              onClick={() => void move(row, 'down')}
              className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="Move down"
            >
              <Icon name="chevron-down" className="h-4 w-4" />
            </button>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          {rowError?.id === row.id && (
            <span className="text-xs text-rose-600">{rowError.message}</span>
          )}
          <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
            Manage
          </Button>
          <Button variant="danger" size="sm" onClick={() => void remove(row)}>
            Delete
          </Button>
        </div>
      ),
      className: 'text-right',
    },
  ];

  const formOpen = adding || editingId !== null;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <p className="text-sm font-medium text-slate-800">Categories</p>
            <p className="text-xs text-slate-400">
              "Explore by health concern" — shown with icons in both apps' Lab section.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={openAdd}>
            <Icon name="plus" className="h-4 w-4" /> New category
          </Button>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          empty="No categories yet — add one to start the health-concern grid."
        />
      </Card>

      <Modal
        open={formOpen}
        onClose={close}
        title={editingId ? 'Edit category' : 'New category'}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Name</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Diabetes"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Icon</span>
            <div className="flex items-center gap-3">
              {draft.image ? (
                <img src={draft.image} alt="" className="h-14 w-14 rounded-lg border border-slate-200 object-contain bg-slate-50" />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                  <Icon name="labs" className="h-6 w-6" />
                </div>
              )}
              <label className="cursor-pointer text-xs font-medium text-brand-600">
                {draft.image ? 'Replace icon' : 'Upload icon'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handlePick(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {draft.image && (
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, image: '' }))}
                  className="text-xs font-medium text-rose-600"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
            />
            Shown to members
          </label>

          {formError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>
          )}
        </div>
      </Modal>
    </>
  );
}
