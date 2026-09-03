import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { NewStore, Store } from '@/types';

type Row = Record<string, unknown>;

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStore(r: Row): Store {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    area: String(r.area ?? ''),
    city: String(r.city ?? ''),
    state: String(r.state ?? ''),
    pincode: String(r.pincode ?? ''),
    phone: String(r.phone ?? ''),
    hours: String(r.hours ?? ''),
    isActive: Boolean(r.is_active),
    latitude: numOrNull(r.latitude),
    longitude: numOrNull(r.longitude),
    memberCount: num(r.member_count),
    orderCount: num(r.order_count),
    openedAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

/** Every SHIELD branch, with its live member and order counts. */
export async function listStores(): Promise<Store[]> {
  const rows = (await sql`
    SELECT s.id, s.code, s.name, s.area, s.city, s.state, s.pincode,
           s.phone, s.hours, s.is_active, s.latitude, s.longitude, s.created_at,
           (SELECT count(*) FROM app.users m
              WHERE m.home_store_id = s.id AND m.deleted_at IS NULL) AS member_count,
           (SELECT count(*) FROM app."order" o WHERE o.store_id = s.id) AS order_count
    FROM app.shield_store s
    ORDER BY s.sort, s.name
  `) as Row[];
  return rows.map(toStore);
}

export async function setStoreActive(id: string, isActive: boolean): Promise<void> {
  await query('UPDATE app.shield_store SET is_active = $2 WHERE id = $1', [id, isActive]);
}

export async function updateStore(
  id: string,
  patch: {
    name: string;
    phone: string;
    hours: string;
    area: string;
    city: string;
    state: string;
    pincode: string;
    latitude: number | null;
    longitude: number | null;
  },
): Promise<void> {
  await query(
    `UPDATE app.shield_store
       SET name = $2, phone = $3, hours = $4, area = $5, city = $6,
           state = $7, pincode = $8, latitude = $9, longitude = $10,
           updated_at = now()
     WHERE id = $1`,
    [
      id,
      patch.name,
      patch.phone,
      patch.hours,
      patch.area,
      patch.city,
      patch.state,
      patch.pincode,
      patch.latitude,
      patch.longitude,
    ],
  );
}

/**
 * Opens a new branch. Available to the customer app (APK + web) the moment it
 * is written — the app reads `app.shield_store` for its branch directory.
 * Returns the new id, or `null` when the code is already taken.
 */
export async function createStore(s: NewStore): Promise<string | null> {
  const code = s.code.trim().toUpperCase();
  const rows = await query<Row>(
    `
    INSERT INTO app.shield_store
      (code, name, area, city, state, pincode, phone, hours, is_active,
       latitude, longitude, sort)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       COALESCE((SELECT max(sort) + 1 FROM app.shield_store), 0))
    ON CONFLICT (code) DO NOTHING
    RETURNING id
    `,
    [
      code,
      s.name.trim(),
      s.area.trim(),
      s.city.trim(),
      s.state.trim(),
      s.pincode.trim(),
      s.phone.trim(),
      s.hours.trim() || '8:00 AM – 10:00 PM',
      s.isActive,
      s.latitude,
      s.longitude,
    ],
  );
  return rows.length > 0 ? String(rows[0].id) : null;
}
