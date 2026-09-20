import { sql, query } from '@/lib/db';
import { api } from '@/lib/api';
import {
  describeUploadFailure,
  reviewVideoContentType,
  reviewVideoProblem,
  reviewVideoSource,
} from '@/lib/reviewVideo';
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

// ---- Uploaded video files (stored in Supabase Storage via backend/api) ------
//
// The console never holds the Supabase key. It asks backend/api (staff-only)
// for a single-use signed upload link, then sends the file straight to the
// bucket; the clip's public URL is what ends up in `video_url`.

interface UploadTicket {
  /** Single-use link that already carries its own authorization. */
  uploadUrl: string;
  publicUrl: string;
  method: 'PUT';
  /** Request headers the upload must send. */
  headers: Record<string, string>;
  /** Form fields sent in the multipart body alongside the file. */
  fields: Record<string, string>;
  expiresInSeconds: number;
}

/** Asks backend/api for a signed upload link for `file`. Throws an `ApiError`
 *  — including `STORAGE_NOT_CONFIGURED` when Supabase isn't set up and
 *  `VIDEO_TOO_LARGE` when the file is over the server's limit. */
export async function requestReviewVideoUpload(
  file: File,
  token: string,
): Promise<UploadTicket> {
  const contentType = reviewVideoContentType(file);
  if (!contentType) throw new Error(reviewVideoProblem(file) ?? 'Unsupported video.');
  return api.post<UploadTicket>(
    '/v1/staff/catalogue/review-videos/upload-url',
    { contentType, size: file.size },
    token,
  );
}

/** Sends `file` to the bucket with progress (0–1) reported as it goes. Uses
 *  XMLHttpRequest because `fetch` can't report upload progress. Aborting
 *  `signal` cancels the transfer. */
export function uploadReviewVideoFile(
  ticket: UploadTicket,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.uploadUrl);
    for (const [name, value] of Object.entries(ticket.headers)) {
      xhr.setRequestHeader(name, value);
    }
    // The body Supabase's own client sends for a signed upload: the fields,
    // then the file as the part with an empty name. The type is pinned to what
    // was validated, since a bucket can restrict which MIME types it accepts
    // and a `.mov` from some browsers reports no type at all.
    const body = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) {
      body.append(name, value);
    }
    body.append('', new Blob([file], { type: reviewVideoContentType(file) ?? file.type }));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else {
        reject(new Error(describeUploadFailure(xhr.status, xhr.responseText)));
      }
    };
    xhr.onerror = () =>
      reject(
        new Error(
          'The upload didn’t reach storage. Check your connection and try again.',
        ),
      );
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** Removes a stored clip that's no longer used — a replaced video, a deleted
 *  clip, or an upload whose row failed to save. Best-effort by design: the
 *  backend ignores any URL that isn't one of its own uploads, and a failure
 *  here only ever leaves an unreferenced file behind, so callers swallow it. */
export async function deleteStoredReviewVideo(url: string, token: string | null): Promise<void> {
  if (!token || reviewVideoSource(url) !== 'video') return;
  await api.post('/v1/staff/catalogue/review-videos/media/delete', { url }, token);
}
