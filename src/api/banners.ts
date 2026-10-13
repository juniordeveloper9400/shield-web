import { api } from '@/lib/api';
import type { BannerPlacement, HomeBanner, NewHomeBanner } from '@/types';

/** A `GET /v1/staff/catalogue/banners` row — `id` comes back as a JSON
 *  number (the column is a bigint identity), not the string `HomeBanner.id`
 *  calls for; mapped below, the same as this module's old direct-SQL
 *  `toBanner` always did. */
interface BannerApiRow {
  id: number;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  cta: string | null;
  target: string | null;
  isActive: boolean;
  sort: number;
  createdAt: string;
}

function toBanner(r: BannerApiRow): HomeBanner {
  return {
    id: String(r.id),
    title: r.title ?? '',
    subtitle: r.subtitle ?? '',
    image: r.image ?? '',
    cta: r.cta ?? '',
    target: r.target ?? '',
    isActive: r.isActive,
    sort: r.sort,
    createdAt: r.createdAt,
  };
}

/**
 * Every banner on one placement's strip, active and not — the console's
 * own Banners page, which shows everything (the app and web build only
 * ever see the active ones, through `GET /v1/public/catalogue/banners`).
 * Reads through backend/api's staff catalogue routes now, not Neon
 * directly.
 */
export async function listBanners(placement: BannerPlacement, token: string | null): Promise<HomeBanner[]> {
  const rows = await api.get<BannerApiRow[]>(`/v1/staff/catalogue/banners?placement=${placement}`, token);
  return rows.map(toBanner);
}

/** Inserts a banner after the current last one on [placement]'s own strip,
 *  unless a sort is given. */
export async function createBanner(
  placement: BannerPlacement,
  input: NewHomeBanner,
  token: string | null,
): Promise<string> {
  const created = await api.post<{ id: number }>(
    '/v1/staff/catalogue/banners',
    { placement, ...input },
    token,
  );
  return String(created.id);
}

export async function updateBanner(id: string, input: NewHomeBanner, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/catalogue/banners/${id}`, input, token);
}

export async function setBannerActive(id: string, active: boolean, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/catalogue/banners/${id}/active`, { isActive: active }, token);
}

export async function deleteBanner(id: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/catalogue/banners/${id}`, token);
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
  token: string | null,
): Promise<void> {
  const index = order.findIndex((b) => b.id === id);
  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) {
    return;
  }
  const a = order[index];
  const b = order[swapWith];
  await api.patch(`/v1/staff/catalogue/banners/${a.id}/sort`, { sort: b.sort }, token);
  await api.patch(`/v1/staff/catalogue/banners/${b.id}/sort`, { sort: a.sort }, token);
}
