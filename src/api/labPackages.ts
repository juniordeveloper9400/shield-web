import { api } from '@/lib/api';
import { iso, num } from '@/lib/mappers';
import type { LabPackage, LabPackageInput, LabTestPickerRow } from '@/types';

/** `GET/POST/PATCH /v1/staff/lab-packages*` sends back LabTestService's
 *  drizzle rows, camelCase, bigint ids as plain numbers and `numeric`
 *  columns as strings (same convention as every other migrated module). */
interface LabPackageRow {
  id: number;
  slug: string;
  name: string;
  categoryId: number | null;
  testCount: number;
  profileCount: number;
  price: string;
  mrp: string;
  saved: string;
  reportIn: string | null;
  rating: string | null;
  booked: string | null;
  forWhom: string | null;
  sample: string | null;
  preparation: string | null;
  fasting: string | null;
  about: string;
  isActive: boolean;
  createdAt: string;
}

function toPackage(r: LabPackageRow): LabPackage {
  return {
    id: String(r.id),
    slug: r.slug,
    name: r.name,
    categoryId: r.categoryId == null ? '' : String(r.categoryId),
    testCount: r.testCount,
    profileCount: r.profileCount,
    price: num(r.price),
    mrp: num(r.mrp),
    saved: num(r.saved),
    reportIn: r.reportIn ?? '',
    rating: r.rating ?? '',
    booked: r.booked ?? '',
    forWhom: r.forWhom ?? '',
    sample: r.sample ?? '',
    preparation: r.preparation ?? '',
    fasting: r.fasting ?? '',
    about: r.about,
    isActive: r.isActive,
    addedAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  };
}

/** The real packages members can book — not the one-test listings the console
 *  keeps for tests switched on with "Show in the app" (`source_test_id` set,
 *  migration 0056); those follow their test and are edited on the Test Master. */
export async function listLabPackages(accessToken: string | null): Promise<LabPackage[]> {
  const rows = await api.get<LabPackageRow[]>('/v1/staff/lab-packages', accessToken);
  return rows.map(toPackage);
}

export async function setLabPackageActive(
  id: string,
  isActive: boolean,
  accessToken: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/lab-packages/${id}/active`, { isActive }, accessToken);
}

export async function updateLabPackage(
  id: string,
  patch: { price: number; mrp: number },
  accessToken: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/lab-packages/${id}/price`, patch, accessToken);
}

interface LabTestPickerRowApi {
  id: number;
  lisCode: number;
  testType: LabTestPickerRow['testType'];
  name: string;
  department: string;
  sample: string;
  amount: string;
  itemCount: number;
}

/** Every active test or group test the package builder can offer — never an
 *  existing package, so a package can't nest another package inside itself.
 *  A group carries [LabTestPickerRow.itemCount], the real count of tests
 *  inside it (from the Test Master's own "Set Grouptest" tab) — what lets a
 *  package built from a few named groups ("Liver Function Test",
 *  "Kidney Function Test", …) still say how many individual tests that
 *  actually adds up to. */
export async function listLabTestsForPicker(accessToken: string | null): Promise<LabTestPickerRow[]> {
  const rows = await api.get<LabTestPickerRowApi[]>('/v1/staff/lab-packages/test-picker', accessToken);
  return rows.map((r) => ({
    id: String(r.id),
    lisCode: r.lisCode,
    testType: r.testType,
    name: r.name,
    department: r.department,
    sample: r.sample,
    amount: num(r.amount),
    itemCount: r.itemCount,
  }));
}

/** The real `app.lab_test` rows [packageId] was built from, oldest choice
 *  first — what the builder preloads its picker with when re-opened. Empty
 *  for a package seeded before migration 0055 (it has profiles, just no
 *  link back to a real test row). */
export async function getLabPackageTestIds(packageId: string, accessToken: string | null): Promise<string[]> {
  return api.get<string[]>(`/v1/staff/lab-packages/${packageId}/test-ids`, accessToken);
}

/** Creates a new member-bookable package from the builder: pricing, an
 *  optional category, and the real tests (or groups) it's made of. Returns
 *  the new package's id. */
export async function createLabPackage(input: LabPackageInput, accessToken: string | null): Promise<string> {
  const { id } = await api.post<{ id: string }>('/v1/staff/lab-packages', input, accessToken);
  return id;
}

/**
 * Updates an existing builder-made (or seeded) package's fields. `test_count`
 * / `profile_count` and the underlying test link are only touched when
 * [testsChanged] — a package seeded before migration 0055 has no real test
 * link yet, so writing those columns unconditionally would zero out a
 * seeded package's real count the moment an admin only changed its price.
 */
export async function updateLabPackageBuild(
  id: string,
  input: LabPackageInput,
  testsChanged: boolean,
  accessToken: string | null,
): Promise<void> {
  await api.patch(`/v1/staff/lab-packages/${id}`, { input, testsChanged }, accessToken);
}
