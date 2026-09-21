import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { LabPackage, LabPackageInput, LabTestPickerRow } from '@/types';

type Row = Record<string, unknown>;

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function listLabPackages(): Promise<LabPackage[]> {
  const rows = (await sql`
    SELECT id, slug, name, category_id, test_count, profile_count, price, mrp, saved,
           report_in, rating, booked, for_whom, sample, preparation, about, is_active, created_at
    FROM app.lab_package
    ORDER BY sort, name
  `) as Row[];

  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    categoryId: r.category_id == null ? '' : String(r.category_id),
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
    preparation: String(r.preparation ?? ''),
    about: String(r.about ?? ''),
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

/** Every active, single (TEST-kind) test the package builder can offer —
 *  never a group test or an existing package, so a package can't nest
 *  another package inside itself. */
export async function listLabTestsForPicker(): Promise<LabTestPickerRow[]> {
  const rows = await query<Row>(
    `SELECT id, lis_code, name, department, sample, amount
       FROM app.lab_test
      WHERE test_type = 'TEST' AND is_active = true
      ORDER BY name`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    lisCode: num(r.lis_code),
    name: String(r.name),
    department: String(r.department ?? ''),
    sample: String(r.sample ?? ''),
    amount: num(r.amount),
  }));
}

/** The real `app.lab_test` rows [packageId] was built from, oldest choice
 *  first — what the builder preloads its picker with when re-opened. Empty
 *  for a package seeded before migration 0055 (it has profiles, just no
 *  link back to a real test row). */
export async function getLabPackageTestIds(packageId: string): Promise<string[]> {
  const rows = await query<{ test_id: unknown }>(
    `SELECT test_id FROM app.lab_package_test_item WHERE package_id = $1 ORDER BY sort`,
    [packageId],
  );
  return rows.map((r) => String(r.test_id));
}

/** A unique slug for a new package: [base], or [base]-2, -3, … the first one
 *  not already taken. Existing packages are re-read each attempt so two
 *  saves racing each other still can't both win the same slug — the same
 *  guard `app.lab_package.slug`'s own `UNIQUE` constraint enforces either way. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'package';
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const [{ taken }] = await query<{ taken: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM app.lab_package WHERE slug = $1) AS taken`,
      [candidate],
    );
    if (!taken) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Writes [input]'s tests as both the real link (`lab_package_test_item`) and,
 * derived from the same chosen tests, the free-text `lab_profile` rows the
 * app's own package card already renders — so a builder-made package needs
 * no changes on either Flutter app's side to show up correctly. Replaces
 * whatever the package held before, deleting rows for tests no longer chosen.
 */
async function writePackageTests(packageId: string, testIds: string[]): Promise<void> {
  await query('DELETE FROM app.lab_package_test_item WHERE package_id = $1', [packageId]);
  await query('DELETE FROM app.lab_profile WHERE lab_package_id = $1', [packageId]);
  if (testIds.length === 0) return;

  const tests = await query<Row>(
    `SELECT id, name FROM app.lab_test WHERE id = ANY($1::bigint[])`,
    [testIds],
  );
  const nameById = new Map(tests.map((t) => [String(t.id), String(t.name)]));

  for (const [index, testId] of testIds.entries()) {
    await query(
      `INSERT INTO app.lab_package_test_item (package_id, test_id, sort) VALUES ($1, $2, $3)`,
      [packageId, testId, index],
    );
    await query(
      `INSERT INTO app.lab_profile (lab_package_id, name, parameters, sort)
       VALUES ($1, $2, 1, $3)`,
      [packageId, nameById.get(testId) ?? 'Test', index],
    );
  }
}

/** Creates a new member-bookable package from the builder: pricing, an
 *  optional category, and the real tests it's made of. Returns the new
 *  package's id. */
export async function createLabPackage(input: LabPackageInput): Promise<string> {
  const slug = await uniqueSlug(input.name);
  const saved = Math.max(input.mrp - input.price, 0);
  const rows = await query<Row>(
    `INSERT INTO app.lab_package (
       slug, name, category_id, test_count, profile_count,
       price, mrp, saved, for_whom, sample, preparation, report_in, about
     )
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      slug,
      input.name.trim(),
      input.categoryId || null,
      input.testIds.length,
      input.price,
      input.mrp,
      saved,
      input.forWhom,
      input.sample,
      input.preparation,
      input.reportIn,
      input.about,
    ],
  );
  const id = String(rows[0].id);
  await writePackageTests(id, input.testIds);
  return id;
}

/**
 * Updates an existing builder-made (or seeded) package's fields. `test_count`
 * / `profile_count` and the underlying `lab_package_test_item` / `lab_profile`
 * rows are only touched when [testsChanged] — a package seeded before
 * migration 0055 has no real test link yet ({@link getLabPackageTestIds}
 * hands the form an empty list for one), so writing those columns
 * unconditionally from [input.testIds] would zero out a seeded package's real
 * count the moment an admin only changed its price. Editing just the price,
 * category or the other fields below leaves what it's built from exactly as
 * it was.
 */
export async function updateLabPackageBuild(
  id: string,
  input: LabPackageInput,
  testsChanged: boolean,
): Promise<void> {
  const saved = Math.max(input.mrp - input.price, 0);
  await query(
    `UPDATE app.lab_package
        SET name = $2, category_id = $3,
            price = $4, mrp = $5, saved = $6,
            for_whom = $7, sample = $8, preparation = $9, report_in = $10, about = $11
      WHERE id = $1`,
    [
      id,
      input.name.trim(),
      input.categoryId || null,
      input.price,
      input.mrp,
      saved,
      input.forWhom,
      input.sample,
      input.preparation,
      input.reportIn,
      input.about,
    ],
  );
  if (testsChanged) {
    await query(
      `UPDATE app.lab_package SET test_count = $2, profile_count = $2 WHERE id = $1`,
      [id, input.testIds.length],
    );
    await writePackageTests(id, input.testIds);
  }
}
