import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { DetailList } from '@/components/ui/DetailList';
import { SearchInput, FilterSelect } from '@/components/ui/Filters';
import { Icon } from '@/components/ui/Icon';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { formatCurrency, formatDate } from '@/lib/format';
import { fileToResizedDataUrl } from '@/lib/images';
import { useAuth } from '@/context/AuthContext';
import { canManageCatalogue } from '@/config/permissions';
import { useAsync } from '@/lib/useAsync';
import { useConfirmDialog } from '@/lib/useConfirmDialog';
import { useUnsavedChangesGuard } from '@/context/UnsavedChangesContext';
import {
  listProducts,
  listCategories,
  listSubcategories,
  listBrands,
  createBrand,
  deleteBrand,
  renameBrand,
  createProduct,
  deleteProduct,
  setProductStatus,
  updateProduct,
  updateProductFull,
  updateProductSections,
  getProductDetail,
} from '@/api/products';
import type {
  Brand,
  NewProduct,
  Product,
  ProductDetailInput,
  ProductStatus,
} from '@/types';

/** The catalogue's tabs: every product, then one per home-feed row the app
 *  shows (the same three flags the product form's "Home feed rows" sets). */
type SectionTab = 'all' | 'isPopular' | 'isDeal' | 'isOfferOfDay';
const SECTION_TABS: { key: SectionTab; label: string }[] = [
  { key: 'all', label: 'All products' },
  { key: 'isPopular', label: 'Popular Items' },
  { key: 'isDeal', label: 'Deals You Love' },
  { key: 'isOfferOfDay', label: 'Offer of the Day' },
];

const EMPTY_DETAIL: ProductDetailInput = {
  form: '',
  manufacturer: '',
  description: '',
  ingredients: '',
  storage: '',
  highlights: '',
  benefits: '',
  directions: '',
  safety: '',
  faqs: [],
};

const EMPTY_NEW: NewProduct = {
  categorySlug: '',
  subcategoryId: '',
  name: '',
  pack: '',
  brand: '',
  code: '',
  price: 0,
  mrp: 0,
  discountLabel: '',
  isPrescriptionOnly: false,
  stockQuantity: 0,
  status: 'active',
  image: '',
  extraImages: [],
  isPopular: false,
  isDeal: false,
  isOfferOfDay: false,
  detail: EMPTY_DETAIL,
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export default function ProductsPage() {
  const { user } = useAuth();
  // Only Admin / Super Admin manage the catalogue; every other role that can
  // open it (the store's Pharmacy Admin) is view-only.
  const canManage = user ? canManageCatalogue(user.role) : false;
  const { data, loading, error, reload } = useAsync(listProducts, []);
  const categories = useAsync(listCategories, []);
  const subcategories = useAsync(listSubcategories, []);
  const brands = useAsync(listBrands, []);

  // Registering a new brand from the "Add product" form — a small inline
  // affordance next to the Brand dropdown, not a separate page.
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);

  // The Brand picker is a custom dropdown (not a native <select>) so each
  // row can carry its own edit/delete controls next to the name, instead of
  // one delete button sitting outside the field for whatever's selected.
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const brandMenuRef = useRef<HTMLDivElement>(null);
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editingBrandName, setEditingBrandName] = useState('');
  const [brandRowBusy, setBrandRowBusy] = useState(false);

  useEffect(() => {
    if (!brandMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (!brandMenuRef.current?.contains(e.target as Node)) {
        setBrandMenuOpen(false);
        setEditingBrandId(null);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [brandMenuOpen]);

  async function registerBrand() {
    if (!newBrandName.trim()) return;
    setBrandSaving(true);
    setBrandError(null);
    try {
      const brand = await createBrand(newBrandName);
      setDraft((d) => ({ ...d, brand: brand.name }));
      setNewBrandName('');
      setAddingBrand(false);
      brands.reload();
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : 'Could not register the brand.');
    } finally {
      setBrandSaving(false);
    }
  }
  const rows = useMemo(() => data ?? [], [data]);

  function startEditingBrand(brand: Brand) {
    setEditingBrandId(brand.id);
    setEditingBrandName(brand.name);
    setBrandError(null);
  }

  async function saveBrandRename(brand: Brand) {
    const trimmed = editingBrandName.trim();
    if (!trimmed || trimmed === brand.name) {
      setEditingBrandId(null);
      return;
    }
    setBrandRowBusy(true);
    setBrandError(null);
    try {
      const updated = await renameBrand(brand.id, trimmed);
      setDraft((d) => (d.brand === brand.name ? { ...d, brand: updated.name } : d));
      setEditingBrandId(null);
      brands.reload();
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : 'Could not rename the brand.');
    } finally {
      setBrandRowBusy(false);
    }
  }

  /** Deletes a brand from the list, after confirmation. */
  function confirmDeleteBrand(brand: Brand) {
    const inUse = rows.filter((p) => p.brand === brand.name).length;
    ask({
      title: 'Delete this brand?',
      message: `"${brand.name}" will be removed from the brand list.${
        inUse > 0
          ? ` ${inUse} existing product${inUse === 1 ? ' keeps' : 's keep'} the name as text.`
          : ''
      }`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        try {
          await deleteBrand(brand.id);
          setDraft((d) => (d.brand === brand.name ? { ...d, brand: '' } : d));
          brands.reload();
        } catch (err) {
          setBrandError(err instanceof Error ? err.message : 'Could not delete the brand.');
        }
      },
    });
  }

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [section, setSection] = useState<SectionTab>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ price: '', stockQuantity: '' });
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const [adding, setAdding] = useState(false);
  // Set while the add page is being used to edit an existing product.
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  // The Add/Edit product form is tabbed — Basic info and Additional info
  // never show at once, only whichever tab is open.
  const [addFormTab, setAddFormTab] = useState<'basic' | 'additional'>('basic');
  const [draft, setDraft] = useState<NewProduct>(EMPTY_NEW);
  const [addError, setAddError] = useState<string | null>(null);
  // The draft as it stood the moment the add/edit page opened — EMPTY_NEW for
  // a new product, the existing product's own fields for an edit. Compared
  // against the live draft below to tell "actually changed something" from
  // "opened the page and left it alone".
  const initialDraftRef = useRef<NewProduct>(EMPTY_NEW);
  const isDraftDirty = adding && JSON.stringify(draft) !== JSON.stringify(initialDraftRef.current);
  useUnsavedChangesGuard(isDraftDirty, {
    label: editingProductId ? 'this product' : 'the new product',
    onSave: saveNew,
  });

  // Add/remove a product from a home-feed section (Popular Items / Deals
  // You Love / Offer of the Day) — the replacement for picking a section at
  // product creation. Driven by the same `search` box as the table filter
  // below: on a section tab it doubles as "find something to add".
  const [addingToSectionId, setAddingToSectionId] = useState<string | null>(null);
  const [removingFromSectionId, setRemovingFromSectionId] = useState<string | null>(null);

  // The selected product's detail-page content, loaded lazily when its modal
  // opens. `undefined` = not loaded yet, `null` = loaded and there is none.
  const [selectedDetail, setSelectedDetail] = useState<
    Awaited<ReturnType<typeof getProductDetail>> | undefined
  >(undefined);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(undefined);
      return;
    }
    let cancelled = false;
    setSelectedDetail(undefined);
    getProductDetail(selectedId)
      .then((d) => {
        if (!cancelled) setSelectedDetail(d);
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function openAdd() {
    if (!canManage) return;
    setEditingProductId(null);
    setDraft(EMPTY_NEW);
    initialDraftRef.current = EMPTY_NEW;
    setAddError(null);
    setAddFormTab('basic');
    setAdding(true);
  }

  /** Opens the add/edit page pre-filled with an existing product. */
  async function openEdit(product: Product) {
    if (!canManage) return;
    setEditingProductId(product.id);
    setAddError(null);
    setSelectedId(null);
    let detail: ProductDetailInput = EMPTY_DETAIL;
    try {
      const d = await getProductDetail(product.id);
      if (d) {
        const { hasDetail: _hasDetail, ...rest } = d;
        detail = rest;
      }
    } catch {
      // Fall back to a blank detail block; the core fields are still editable.
    }
    const prefilled: NewProduct = {
      categorySlug: product.categorySlug,
      subcategoryId: product.subcategoryId,
      name: product.name,
      pack: product.pack,
      brand: product.brand,
      code: product.code,
      price: product.price,
      mrp: product.mrp,
      discountLabel: product.discountLabel,
      isPrescriptionOnly: product.isPrescriptionOnly,
      stockQuantity: product.stockQuantity,
      status: product.status,
      image: product.image,
      extraImages: [],
      isPopular: product.isPopular,
      isDeal: product.isDeal,
      isOfferOfDay: product.isOfferOfDay,
      detail,
    };
    setDraft(prefilled);
    initialDraftRef.current = prefilled;
    setAddFormTab('basic');
    setAdding(true);
  }

  /** Patches one field of the draft's detail block. */
  function setDetail<K extends keyof ProductDetailInput>(
    key: K,
    value: ProductDetailInput[K],
  ) {
    setDraft((d) => ({ ...d, detail: { ...d.detail, [key]: value } }));
  }

  /** Sub-categories under the category the draft currently points at. */
  const draftSubOptions = useMemo(
    () =>
      (subcategories.data ?? []).filter(
        (s) => s.categorySlug === draft.categorySlug,
      ),
    [subcategories.data, draft.categorySlug],
  );

  /** Returns whether it actually saved — the unsaved-changes guard's "Save
   *  and continue later" needs to know before it navigates away. */
  async function saveNew(): Promise<boolean> {
    if (!draft.categorySlug) {
      setAddError('Pick a category first.');
      return false;
    }
    if (draftSubOptions.length > 0 && !draft.subcategoryId) {
      setAddError('Pick a sub-category.');
      return false;
    }
    if (!draft.name.trim()) {
      setAddError('Give the product a name.');
      return false;
    }
    if (!(draft.price >= 0) || !(draft.mrp >= 0)) {
      setAddError('Offer price and MRP must be zero or more.');
      return false;
    }
    setSaving(true);
    setAddError(null);
    try {
      if (editingProductId) await updateProductFull(editingProductId, draft);
      else await createProduct(draft);
      setAdding(false);
      reload();
      return true;
    } catch (err) {
      setAddError(
        err instanceof Error
          ? err.message
          : editingProductId
            ? 'Could not save the product.'
            : 'Could not add the product.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function removeProduct(id: string) {
    setSaving(true);
    try {
      await deleteProduct(id);
      setSelectedId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of rows) if (p.categorySlug) seen.set(p.categorySlug, p.categoryTitle);
    return [
      { value: 'all', label: 'All categories' },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [rows]);

  const sectionTabs: TabItem[] = useMemo(
    () =>
      SECTION_TABS.map(({ key, label }) => ({
        key,
        label,
        count: key === 'all' ? rows.length : rows.filter((p) => p[key]).length,
      })),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (section !== 'all' && !row[section]) return false;
      const matchesQuery =
        !q ||
        row.name.toLowerCase().includes(q) ||
        row.brand.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q);
      const matchesStatus = status === 'all' || row.status === status;
      const matchesCategory =
        category === 'all' || row.categorySlug === category;
      return matchesQuery && matchesStatus && matchesCategory;
    });
  }, [rows, search, status, category, section]);

  // Candidates for "add to this section" — every product not already in it,
  // matching the same search box the table below filters by; capped so the
  // list stays scannable.
  const sectionCandidates = useMemo(() => {
    if (section === 'all') return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return rows
      .filter((p) => !p[section])
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [rows, search, section]);

  async function addToSection(product: Product) {
    if (section === 'all') return;
    setAddingToSectionId(product.id);
    try {
      await updateProductSections(product.id, {
        isPopular: section === 'isPopular' ? true : product.isPopular,
        isDeal: section === 'isDeal' ? true : product.isDeal,
        isOfferOfDay: section === 'isOfferOfDay' ? true : product.isOfferOfDay,
      });
      setSearch('');
      reload();
    } finally {
      setAddingToSectionId(null);
    }
  }

  /** Clears this product's flag for the current section — the same write
   *  `updateProductSections` always made, so the app and webapp (which read
   *  these same three flags) stop showing it in this row the moment this
   *  succeeds, with no separate "sync" step. */
  async function removeFromSection(product: Product) {
    if (section === 'all') return;
    setRemovingFromSectionId(product.id);
    try {
      await updateProductSections(product.id, {
        isPopular: section === 'isPopular' ? false : product.isPopular,
        isDeal: section === 'isDeal' ? false : product.isDeal,
        isOfferOfDay: section === 'isOfferOfDay' ? false : product.isOfferOfDay,
      });
      reload();
    } finally {
      setRemovingFromSectionId(null);
    }
  }

  function open(id: string) {
    const product = rows.find((r) => r.id === id);
    if (!product) return;
    setSelectedId(id);
    setEditing(false);
    setForm({
      price: String(product.price),
      stockQuantity: String(product.stockQuantity),
    });
  }

  async function changeStatus(id: string, next: ProductStatus) {
    setSaving(true);
    try {
      await setProductStatus(id, next);
      setSelectedId(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!selected) return;
    const price = Number(form.price);
    const stockQuantity = Number(form.stockQuantity);
    setSaving(true);
    try {
      await updateProduct(selected.id, {
        price: Number.isFinite(price) && price >= 0 ? price : selected.price,
        stockQuantity:
          Number.isFinite(stockQuantity) && stockQuantity >= 0
            ? stockQuantity
            : selected.stockQuantity,
      });
      setEditing(false);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const counts = {
    total: rows.length,
    active: rows.filter((r) => r.status === 'active').length,
    inactive: rows.filter((r) => r.status === 'inactive').length,
    rx: rows.filter((r) => r.isPrescriptionOnly).length,
  };

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: 'Product',
      render: (row) => (
        <div className="flex items-center gap-3">
          {row.image ? (
            <img
              src={row.image}
              alt=""
              className="h-10 w-10 shrink-0 rounded-md border border-slate-200 object-cover"
            />
          ) : (
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-dashed border-slate-200 text-slate-300">
              <Icon name="products" className="h-4 w-4" />
            </div>
          )}
          <div>
            <p className="font-medium text-slate-800">
              {row.name}
              {row.isPrescriptionOnly && (
                <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-600">
                  Rx
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400">
              {row.brand} · {row.pack}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (row) => (
        <div>
          <p className="text-slate-700">{row.categoryTitle || '—'}</p>
          {row.subcategoryLabel && (
            <p className="text-xs text-slate-400">{row.subcategoryLabel}</p>
          )}
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Offer Price',
      render: (row) => (
        <div className="text-right">
          <p className="font-medium text-slate-800">{formatCurrency(row.price)}</p>
          {row.mrp > row.price && (
            <p className="text-xs text-slate-400 line-through">
              {formatCurrency(row.mrp)}
            </p>
          )}
        </div>
      ),
      className: 'text-right',
    },
    {
      key: 'stock',
      header: 'Stock',
      render: (row) => (
        <span className={row.stockQuantity < 50 ? 'font-medium text-amber-600' : ''}>
          {row.stockQuantity}
        </span>
      ),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'green' : 'gray'}>
          {row.status === 'active' ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-2">
          {canManage && section !== 'all' && (
            <Button
              variant="danger"
              size="sm"
              disabled={removingFromSectionId === row.id}
              onClick={() => removeFromSection(row)}
            >
              {removingFromSectionId === row.id ? 'Removing…' : 'Remove'}
            </Button>
          )}
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => openEdit(row)}>
              Edit
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => open(row.id)}>
            {canManage ? 'Manage' : 'View'}
          </Button>
        </div>
      ),
      className: 'text-right',
    },
  ];

  // The Add product form is a page of its own, not a pop-up.
  const addFields = (
        <div className="space-y-4">
          <Tabs
            items={[
              { key: 'basic', label: 'Basic info' },
              { key: 'additional', label: 'Additional info' },
            ]}
            active={addFormTab}
            onChange={(key) => setAddFormTab(key as 'basic' | 'additional')}
          />
          <div className={addFormTab === 'basic' ? 'space-y-4' : 'hidden'}>
          <EditField label="Category">
            <select
              value={draft.categorySlug}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  categorySlug: e.target.value,
                  // The old sub-category belongs to the old category.
                  subcategoryId: '',
                })
              }
              className={inputClass}
            >
              <option value="">Select a category…</option>
              {/* Lab tests are added on the Lab Tests page, never as products,
                  so that category is left out of this product form. */}
              {(categories.data ?? [])
                .filter((c) => c.slug !== 'lab-tests' && c.title.trim().toLowerCase() !== 'lab tests')
                .map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.title}
                  </option>
                ))}
            </select>
          </EditField>
          <EditField label="Sub-category">
            <select
              value={draft.subcategoryId}
              onChange={(e) =>
                setDraft({ ...draft, subcategoryId: e.target.value })
              }
              className={inputClass}
              disabled={!draft.categorySlug || draftSubOptions.length === 0}
            >
              <option value="">
                {!draft.categorySlug
                  ? 'Pick a category first'
                  : draftSubOptions.length === 0
                    ? 'No sub-categories for this category'
                    : 'Select a sub-category…'}
              </option>
              {draftSubOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </EditField>
          <EditField label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={inputClass}
              placeholder="Paracetamol 500mg"
            />
          </EditField>
          <div className="grid grid-cols-2 gap-3">
            <EditField label="Pack">
              <input
                value={draft.pack}
                onChange={(e) => setDraft({ ...draft, pack: e.target.value })}
                className={inputClass}
                placeholder="15 tablets"
              />
            </EditField>
            <EditField label="Brand">
              <div className="flex items-center gap-2">
                <div className="relative flex-1" ref={brandMenuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setBrandMenuOpen((v) => !v);
                      setEditingBrandId(null);
                    }}
                    className={`${inputClass} flex items-center justify-between text-left`}
                  >
                    <span className={draft.brand ? '' : 'text-slate-400'}>
                      {draft.brand || 'Select a brand…'}
                    </span>
                    <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                  {brandMenuOpen && (
                    <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft({ ...draft, brand: '' });
                          setBrandMenuOpen(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-50"
                      >
                        Select a brand…
                      </button>
                      {(brands.data ?? []).map((b) => (
                        <div
                          key={b.id}
                          className={`flex items-center gap-1 px-1.5 py-1 text-sm hover:bg-slate-50 ${
                            b.name === draft.brand ? 'bg-accent-50' : ''
                          }`}
                        >
                          {editingBrandId === b.id ? (
                            <>
                              <input
                                autoFocus
                                value={editingBrandName}
                                disabled={brandRowBusy}
                                onChange={(e) => setEditingBrandName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void saveBrandRename(b);
                                  } else if (e.key === 'Escape') {
                                    setEditingBrandId(null);
                                  }
                                }}
                                className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                              />
                              <button
                                type="button"
                                title="Save"
                                disabled={brandRowBusy}
                                onClick={() => void saveBrandRename(b)}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded text-brand-600 hover:bg-brand-50"
                              >
                                <Icon name="check" className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setDraft({ ...draft, brand: b.name });
                                  setBrandMenuOpen(false);
                                }}
                                className="min-w-0 flex-1 truncate px-1.5 py-1 text-left"
                              >
                                {b.name}
                              </button>
                              <button
                                type="button"
                                title="Edit this brand"
                                onClick={() => startEditingBrand(b)}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              >
                                <Icon name="edit" className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Delete this brand"
                                onClick={() => confirmDeleteBrand(b)}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Icon name="trash" className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                      {(brands.data ?? []).length === 0 && (
                        <p className="px-3 py-2 text-sm text-slate-400">No brands yet.</p>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  title="Register a new brand"
                  onClick={() => {
                    setAddingBrand((v) => !v);
                    setBrandError(null);
                  }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
                >
                  <Icon name="plus" className="h-4 w-4" />
                </button>
              </div>
              {addingBrand && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    autoFocus
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        registerBrand();
                      }
                    }}
                    placeholder="New brand name"
                    className={inputClass}
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={brandSaving || !newBrandName.trim()}
                    onClick={registerBrand}
                  >
                    {brandSaving ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              )}
              {brandError && <p className="mt-1 text-xs text-rose-600">{brandError}</p>}
            </EditField>
            <EditField label="Offer Price (₹)">
              <input
                inputMode="numeric"
                value={draft.price || ''}
                onChange={(e) =>
                  setDraft({ ...draft, price: Number(e.target.value) || 0 })
                }
                className={inputClass}
              />
            </EditField>
            <EditField label="MRP (₹)">
              <input
                inputMode="numeric"
                value={draft.mrp || ''}
                onChange={(e) =>
                  setDraft({ ...draft, mrp: Number(e.target.value) || 0 })
                }
                className={inputClass}
              />
            </EditField>
            <EditField label="Stock on hand">
              <input
                inputMode="numeric"
                value={draft.stockQuantity || ''}
                onChange={(e) =>
                  setDraft({ ...draft, stockQuantity: Number(e.target.value) || 0 })
                }
                className={inputClass}
              />
            </EditField>
            <EditField label="Code (optional)">
              <input
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                className={inputClass}
              />
            </EditField>
          </div>
          <EditField label="Discount label (optional)">
            <input
              value={draft.discountLabel}
              onChange={(e) => setDraft({ ...draft, discountLabel: e.target.value })}
              className={inputClass}
              placeholder="20% off"
            />
          </EditField>
          <EditField label="Product images (optional)">
            <div className="flex flex-wrap items-start gap-3">
              {draft.image && (
                <div className="flex flex-col items-center gap-1">
                  <div className="relative">
                    <img
                      src={draft.image}
                      alt=""
                      className="h-16 w-16 rounded-lg border-2 border-brand-500 object-cover"
                    />
                    <button
                      type="button"
                      title="Remove this image"
                      onClick={() =>
                        setDraft((d) => {
                          const extra = [...d.extraImages];
                          const next = extra.shift() ?? '';
                          return { ...d, image: next, extraImages: extra };
                        })
                      }
                      className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-rose-200 bg-white text-[10px] leading-none text-rose-600"
                    >
                      ×
                    </button>
                  </div>
                  <span className="text-[10px] font-semibold text-brand-600">Primary</span>
                </div>
              )}
              {draft.extraImages.map((img, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="relative">
                    <img
                      src={img}
                      alt=""
                      className="h-16 w-16 rounded-lg border border-slate-200 object-cover"
                    />
                    <button
                      type="button"
                      title="Remove this image"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          extraImages: d.extraImages.filter((_, j) => j !== i),
                        }))
                      }
                      className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-rose-200 bg-white text-[10px] leading-none text-rose-600"
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    className="text-[10px] font-medium text-brand-600"
                    onClick={() =>
                      setDraft((d) => {
                        const extra = [...d.extraImages];
                        const promoted = extra[i];
                        extra[i] = d.image;
                        return { ...d, image: promoted, extraImages: extra };
                      })
                    }
                  >
                    Set primary
                  </button>
                </div>
              ))}
              {!draft.image && draft.extraImages.length === 0 && (
                <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                  <Icon name="products" className="h-6 w-6" />
                </div>
              )}
              <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-600">
                <Icon name="plus" className="h-4 w-4" />
                <span className="text-[9px] font-medium">Add</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setAddError(null);
                    try {
                      const url = await fileToResizedDataUrl(file);
                      setDraft((d) =>
                        d.image
                          ? { ...d, extraImages: [...d.extraImages, url] }
                          : { ...d, image: url },
                      );
                    } catch (err) {
                      setAddError(
                        err instanceof Error ? err.message : 'Could not load the image.',
                      );
                    }
                  }}
                />
              </label>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              The first image (outlined, marked "Primary") is what shows wherever the app and
              webapp show one image — the catalogue list, product cards, cart. "Set primary" on
              another image swaps it into that spot.
            </p>
          </EditField>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.isPrescriptionOnly}
              onChange={(e) =>
                setDraft({ ...draft, isPrescriptionOnly: e.target.checked })
              }
            />
            Prescription required
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.status === 'active'}
              onChange={(e) =>
                setDraft({ ...draft, status: e.target.checked ? 'active' : 'inactive' })
              }
            />
            Active (visible in the app straight away)
          </label>
          </div>

          <div className={addFormTab === 'additional' ? 'space-y-4' : 'hidden'}>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Detail page (optional)
            </p>
            <p className="mb-3 text-xs text-slate-400">
              Anything left blank is filled in automatically by the app from the
              name and pack. List fields take one item per line.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <EditField label="Form / kind">
                  <input
                    value={draft.detail.form}
                    onChange={(e) => setDetail('form', e.target.value)}
                    className={inputClass}
                    placeholder="Tablet, Syrup, Cream, Device…"
                  />
                </EditField>
                <EditField label="Manufacturer">
                  <input
                    value={draft.detail.manufacturer}
                    onChange={(e) => setDetail('manufacturer', e.target.value)}
                    className={inputClass}
                  />
                </EditField>
              </div>
              <EditField label="Description">
                <textarea
                  value={draft.detail.description}
                  onChange={(e) => setDetail('description', e.target.value)}
                  className={textareaClass}
                  rows={3}
                />
              </EditField>
              <div className="grid grid-cols-2 gap-3">
                <EditField label="Ingredients">
                  <textarea
                    value={draft.detail.ingredients}
                    onChange={(e) => setDetail('ingredients', e.target.value)}
                    className={textareaClass}
                    rows={2}
                  />
                </EditField>
                <EditField label="Storage">
                  <textarea
                    value={draft.detail.storage}
                    onChange={(e) => setDetail('storage', e.target.value)}
                    className={textareaClass}
                    rows={2}
                  />
                </EditField>
              </div>
              <EditField label="Highlights (one per line)">
                <textarea
                  value={draft.detail.highlights}
                  onChange={(e) => setDetail('highlights', e.target.value)}
                  className={textareaClass}
                  rows={3}
                />
              </EditField>
              <EditField label="Key benefits (one per line)">
                <textarea
                  value={draft.detail.benefits}
                  onChange={(e) => setDetail('benefits', e.target.value)}
                  className={textareaClass}
                  rows={3}
                />
              </EditField>
              <EditField label="Directions for use (one per line)">
                <textarea
                  value={draft.detail.directions}
                  onChange={(e) => setDetail('directions', e.target.value)}
                  className={textareaClass}
                  rows={3}
                />
              </EditField>
              <EditField label="Safety information (one per line)">
                <textarea
                  value={draft.detail.safety}
                  onChange={(e) => setDetail('safety', e.target.value)}
                  className={textareaClass}
                  rows={3}
                />
              </EditField>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    FAQs
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-brand-600"
                    onClick={() =>
                      setDetail('faqs', [
                        ...draft.detail.faqs,
                        { question: '', answer: '' },
                      ])
                    }
                  >
                    + Add question
                  </button>
                </div>
                {draft.detail.faqs.length === 0 && (
                  <p className="text-xs text-slate-400">
                    None — the app generates a standard set.
                  </p>
                )}
                <div className="space-y-2">
                  {draft.detail.faqs.map((faq, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-slate-200 p-2"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">
                          Question {i + 1}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-medium text-rose-600"
                          onClick={() =>
                            setDetail(
                              'faqs',
                              draft.detail.faqs.filter((_, j) => j !== i),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        value={faq.question}
                        onChange={(e) =>
                          setDetail(
                            'faqs',
                            draft.detail.faqs.map((f, j) =>
                              j === i ? { ...f, question: e.target.value } : f,
                            ),
                          )
                        }
                        className={`${inputClass} mb-1.5`}
                        placeholder="Question"
                      />
                      <textarea
                        value={faq.answer}
                        onChange={(e) =>
                          setDetail(
                            'faqs',
                            draft.detail.faqs.map((f, j) =>
                              j === i ? { ...f, answer: e.target.value } : f,
                            ),
                          )
                        }
                        className={textareaClass}
                        rows={2}
                        placeholder="Answer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          </div>

          {addError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {addError}
            </p>
          )}
        </div>
  );

  if (adding && canManage) {
    return (
      <>
        <PageHeader
          title={editingProductId ? 'Edit product' : 'Add product'}
          subtitle={
            editingProductId
              ? 'Change any detail, then save.'
              : 'Fill in the product, then add it to the catalogue.'
          }
          actions={
            <Button variant="secondary" disabled={saving} onClick={() => setAdding(false)}>
              Back to catalogue
            </Button>
          }
        />

        <Card>
          <div className="p-6">{addFields}</div>
          <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
            <Button variant="secondary" disabled={saving} onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={saveNew}>
              {editingProductId ? 'Save changes' : 'Add to catalogue'}
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Catalogue"
        subtitle={
          canManage
            ? 'The storefront and pharmacy-shelf catalogue members buy from.'
            : 'The storefront and pharmacy-shelf catalogue (view only — managed by Admin).'
        }
        actions={
          canManage ? (
            <Button variant="primary" onClick={openAdd}>
              <Icon name="plus" className="h-4 w-4" /> Add product
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Products" value={counts.total} icon="products" tone="blue" />
        <StatCard label="Active" value={counts.active} icon="check" tone="green" />
        <StatCard label="Inactive" value={counts.inactive} tone="rose" />
        <StatCard label="Prescription only" value={counts.rx} tone="amber" />
      </div>

      <Card>
        <div className="px-4 pt-3">
          <Tabs
            items={sectionTabs}
            active={section}
            onChange={(key) => {
              setSection(key as SectionTab);
              setSearch('');
            }}
          />
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={
              section === 'all'
                ? 'Search product, brand, code…'
                : `Search to filter, or find a product to add to “${SECTION_TABS.find((t) => t.key === section)?.label}”…`
            }
          />
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              value={category}
              onChange={setCategory}
              options={categoryOptions}
            />
            <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </div>
        </div>
        {canManage && section !== 'all' && search.trim() && sectionCandidates.length > 0 && (
          <div className="border-b border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Add to “{SECTION_TABS.find((t) => t.key === section)?.label}”
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {sectionCandidates.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 p-2.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {p.image ? (
                      <img
                        src={p.image}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-md border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-dashed border-slate-200 text-slate-300">
                        <Icon name="products" className="h-3.5 w-3.5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-800">{p.name}</p>
                      <p className="truncate text-xs text-slate-400">
                        {p.brand} · {p.pack}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={addingToSectionId === p.id}
                    onClick={() => addToSection(p)}
                  >
                    {addingToSectionId === p.id ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty={
            section === 'all'
              ? 'No products match your filters.'
              : `No products in “${SECTION_TABS.find((t) => t.key === section)?.label}” match your filters.`
          }
        />
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? ''}
        footer={
          selected && canManage && (
            <>
              {editing ? (
                <>
                  <Button variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" disabled={saving} onClick={saveEdit}>
                    Save changes
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    <Icon name="plus" className="h-4 w-4" /> Edit price / stock
                  </Button>
                  {selected.status === 'active' ? (
                    <Button
                      variant="danger"
                      disabled={saving}
                      onClick={() => changeStatus(selected.id, 'inactive')}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      variant="success"
                      disabled={saving}
                      onClick={() => changeStatus(selected.id, 'active')}
                    >
                      <Icon name="check" className="h-4 w-4" /> Activate
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    disabled={saving}
                    onClick={() =>
                      ask({
                        title: 'Delete this product?',
                        message: `"${selected.name}" will be removed from the catalogue. This cannot be undone.`,
                        confirmLabel: 'Delete',
                        danger: true,
                        onConfirm: () => removeProduct(selected.id),
                      })
                    }
                  >
                    Delete
                  </Button>
                </>
              )}
            </>
          )
        }
      >
        {selected && !editing && (
          <>
            <div className="mb-3 flex items-center gap-3">
              <Badge tone={selected.status === 'active' ? 'green' : 'gray'}>
                {selected.status === 'active' ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            {selected.image && (
              <img
                src={selected.image}
                alt={selected.name}
                className="mb-4 h-40 w-full rounded-lg border border-slate-200 object-contain bg-slate-50"
              />
            )}
            <DetailList
              rows={[
                { label: 'Code', value: selected.code || '—' },
                { label: 'Brand', value: selected.brand || '—' },
                { label: 'Pack', value: selected.pack || '—' },
                { label: 'Category', value: selected.categoryTitle || '—' },
                {
                  label: 'Sub-category',
                  value: selected.subcategoryLabel || '—',
                },
                { label: 'Offer Price', value: formatCurrency(selected.price) },
                { label: 'MRP', value: formatCurrency(selected.mrp) },
                {
                  label: 'Discount',
                  value: selected.discountLabel || '—',
                },
                { label: 'Stock on hand', value: selected.stockQuantity },
                {
                  label: 'Prescription',
                  value: selected.isPrescriptionOnly ? 'Required' : 'Not required',
                },
                { label: 'Added', value: formatDate(selected.addedAt) },
              ]}
            />
            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Home feed rows
              </p>
              <div className="space-y-1.5">
                {(
                  [
                    ['isPopular', 'Popular Items'],
                    ['isDeal', 'Deals You Love'],
                    ['isOfferOfDay', 'Offer of the Day'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      disabled={saving || !canManage}
                      checked={selected[key]}
                      onChange={async (e) => {
                        setSaving(true);
                        try {
                          await updateProductSections(selected.id, {
                            isPopular: selected.isPopular,
                            isDeal: selected.isDeal,
                            isOfferOfDay: selected.isOfferOfDay,
                            [key]: e.target.checked,
                          });
                          reload();
                        } finally {
                          setSaving(false);
                        }
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Detail page
              </p>
              {selectedDetail === undefined ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : selectedDetail && selectedDetail.hasDetail ? (
                <div className="space-y-2 text-sm text-slate-600">
                  <p>
                    <span className="font-medium text-slate-700">Custom content</span>{' '}
                    entered by an admin. Shown in the app; blanks fall back to
                    auto-generated text.
                  </p>
                  {selectedDetail.form && (
                    <p className="text-xs text-slate-500">
                      Form: {selectedDetail.form}
                    </p>
                  )}
                  {selectedDetail.description && (
                    <p className="line-clamp-3 text-xs text-slate-500">
                      {selectedDetail.description}
                    </p>
                  )}
                  {selectedDetail.faqs.length > 0 && (
                    <p className="text-xs text-slate-500">
                      {selectedDetail.faqs.length} FAQ
                      {selectedDetail.faqs.length === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">
                  Auto-generated by the app from the name and pack. Add custom
                  content when creating a product.
                </p>
              )}
            </div>
          </>
        )}

        {selected && editing && (
          <div className="space-y-4">
            <EditField label="Offer Price (₹)">
              <input
                inputMode="numeric"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="Stock on hand">
              <input
                inputMode="numeric"
                value={form.stockQuantity}
                onChange={(e) =>
                  setForm({ ...form, stockQuantity: e.target.value })
                }
                className={inputClass}
              />
            </EditField>
          </div>
        )}
      </Modal>


      {confirmDialog}
    </>
  );
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

const textareaClass = `${inputClass} resize-y`;

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
