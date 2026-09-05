import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { fileToResizedDataUrl } from '@/lib/images';
import { useAsync } from '@/lib/useAsync';
import {
  createBanner,
  deleteBanner,
  listBanners,
  moveBanner,
  setBannerActive,
  updateBanner,
} from '@/api/banners';
import type { HomeBanner, NewHomeBanner } from '@/types';

const EMPTY: NewHomeBanner = {
  title: '',
  subtitle: '',
  image: '',
  cta: '',
  target: '',
  isActive: true,
  sort: 0,
};

export default function BannersPage() {
  const { data, loading, error, reload } = useAsync(listBanners, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewHomeBanner>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openAdd() {
    setDraft({ ...EMPTY, sort: rows.length });
    setFormError(null);
    setAdding(true);
  }

  function openEdit(banner: HomeBanner) {
    setDraft({
      title: banner.title,
      subtitle: banner.subtitle,
      image: banner.image,
      cta: banner.cta,
      target: banner.target,
      isActive: banner.isActive,
      sort: banner.sort,
    });
    setFormError(null);
    setEditingId(banner.id);
  }

  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setFormError(null);
  }

  async function handleImagePick(file: File) {
    setFormError(null);
    try {
      const url = await fileToResizedDataUrl(file, 1080, 0.75);
      setDraft((d) => ({ ...d, image: url }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load the image.');
    }
  }

  async function save() {
    if (!draft.image) {
      setFormError('Add a banner image.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await updateBanner(editingId, draft);
      } else {
        await createBanner(draft);
      }
      closeForm();
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the banner.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await deleteBanner(id);
      closeForm();
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(banner: HomeBanner) {
    await setBannerActive(banner.id, !banner.isActive);
    reload();
  }

  async function move(banner: HomeBanner, direction: 'up' | 'down') {
    await moveBanner(banner.id, direction, rows);
    reload();
  }

  const columns: Column<HomeBanner>[] = [
    {
      key: 'preview',
      header: '',
      render: (row) => (
        <img
          src={row.image}
          alt=""
          className="h-12 w-20 rounded-md border border-slate-200 object-cover"
        />
      ),
    },
    {
      key: 'title',
      header: 'Banner',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.title || 'Untitled'}</p>
          {row.subtitle && (
            <p className="line-clamp-1 text-xs text-slate-400">{row.subtitle}</p>
          )}
        </div>
      ),
    },
    {
      key: 'cta',
      header: 'Links to',
      render: (row) =>
        row.cta || row.target ? (
          <div>
            <p className="text-slate-700">{row.cta || '—'}</p>
            <p className="text-xs text-slate-400">{row.target || '—'}</p>
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <button onClick={() => toggleActive(row)} className="cursor-pointer">
          <Badge tone={row.isActive ? 'green' : 'gray'}>
            {row.isActive ? 'Active' : 'Hidden'}
          </Badge>
        </button>
      ),
    },
    {
      key: 'order',
      header: 'Order',
      render: (row) => {
        const index = rows.findIndex((b) => b.id === row.id);
        return (
          <div className="flex items-center gap-1">
            <button
              disabled={index <= 0}
              onClick={() => move(row, 'up')}
              className="grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              aria-label="Move up"
            >
              <Icon name="chevron-down" className="h-4 w-4 rotate-180" />
            </button>
            <button
              disabled={index >= rows.length - 1}
              onClick={() => move(row, 'down')}
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
        <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
          Edit
        </Button>
      ),
      className: 'text-right',
    },
  ];

  const formOpen = adding || editingId !== null;

  return (
    <>
      <PageHeader
        title="Home Banners"
        subtitle="The hero banner shown at the top of the app and web home screen, below the search bar."
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Icon name="plus" className="h-4 w-4" /> Add banner
          </Button>
        }
      />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          empty="No banners yet — add one to replace the default app banner."
        />
      </Card>

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingId ? 'Edit banner' : 'Add banner'}
        footer={
          <>
            {editingId && (
              <Button
                variant="danger"
                disabled={saving}
                onClick={() => remove(editingId)}
              >
                Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="secondary" disabled={saving} onClick={closeForm}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {editingId ? 'Save changes' : 'Add banner'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <EditField label="Banner image">
            <div className="flex items-center gap-3">
              {draft.image ? (
                <img
                  src={draft.image}
                  alt=""
                  className="h-16 w-28 rounded-lg border border-slate-200 object-cover"
                />
              ) : (
                <div className="grid h-16 w-28 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                  <Icon name="banners" className="h-6 w-6" />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <input
                  type="file"
                  accept="image/*"
                  className="text-xs text-slate-500 file:mr-2 file:rounded-md file:border-0 file:bg-brand-50 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-brand-700"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImagePick(file);
                  }}
                />
                <p className="text-xs text-slate-400">
                  Landscape works best — it fills a 16:9 strip on the home screen.
                </p>
                {draft.image && (
                  <button
                    type="button"
                    className="self-start text-xs font-medium text-rose-600"
                    onClick={() => setDraft((d) => ({ ...d, image: '' }))}
                  >
                    Remove image
                  </button>
                )}
              </div>
            </div>
          </EditField>

          <EditField label="Title (optional — not shown on the banner itself)">
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className={inputClass}
              placeholder="Genuine medicines, up to 40% off"
            />
          </EditField>

          <EditField label="Internal note (optional)">
            <input
              value={draft.subtitle}
              onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))}
              className={inputClass}
              placeholder="e.g. Diwali campaign — remove after 15 Nov"
            />
          </EditField>

          <div className="grid grid-cols-2 gap-3">
            <EditField label="Button text (optional)">
              <input
                value={draft.cta}
                onChange={(e) => setDraft((d) => ({ ...d, cta: e.target.value }))}
                className={inputClass}
                placeholder="Shop now"
              />
            </EditField>
            <EditField label="Opens (optional)">
              <input
                value={draft.target}
                onChange={(e) => setDraft((d) => ({ ...d, target: e.target.value }))}
                className={inputClass}
                placeholder="/products or a full link"
              />
            </EditField>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft((d) => ({ ...d, isActive: e.target.checked }))
              }
            />
            Show on the home screen
          </label>

          {formError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
