import { query } from '@/lib/db';
import { num } from '@/lib/mappers';
import type { LabCategory, NewLabCategory } from '@/types';

type Row = Record<string, unknown>;

function toCategory(r: Row): LabCategory {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    image: String(r.image ?? ''),
    sort: num(r.sort),
    isActive: r.is_active === true,
    testCount: num(r.test_count),
  };
}

/** Every category, active or not — the console shows all of them; the
 *  category grid in both apps only ever reads the active ones. [testCount]
 *  is a live count of active `lab_package` rows, the same figure Member
 *  packages itself would show for that category, never a stored total. */
export async function listLabCategories(): Promise<LabCategory[]> {
  const rows = await query<Row>(
    `SELECT c.id, c.name, c.image, c.sort, c.is_active,
            (SELECT count(*) FROM app.lab_package p
              WHERE p.category_id = c.id AND p.is_active = true) AS test_count
       FROM app.lab_category c
      ORDER BY c.sort, c.name`,
  );
  return rows.map(toCategory);
}

/** Creates a category. Returns null when the name is already taken
 *  (case-insensitively), same collision contract as a lab test's own name. */
export async function createLabCategory(input: NewLabCategory): Promise<string | null> {
  try {
    const rows = await query<Row>(
      `INSERT INTO app.lab_category (name, image, sort, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.name.trim(), input.image || null, input.sort, input.isActive],
    );
    return String(rows[0].id);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('lab_category_name_uidx')) return null;
    throw error;
  }
}

export async function updateLabCategory(id: string, input: NewLabCategory): Promise<boolean> {
  try {
    await query(
      `UPDATE app.lab_category SET name = $2, image = $3, sort = $4, is_active = $5
        WHERE id = $1`,
      [id, input.name.trim(), input.image || null, input.sort, input.isActive],
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('lab_category_name_uidx')) return false;
    throw error;
  }
}

export async function setLabCategoryActive(id: string, isActive: boolean): Promise<void> {
  await query('UPDATE app.lab_category SET is_active = $2 WHERE id = $1', [id, isActive]);
}

/** Refused (throws, with a plain-English reason) while a test or a package
 *  still carries this category — same "unlink it first" contract
 *  {@link deleteLabTest} already gives for a test still used inside a group.
 *  `category_id` is `ON DELETE SET NULL`, so the database itself would not
 *  block this; the console still asks the admin to clear it deliberately
 *  rather than silently uncategorising everything under it. */
export async function deleteLabCategory(id: string, name: string): Promise<void> {
  const [{ n }] = await query<{ n: number }>(
    `SELECT (
       (SELECT count(*) FROM app.lab_test WHERE category_id = $1) +
       (SELECT count(*) FROM app.lab_package WHERE category_id = $1)
     )::int AS n`,
    [id],
  );
  if (Number(n) > 0) {
    throw new Error(
      `"${name}" is still set on ${n} test${Number(n) === 1 ? '' : 's'}/package${Number(n) === 1 ? '' : 's'} — change their category before deleting it.`,
    );
  }
  await query('DELETE FROM app.lab_category WHERE id = $1', [id]);
}

/** Moves [id] one step up or down the sort order among [rows] — swaps `sort`
 *  with its neighbour, mirroring `moveCategory` in `categoryBanners.ts`. */
export async function moveLabCategory(
  id: string,
  direction: 'up' | 'down',
  rows: LabCategory[],
): Promise<void> {
  const index = rows.findIndex((r) => r.id === id);
  if (index === -1) return;
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) return;
  const a = rows[index];
  const b = rows[swapWith];
  await query('UPDATE app.lab_category SET sort = $2 WHERE id = $1', [a.id, b.sort]);
  await query('UPDATE app.lab_category SET sort = $2 WHERE id = $1', [b.id, a.sort]);
}
