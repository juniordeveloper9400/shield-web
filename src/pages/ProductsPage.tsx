import { useMemo, useState } from 'react';
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
import { formatCurrency, formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  listProducts,
  listCategories,
  createProduct,
  deleteProduct,
  setProductStatus,
  updateProduct,
} from '@/api/products';
import type { NewProduct, Product, ProductStatus } from '@/types';

const EMPTY_NEW: NewProduct = {
  categorySlug: '',
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
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export default function ProductsPage() {
  const { data, loading, error, reload } = useAsync(listProducts, []);
  const categories = useAsync(listCategories, []);
  const rows = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ price: '', stockQuantity: '' });

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewProduct>(EMPTY_NEW);
  const [addError, setAddError] = useState<string | null>(null);

  function openAdd() {
    setDraft(EMPTY_NEW);
    setAddError(null);
    setAdding(true);
  }

  async function saveNew() {
    if (!draft.categorySlug) return setAddError('Pick a category first.');
    if (!draft.name.trim()) return setAddError('Give the product a name.');
    if (!(draft.price >= 0) || !(draft.mrp >= 0))
      return setAddError('Price and MRP must be zero or more.');
    setSaving(true);
    setAddError(null);
    try {
      await createProduct(draft);
      setAdding(false);
      reload();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add the product.');
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
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
  }, [rows, search, status, category]);

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
      ),
    },
    { key: 'category', header: 'Category', render: (row) => row.categoryTitle || '—' },
    {
      key: 'price',
      header: 'Price',
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
        <Button variant="secondary" size="sm" onClick={() => open(row.id)}>
          Manage
        </Button>
      ),
      className: 'text-right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Catalogue"
        subtitle="The storefront and pharmacy-shelf catalogue members buy from."
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Icon name="plus" className="h-4 w-4" /> Add product
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Products" value={counts.total} icon="products" tone="blue" />
        <StatCard label="Active" value={counts.active} icon="check" tone="green" />
        <StatCard label="Inactive" value={counts.inactive} tone="rose" />
        <StatCard label="Prescription only" value={counts.rx} tone="amber" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search product, brand, code…"
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
        <DataTable
          columns={columns}
          rows={filtered}
          loading={loading}
          error={error}
          empty="No products match your filters."
        />
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? ''}
        footer={
          selected && (
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
                    onClick={() => removeProduct(selected.id)}
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
            <div className="mb-3">
              <Badge tone={selected.status === 'active' ? 'green' : 'gray'}>
                {selected.status === 'active' ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <DetailList
              rows={[
                { label: 'Code', value: selected.code || '—' },
                { label: 'Brand', value: selected.brand || '—' },
                { label: 'Pack', value: selected.pack || '—' },
                { label: 'Category', value: selected.categoryTitle || '—' },
                { label: 'Price', value: formatCurrency(selected.price) },
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
          </>
        )}

        {selected && editing && (
          <div className="space-y-4">
            <EditField label="Price (₹)">
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

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add product"
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving} onClick={saveNew}>
              Add to catalogue
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <EditField label="Category">
            <select
              value={draft.categorySlug}
              onChange={(e) => setDraft({ ...draft, categorySlug: e.target.value })}
              className={inputClass}
            >
              <option value="">Select a category…</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.title}
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
              <input
                value={draft.brand}
                onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                className={inputClass}
              />
            </EditField>
            <EditField label="Price (₹)">
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
          {addError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {addError}
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
