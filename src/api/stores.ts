import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { Store } from '@/types';

type Row = Record<string, unknown>;

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
    memberCount: num(r.member_count),
    orderCount: num(r.order_count),
    openedAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

/** Every SHIELD branch, with its live member and order counts. */
export async function listStores(): Promise<Store[]> {
  const rows = (await sql`
    SELECT s.id, s.code, s.name, s.area, s.city, s.state, s.pincode,
           s.phone, s.hours, s.is_active, s.created_at,
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
  patch: { name: string; phone: string; hours: string; pincode: string },
): Promise<void> {
  await query(
    `UPDATE app.shield_store
       SET name = $2, phone = $3, hours = $4, pincode = $5
     WHERE id = $1`,
    [id, patch.name, patch.phone, patch.hours, patch.pincode],
  );
}
