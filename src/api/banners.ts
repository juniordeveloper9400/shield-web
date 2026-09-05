import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { HomeBanner, NewHomeBanner } from '@/types';

type Row = Record<string, unknown>;

function toBanner(r: Row): HomeBanner {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    subtitle: String(r.subtitle ?? ''),
    image: String(r.image ?? ''),
    cta: String(r.cta ?? ''),
    target: String(r.target ?? ''),
    isActive: r.is_active === true,
    sort: num(r.sort),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

/**
 * Every home-screen banner — `app.home_banner` — in display order. The
 * console shows all of them (active and not); the app and web build only ever
 * query the active ones.
 */
export async function listBanners(): Promise<HomeBanner[]> {
  const rows = (await sql`
    SELECT id, title, subtitle, image, cta, target, is_active, sort, created_at
    FROM app.home_banner
    ORDER BY sort, id
  `) as Row[];
  return rows.map(toBanner);
}

/** Inserts a banner after the current last one unless a sort is given. */
export async function createBanner(input: NewHomeBanner): Promise<string> {
  const rows = await query<Row>(
    `
    INSERT INTO app.home_banner (title, subtitle, image, cta, target, is_active, sort)
    VALUES ($1, $2, $3, $4, $5, $6,
      COALESCE($7, (SELECT COALESCE(MAX(sort), -1) + 1 FROM app.home_banner)))
    RETURNING id
    `,
    [
      input.title.trim(),
      input.subtitle.trim(),
      input.image,
      input.cta.trim(),
      input.target.trim(),
      input.isActive,
      Number.isFinite(input.sort) ? input.sort : null,
    ],
  );
  return String(rows[0].id);
}

export async function updateBanner(
  id: string,
  input: NewHomeBanner,
): Promise<void> {
  await query(
    `
    UPDATE app.home_banner
       SET title = $2, subtitle = $3, image = $4, cta = $5, target = $6,
           is_active = $7, sort = $8
     WHERE id = $1
    `,
    [
      id,
      input.title.trim(),
      input.subtitle.trim(),
      input.image,
      input.cta.trim(),
      input.target.trim(),
      input.isActive,
      input.sort,
    ],
  );
}

export async function setBannerActive(id: string, active: boolean): Promise<void> {
  await query(`UPDATE app.home_banner SET is_active = $2 WHERE id = $1`, [
    id,
    active,
  ]);
}

export async function deleteBanner(id: string): Promise<void> {
  await query(`DELETE FROM app.home_banner WHERE id = $1`, [id]);
}

/**
 * Swaps this banner's `sort` with the one immediately before ('up') or after
 * ('down') it in [order] — the id list the list is currently showing, already
 * sorted. A no-op at either end of the list.
 */
export async function moveBanner(
  id: string,
  direction: 'up' | 'down',
  order: HomeBanner[],
): Promise<void> {
  const index = order.findIndex((b) => b.id === id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) {
    return;
  }
  const a = order[index];
  const b = order[swapWith];
  await query(`UPDATE app.home_banner SET sort = $2 WHERE id = $1`, [a.id, b.sort]);
  await query(`UPDATE app.home_banner SET sort = $2 WHERE id = $1`, [b.id, a.sort]);
}
