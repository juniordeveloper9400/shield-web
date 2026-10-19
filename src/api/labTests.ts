import { api, ApiError } from '@/lib/api';
import { num } from '@/lib/mappers';
import type {
  LabTestSource,
  LabGroupItem,
  LabSpecialRate,
  LabTest,
  LabTestInput,
  LabTestSummary,
  LabTestType,
} from '@/types';

/** `GET/POST /v1/staff/lab-tests*` sends back LabTestService's drizzle
 *  rows, camelCase, bigint ids as plain numbers and `numeric` columns as
 *  strings (same convention as every other migrated module, e.g. stores.ts). */
interface LabTestSummaryRow {
  id: number;
  lisCode: number;
  testType: LabTestType;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  description: string;
  shortName: string;
  department: string;
  method: string;
  sample: string;
  reportingTime: string;
  amount: string;
  labRate: string;
  source: LabTestSource;
  isActive: boolean;
  itemCount: number;
  showInApp: boolean;
  isMostCommon: boolean;
}

function toSummary(r: LabTestSummaryRow): LabTestSummary {
  return {
    id: String(r.id),
    lisCode: r.lisCode,
    testType: r.testType,
    name: r.name,
    categoryId: r.categoryId == null ? '' : String(r.categoryId),
    categoryName: r.categoryName ?? '',
    description: r.description ?? '',
    shortName: r.shortName,
    department: r.department,
    method: r.method,
    sample: r.sample,
    reportingTime: r.reportingTime,
    amount: num(r.amount),
    labRate: num(r.labRate),
    source: r.source,
    isActive: r.isActive,
    itemCount: r.itemCount,
    showInApp: r.showInApp,
    isMostCommon: r.isMostCommon,
  };
}

/** Every saved test, group test and package — the list under the form. */
export async function listLabTests(accessToken: string | null): Promise<LabTestSummary[]> {
  const rows = await api.get<LabTestSummaryRow[]>('/v1/staff/lab-tests', accessToken);
  return rows.map(toSummary);
}

interface LabTestRow extends Omit<LabTestInput, 'rate' | 'discountPercent' | 'amount' | 'labRate' | 'categoryId'> {
  id: number;
  lisCode: number;
  categoryId: number | null;
  rate: string;
  discountPercent: string;
  amount: string;
  labRate: string;
  source: LabTestSource;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  groupItems: { testId: number; name: string; department: string; sample: string; amount: string; setOrder: number; isSubhead: boolean }[];
  specialRates: { refLab: string; rate: string }[];
}

/** One test with everything on its tabs: group members and special rates. */
export async function getLabTest(id: string, accessToken: string | null): Promise<LabTest | null> {
  let r: LabTestRow;
  try {
    r = await api.get<LabTestRow>(`/v1/staff/lab-tests/${id}`, accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }

  const groupItems: LabGroupItem[] = r.groupItems.map((i) => ({
    testId: String(i.testId),
    name: i.name,
    department: i.department,
    sample: i.sample,
    amount: num(i.amount),
    setOrder: i.setOrder,
    isSubhead: i.isSubhead,
  }));
  const specialRates: LabSpecialRate[] = r.specialRates.map((s) => ({
    refLab: s.refLab,
    rate: num(s.rate),
  }));

  return {
    ...r,
    description: r.description ?? '',
    id: String(r.id),
    categoryId: r.categoryId == null ? '' : String(r.categoryId),
    rate: num(r.rate),
    discountPercent: num(r.discountPercent),
    amount: num(r.amount),
    labRate: num(r.labRate),
    groupItems,
    specialRates,
  };
}

/**
 * Creates ([id] null) or updates a test together with its group members and
 * special rates — one POST, atomic on the backend (LabTestService.saveLabTest's
 * own transaction). `created_by`/`updated_by` are resolved server-side from
 * the signed-in staff member, never sent from here.
 */
export async function saveLabTest(
  id: string | null,
  input: LabTestInput,
  groupItems: LabGroupItem[],
  specialRates: LabSpecialRate[],
  accessToken: string | null,
): Promise<{ id: string; lisCode: number }> {
  const body = { input, groupItems, specialRates };
  const saved = id
    ? await api.post<{ id: string; lisCode: number }>(`/v1/staff/lab-tests/${id}`, body, accessToken)
    : await api.post<{ id: string; lisCode: number }>('/v1/staff/lab-tests', body, accessToken);
  return saved;
}

/** Deletes a test (and, through the cascade, its own group rows and special
 *  rates). Refused while another group test or package still lists it. */
export async function deleteLabTest(id: string, accessToken: string | null): Promise<void> {
  await api.delete(`/v1/staff/lab-tests/${id}`, accessToken);
}

// ---- Field options: the Department/Method/Sample/… pick lists -------------

/** Matches backend/api's `LAB_TEST_FIELD_KEYS` one for one. */
export type LabTestFieldKey =
  | 'department'
  | 'method'
  | 'sample'
  | 'volume'
  | 'scheduledDays'
  | 'cutOfTime'
  | 'reportingTime'
  | 'technology'
  | 'testMode'
  | 'performAt';

export interface LabTestFieldOption {
  id: string;
  value: string;
}

/** Every field's pick list, keyed by field — what each LisCombobox below
 *  offers as suggestions, on top of whatever is being typed. */
export async function listLabTestFieldOptions(
  accessToken: string | null,
): Promise<Record<LabTestFieldKey, LabTestFieldOption[]>> {
  return api.get<Record<LabTestFieldKey, LabTestFieldOption[]>>('/v1/staff/lab-tests/field-options', accessToken);
}

/** Adds one entry to a field's pick list directly — the same value a test
 *  could already save with that field, just addable up front. */
export async function createLabTestFieldOption(
  fieldKey: LabTestFieldKey,
  value: string,
  accessToken: string | null,
): Promise<LabTestFieldOption> {
  return api.post<LabTestFieldOption>('/v1/staff/lab-tests/field-options', { fieldKey, value }, accessToken);
}

/** Renames a pick-list entry. A test that already carries the old text
 *  keeps it — only the list's own wording changes for the next test. */
export async function updateLabTestFieldOption(
  id: string,
  value: string,
  accessToken: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/lab-tests/field-options/${id}`, { value }, accessToken);
}

/** Removes one pick-list entry. Never touches a test that already used the
 *  value — it just stops being offered as a suggestion. */
export async function deleteLabTestFieldOption(id: string, accessToken: string | null): Promise<void> {
  await api.delete(`/v1/staff/lab-tests/field-options/${id}`, accessToken);
}
