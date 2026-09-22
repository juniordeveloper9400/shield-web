import { api } from '@/lib/api';
import {
  describeUploadFailure,
  reviewVideoContentType,
  reviewVideoProblem,
  reviewVideoSource,
} from '@/lib/reviewVideo';
import type { CustomerReviewVideo, NewCustomerReviewVideo } from '@/types';

type Row = Record<string, unknown>;

function toVideo(r: Row): CustomerReviewVideo {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    subtitle: String(r.subtitle ?? ''),
    videoUrl: String(r.videoUrl ?? ''),
    thumbnail: String(r.thumbnail ?? ''),
    isActive: r.isActive === true,
    sort: Number(r.sort ?? 0),
    createdAt: String(r.createdAt ?? new Date(0).toISOString()),
  };
}

// Every write below goes through backend/api (`v1/staff/catalogue/review-
// videos*`, see `catalogue-admin.controller.ts`/`catalogue.service.ts`)
// rather than a direct Neon write. That is what actually invalidates the
// `catalogue:review-videos:active` Redis cache the app and web build read
// through (`GET /v1/public/catalogue/review-videos`, 60s TTL) — a clip added
// through a direct Neon insert here saved correctly, but the cache had no way
// to know, so it kept serving whatever it last held (up to 60s stale, or
// longer if the direct-Neon endpoint itself is unreachable from the browser,
// as `lib/db.ts`'s own doc on that trade-off explains). `listCustomerReviewVideos`
// still needs a token: unlike the app/web reads, the console's list includes
// hidden clips too (`listAllReviewVideosForStaff`), which only staff may see.

/**
 * Every clip in "What our customers have to say" — active and hidden alike,
 * in display order. The console shows all of them; the app and web build
 * only ever see the active ones, through the separate public endpoint.
 */
export async function listCustomerReviewVideos(
  token: string | null,
): Promise<CustomerReviewVideo[]> {
  const rows = await api.get<Row[]>('/v1/staff/catalogue/review-videos', token);
  return rows.map(toVideo);
}

/** Inserts a clip after the current last one unless a sort is given. */
export async function createCustomerReviewVideo(
  input: NewCustomerReviewVideo,
  token: string | null,
): Promise<string> {
  const created = await api.post<Row>(
    '/v1/staff/catalogue/review-videos',
    {
      name: input.name.trim(),
      subtitle: input.subtitle.trim(),
      videoUrl: input.videoUrl.trim(),
      thumbnail: input.thumbnail || undefined,
      isActive: input.isActive,
      sort: Number.isFinite(input.sort) ? input.sort : undefined,
    },
    token,
  );
  return String(created.id);
}

export async function updateCustomerReviewVideo(
  id: string,
  input: NewCustomerReviewVideo,
  token: string | null,
): Promise<void> {
  await api.patch(
    `/v1/staff/catalogue/review-videos/${id}`,
    {
      name: input.name.trim(),
      subtitle: input.subtitle.trim(),
      videoUrl: input.videoUrl.trim(),
      thumbnail: input.thumbnail || '',
      isActive: input.isActive,
      sort: input.sort,
    },
    token,
  );
}

export async function setCustomerReviewVideoActive(
  id: string,
  active: boolean,
  token: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/catalogue/review-videos/${id}`, { isActive: active }, token);
}

export async function deleteCustomerReviewVideo(id: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/catalogue/review-videos/${id}`, token);
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
  token: string | null,
): Promise<void> {
  const index = order.findIndex((v) => v.id === id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) {
    return;
  }
  const a = order[index];
  const b = order[swapWith];
  await api.patch(`/v1/staff/catalogue/review-videos/${a.id}`, { sort: b.sort }, token);
  await api.patch(`/v1/staff/catalogue/review-videos/${b.id}`, { sort: a.sort }, token);
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
