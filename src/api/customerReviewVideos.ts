import { api } from '@/lib/api';
import type { ReviewVideoUploadTransport } from '@/lib/reviewVideoUpload';
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

// ---- Uploaded video bytes (stored in Neon Postgres via backend/api) --------
//
// The clip's video is not sent as one request: `uploadReviewVideo`
// (lib/reviewVideoUpload.ts) splits it into 786432-byte chunks and drives
// this transport through create -> chunks -> complete. The console never
// deletes an old clip's media itself on replace or delete — backend/api's
// `updateReviewVideo`/`deleteReviewVideo` already do that server-side, the
// moment the metadata write that made the old media unreferenced succeeds.
// `discard` here is for the one case that is still this console's to handle:
// a media upload that completed but the metadata save that would have used
// it failed, leaving it referenced by nothing.

/** A `ReviewVideoUploadTransport` (see lib/reviewVideoUpload.ts) backed by
 *  backend/api's `/v1/staff/catalogue/review-video-media` routes. */
export function reviewVideoMediaTransport(token: string): ReviewVideoUploadTransport {
  return {
    create: (input) => api.post('/v1/staff/catalogue/review-video-media', input, token),
    status: (id) => api.get(`/v1/staff/catalogue/review-video-media/${id}`, token),
    putChunk: (id, index, data) =>
      api.put(`/v1/staff/catalogue/review-video-media/${id}/chunks/${index}`, { data }, token),
    complete: (id) => api.post(`/v1/staff/catalogue/review-video-media/${id}/complete`, undefined, token),
    discard: async (id) => {
      await api.delete(`/v1/staff/catalogue/review-video-media/${id}`, token);
    },
  };
}
