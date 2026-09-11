import { query } from '@/lib/db';
import { num } from '@/lib/mappers';
import type { CategoryGroupAdmin, NewCategoryGroup, NewSubcategory, SubcategoryAdmin } from '@/types';

type Row = Record<string, unknown>;

function toSubcategory(r: Row): SubcategoryAdmin {
  return {
    id: String(r.id),
    label: String(r.label ?? ''),
    iconName: String(r.icon_name ?? ''),
    image: String(r.image ?? ''),
    offer: String(r.offer ?? ''),
    sort: num(r.sort),
  };
}

function toCategoryGroup(r: Row, subcategories: SubcategoryAdmin[]): CategoryGroupAdmin {
  return {
    id: String(r.id),
    slug: String(r.slug ?? ''),
    title: String(r.title ?? ''),
    tabLabel: String(r.tab_label ?? ''),
    iconName: String(r.icon_name ?? ''),
    image: String(r.image ?? ''),
    bannerImage: String(r.banner_image ?? ''),
    panelTint: String(r.panel_tint ?? ''),
    offer: String(r.offer ?? ''),
    sort: num(r.sort),
    isActive: r.is_active === true,
    subcategories,
  };
}

/** Every category, active or not, with its sub-categories nested — the
 *  console shows everything; the app only ever reads the active ones. */
export async function listCategoryGroups(): Promise<CategoryGroupAdmin[]> {
  const categoryRows = await query<Row>(
    `SELECT id, slug, title, tab_label, icon_name, image, banner_image,
            panel_tint, offer, sort, is_active
     FROM app.product_category
     ORDER BY sort, id`,
  );
  const subRows = await query<Row>(
    `SELECT id, category_id, label, icon_name, image, offer, sort
     FROM app.product_subcategory
     ORDER BY sort, id`,
  );
  const byCategory = new Map<string, SubcategoryAdmin[]>();
  for (const r of subRows) {
    const key = String(r.category_id);
    let list = byCategory.get(key);
    if (!list) {
      list = [];
      byCategory.set(key, list);
    }
    list.push(toSubcategory(r));
  }
  return categoryRows.map((r) =>
    toCategoryGroup(r, byCategory.get(String(r.id)) ?? []),
  );
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

export async function createCategory(input: NewCategoryGroup): Promise<string | null> {
  const rows = await query<Row>(
    `INSERT INTO app.product_category
       (slug, title, tab_label, icon_name, image, banner_image, panel_tint,
        offer, sort, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [
      input.slug.trim(),
      input.title.trim(),
      input.tabLabel.trim() || input.title.trim(),
      input.iconName,
      input.image,
      input.bannerImage,
      input.panelTint,
      input.offer.trim(),
      input.sort,
      input.isActive,
    ],
  );
  return rows.length > 0 ? String(rows[0].id) : null;
}

export async function updateCategory(
  id: string,
  input: NewCategoryGroup,
): Promise<void> {
  await query(
    `UPDATE app.product_category
        SET title = $2, tab_label = $3, icon_name = $4, image = $5,
            banner_image = $6, panel_tint = $7, offer = $8, sort = $9,
            is_active = $10, updated_at = now()
      WHERE id = $1`,
    [
      id,
      input.title.trim(),
      input.tabLabel.trim() || input.title.trim(),
      input.iconName,
      input.image,
      input.bannerImage,
      input.panelTint,
      input.offer.trim(),
      input.sort,
      input.isActive,
    ],
  );
}

export async function setCategoryActive(id: string, active: boolean): Promise<void> {
  await query(`UPDATE app.product_category SET is_active = $2 WHERE id = $1`, [
    id,
    active,
  ]);
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
): Promise<void> {
  const index = order.findIndex((c) => c.id === id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) {
    return;
  }
  const a = order[index];
  const b = order[swapWith];
  await query(`UPDATE app.product_category SET sort = $2 WHERE id = $1`, [
    a.id,
    b.sort,
  ]);
  await query(`UPDATE app.product_category SET sort = $2 WHERE id = $1`, [
    b.id,
    a.sort,
  ]);
}

export async function createSubcategory(
  categoryId: string,
  input: NewSubcategory,
): Promise<string> {
  const rows = await query<Row>(
    `INSERT INTO app.product_subcategory
       (category_id, label, icon_name, image, offer, sort)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      categoryId,
      input.label.trim(),
      input.iconName,
      input.image,
      input.offer.trim(),
      input.sort,
    ],
  );
  return String(rows[0].id);
}

export async function updateSubcategory(
  id: string,
  input: NewSubcategory,
): Promise<void> {
  await query(
    `UPDATE app.product_subcategory
        SET label = $2, icon_name = $3, image = $4, offer = $5, sort = $6
      WHERE id = $1`,
    [id, input.label.trim(), input.iconName, input.image, input.offer.trim(), input.sort],
  );
}

/** Deleting a sub-category clears it from any product filed under it
 *  (`app.product.subcategory_id` is `ON DELETE SET NULL`) rather than
 *  failing. */
export async function deleteSubcategory(id: string): Promise<void> {
  await query(`DELETE FROM app.product_subcategory WHERE id = $1`, [id]);
}
