import { api } from '@/lib/api';
import { fromEnum } from '@/lib/mappers';
import type {
  Brand,
  NewProduct,
  Product,
  ProductCategory,
  ProductDetailInput,
  ProductFaqInput,
  ProductStatus,
  ProductSubcategory,
} from '@/types';

/** A `GET /v1/staff/catalogue/products` row — several ids come back as
 *  JSON numbers (bigint columns), not the string ids shieldweb's own
 *  types use; mapped below. */
interface ProductApiRow {
  id: number;
  code: string | null;
  name: string;
  pack: string;
  brand: string | null;
  categorySlug: string | null;
  categoryTitle: string | null;
  subcategoryId: number | null;
  subcategoryLabel: string | null;
  price: string | number;
  mrp: string | number;
  discountLabel: string | null;
  isPrescriptionOnly: boolean;
  status: string;
  stockQuantity: string | number;
  image: string | null;
  isPopular: boolean;
  isDeal: boolean;
  isOfferOfDay: boolean;
  createdAt: string;
}

function toProduct(r: ProductApiRow): Product {
  return {
    id: String(r.id),
    code: r.code ?? '',
    name: r.name,
    pack: r.pack,
    brand: r.brand ?? '',
    categorySlug: r.categorySlug ?? '',
    categoryTitle: r.categoryTitle ?? '',
    subcategoryId: r.subcategoryId == null ? '' : String(r.subcategoryId),
    subcategoryLabel: r.subcategoryLabel ?? '',
    price: Number(r.price),
    mrp: Number(r.mrp),
    discountLabel: r.discountLabel ?? '',
    isPrescriptionOnly: r.isPrescriptionOnly,
    status: fromEnum<ProductStatus>(r.status),
    stockQuantity: Number(r.stockQuantity),
    image: r.image ?? '',
    isPopular: r.isPopular,
    isDeal: r.isDeal,
    isOfferOfDay: r.isOfferOfDay,
    addedAt: r.createdAt,
  };
}

/** Every product, any status — the console's own catalogue table. Reads
 *  through backend/api's staff catalogue routes now, not Neon directly. */
export async function listProducts(token: string | null): Promise<Product[]> {
  const rows = await api.get<ProductApiRow[]>('/v1/staff/catalogue/products', token);
  return rows.map(toProduct);
}

/** The storefront category groups the admin picks from when adding a
 *  product — public, no auth required, same freebie `geo.ts`'s read
 *  helpers found. */
export async function listCategories(token: string | null): Promise<ProductCategory[]> {
  const rows = await api.get<{ id: number; slug: string; title: string }[]>(
    '/v1/public/catalogue/categories',
    token,
  );
  return rows.map((r) => ({ id: String(r.id), slug: r.slug, title: r.title }));
}

/**
 * Every sub-category, with its parent category's slug — the second
 * dropdown on the "Add product" form filters this list by the chosen
 * category. Flattens the staff nested-categories route (every category,
 * active or not, each with its subcategories inlined) rather than one
 * request per category.
 */
export async function listSubcategories(token: string | null): Promise<ProductSubcategory[]> {
  const groups = await api.get<
    { id: number; slug: string; isActive: boolean; subcategories: { id: number; label: string }[] }[]
  >('/v1/staff/catalogue/categories', token);
  return groups
    .filter((c) => c.isActive)
    .flatMap((c) => c.subcategories.map((s) => ({ id: String(s.id), categorySlug: c.slug, label: s.label })));
}

/** Every registered brand — the "Add product" form's Brand field picks
 *  from this instead of free text, so the same brand reads the same way
 *  twice. */
export async function listBrands(token: string | null): Promise<Brand[]> {
  const rows = await api.get<{ id: number; name: string }[]>('/v1/staff/catalogue/brands', token);
  return rows.map((r) => ({ id: String(r.id), name: r.name }));
}

/** Registers a new brand (or returns the existing one — matched
 *  case-insensitively, so "Cetaphil" typed twice is one brand, not two). */
export async function createBrand(name: string, token: string | null): Promise<Brand> {
  const r = await api.post<{ id: number; name: string }>('/v1/staff/catalogue/brands', { name }, token);
  return { id: String(r.id), name: r.name };
}

/** Removes a brand from the list. Products keep their brand text as-is. */
export async function deleteBrand(id: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/catalogue/brands/${id}`, token);
}

/** Renames a registered brand. Existing products keep whatever brand text
 *  they were saved with. */
export async function renameBrand(id: string, name: string, token: string | null): Promise<Brand> {
  const r = await api.patch<{ id: number; name: string }>(`/v1/staff/catalogue/brands/${id}`, { name }, token);
  return { id: String(r.id), name: r.name };
}

/**
 * Adds a product to the catalogue under the chosen category. Available to
 * the app and the web console the moment it is written. Returns the new id.
 */
export async function createProduct(p: NewProduct, token: string | null): Promise<string> {
  const r = await api.post<{ id: number }>('/v1/staff/catalogue/products', p, token);
  return String(r.id);
}

/**
 * The detail-page content for a product, or `null` when none has been
 * entered.
 */
export async function getProductDetail(
  id: string,
  token: string | null,
): Promise<(ProductDetailInput & { hasDetail: boolean; extraImages: string[] }) | null> {
  const r = await api.get<{
    form: string;
    manufacturer: string;
    description: string;
    ingredients: string;
    storage: string;
    highlights: string;
    benefits: string;
    directions: string;
    safety: string;
    faqs: ProductFaqInput[];
    hasDetail: boolean;
    extraImages: string[];
  } | null>(`/v1/staff/catalogue/products/${id}/detail`, token);
  return r;
}

/** Removes a product from the catalogue. Order lines keep their text copy. */
export async function deleteProduct(id: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/catalogue/products/${id}`, token);
}

export async function setProductStatus(id: string, status: ProductStatus, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/catalogue/products/${id}/status`, { status }, token);
}

export async function updateProduct(
  id: string,
  patch: { price: number; stockQuantity: number },
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/catalogue/products/${id}`, patch, token);
}

/**
 * Rewrites every admin-editable field of a product (the "Edit" page) —
 * core fields plus the detail page, FAQs and image gallery. Home-feed
 * flags and status are carried through unchanged from the form's values.
 */
export async function updateProductFull(id: string, p: NewProduct, token: string | null): Promise<void> {
  await api.put(`/v1/staff/catalogue/products/${id}`, p, token);
}

/**
 * Sets which home-feed rows a product appears in — "Popular Items",
 * "Deals You Love", "Offer of the Day". The app picks the change up on its
 * next catalogue load.
 */
export async function updateProductSections(
  id: string,
  sections: { isPopular: boolean; isDeal: boolean; isOfferOfDay: boolean },
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/catalogue/products/${id}/sections`, sections, token);
}
