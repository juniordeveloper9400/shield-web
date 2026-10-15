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

/** Live preview of the discount badge the backend will compute and save —
 *  mirrors CatalogueService.discountLabelFor so what the admin sees while
 *  typing matches what members actually get. */
function discountLabelFor(price: number, mrp: number): string | null {
  if (mrp <= 0 || mrp <= price) return null;
  const percent = Math.round(((mrp - price) / mrp) * 100);
  return percent > 0 ? `${percent}% off` : null;
}

/** Default storage instructions admins pick from, persisted to localStorage so
 *  admins can create, edit, and delete storage options. */
const DEFAULT_STORAGE_OPTIONS = [
  'Store below 25°C in a cool, dry place',
  'Store below 30°C in a cool, dry place',
  'Store in a cool, dry place away from direct sunlight',
  'Store at room temperature, away from moisture',
  'Refrigerate between 2°C and 8°C. Do not freeze',
  'Keep out of reach and sight of children',
];
const STORAGE_OPTIONS_STORAGE_KEY = 'shield-catalogue-storage-options';

function loadStorageOptions(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_OPTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_STORAGE_OPTIONS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {}
  return DEFAULT_STORAGE_OPTIONS;
}

function persistStorageOptions(options: string[]) {
  try {
    window.localStorage.setItem(STORAGE_OPTIONS_STORAGE_KEY, JSON.stringify(options));
  } catch {}
}

/** Short labels for the catalogue-table tags — the same three sections the
 *  "Home feed rows" panel and the section tabs use, just compact enough to
 *  sit under a product's category. */
const SECTION_TAGS: { key: 'isPopular' | 'isDeal' | 'isOfferOfDay'; untilKey: 'popularUntil' | 'dealUntil' | 'offerOfDayUntil'; label: string; tone: string }[] = [
  { key: 'isPopular', untilKey: 'popularUntil', label: 'Popular', tone: 'bg-violet-50 text-violet-600' },
  { key: 'isDeal', untilKey: 'dealUntil', label: 'Deal', tone: 'bg-amber-50 text-amber-700' },
  { key: 'isOfferOfDay', untilKey: 'offerOfDayUntil', label: 'Offer of the day', tone: 'bg-sky-50 text-sky-700' },
];

/** Whether an "until" has already passed — the console still shows the raw
 *  flag as set (see CatalogueService.withEffectiveSections), so the tag
 *  itself needs its own expired marker rather than just disappearing. */
function isPast(until: string | null): boolean {
  return until != null && new Date(until).getTime() <= Date.now();
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export default function ProductsPage() {
  const { user, accessToken } = useAuth();
  // Only Admin / Super Admin manage the catalogue; every other role that can
  // open it (the store's Pharmacy Admin) is view-only.
  const canManage = user ? canManageCatalogue(user.role) : false;
  const { data, loading, error, reload } = useAsync(() => listProducts(accessToken), [accessToken]);
  const categories = useAsync(() => listCategories(accessToken), [accessToken]);
  const subcategories = useAsync(() => listSubcategories(accessToken), [accessToken]);
  const brands = useAsync(() => listBrands(accessToken), [accessToken]);

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

  // Storage dropdown custom management (create, edit, delete)
  const [storageOptions, setStorageOptions] = useState<string[]>(() => loadStorageOptions());
  const [storageMenuOpen, setStorageMenuOpen] = useState(false);
  const storageMenuRef = useRef<HTMLDivElement>(null);
  const [addingStorage, setAddingStorage] = useState(false);
  const [newStorageText, setNewStorageText] = useState('');
  const [editingStorageIndex, setEditingStorageIndex] = useState<number | null>(null);
  const [editingStorageText, setEditingStorageText] = useState('');

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (brandMenuOpen && !brandMenuRef.current?.contains(target)) {
        setBrandMenuOpen(false);
        setEditingBrandId(null);
      }
      if (storageMenuOpen && !storageMenuRef.current?.contains(target)) {
        setStorageMenuOpen(false);
        setEditingStorageIndex(null);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [brandMenuOpen, storageMenuOpen]);

  async function registerBrand() {
    if (!newBrandName.trim()) return;
    setBrandSaving(true);
    setBrandError(null);
    try {
      const brand = await createBrand(newBrandName, accessToken);
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
      const updated = await renameBrand(brand.id, trimmed, accessToken);
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
          await deleteBrand(brand.id, accessToken);
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
  const [form, setForm] = useState<{
    price: string;
    stockQuantity: string;
    image: string;
    extraImages: string[];
  }>({ price: '', stockQuantity: '', image: '', extraImages: [] });
  const [activePreviewIdx, setActivePreviewIdx] = useState(0);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    uses: true,
    desc: true,
    howTo: true,
    ingredients: false,
    safety: false,
    faqs: true,
  });
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const [formImageBusy, setFormImageBusy] = useState(false);
  const [formImageError, setFormImageError] = useState<string | null>(null);
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

  // Bulk "add to home-feed section" — checkboxes on the table let the admin
  // pick several products at once, then assign them all to the same section
  // (optionally with an expiry date) in one action, instead of opening each
  // product's own Manage panel.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSection, setBulkSection] = useState<'isPopular' | 'isDeal' | 'isOfferOfDay'>('isPopular');
  const [bulkUntil, setBulkUntil] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

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
    getProductDetail(selectedId, accessToken)
      .then((d) => {
        if (!cancelled) {
          setSelectedDetail(d);
          setForm((f) => ({
            ...f,
            extraImages: d?.extraImages ?? [],
          }));
        }
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, accessToken]);

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
    let extraImages: string[] = [];
    try {
      const d = await getProductDetail(product.id, accessToken);
      if (d) {
        const { hasDetail: _hasDetail, extraImages: galleryExtras, ...rest } = d;
        // "Highlights" and "Key benefits" used to be two separate fields;
        // the form now edits one combined "Key uses" field. Fold any
        // pre-existing benefits lines into it (deduped) so older products
        // don't lose that copy, then stop writing to benefits going forward.
        const mergedUses = [
          ...rest.highlights.split('\n').map((l) => l.trim()).filter(Boolean),
          ...rest.benefits.split('\n').map((l) => l.trim()).filter(Boolean),
        ];
        rest.highlights = Array.from(new Set(mergedUses)).join('\n');
        rest.benefits = '';
        detail = rest;
        extraImages = galleryExtras;
        if (rest.storage) {
          setStorageOptions((prev) => {
            if (prev.includes(rest.storage)) return prev;
            const next = [...prev, rest.storage];
            persistStorageOptions(next);
            return next;
          });
        }
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
      isPrescriptionOnly: product.isPrescriptionOnly,
      stockQuantity: product.stockQuantity,
      status: product.status,
      image: product.image,
      extraImages,
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
  function addStorageOption() {
    const trimmed = newStorageText.trim();
    if (!trimmed) return;
    if (!storageOptions.includes(trimmed)) {
      const next = [...storageOptions, trimmed];
      setStorageOptions(next);
      persistStorageOptions(next);
    }
    setDetail('storage', trimmed);
    setNewStorageText('');
    setAddingStorage(false);
  }

  function saveStorageRename(index: number) {
    const trimmed = editingStorageText.trim();
    const oldVal = storageOptions[index];
    if (!trimmed || trimmed === oldVal) {
      setEditingStorageIndex(null);
      return;
    }
    const next = [...storageOptions];
    next[index] = trimmed;
    setStorageOptions(next);
    persistStorageOptions(next);
    if (draft.detail.storage === oldVal) {
      setDetail('storage', trimmed);
    }
    setEditingStorageIndex(null);
  }

  function confirmDeleteStorage(option: string, index: number) {
    ask({
      title: 'Delete storage instruction?',
      message: `"${option}" will be removed from the options list. Products currently assigned this instruction will keep their text.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        const next = storageOptions.filter((_, i) => i !== index);
        setStorageOptions(next);
        persistStorageOptions(next);
        if (draft.detail.storage === option) {
          setDetail('storage', '');
        }
      },
    });
  }

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
      if (editingProductId) await updateProductFull(editingProductId, draft, accessToken);
      else await createProduct(draft, accessToken);
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
      await deleteProduct(id, accessToken);
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
      }, accessToken);
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
      }, accessToken);
      reload();
    } finally {
      setRemovingFromSectionId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Adds every checked product to `bulkSection`, all with the same
   *  (optional) expiry date — one write per product, same as the single-row
   *  Manage panel makes, just looped. A field already in the section keeps
   *  its other two flags as they were; only the target section and its
   *  expiry change. */
  async function applyBulkSection() {
    if (selectedIds.size === 0) return;
    setBulkError(null);
    setBulkApplying(true);
    // End of the chosen day, in the admin's own timezone — a date picker
    // only gives a calendar day, not a moment, and "expires at the start of
    // the day I picked" would surprise nobody more than the admin who set it.
    const untilIso = bulkUntil ? new Date(`${bulkUntil}T23:59:59`).toISOString() : null;
    try {
      const targets = rows.filter((r) => selectedIds.has(r.id));
      await Promise.all(
        targets.map((p) =>
          updateProductSections(p.id, {
            isPopular: bulkSection === 'isPopular' ? true : p.isPopular,
            isDeal: bulkSection === 'isDeal' ? true : p.isDeal,
            isOfferOfDay: bulkSection === 'isOfferOfDay' ? true : p.isOfferOfDay,
            ...(bulkSection === 'isPopular' ? { popularUntil: untilIso } : {}),
            ...(bulkSection === 'isDeal' ? { dealUntil: untilIso } : {}),
            ...(bulkSection === 'isOfferOfDay' ? { offerOfDayUntil: untilIso } : {}),
          }, accessToken),
        ),
      );
      setSelectedIds(new Set());
      setBulkUntil('');
      reload();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Could not update those products.');
    } finally {
      setBulkApplying(false);
    }
  }

  function open(id: string) {
    const product = rows.find((r) => r.id === id);
    if (!product) return;
    setSelectedId(id);
    setEditing(false);
    setActivePreviewIdx(0);
    setOpenFaqIndex(null);
    setFormImageError(null);
    setForm({
      price: String(product.price),
      stockQuantity: String(product.stockQuantity),
      image: product.image,
      extraImages: [],
    });
  }

  async function changeStatus(id: string, next: ProductStatus) {
    setSaving(true);
    try {
      await setProductStatus(id, next, accessToken);
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
      await updateProduct(
        selected.id,
        {
          price: Number.isFinite(price) && price >= 0 ? price : selected.price,
          stockQuantity:
            Number.isFinite(stockQuantity) && stockQuantity >= 0
              ? stockQuantity
              : selected.stockQuantity,
          image: form.image,
          extraImages: form.extraImages,
        },
        accessToken,
      );
      setEditing(false);
      reload();
      if (selectedId) {
        getProductDetail(selectedId, accessToken)
          .then((d) => setSelectedDetail(d))
          .catch(() => setSelectedDetail(null));
      }
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
      key: 'select',
      header: (
        <input
          type="checkbox"
          aria-label="Select all visible products"
          checked={filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id))}
          onChange={(e) =>
            setSelectedIds(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())
          }
        />
      ),
      render: (row) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.name}`}
          checked={selectedIds.has(row.id)}
          onChange={() => toggleSelected(row.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
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
          {SECTION_TAGS.some((t) => row[t.key]) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {SECTION_TAGS.filter((t) => row[t.key]).map((t) => {
                const until = row[t.untilKey];
                const expired = isPast(until);
                return (
                  <span
                    key={t.key}
                    title={until ? `Until ${formatDate(until)}` : 'No expiry'}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      expired ? 'bg-slate-100 text-slate-400' : t.tone
                    }`}
                  >
                    {t.label}
                    {expired ? ' · expired' : ''}
                  </span>
                );
              })}
            </div>
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
          <EditField label="Discount">
            <p className="text-sm text-slate-600">
              {discountLabelFor(draft.price, draft.mrp) ?? 'No discount — set an MRP above the Offer Price'}
            </p>
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
                        ask({
                          title: 'Remove primary image?',
                          message:
                            draft.extraImages.length > 0
                              ? 'Are you sure you want to remove the primary image? The next image will become the primary image.'
                              : 'Are you sure you want to remove this product image?',
                          confirmLabel: 'Remove',
                          danger: true,
                          onConfirm: () =>
                            setDraft((d) => {
                              const extra = [...d.extraImages];
                              const next = extra.shift() ?? '';
                              return { ...d, image: next, extraImages: extra };
                            }),
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
                        ask({
                          title: 'Remove this image?',
                          message: 'Are you sure you want to remove this image from the gallery?',
                          confirmLabel: 'Remove',
                          danger: true,
                          onConfirm: () =>
                            setDraft((d) => ({
                              ...d,
                              extraImages: d.extraImages.filter((_, j) => j !== i),
                            })),
                        })
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
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (files.length === 0) return;
                    setAddError(null);
                    try {
                      for (const file of files) {
                        const url = await fileToResizedDataUrl(file);
                        setDraft((d) =>
                          d.image
                            ? { ...d, extraImages: [...d.extraImages, url] }
                            : { ...d, image: url },
                        );
                      }
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
              another image swaps it into that spot. Click (×) to remove an image.
            </p>
          </EditField>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
                  <div className="relative flex items-center gap-2" ref={storageMenuRef}>
                    <div className="relative min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => {
                          setStorageMenuOpen((v) => !v);
                          setEditingStorageIndex(null);
                        }}
                        className={`${inputClass} flex items-center justify-between text-left`}
                      >
                        <span className={`truncate ${draft.detail.storage ? '' : 'text-slate-400'}`}>
                          {draft.detail.storage || 'Select storage instructions…'}
                        </span>
                        <Icon name="chevron-down" className="h-4 w-4 shrink-0 text-slate-400" />
                      </button>
                      {storageMenuOpen && (
                        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => {
                              setDetail('storage', '');
                              setStorageMenuOpen(false);
                            }}
                            className="block w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-50"
                          >
                            Select storage instructions…
                          </button>
                          {storageOptions.map((opt, i) => (
                            <div
                              key={i}
                              className={`flex items-center gap-1 px-1.5 py-1 text-sm hover:bg-slate-50 ${
                                opt === draft.detail.storage ? 'bg-accent-50' : ''
                              }`}
                            >
                              {editingStorageIndex === i ? (
                                <>
                                  <input
                                    autoFocus
                                    value={editingStorageText}
                                    onChange={(e) => setEditingStorageText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        saveStorageRename(i);
                                      } else if (e.key === 'Escape') {
                                        setEditingStorageIndex(null);
                                      }
                                    }}
                                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                                  />
                                  <button
                                    type="button"
                                    title="Save"
                                    onClick={() => saveStorageRename(i)}
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
                                      setDetail('storage', opt);
                                      setStorageMenuOpen(false);
                                    }}
                                    className="min-w-0 flex-1 truncate px-1.5 py-1 text-left"
                                  >
                                    {opt}
                                  </button>
                                  <button
                                    type="button"
                                    title="Edit storage instruction"
                                    onClick={() => {
                                      setEditingStorageIndex(i);
                                      setEditingStorageText(opt);
                                    }}
                                    className="grid h-7 w-7 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                  >
                                    <Icon name="edit" className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Delete storage instruction"
                                    onClick={() => confirmDeleteStorage(opt, i)}
                                    className="grid h-7 w-7 shrink-0 place-items-center rounded text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                                  >
                                    <Icon name="trash" className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          ))}
                          {storageOptions.length === 0 && (
                            <p className="px-3 py-2 text-sm text-slate-400">No storage instructions yet.</p>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      title="Register a new storage instruction"
                      onClick={() => setAddingStorage((v) => !v)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
                    >
                      <Icon name="plus" className="h-4 w-4" />
                    </button>
                  </div>
                  {addingStorage && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        autoFocus
                        value={newStorageText}
                        onChange={(e) => setNewStorageText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addStorageOption();
                          }
                        }}
                        placeholder="New storage instruction"
                        className={inputClass}
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={!newStorageText.trim()}
                        onClick={addStorageOption}
                      >
                        Add
                      </Button>
                    </div>
                  )}
                </EditField>
              </div>
              <EditField label="Key uses (one per line)">
                <textarea
                  value={draft.detail.highlights}
                  onChange={(e) => setDetail('highlights', e.target.value)}
                  className={textareaClass}
                  rows={3}
                />
              </EditField>
              <EditField label="How to use (one per line)">
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
        {canManage && selectedIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50/60 p-3">
            <span className="text-sm font-medium text-slate-700">
              {selectedIds.size} selected
            </span>
            <select
              value={bulkSection}
              onChange={(e) => setBulkSection(e.target.value as typeof bulkSection)}
              className={inputClass + ' w-auto'}
            >
              {SECTION_TABS.filter((t) => t.key !== 'all').map((t) => (
                <option key={t.key} value={t.key}>
                  Add to “{t.label}”
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Expires
              <input
                type="date"
                value={bulkUntil}
                onChange={(e) => setBulkUntil(e.target.value)}
                className={inputClass + ' w-auto'}
              />
            </label>
            {bulkUntil && (
              <button
                type="button"
                className="text-xs font-medium text-slate-500 underline"
                onClick={() => setBulkUntil('')}
              >
                No expiry
              </button>
            )}
            <Button size="sm" disabled={bulkApplying} onClick={applyBulkSection}>
              {bulkApplying ? 'Applying…' : 'Apply'}
            </Button>
            <button
              type="button"
              className="text-xs font-medium text-slate-500"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </button>
            {bulkError && <p className="w-full text-xs text-rose-600">{bulkError}</p>}
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
        size="xl"
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
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(true);
                      setForm({
                        price: String(selected.price),
                        stockQuantity: String(selected.stockQuantity),
                        image: selected.image,
                        extraImages: selectedDetail?.extraImages ?? [],
                      });
                    }}
                  >
                    <Icon name="plus" className="h-4 w-4" /> Edit price / stock
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => openEdit(selected)}
                  >
                    <Icon name="edit" className="h-4 w-4" /> Edit product
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
          <div className="space-y-5">
            {/* Top Identity Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={selected.status === 'active' ? 'green' : 'gray'}>
                  {selected.status === 'active' ? 'Active' : 'Inactive'}
                </Badge>
                {selected.isPrescriptionOnly ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
                    <span className="font-bold">Rx</span> Prescription Required
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    OTC Medicine
                  </span>
                )}
                {selected.categoryTitle && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {selected.categoryTitle}
                  </span>
                )}
                {selected.subcategoryLabel && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                    {selected.subcategoryLabel}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400 font-mono">Code: {selected.code || '—'}</span>
            </div>

            {/* Main Showcase: 2-Columns */}
            {(() => {
              const allImages = [
                selected.image,
                ...(selectedDetail?.extraImages ?? []),
              ].filter(Boolean);
              const currentImage = allImages[activePreviewIdx] ?? allImages[0] ?? '';
              const discountPercent =
                selected.mrp > selected.price
                  ? Math.round(((selected.mrp - selected.price) / selected.mrp) * 100)
                  : 0;
              const keyUsesList = [
                ...(selectedDetail?.highlights?.split('\n') ?? []),
                ...(selectedDetail?.benefits?.split('\n') ?? []),
              ]
                .map((s) => s.trim())
                .filter(Boolean);
              const directionsList = (selectedDetail?.directions?.split('\n') ?? [])
                .map((s) => s.trim())
                .filter(Boolean);
              const safetyList = (selectedDetail?.safety?.split('\n') ?? [])
                .map((s) => s.trim())
                .filter(Boolean);

              return (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                  {/* Left Column: Artwork Gallery & Visibility */}
                  <div className="md:col-span-5 space-y-4">
                    {/* Artwork Card (Styled like App's _ArtworkCard) */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xs">
                      <div className="relative aspect-[4/3] w-full rounded-xl bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-100">
                        {currentImage ? (
                          <img
                            src={currentImage}
                            alt={selected.name}
                            className="h-full w-full object-contain p-2 transition-all duration-200"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2 text-slate-300">
                            <Icon name="products" className="h-12 w-12" />
                            <span className="text-xs text-slate-400">No artwork uploaded</span>
                          </div>
                        )}

                        {/* Discount Banner (Matching App) */}
                        {discountPercent > 0 && (
                          <div className="absolute top-0 left-0 rounded-br-xl bg-brand-600 px-3 py-1 text-xs font-black tracking-wide text-white shadow-xs">
                            {discountPercent}% OFF
                          </div>
                        )}

                        {/* Primary Badge */}
                        {activePreviewIdx === 0 && currentImage && (
                          <span
                            className={`absolute ${
                              discountPercent > 0 ? 'top-8 left-2' : 'top-2 left-2'
                            } rounded bg-brand-700/90 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider backdrop-blur-xs`}
                          >
                            Primary
                          </span>
                        )}

                        {/* Image Counter */}
                        {allImages.length > 1 && (
                          <span className="absolute bottom-2.5 right-2.5 rounded-full bg-black/60 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur-xs">
                            {activePreviewIdx + 1} / {allImages.length}
                          </span>
                        )}

                        {/* Navigation Arrows */}
                        {allImages.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setActivePreviewIdx((prev) =>
                                  prev > 0 ? prev - 1 : allImages.length - 1,
                                )
                              }
                              className="absolute left-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-slate-700 shadow-xs hover:bg-white transition-all opacity-80 hover:opacity-100 font-bold"
                            >
                              ‹
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setActivePreviewIdx((prev) =>
                                  prev < allImages.length - 1 ? prev + 1 : 0,
                                )
                              }
                              className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-slate-700 shadow-xs hover:bg-white transition-all opacity-80 hover:opacity-100 font-bold"
                            >
                              ›
                            </button>
                          </>
                        )}

                        {/* Remove Image (Admin only with confirmation) */}
                        {canManage && currentImage && (
                          <button
                            type="button"
                            title="Remove this image"
                            onClick={() =>
                              ask({
                                title: 'Remove this image?',
                                message:
                                  activePreviewIdx === 0
                                    ? allImages.length > 1
                                      ? 'Are you sure you want to remove the primary image? The next image will become the primary image.'
                                      : 'Are you sure you want to remove this product image?'
                                    : 'Are you sure you want to remove this image from the product?',
                                confirmLabel: 'Remove',
                                danger: true,
                                onConfirm: async () => {
                                  const filtered = allImages.filter(
                                    (_, idx) => idx !== activePreviewIdx,
                                  );
                                  const nextPrimary = filtered[0] ?? '';
                                  const nextExtras = filtered.slice(1);
                                  setSaving(true);
                                  try {
                                    await updateProduct(
                                      selected.id,
                                      {
                                        image: nextPrimary,
                                        extraImages: nextExtras,
                                      },
                                      accessToken,
                                    );
                                    reload();
                                    if (selectedId) {
                                      const d = await getProductDetail(
                                        selectedId,
                                        accessToken,
                                      );
                                      setSelectedDetail(d);
                                    }
                                    setActivePreviewIdx((prev) =>
                                      Math.max(0, Math.min(prev, filtered.length - 1)),
                                    );
                                  } finally {
                                    setSaving(false);
                                  }
                                },
                              })
                            }
                            className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border border-rose-200 bg-white/95 text-xs font-bold text-rose-600 shadow-xs hover:bg-rose-50 transition-all"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      {/* Thumbnail Gallery (Matching App) */}
                      {allImages.length > 1 && (
                        <div className="mt-2.5 flex items-center gap-2 overflow-x-auto p-1">
                          {allImages.map((img, idx) => (
                            <div key={idx} className="relative group shrink-0">
                              <button
                                type="button"
                                onClick={() => setActivePreviewIdx(idx)}
                                className={`relative h-14 w-14 rounded-lg border-2 overflow-hidden transition-all block ${
                                  activePreviewIdx === idx
                                    ? 'border-brand-500 ring-2 ring-brand-200 shadow-xs'
                                    : 'border-slate-200 hover:border-slate-300 opacity-70 hover:opacity-100'
                                }`}
                              >
                                <img src={img} alt="" className="h-full w-full object-cover" />
                                {idx === 0 && (
                                  <span className="absolute bottom-0 inset-x-0 bg-brand-600/95 text-white text-[8px] font-bold text-center leading-tight py-0.5">
                                    P
                                  </span>
                                )}
                              </button>
                              {canManage && (
                                <button
                                  type="button"
                                  title="Remove this image"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    ask({
                                      title: 'Remove this image?',
                                      message:
                                        idx === 0
                                          ? allImages.length > 1
                                            ? 'Are you sure you want to remove the primary image? The next image will become the primary image.'
                                            : 'Are you sure you want to remove this product image?'
                                          : 'Are you sure you want to remove this image from the product?',
                                      confirmLabel: 'Remove',
                                      danger: true,
                                      onConfirm: async () => {
                                        const filtered = allImages.filter((_, i) => i !== idx);
                                        const nextPrimary = filtered[0] ?? '';
                                        const nextExtras = filtered.slice(1);
                                        setSaving(true);
                                        try {
                                          await updateProduct(
                                            selected.id,
                                            {
                                              image: nextPrimary,
                                              extraImages: nextExtras,
                                            },
                                            accessToken,
                                          );
                                          reload();
                                          if (selectedId) {
                                            const d = await getProductDetail(
                                              selectedId,
                                              accessToken,
                                            );
                                            setSelectedDetail(d);
                                          }
                                          setActivePreviewIdx((prev) =>
                                            Math.max(
                                              0,
                                              Math.min(prev, filtered.length - 1),
                                            ),
                                          );
                                        } finally {
                                          setSaving(false);
                                        }
                                      },
                                    });
                                  }}
                                  className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border border-rose-200 bg-white text-[10px] leading-none text-rose-600 shadow-xs opacity-90 hover:opacity-100 hover:bg-rose-50"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Metadata Card */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-2">
                      <p className="font-bold text-slate-800 uppercase tracking-wide text-[11px]">
                        Catalogue Details
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-slate-600">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Product Code</span>
                          <span className="font-mono font-medium">{selected.code || '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Added On</span>
                          <span>{formatDate(selected.addedAt)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Category</span>
                          <span className="truncate block">{selected.categoryTitle || '—'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Sub-category</span>
                          <span className="truncate block">{selected.subcategoryLabel || '—'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Home Feed Rows Card */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Home feed visibility
                      </p>
                      <div className="space-y-2">
                        {(
                          [
                            ['isPopular', 'popularUntil', 'Popular Items'],
                            ['isDeal', 'dealUntil', 'Deals You Love'],
                            ['isOfferOfDay', 'offerOfDayUntil', 'Offer of the Day'],
                          ] as const
                        ).map(([key, untilKey, label]) => (
                          <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <label className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                disabled={saving || !canManage}
                                checked={selected[key]}
                                onChange={async (e) => {
                                  setSaving(true);
                                  try {
                                    await updateProductSections(
                                      selected.id,
                                      {
                                        isPopular: selected.isPopular,
                                        isDeal: selected.isDeal,
                                        isOfferOfDay: selected.isOfferOfDay,
                                        [key]: e.target.checked,
                                      },
                                      accessToken,
                                    );
                                    reload();
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                              />
                              {label}
                            </label>
                            {selected[key] && (
                              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                Expires
                                <input
                                  type="date"
                                  disabled={saving || !canManage}
                                  value={
                                    selected[untilKey] ? selected[untilKey]!.slice(0, 10) : ''
                                  }
                                  onChange={async (e) => {
                                    setSaving(true);
                                    try {
                                      const until = e.target.value
                                        ? new Date(`${e.target.value}T23:59:59`).toISOString()
                                        : null;
                                      await updateProductSections(
                                        selected.id,
                                        {
                                          isPopular: selected.isPopular,
                                          isDeal: selected.isDeal,
                                          isOfferOfDay: selected.isOfferOfDay,
                                          [untilKey]: until,
                                        },
                                        accessToken,
                                      );
                                      reload();
                                    } finally {
                                      setSaving(false);
                                    }
                                  }}
                                  className="rounded border border-slate-200 px-1.5 py-0.5 text-xs"
                                />
                                {isPast(selected[untilKey]) && (
                                  <span className="font-medium text-rose-500">expired</span>
                                )}
                              </label>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Identity, Pricing, Storage & Sections */}
                  <div className="md:col-span-7 space-y-3.5">
                    {/* Header & Pricing Card (Matching App's _HeaderCard) */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-600">
                          <span>{selected.brand || 'Sahakar 360'}</span>
                          <span className="text-sky-500" title="Verified Brand">✓</span>
                        </div>
                        <h2 className="text-xl font-extrabold text-slate-900 leading-tight mt-0.5">
                          {selected.name}
                        </h2>
                        <p className="text-xs font-medium text-slate-500 mt-0.5">
                          Pack size: {selected.pack}
                        </p>
                      </div>

                      <div className="border-t border-slate-100 pt-3 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          {selected.mrp > selected.price && (
                            <p className="text-xs text-slate-400 line-through">
                              MRP {formatCurrency(selected.mrp)}
                            </p>
                          )}
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black text-slate-900">
                              {formatCurrency(selected.price)}
                            </span>
                            {discountPercent > 0 && (
                              <span className="rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-xs font-extrabold">
                                {discountPercent}% OFF
                              </span>
                            )}
                          </div>
                          {selected.mrp > selected.price && (
                            <p className="text-xs font-bold text-emerald-600 mt-0.5">
                              You save {formatCurrency(selected.mrp - selected.price)} on this pack
                            </p>
                          )}
                        </div>

                        <div>
                          {selected.stockQuantity > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              In stock ({selected.stockQuantity})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 border border-rose-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              Out of stock
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Storage Strip (Matching App's _StorageStrip) */}
                    {selectedDetail?.storage && (
                      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 flex items-start gap-2.5">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-600 text-sm font-bold">
                          ❄
                        </span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-800">
                            Storage Instructions
                          </p>
                          <p className="text-xs font-medium text-sky-950 mt-0.5 leading-snug">
                            {selectedDetail.storage}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Key Uses (Matching App's _Section) */}
                    {keyUsesList.length > 0 && (
                      <DetailSectionCard
                        title="Key Uses & Benefits"
                        badge={`${keyUsesList.length} points`}
                        isOpen={Boolean(openSections.uses)}
                        onToggle={() => toggleSection('uses')}
                      >
                        <ul className="space-y-1.5">
                          {keyUsesList.map((use, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-[10px] mt-0.5 font-bold">
                                ✓
                              </span>
                              <span className="text-xs text-slate-700 leading-snug">{use}</span>
                            </li>
                          ))}
                        </ul>
                      </DetailSectionCard>
                    )}

                    {/* Description */}
                    {selectedDetail?.description && (
                      <DetailSectionCard
                        title="Product Description"
                        isOpen={Boolean(openSections.desc)}
                        onToggle={() => toggleSection('desc')}
                      >
                        <p className="whitespace-pre-line text-xs text-slate-700 leading-relaxed">
                          {selectedDetail.description}
                        </p>
                      </DetailSectionCard>
                    )}

                    {/* How to Use (Directions) */}
                    {directionsList.length > 0 && (
                      <DetailSectionCard
                        title="How to Use"
                        badge={`${directionsList.length} steps`}
                        isOpen={Boolean(openSections.howTo)}
                        onToggle={() => toggleSection('howTo')}
                      >
                        <ol className="space-y-2">
                          {directionsList.map((dir, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700 font-bold text-xs">
                                {i + 1}
                              </span>
                              <span className="text-xs text-slate-700 leading-snug">{dir}</span>
                            </li>
                          ))}
                        </ol>
                      </DetailSectionCard>
                    )}

                    {/* Ingredients */}
                    {selectedDetail?.ingredients && (
                      <DetailSectionCard
                        title="Ingredients & Composition"
                        isOpen={Boolean(openSections.ingredients)}
                        onToggle={() => toggleSection('ingredients')}
                      >
                        <p className="whitespace-pre-line text-xs text-slate-700 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                          {selectedDetail.ingredients}
                        </p>
                      </DetailSectionCard>
                    )}

                    {/* Safety Information */}
                    {safetyList.length > 0 && (
                      <DetailSectionCard
                        title="Safety Information"
                        badge={`${safetyList.length} precautions`}
                        isOpen={Boolean(openSections.safety)}
                        onToggle={() => toggleSection('safety')}
                      >
                        <ul className="space-y-2">
                          {safetyList.map((item, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-amber-950 bg-amber-50/70 p-2.5 rounded-lg border border-amber-200/60"
                            >
                              <span className="text-amber-600 font-bold text-xs mt-0.5">⚠</span>
                              <span className="text-xs text-amber-900 leading-snug">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </DetailSectionCard>
                    )}

                    {/* FAQs Accordion */}
                    {selectedDetail?.faqs && selectedDetail.faqs.length > 0 && (
                      <DetailSectionCard
                        title="Frequently Asked Questions"
                        badge={`${selectedDetail.faqs.length} FAQs`}
                        isOpen={Boolean(openSections.faqs)}
                        onToggle={() => toggleSection('faqs')}
                      >
                        <div className="space-y-2">
                          {selectedDetail.faqs.map((faq, i) => {
                            const isFaqOpen = openFaqIndex === i;
                            return (
                              <div
                                key={i}
                                className="rounded-lg border border-slate-200 overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() => setOpenFaqIndex(isFaqOpen ? null : i)}
                                  className="w-full flex items-center justify-between p-2.5 text-left font-semibold text-xs text-slate-800 bg-slate-50/70 hover:bg-slate-100/70 transition-colors"
                                >
                                  <span>{faq.question}</span>
                                  <Icon
                                    name="chevron-down"
                                    className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
                                      isFaqOpen ? 'rotate-180' : ''
                                    }`}
                                  />
                                </button>
                                {isFaqOpen && (
                                  <div className="p-2.5 text-xs text-slate-600 bg-white border-t border-slate-100 leading-relaxed">
                                    {faq.answer}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </DetailSectionCard>
                    )}

                    {/* When product has no custom detail text entered */}
                    {selectedDetail && !selectedDetail.hasDetail && (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-center">
                        <p className="text-xs font-semibold text-slate-700">App-Generated Detail View</p>
                        <p className="mt-1 text-[11px] text-slate-400 max-w-sm mx-auto">
                          This product uses auto-generated descriptions and guidelines in the member app.
                        </p>
                        {canManage && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-2.5"
                            onClick={() => openEdit(selected)}
                          >
                            <Icon name="edit" className="h-3.5 w-3.5" /> Add custom details & FAQs
                          </Button>
                        )}
                      </div>
                    )}

                    {/* When selectedDetail is still loading */}
                    {selectedDetail === undefined && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400 animate-pulse">
                        Loading complete product details…
                      </div>
                    )}

                    {/* Trust & Guarantee strip (Matching App) */}
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span>Verified by Sahakar 360 Pharmacy Team · 100% Genuine Medicines</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {selected && editing && (
          <div className="space-y-4">
            <EditField label="Product images (optional)">
              <div className="flex flex-wrap items-start gap-3">
                {form.image && (
                  <div className="flex flex-col items-center gap-1">
                    <div className="relative">
                      <img
                        src={form.image}
                        alt=""
                        className="h-16 w-16 rounded-lg border-2 border-brand-500 object-cover"
                      />
                      <button
                        type="button"
                        title="Remove this image"
                        onClick={() =>
                          ask({
                            title: 'Remove primary image?',
                            message:
                              form.extraImages.length > 0
                                ? 'Are you sure you want to remove the primary image? The next image will become the primary image.'
                                : 'Are you sure you want to remove this product image?',
                            confirmLabel: 'Remove',
                            danger: true,
                            onConfirm: () =>
                              setForm((f) => {
                                const extra = [...f.extraImages];
                                const next = extra.shift() ?? '';
                                return { ...f, image: next, extraImages: extra };
                              }),
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
                {form.extraImages.map((img, i) => (
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
                          ask({
                            title: 'Remove this image?',
                            message: 'Are you sure you want to remove this image from the gallery?',
                            confirmLabel: 'Remove',
                            danger: true,
                            onConfirm: () =>
                              setForm((f) => ({
                                ...f,
                                extraImages: f.extraImages.filter((_, j) => j !== i),
                              })),
                          })
                        }
                        className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-rose-200 bg-white text-[10px] leading-none text-rose-600"
                      >
                        ×
                      </button>
                    </div>
                    <button
                      type="button"
                      className="text-[10px] font-medium text-brand-600 hover:underline"
                      onClick={() =>
                        setForm((f) => {
                          const extra = [...f.extraImages];
                          const promoted = extra[i];
                          extra[i] = f.image;
                          return { ...f, image: promoted, extraImages: extra };
                        })
                      }
                    >
                      Set primary
                    </button>
                  </div>
                ))}
                {!form.image && form.extraImages.length === 0 && (
                  <div className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                    <Icon name="products" className="h-6 w-6" />
                  </div>
                )}
                <label
                  className={`flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-brand-400 hover:text-brand-600 ${
                    formImageBusy ? 'opacity-50 pointer-events-none' : ''
                  }`}
                >
                  <Icon name="plus" className="h-4 w-4" />
                  <span className="text-[9px] font-medium">{formImageBusy ? 'Adding…' : 'Add'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={formImageBusy}
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (files.length === 0) return;
                      setFormImageError(null);
                      setFormImageBusy(true);
                      try {
                        for (const file of files) {
                          const url = await fileToResizedDataUrl(file);
                          setForm((f) =>
                            f.image
                              ? { ...f, extraImages: [...f.extraImages, url] }
                              : { ...f, image: url },
                          );
                        }
                      } catch (err) {
                        setFormImageError(
                          err instanceof Error ? err.message : 'Could not load the image.',
                        );
                      } finally {
                        setFormImageBusy(false);
                      }
                    }}
                  />
                </label>
              </div>
              {formImageError && <p className="mt-1.5 text-xs text-rose-600">{formImageError}</p>}
              <p className="mt-1.5 text-xs text-slate-400">
                The first image (marked "Primary") is displayed first across the app and webapp. "Set primary" swaps it into that spot.
              </p>
            </EditField>
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

function DetailSectionCard({
  title,
  isOpen,
  onToggle,
  badge,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3.5 text-left bg-white hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-800">{title}</span>
          {badge && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {badge}
            </span>
          )}
        </div>
        <Icon
          name="chevron-down"
          className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      {isOpen && (
        <div className="border-t border-slate-100 p-3.5 text-xs text-slate-600 bg-white">
          {children}
        </div>
      )}
    </div>
  );
}
