import { api } from '@/lib/api';
import type { LabCategory, NewLabCategory } from '@/types';

/** A `GET /v1/staff/lab-categories` row — `id` comes back as a JSON number
 *  (a bigint identity column), not the string {@link LabCategory.id}. */
interface LabCategoryApiRow {
  id: number;
  name: string;
  image: string | null;
  sort: number;
  isActive: boolean;
  testCount: number;
}

function toCategory(r: LabCategoryApiRow): LabCategory {
  return {
    id: String(r.id),
    name: r.name,
    image: r.image ?? '',
    sort: r.sort,
    isActive: r.isActive,
    testCount: r.testCount,
  };
}

/** Every category, active or not — the console shows all of them; the
 *  category grid in both apps only ever reads the active ones. [testCount]
 *  is a live count of active `lab_package` rows, the same figure Member
 *  packages itself would show for that category, never a stored total.
 *  Reads through backend/api's staff care routes now, not Neon directly. */
export async function listLabCategories(token: string | null): Promise<LabCategory[]> {
  const rows = await api.get<LabCategoryApiRow[]>('/v1/staff/lab-categories', token);
  return rows.map(toCategory);
}

/** Creates a category. Returns null when the name is already taken
 *  (case-insensitively), same collision contract as a lab test's own name. */
export async function createLabCategory(input: NewLabCategory, token: string | null): Promise<string | null> {
  const result = await api.post<{ category: { id: number } | null }>(
    '/v1/staff/lab-categories',
    { ...input, name: input.name.trim(), image: input.image || '' },
    token,
  );
  return result.category ? String(result.category.id) : null;
}

export async function updateLabCategory(id: string, input: NewLabCategory, token: string | null): Promise<boolean> {
  const result = await api.patch<{ category: { id: number } | null }>(
    `/v1/staff/lab-categories/${id}`,
    { ...input, name: input.name.trim(), image: input.image || '' },
    token,
  );
  return result.category !== null;
}

export async function setLabCategoryActive(id: string, isActive: boolean, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/lab-categories/${id}/active`, { isActive }, token);
}

/** Refused (throws, with a plain-English reason) while a test or a package
 *  still carries this category — same "unlink it first" contract
 *  {@link deleteLabTest} already gives for a test still used inside a group.
 *  `category_id` is `ON DELETE SET NULL`, so the database itself would not
 *  block this; the console still asks the admin to clear it deliberately
 *  rather than silently uncategorising everything under it. */
export async function deleteLabCategory(id: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/lab-categories/${id}`, token);
}

/** Moves [id] one step up or down the sort order among [rows] — swaps `sort`
 *  with its neighbour, mirroring `moveCategory` in `categoryBanners.ts`. */
export async function moveLabCategory(
  id: string,
  direction: 'up' | 'down',
  rows: LabCategory[],
  token: string | null,
): Promise<void> {
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return;
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) return;
  const a = rows[index];
  const b = rows[swapWith];
  await api.patch(`/v1/staff/lab-categories/${a.id}/sort`, { sort: b.sort }, token);
  await api.patch(`/v1/staff/lab-categories/${b.id}/sort`, { sort: a.sort }, token);
}
