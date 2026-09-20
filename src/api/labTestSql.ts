import type { LabGroupItem, LabSpecialRate, LabTestInput } from '@/types';

/**
 * `app.lab_test` column ↔ [LabTestInput] key, in one place so the read, insert
 * and update paths cannot drift apart. The kind of each value (text, number,
 * boolean) is taken from `blankLabTest()`, so adding a field is one line here
 * plus its default there.
 */
export const LAB_TEST_FIELDS: ReadonlyArray<readonly [column: string, key: keyof LabTestInput]> = [
  ['test_type', 'testType'],
  ['name', 'name'],
  ['short_name', 'shortName'],
  ['calc_code', 'calcCode'],
  ['division', 'division'],
  ['department', 'department'],
  ['method', 'method'],
  ['unit', 'unit'],
  ['rate', 'rate'],
  ['discount_percent', 'discountPercent'],
  ['amount', 'amount'],
  ['sample', 'sample'],
  ['volume', 'volume'],
  ['cut_of_time', 'cutOfTime'],
  ['technology', 'technology'],
  ['test_mode', 'testMode'],
  ['report_on_value', 'reportOnValue'],
  ['report_on_unit', 'reportOnUnit'],
  ['perform_at', 'performAt'],
  ['internal_note', 'internalNote'],
  ['nabl_accredited', 'nablAccredited'],
  ['send_sms', 'sendSms'],
  ['sample_type_barcode', 'sampleTypeBarcode'],
  ['free_test', 'freeTest'],
  ['avoid_incentive', 'avoidIncentive'],
  ['alphanumeric_critical', 'alphanumericCritical'],
  ['common_technology', 'commonTechnology'],
  ['avoid_result_entry', 'avoidResultEntry'],
  ['hide_head', 'hideHead'],
  ['edit_test_rate', 'editTestRate'],
  ['ref1', 'ref1'],
  ['ref2', 'ref2'],
  ['specification_1', 'specification1'],
  ['specification_2', 'specification2'],
  ['specification_3', 'specification3'],
  ['result_template', 'resultTemplate'],
  ['is_active', 'isActive'],
];

/**
 * The single statement that creates ([id] null) or updates a test together
 * with its group members and special rates, and returns its `id, lis_code`.
 *
 * One statement — data-modifying CTEs — so the console's non-transactional
 * Neon client still saves the test and its rows all-or-nothing: a bad member
 * row can never leave a half-saved group behind. Members and rates are
 * upserted and the ones no longer listed deleted, rather than
 * delete-then-reinsert, because the CTEs of one statement run in no set order.
 *
 * Only a group / package keeps members; any other type clears whatever it had.
 * Pure (no database access) so it can be tested against a real Postgres.
 */
export function buildSaveStatement(
  id: string | null,
  input: LabTestInput,
  groupItems: LabGroupItem[],
  specialRates: LabSpecialRate[],
  userName: string,
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const p = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const clean = { ...input, name: input.name.trim() } as LabTestInput;
  const values = LAB_TEST_FIELDS.map(([, key]) => clean[key]);

  let head: string;
  if (id) {
    const sets = LAB_TEST_FIELDS.map(([column], i) => `${column} = ${p(values[i])}`);
    sets.push(`updated_by = ${p(userName)}`);
    head = `UPDATE app.lab_test SET ${sets.join(', ')}
             WHERE id = ${p(id)} RETURNING id, lis_code`;
  } else {
    const columns = [...LAB_TEST_FIELDS.map(([column]) => column), 'created_by', 'updated_by'];
    const placeholders = [...values.map((v) => p(v)), p(userName), p(userName)];
    head = `INSERT INTO app.lab_test (${columns.join(', ')})
            VALUES (${placeholders.join(', ')}) RETURNING id, lis_code`;
  }

  const members = input.testType === 'TEST' ? [] : groupItems;
  const itemsJson = p(
    JSON.stringify(
      members.map((item) => ({
        testId: item.testId,
        amount: item.amount,
        setOrder: item.setOrder,
        isSubhead: item.isSubhead,
      })),
    ),
  );
  const ratesJson = p(
    JSON.stringify(
      specialRates.map((rate) => ({ refLab: rate.refLab.trim(), rate: rate.rate })),
    ),
  );

  const text = `WITH t AS (${head}),
       up_items AS (
         INSERT INTO app.lab_test_group_item (group_id, test_id, amount, set_order, is_subhead)
         SELECT t.id, (x->>'testId')::bigint, (x->>'amount')::numeric,
                (x->>'setOrder')::int, (x->>'isSubhead')::boolean
           FROM t, jsonb_array_elements(${itemsJson}::jsonb) AS x
         ON CONFLICT (group_id, test_id) DO UPDATE
           SET amount = EXCLUDED.amount, set_order = EXCLUDED.set_order,
               is_subhead = EXCLUDED.is_subhead
         RETURNING id
       ),
       drop_items AS (
         DELETE FROM app.lab_test_group_item
          WHERE group_id = (SELECT id FROM t)
            AND test_id NOT IN (
              SELECT (x->>'testId')::bigint FROM jsonb_array_elements(${itemsJson}::jsonb) AS x)
         RETURNING id
       ),
       up_rates AS (
         INSERT INTO app.lab_test_special_rate (test_id, ref_lab, rate)
         SELECT t.id, x->>'refLab', (x->>'rate')::numeric
           FROM t, jsonb_array_elements(${ratesJson}::jsonb) AS x
         ON CONFLICT (test_id, ref_lab) DO UPDATE SET rate = EXCLUDED.rate
         RETURNING id
       ),
       drop_rates AS (
         DELETE FROM app.lab_test_special_rate
          WHERE test_id = (SELECT id FROM t)
            AND ref_lab NOT IN (
              SELECT x->>'refLab' FROM jsonb_array_elements(${ratesJson}::jsonb) AS x)
         RETURNING id
       )
       SELECT id, lis_code FROM t`;

  return { text, params };
}
