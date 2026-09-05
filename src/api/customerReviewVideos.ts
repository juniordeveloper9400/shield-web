import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { CustomerReviewVideo, NewCustomerReviewVideo } from '@/types';

type Row = Record<string, unknown>;

function toVideo(r: Row): CustomerReviewVideo {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    subtitle: String(r.subtitle ?? ''),
    videoUrl: String(r.video_url ?? ''),
    thumbnail: String(r.thumbnail ?? ''),
    isActive: r.is_active === true,
    sort: num(r.sort),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

/**
 * Every clip in "What our customers have to say" — `app.customer_review_video`
 * — in display order. The console shows all of them (active and not); the
 * app and web build only ever query the active ones.
 */
export async function listCustomerReviewVideos(): Promise<CustomerReviewVideo[]> {
  const rows = (await sql`
    SELECT id, name, subtitle, video_url, thumbnail, is_active, sort, created_at
    FROM app.customer_review_video
    ORDER BY sort, id
  `) as Row[];
  return rows.map(toVideo);
}

/** Inserts a clip after the current last one unless a sort is given. */
export async function createCustomerReviewVideo(
  input: NewCustomerReviewVideo,
): Promise<string> {
  const rows = await query<Row>(
    `
    INSERT INTO app.customer_review_video
      (name, subtitle, video_url, thumbnail, is_active, sort)
    VALUES ($1, $2, $3, $4, $5,
      COALESCE($6, (SELECT COALESCE(MAX(sort), -1) + 1 FROM app.customer_review_video)))
    RETURNING id
    `,
    [
      input.name.trim(),
      input.subtitle.trim(),
      input.videoUrl.trim(),
      input.thumbnail || null,
      input.isActive,
      Number.isFinite(input.sort) ? input.sort : null,
    ],
  );
  return String(rows[0].id);
}

export async function updateCustomerReviewVideo(
  id: string,
  input: NewCustomerReviewVideo,
): Promise<void> {
  await query(
    `
    UPDATE app.customer_review_video
       SET name = $2, subtitle = $3, video_url = $4, thumbnail = $5,
           is_active = $6, sort = $7, updated_at = now()
     WHERE id = $1
    `,
    [
      id,
      input.name.trim(),
      input.subtitle.trim(),
      input.videoUrl.trim(),
      input.thumbnail || null,
      input.isActive,
      input.sort,
    ],
  );
}

export async function setCustomerReviewVideoActive(
  id: string,
  active: boolean,
): Promise<void> {
  await query(
    `UPDATE app.customer_review_video SET is_active = $2, updated_at = now() WHERE id = $1`,
    [id, active],
  );
}

export async function deleteCustomerReviewVideo(id: string): Promise<void> {
  await query(`DELETE FROM app.customer_review_video WHERE id = $1`, [id]);
}

/**
 * Swaps this clip's `sort` with the one immediately before ('up') or after
 * ('down') it in [order] — the id list the list is currently showing, already
 * sorted. A no-op at either end of the list.
 */
export async function moveCustomerReviewVideo(
  id: string,
  direction: 'up' | 'down',
  order: CustomerReviewVideo[],
): Promise<void> {
  const index = order.findIndex((v) => v.id === id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) {
    return;
  }
  const a = order[index];
  const b = order[swapWith];
  await query(`UPDATE app.customer_review_video SET sort = $2 WHERE id = $1`, [
    a.id,
    b.sort,
  ]);
  await query(`UPDATE app.customer_review_video SET sort = $2 WHERE id = $1`, [
    b.id,
    a.sort,
  ]);
}
