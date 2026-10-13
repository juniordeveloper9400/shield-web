import { api } from '@/lib/api';
import type { CategoryGroupAdmin, NewCategoryGroup, NewSubcategory, SubcategoryAdmin } from '@/types';

/** A `GET /v1/staff/catalogue/categories` subcategory row — `id`/
 *  `categoryId` come back as JSON numbers (bigint identity columns), not
 *  the string ids {@link SubcategoryAdmin}/{@link CategoryGroupAdmin} call
 *  for; mapped below, same as this module's old direct-SQL mappers did. */
interface SubcategoryApiRow {
  id: number;
  categoryId: number;
  label: string;
  iconName: string | null;
  image: string | null;
  offer: string | null;
  sort: number;
}

interface CategoryGroupApiRow {
  id: number;
  slug: string;
  title: string;
  tabLabel: string;
  iconName: string | null;
  image: string | null;
  bannerImage: string | null;
  panelTint: string | null;
  offer: string;
  sort: number;
  isActive: boolean;
  subcategories: SubcategoryApiRow[];
}

function toSubcategory(r: SubcategoryApiRow): SubcategoryAdmin {
  return {
    id: String(r.id),
    label: r.label,
    iconName: r.iconName ?? '',
    image: r.image ?? '',
    offer: r.offer ?? '',
    sort: r.sort,
  };
}

function toCategoryGroup(r: CategoryGroupApiRow): CategoryGroupAdmin {
  return {
    id: String(r.id),
    slug: r.slug,
    title: r.title,
    tabLabel: r.tabLabel,
    iconName: r.iconName ?? '',
    image: r.image ?? '',
    bannerImage: r.bannerImage ?? '',
    panelTint: r.panelTint ?? '',
    offer: r.offer,
    sort: r.sort,
    isActive: r.isActive,
    subcategories: r.subcategories.map(toSubcategory),
  };
}

/** Every category, active or not, with its sub-categories nested — the
 *  console shows everything; the app only ever reads the active ones.
 *  Reads through backend/api's staff catalogue routes now, not Neon
 *  directly. */
export async function listCategoryGroups(token: string | null): Promise<CategoryGroupAdmin[]> {
  const rows = await api.get<CategoryGroupApiRow[]>('/v1/staff/catalogue/categories', token);
  return rows.map(toCategoryGroup);
}

/** `"Skin Care"` → `"skin-care"` — a starting slug suggestion, made unique by
 *  the caller if it collides (the column is `UNIQUE`). */
export function suggestCategorySlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Null when [input]'s slug is already taken. */
export async function createCategory(input: NewCategoryGroup, token: string | null): Promise<string | null> {
  const result = await api.post<{ category: { id: number } | null }>(
    '/v1/staff/catalogue/categories',
    { ...input, slug: input.slug.trim(), title: input.title.trim(), tabLabel: input.tabLabel.trim() || input.title.trim() },
    token,
  );
  return result.category ? String(result.category.id) : null;
}

export async function updateCategory(id: string, input: NewCategoryGroup, token: string | null): Promise<void> {
  // slug is immutable server-side (the route ignores it even if sent) —
  // left out here too so nobody mistakes this for a working rename.
  const { slug: _slug, ...rest } = input;
  await api.patch(
    `/v1/staff/catalogue/categories/${id}`,
    { ...rest, title: rest.title.trim(), tabLabel: rest.tabLabel.trim() || rest.title.trim() },
    token,
  );
}

export async function setCategoryActive(id: string, active: boolean, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/catalogue/categories/${id}/active`, { isActive: active }, token);
}

/**
 * Swaps this category's `sort` with the one immediately before ('up') or
 * after ('down') it in [order] — the id list the list is currently showing,
 * already sorted. A no-op at either end.
 */
export async function moveCategory(
  id: string,
  direction: 'up' | 'down',
  order: CategoryGroupAdmin[],
  token: string | null,
): Promise<void> {
  const index = order.findIndex((c) => c.id === id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) {
    return;
  }
  const a = order[index];
  const b = order[swapWith];
  await api.patch(`/v1/staff/catalogue/categories/${a.id}/sort`, { sort: b.sort }, token);
  await api.patch(`/v1/staff/catalogue/categories/${b.id}/sort`, { sort: a.sort }, token);
}

export async function createSubcategory(
  categoryId: string,
  input: NewSubcategory,
  token: string | null,
): Promise<string> {
  const created = await api.post<{ id: number }>(
    `/v1/staff/catalogue/categories/${categoryId}/subcategories`,
    { ...input, label: input.label.trim(), offer: input.offer.trim() },
    token,
  );
  return String(created.id);
}

export async function updateSubcategory(id: string, input: NewSubcategory, token: string | null): Promise<void> {
  await api.patch(
    `/v1/staff/catalogue/subcategories/${id}`,
    { ...input, label: input.label.trim(), offer: input.offer.trim() },
    token,
  );
}

/** Deleting a sub-category clears it from any product filed under it
 *  (`app.product.subcategory_id` is `ON DELETE SET NULL`) rather than
 *  failing. */
export async function deleteSubcategory(id: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/catalogue/subcategories/${id}`, token);
}
