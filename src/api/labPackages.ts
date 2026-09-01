import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { LabPackage } from '@/types';

type Row = Record<string, unknown>;

export async function listLabPackages(): Promise<LabPackage[]> {
  const rows = (await sql`
    SELECT id, slug, name, test_count, profile_count, price, mrp, saved,
           report_in, rating, booked, for_whom, sample, is_active, created_at
    FROM app.lab_package
    ORDER BY sort, name
  `) as Row[];

  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    testCount: num(r.test_count),
    profileCount: num(r.profile_count),
    price: num(r.price),
    mrp: num(r.mrp),
    saved: num(r.saved),
    reportIn: String(r.report_in ?? ''),
    rating: String(r.rating ?? ''),
    booked: String(r.booked ?? ''),
    forWhom: String(r.for_whom ?? ''),
    sample: String(r.sample ?? ''),
    isActive: Boolean(r.is_active),
    addedAt: iso(r.created_at) ?? new Date(0).toISOString(),
  }));
}

export async function setLabPackageActive(id: string, isActive: boolean): Promise<void> {
  await query('UPDATE app.lab_package SET is_active = $2 WHERE id = $1', [id, isActive]);
}

export async function updateLabPackage(
  id: string,
  patch: { price: number; mrp: number },
): Promise<void> {
  await query(
    `UPDATE app.lab_package
        SET price = $2, mrp = $3, saved = GREATEST($3 - $2, 0)
      WHERE id = $1`,
    [id, patch.price, patch.mrp],
  );
}
