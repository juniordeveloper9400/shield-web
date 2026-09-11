import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { CATEGORY_ICON_OPTIONS, CATEGORY_TINT_OPTIONS } from '@/lib/categoryIcons';
import { fileToResizedDataUrl } from '@/lib/images';
import { useAsync } from '@/lib/useAsync';
import {
  createCategory,
  createSubcategory,
  deleteSubcategory,
  listCategoryGroups,
  moveCategory,
  setCategoryActive,
  suggestCategorySlug,
  updateCategory,
  updateSubcategory,
} from '@/api/categoryBanners';
import type { CategoryGroupAdmin, NewCategoryGroup, NewSubcategory } from '@/types';

const EMPTY: NewCategoryGroup = {
  slug: '',
  title: '',
  tabLabel: '',
  iconName: CATEGORY_ICON_OPTIONS[0].value,
  image: '',
  bannerImage: '',
  panelTint: CATEGORY_TINT_OPTIONS[0].value,
  offer: '',
  sort: 0,
  isActive: true,
};

/** A sub-category row being edited — a real one (`id` set) or a new one added
 *  in this session (`id` blank), keyed by [key] so React can track it even
 *  before it has a database id. */
interface SubDraft extends NewSubcategory {
  key: string;
  id: string;
}

let nextKey = 1;
function blankSub(sort: number): SubDraft {
  return {
    key: `new-${nextKey++}`,
    id: '',
    label: '',
    iconName: CATEGORY_ICON_OPTIONS[0].value,
    image: '',
    offer: '',
    sort,
  };
}

export default function CategoryBannersPage() {
  const { data, loading, error, reload } = useAsync(listCategoryGroups, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewCategoryGroup>(EMPTY);
  const [slugTouched, setSlugTouched] = useState(false);
  const [subDrafts, setSubDrafts] = useState<SubDraft[]>([]);
  const [removedSubIds, setRemovedSubIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openAdd() {
    setDraft({ ...EMPTY, sort: rows.length });
    setSlugTouched(false);
    setSubDrafts([]);
    setRemovedSubIds([]);
    setFormError(null);
    setAdding(true);
  }

  function openEdit(group: CategoryGroupAdmin) {
    setDraft({
      slug: group.slug,
      title: group.title,
      tabLabel: group.tabLabel,
      iconName: group.iconName || CATEGORY_ICON_OPTIONS[0].value,
      image: group.image,
      bannerImage: group.bannerImage,
      panelTint: group.panelTint || CATEGORY_TINT_OPTIONS[0].value,
      offer: group.offer,
      sort: group.sort,
      isActive: group.isActive,
    });
    setSlugTouched(true);
    setSubDrafts(
      group.subcategories.map((s) => ({
        key: s.id,
        id: s.id,
        label: s.label,
        iconName: s.iconName || CATEGORY_ICON_OPTIONS[0].value,
        image: s.image,
        offer: s.offer,
        sort: s.sort,
      })),
    );
    setRemovedSubIds([]);
    setFormError(null);
    setEditingId(group.id);
  }

  function closeForm() {
    setAdding(false);
    setEditingId(null);
    setFormError(null);
  }

  function patchDraft(patch: Partial<NewCategoryGroup>) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (!slugTouched && patch.title !== undefined && !editingId) {
        next.slug = suggestCategorySlug(next.title);
      }
      return next;
    });
  }

  function patchSub(key: string, patch: Partial<SubDraft>) {
    setSubDrafts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addSubRow() {
    setSubDrafts((rows) => [...rows, blankSub(rows.length)]);
  }

  function removeSubRow(row: SubDraft) {
    setSubDrafts((rows) => rows.filter((r) => r.key !== row.key));
    if (row.id) {
      setRemovedSubIds((ids) => [...ids, row.id]);
    }
  }

  async function handleBannerPick(file: File) {
    setFormError(null);
    try {
      const url = await fileToResizedDataUrl(file, 1080, 0.75);
      patchDraft({ bannerImage: url });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load the image.');
    }
  }

  async function handleChipPick(file: File) {
    setFormError(null);
    try {
      const url = await fileToResizedDataUrl(file, 320, 0.8);
      patchDraft({ image: url });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load the image.');
    }
  }

  async function handleSubImagePick(row: SubDraft, file: File) {
    setFormError(null);
    try {
      const url = await fileToResizedDataUrl(file, 320, 0.8);
      patchSub(row.key, { image: url });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not load the image.');
    }
  }

  async function save() {
    if (!draft.title.trim()) {
      setFormError('Give the category a title.');
      return;
    }
    if (!editingId && !draft.slug.trim()) {
      setFormError('Give the category a slug.');
      return;
    }
    if (subDrafts.some((s) => !s.label.trim())) {
      setFormError('Every sub-category needs a label — remove any blank rows.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      let categoryId = editingId;
      if (categoryId) {
        await updateCategory(categoryId, draft);
      } else {
        const id = await createCategory(draft);
        if (!id) {
          setFormError(`The slug "${draft.slug}" is already in use.`);
          return;
        }
        categoryId = id;
      }

      for (const id of removedSubIds) {
        await deleteSubcategory(id);
      }
      for (const [index, sub] of subDrafts.entries()) {
        const input: NewSubcategory = {
          label: sub.label,
          iconName: sub.iconName,
          image: sub.image,
          offer: sub.offer,
          sort: index,
        };
        if (sub.id) {
          await updateSubcategory(sub.id, input);
        } else {
          await createSubcategory(categoryId, input);
        }
      }

      closeForm();
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the category.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(group: CategoryGroupAdmin) {
    await setCategoryActive(group.id, !group.isActive);
    reload();
  }

  async function move(group: CategoryGroupAdmin, direction: 'up' | 'down') {
    await moveCategory(group.id, direction, rows);
    reload();
  }

  const columns: Column<CategoryGroupAdmin>[] = [
    {
      key: 'preview',
      header: '',
      render: (row) =>
        row.bannerImage ? (
          <img
            src={row.bannerImage}
            alt=""
            className="h-12 w-20 rounded-md border border-slate-200 object-cover"
          />
        ) : (
          <div
            className="grid h-12 w-20 place-items-center rounded-md border border-slate-200 text-slate-300"
            style={{
              backgroundColor:
                CATEGORY_TINT_OPTIONS.find((t) => t.value === row.panelTint)?.hex ??
                '#F1F5F9',
            }}
          >
            <Icon name="banners" className="h-5 w-5" />
          </div>
        ),
    },
    {
      key: 'title',
      header: 'Category',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.title}</p>
          <p className="text-xs text-slate-400">
            {row.subcategories.length} sub-categor
            {row.subcategories.length === 1 ? 'y' : 'ies'}
            {row.offer ? ` · ${row.offer}` : ''}
          </p>
        </div>
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
        const index = rows.findIndex((c) => c.id === row.id);
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
          Manage
        </Button>
      ),
      className: 'text-right',
    },
  ];

  const formOpen = adding || editingId !== null;

  return (
    <>
      <PageHeader
        title="Category banners"
        subtitle="The promotional banner, icon and sub-categories for each product category — shown in the Categories tab and the home 'Shop by categories' strip."
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Icon name="plus" className="h-4 w-4" /> Add category
          </Button>
        }
      />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          empty="No categories yet."
        />
      </Card>

      <Modal
        open={formOpen}
        onClose={closeForm}
        size="lg"
        title={editingId ? `Manage "${draft.title}"` : 'Add category'}
        footer={
          <>
            <div className="flex-1" />
            <Button variant="secondary" disabled={saving} onClick={closeForm}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              {editingId ? 'Save changes' : 'Add category'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <EditField label="Title — heading on the Categories tab">
              <input
                value={draft.title}
                onChange={(e) => patchDraft({ title: e.target.value })}
                className={inputClass}
                placeholder="Personal Care"
              />
            </EditField>
            <EditField label="Slug — stable id, used by products (unique)">
              <input
                value={draft.slug}
                disabled={Boolean(editingId)}
                onChange={(e) => {
                  setSlugTouched(true);
                  patchDraft({ slug: e.target.value.toLowerCase() });
                }}
                className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-400`}
                placeholder="personal-care"
              />
            </EditField>
          </div>

          <EditField label="Tab label — home strip chip caption (optional, defaults to the title)">
            <input
              value={draft.tabLabel}
              onChange={(e) => patchDraft({ tabLabel: e.target.value })}
              className={inputClass}
              placeholder="Personal Care"
            />
          </EditField>

          <div className="grid grid-cols-2 gap-3">
            <EditField label="Icon — fallback when there is no chip image">
              <select
                value={draft.iconName}
                onChange={(e) => patchDraft({ iconName: e.target.value })}
                className={inputClass}
              >
                {CATEGORY_ICON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </EditField>
            <EditField label="Panel tint — background behind the panel and chip">
              <div className="flex flex-wrap items-center gap-2">
                {CATEGORY_TINT_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    title={t.label}
                    onClick={() => patchDraft({ panelTint: t.value })}
                    className={`h-8 w-8 rounded-full border-2 ${
                      draft.panelTint === t.value
                        ? 'border-brand-600'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: t.hex }}
                  />
                ))}
              </div>
            </EditField>
          </div>

          <EditField label="Promotional banner — shown at the top of this category's listing">
            <ImagePicker
              value={draft.bannerImage}
              onPick={handleBannerPick}
              onClear={() => patchDraft({ bannerImage: '' })}
              aspect="aspect-[21/9]"
            />
          </EditField>

          <EditField label="Chip image — the home strip's small artwork (optional, falls back to the icon)">
            <ImagePicker
              value={draft.image}
              onPick={handleChipPick}
              onClear={() => patchDraft({ image: '' })}
              aspect="aspect-square"
              compact
            />
          </EditField>

          <EditField label="Offer note (optional) — e.g. 'Up to 40% off'">
            <input
              value={draft.offer}
              onChange={(e) => patchDraft({ offer: e.target.value })}
              className={inputClass}
              placeholder="Up to 40% off"
            />
          </EditField>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => patchDraft({ isActive: e.target.checked })}
            />
            Show in the app and web build
          </label>

          <div className="border-t border-slate-200 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                Sub-categories
              </span>
              <Button variant="secondary" size="sm" onClick={addSubRow}>
                <Icon name="plus" className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {subDrafts.length === 0 ? (
              <p className="text-xs text-slate-400">
                No sub-categories yet — add at least one so this group has
                something to list.
              </p>
            ) : (
              <div className="space-y-2">
                {subDrafts.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 p-2.5"
                  >
                    <ImagePicker
                      value={row.image}
                      onPick={(f) => handleSubImagePick(row, f)}
                      onClear={() => patchSub(row.key, { image: '' })}
                      aspect="aspect-square"
                      compact
                      tiny
                    />
                    <div className="grid flex-1 grid-cols-2 gap-2">
                      <input
                        value={row.label}
                        onChange={(e) => patchSub(row.key, { label: e.target.value })}
                        className={inputClass}
                        placeholder="Skin Care"
                      />
                      <select
                        value={row.iconName}
                        onChange={(e) =>
                          patchSub(row.key, { iconName: e.target.value })
                        }
                        className={inputClass}
                      >
                        {CATEGORY_ICON_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        value={row.offer}
                        onChange={(e) => patchSub(row.key, { offer: e.target.value })}
                        className={`${inputClass} col-span-2`}
                        placeholder="Offer note (optional)"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSubRow(row)}
                      className="mt-1 shrink-0 text-xs font-medium text-rose-600"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

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

function ImagePicker({
  value,
  onPick,
  onClear,
  aspect,
  compact,
  tiny,
}: {
  value: string;
  onPick: (file: File) => void;
  onClear: () => void;
  aspect: string;
  compact?: boolean;
  tiny?: boolean;
}) {
  const size = tiny ? 'h-14 w-14' : compact ? 'h-24 w-24' : 'w-full';
  return (
    <div className={tiny || compact ? 'shrink-0' : ''}>
      <div
        className={`relative ${size} ${compact || tiny ? '' : aspect} overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50`}
      >
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-slate-300">
            <Icon name="banners" className={tiny ? 'h-4 w-4' : 'h-6 w-6'} />
          </div>
        )}
      </div>
      <div className={`mt-1 flex items-center gap-2 ${tiny ? 'flex-col items-start' : ''}`}>
        <label className="cursor-pointer text-xs font-medium text-brand-700">
          {value ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onPick(file);
            }}
          />
        </label>
        {value && (
          <button
            type="button"
            className="text-xs font-medium text-rose-600"
            onClick={onClear}
          >
            Remove
          </button>
        )}
      </div>
    </div>
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
