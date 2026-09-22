import { query } from '@/lib/db';
import { iso, isoRequired, num } from '@/lib/mappers';
import { blankLabTest } from '@/lib/labTests';
import { buildSaveStatement, LAB_TEST_FIELDS } from './labTestSql';
import type {
  LabTestSource,
  LabGroupItem,
  LabSpecialRate,
  LabTest,
  LabTestInput,
  LabTestSummary,
  LabTestType,
} from '@/types';

type Row = Record<string, unknown>;

function toInput(r: Row): LabTestInput {
  const out: Record<string, unknown> = {};
  const blank = blankLabTest() as unknown as Record<string, unknown>;
  for (const [column, key] of LAB_TEST_FIELDS) {
    const kind = typeof blank[key];
    const value = r[column];
    out[key] =
      kind === 'number' ? num(value) : kind === 'boolean' ? Boolean(value) : String(value ?? '');
  }
  return out as unknown as LabTestInput;
}

/** Every saved test, group test and package — the list under the form. */
export async function syncAllActiveLabTests(): Promise<void> {
  const activeTests = await query<Row>(
    `SELECT id FROM app.lab_test WHERE is_active = true AND show_in_app = true`,
  );
  for (const r of activeTests) {
    try {
      await syncLabTestListing(String(r.id));
    } catch {
      // ignore individual sync errors
    }
  }
}

/** Every saved test, group test and package — the list under the form. */
export async function listLabTests(): Promise<LabTestSummary[]> {
  try {
    await syncAllActiveLabTests();
  } catch {
    // best-effort sync
  }
  const rows = await query<Row>(
    `SELECT t.id, t.lis_code, t.test_type, t.name, t.short_name, t.department,
            t.method, t.sample, t.reporting_time, t.amount, t.lab_rate, t.source, t.is_active,
            (SELECT count(*) FROM app.lab_test_group_item i
              WHERE i.group_id = t.id) AS item_count
       FROM app.lab_test t
      ORDER BY t.name`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    lisCode: num(r.lis_code),
    testType: String(r.test_type) as LabTestType,
    name: String(r.name),
    shortName: String(r.short_name ?? ''),
    department: String(r.department ?? ''),
    method: String(r.method ?? ''),
    sample: String(r.sample ?? ''),
    reportingTime: String(r.reporting_time ?? ''),
    amount: num(r.amount),
    labRate: num(r.lab_rate),
    source: String(r.source ?? 'ADMIN') as LabTestSource,
    isActive: Boolean(r.is_active),
    itemCount: num(r.item_count),
  }));
}

/** One test with everything on its tabs: group members and special rates. */
export async function getLabTest(id: string): Promise<LabTest | null> {
  const rows = await query<Row>(`SELECT * FROM app.lab_test WHERE id = $1`, [id]);
  if (rows.length === 0) return null;
  const r = rows[0];

  const itemRows = await query<Row>(
    `SELECT i.test_id, i.amount, i.set_order, i.is_subhead,
            t.name, t.department, t.sample
       FROM app.lab_test_group_item i
       JOIN app.lab_test t ON t.id = i.test_id
      WHERE i.group_id = $1
      ORDER BY i.set_order, i.id`,
    [id],
  );
  const rateRows = await query<Row>(
    `SELECT ref_lab, rate FROM app.lab_test_special_rate
      WHERE test_id = $1 ORDER BY ref_lab`,
    [id],
  );

  const groupItems: LabGroupItem[] = itemRows.map((i) => ({
    testId: String(i.test_id),
    name: String(i.name ?? ''),
    department: String(i.department ?? ''),
    sample: String(i.sample ?? ''),
    amount: num(i.amount),
    setOrder: num(i.set_order),
    isSubhead: Boolean(i.is_subhead),
  }));
  const specialRates: LabSpecialRate[] = rateRows.map((s) => ({
    refLab: String(s.ref_lab),
    rate: num(s.rate),
  }));

  return {
    ...toInput(r),
    id: String(r.id),
    lisCode: num(r.lis_code),
    source: String(r.source ?? 'ADMIN') as LabTestSource,
    createdBy: String(r.created_by ?? ''),
    updatedBy: String(r.updated_by ?? ''),
    createdAt: isoRequired(r.created_at),
    updatedAt: iso(r.updated_at) ?? isoRequired(r.created_at),
    groupItems,
    specialRates,
  };
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Keeps the member-facing listing of one test in step with the test itself
 * (migration 0056) — what "Top Profiles and Tests" in both apps reads.
 *
 * A test, group test, or package that is **active and switched on with "Show in
 * the app"** gets (or keeps) one `app.lab_package` row of its own —
 * `source_test_id` set — because that is what a member actually books
 * (`lab_booking.lab_package_id`). Its price is the test's own Amount, its MRP
 * the Rate (never below the price), its test count the number of tests inside a
 * group/package (1 for a plain test), and it inherits the test's category and
 * reporting time. Anything else — switched off or inactive — has its listing
 * switched off (never deleted, so a member's earlier booking keeps pointing at
 * something).
 */
export async function syncLabTestListing(testId: string): Promise<void> {
  const rows = await query<Row>(
    `SELECT t.id, t.test_type, t.name, t.rate, t.amount, t.category_id, t.sample,
            t.reporting_time, t.is_active, t.show_in_app,
            (SELECT count(*) FROM app.lab_test_group_item i WHERE i.group_id = t.id) AS item_count
       FROM app.lab_test t WHERE t.id = $1`,
    [testId],
  );
  const t = rows[0];
  if (!t) return;

  const listed = Boolean(t.show_in_app) && Boolean(t.is_active);
  if (!listed) {
    await query('UPDATE app.lab_package SET is_active = false WHERE source_test_id = $1', [testId]);
    return;
  }

  const name = String(t.name);
  const testCount =
    t.test_type === 'GROUP' || t.test_type === 'PACKAGE' ? Math.max(num(t.item_count), 1) : 1;
  const price = num(t.amount);
  const mrp = Math.max(num(t.rate), price);

  const base = slugify(name) || `test-${testId}`;
  const [{ taken }] = await query<{ taken: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM app.lab_package WHERE slug = $1
                     AND source_test_id IS DISTINCT FROM $2::bigint) AS taken`,
    [base, testId],
  );
  const slug = taken ? `${base}-${testId}` : base;

  const saved = await query<Row>(
    `INSERT INTO app.lab_package (
       slug, name, category_id, test_count, profile_count, price, mrp, saved,
       report_in, sample, is_active, source_test_id
     )
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, true, $10)
     ON CONFLICT (source_test_id) DO UPDATE SET
       slug = EXCLUDED.slug, name = EXCLUDED.name, category_id = EXCLUDED.category_id,
       test_count = EXCLUDED.test_count, profile_count = 1,
       price = EXCLUDED.price, mrp = EXCLUDED.mrp, saved = EXCLUDED.saved,
       report_in = EXCLUDED.report_in, sample = EXCLUDED.sample, is_active = true
     RETURNING id`,
    [
      slug,
      name,
      t.category_id ?? null,
      testCount,
      price,
      mrp,
      Math.max(mrp - price, 0),
      String(t.reporting_time ?? ''),
      String(t.sample ?? ''),
      testId,
    ],
  );
  const packageId = String(saved[0].id);

  const memberItems = await query<Row>(
    `SELECT t.name, t.department
       FROM app.lab_test_group_item i
       JOIN app.lab_test t ON t.id = i.test_id
      WHERE i.group_id = $1
      ORDER BY i.set_order, i.id`,
    [testId],
  );

  await query('DELETE FROM app.lab_profile WHERE lab_package_id = $1', [packageId]);
  if (memberItems.length > 0) {
    for (let idx = 0; idx < memberItems.length; idx++) {
      const item = memberItems[idx];
      await query(
        'INSERT INTO app.lab_profile (lab_package_id, name, parameters, sort) VALUES ($1, $2, 1, $3)',
        [packageId, String(item.name ?? ''), idx],
      );
    }
  } else {
    await query(
      'INSERT INTO app.lab_profile (lab_package_id, name, parameters, sort) VALUES ($1, $2, $3, 0)',
      [packageId, name, testCount],
    );
  }
}

/** `"A", "B" and "C"` for an error sentence. */
function quotedList(names: string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  return quoted.length <= 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** Names of the group tests / packages that list [testId] as a member. */
async function groupsUsing(testId: string): Promise<string[]> {
  const rows = await query<Row>(
    `SELECT DISTINCT g.name
       FROM app.lab_test_group_item i
       JOIN app.lab_test g ON g.id = i.group_id
      WHERE i.test_id = $1
      ORDER BY g.name
      LIMIT 5`,
    [testId],
  );
  return rows.map((r) => String(r.name));
}

/**
 * Creates ([id] null) or updates a test together with its group members and
 * special rates, and returns its id and LIS code — all in one statement, so a
 * bad member row can never leave a half-saved group behind (see
 * [buildSaveStatement]).
 */
export async function saveLabTest(
  id: string | null,
  input: LabTestInput,
  groupItems: LabGroupItem[],
  specialRates: LabSpecialRate[],
  userName: string,
): Promise<{ id: string; lisCode: number }> {
  if (id && input.testType !== 'TEST') {
    const usedIn = await groupsUsing(id);
    if (usedIn.length > 0) {
      throw new Error(
        `"${input.name.trim()}" is used inside ${quotedList(usedIn)}, so it has to stay a single Test. Remove it from there first.`,
      );
    }
  }

  const statement = buildSaveStatement(id, input, groupItems, specialRates, userName);

  try {
    const rows = await query<Row>(statement.text, statement.params);
    if (rows.length === 0) {
      throw new Error('That test no longer exists — it may have been deleted. Press New to start again.');
    }
    const savedId = String(rows[0].id);
    try {
      await syncLabTestListing(savedId);
    } catch (syncError) {
      const why = syncError instanceof Error ? syncError.message : 'unknown error';
      throw new Error(
        `"${input.name.trim()}" was saved, but its listing in the app could not be updated (${why}). Save it again to retry.`,
      );
    }
    return { id: savedId, lisCode: num(rows[0].lis_code) };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('lab_test_name_uidx')) {
      throw new Error(`A test named "${input.name.trim()}" already exists — names must be unique.`);
    }
    throw error;
  }
}

/** Deletes a test (and, through the cascade, its own group rows and special
 *  rates). Refused while another group test or package still lists it. */
export async function deleteLabTest(id: string, name: string): Promise<void> {
  const usedIn = await groupsUsing(id);
  if (usedIn.length > 0) {
    throw new Error(
      `"${name}" is used inside ${quotedList(usedIn)}. Remove it from there before deleting it.`,
    );
  }
  try {
    await query('DELETE FROM app.lab_test WHERE id = $1', [id]);
  } catch (error) {
    if (error instanceof Error && error.message.includes('lab_package_test_item')) {
      throw new Error(
        `"${name}" is part of a package on Member packages. Remove it from that package first.`,
      );
    }
    if (error instanceof Error && error.message.includes('lab_booking')) {
      // Its app listing (source_test_id, ON DELETE CASCADE) has been booked.
      throw new Error(
        `"${name}" has been booked by a member, so it cannot be deleted. Untick "Show in the app" (or mark it inactive) to take it off the app instead.`,
      );
    }
    throw error;
  }
}
