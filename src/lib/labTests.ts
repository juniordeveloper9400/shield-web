import type {
  LabGroupItem,
  LabSpecialRate,
  LabTestInput,
  LabTestType,
} from '@/types';

/** Money to two decimals, the way `numeric(12,2)` will store it. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** What the patient pays: [rate] less [discountPercent]. A blank or nonsense
 *  input is treated as 0 and the discount is held to 0–100, so the form can
 *  never show a negative amount. */
export function netAmount(rate: number, discountPercent: number): number {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const d = Number.isFinite(discountPercent)
    ? Math.min(100, Math.max(0, discountPercent))
    : 0;
  return roundMoney(r - (r * d) / 100);
}

/** The form's "Group Amount": the sum of what each member test costs inside
 *  the group. Compare it with the group's own [LabTestInput.amount] — the
 *  "Total Amount" it is actually sold at — to see the saving. */
export function groupTotal(items: Pick<LabGroupItem, 'amount'>[]): number {
  return roundMoney(
    items.reduce(
      (sum, item) =>
        sum + (Number.isFinite(item.amount) && item.amount > 0 ? item.amount : 0),
      0,
    ),
  );
}

/** The next free "Setorder" for a row appended to a group. */
export function nextSetOrder(items: Pick<LabGroupItem, 'setOrder'>[]): number {
  return items.reduce((max, item) => Math.max(max, item.setOrder), 0) + 1;
}

/** A test type that is built from other tests on the "Set Grouptest" tab. */
export function isGroupType(type: LabTestType): boolean {
  return type === 'GROUP' || type === 'PACKAGE';
}

/** What the Test Master's search box looks a test up by. */
export type LabTestSearchBy = 'name' | 'short' | 'lis';

/**
 * The tests the search box offers for [text], in the order given.
 *
 * Nothing typed offers every test, so the box can be used to browse the whole
 * master; typing narrows it — by name or short name anywhere in it, or by the
 * start of a Lis Code. It is handed every test on record, the imported rate
 * list included, never only the ones made in the console.
 */
export function searchLabTests<
  T extends { name: string; shortName: string; lisCode: number },
>(tests: T[], by: LabTestSearchBy, text: string): T[] {
  const q = text.trim().toLowerCase();
  if (!q) return tests;
  return tests.filter((t) =>
    by === 'name'
      ? t.name.toLowerCase().includes(q)
      : by === 'short'
        ? t.shortName.toLowerCase().includes(q)
        : String(t.lisCode).startsWith(q),
  );
}

export const TEST_TYPE_LABELS: Record<LabTestType, string> = {
  TEST: 'Test',
  GROUP: 'Group Test',
  PACKAGE: 'Package',
};

/** A blank form — what "New" resets to. */
export function blankLabTest(): LabTestInput {
  return {
    testType: 'TEST',
    name: '',
    categoryId: '',
    showInApp: true,
    shortName: '',
    calcCode: '',
    division: 'LAB',
    department: '',
    method: '',
    unit: '',
    rate: 0,
    discountPercent: 0,
    amount: 0,
    labRate: 0,
    sample: '',
    volume: '',
    scheduledDays: '',
    cutOfTime: '',
    reportingTime: '',
    technology: '',
    testMode: '',
    reportOnValue: 0,
    reportOnUnit: 'Minutes',
    performAt: 'In House',
    internalNote: '',
    nablAccredited: false,
    sendSms: false,
    sampleTypeBarcode: false,
    freeTest: false,
    avoidIncentive: false,
    alphanumericCritical: false,
    commonTechnology: false,
    avoidResultEntry: false,
    hideHead: false,
    editTestRate: false,
    ref1: '',
    ref2: '',
    specification1: '',
    specification2: '',
    specification3: '',
    resultTemplate: '',
    isActive: true,
  };
}

/** Just the editable fields of [source] — a saved [LabTest] carries an id,
 *  timestamps and its rows too, none of which belong in the form's state. */
export function pickInput(source: LabTestInput): LabTestInput {
  const blank = blankLabTest();
  const from = source as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(blank)) {
    out[key] = from[key];
  }
  return out as unknown as LabTestInput;
}

/**
 * The first thing wrong with a form about to be saved, in plain words, or
 * `null` when it is good to go. Checked here first so the staff member sees a
 * sentence rather than a Postgres constraint name.
 */
export function validateLabTest(
  input: LabTestInput,
  items: LabGroupItem[],
  specialRates: LabSpecialRate[],
): string | null {
  if (!input.name.trim()) {
    return 'Enter the test name.';
  }
  if (!(input.rate >= 0)) {
    return 'The rate cannot be negative.';
  }
  if (!(input.discountPercent >= 0 && input.discountPercent <= 100)) {
    return 'Disc% must be between 0 and 100.';
  }
  if (!(input.labRate >= 0)) {
    return 'The lab rate cannot be negative.';
  }
  if (!(input.reportOnValue >= 0)) {
    return 'Report On cannot be negative.';
  }

  if (isGroupType(input.testType)) {
    if (items.length === 0) {
      return `A ${TEST_TYPE_LABELS[input.testType].toLowerCase()} needs at least one test — add rows on the Set Grouptest tab.`;
    }
    const seen = new Set<string>();
    for (const item of items) {
      if (!item.testId) {
        return 'A Set Grouptest row has no test chosen — pick one or delete the row.';
      }
      if (seen.has(item.testId)) {
        return `"${item.name}" appears twice on the Set Grouptest tab.`;
      }
      seen.add(item.testId);
      if (!(item.amount >= 0)) {
        return `The amount for "${item.name}" cannot be negative.`;
      }
    }
  }

  const labs = new Set<string>();
  for (const rate of specialRates) {
    const lab = rate.refLab.trim().toLowerCase();
    if (!lab) {
      return 'A Special Rate row has no Ref Lab — fill it in or delete the row.';
    }
    if (labs.has(lab)) {
      return `"${rate.refLab.trim()}" has two Special Rate rows.`;
    }
    labs.add(lab);
    if (!(rate.rate >= 0)) {
      return `The special rate for "${rate.refLab.trim()}" cannot be negative.`;
    }
  }
  return null;
}

// Suggestions for the form's free-text dropdowns. Staff can type anything not
// listed — these only save typing the common values, and mirror what the LIS
// screens they are used to offer.
export const DIVISIONS = ['LAB'];
export const DEPARTMENTS = [
  'BIOCHEMISTRY',
  'HAEMATOLOGY',
  'CLINICAL PATHOLOGY',
  'MICROBIOLOGY',
  'SEROLOGY',
  'IMMUNOLOGY',
  'HORMONES',
  'HISTOPATHOLOGY',
  'CYTOLOGY',
  'MOLECULAR BIOLOGY',
];
export const SAMPLES = [
  'SERUM',
  'PLASMA',
  'WHOLE BLOOD',
  'URINE',
  'STOOL',
  'SPUTUM',
  'SWAB',
  'CSF',
  'BODY FLUID',
];
export const VOLUMES = ['1 ml', '2 ml', '3 ml', '5 ml', '10 ml', '50 ml'];
/** The time of day samples must reach the lab by. */
export const CUT_OFF_TIMES = ['10 am', '11 am', '12 pm', '1 pm', '2 pm', '3 pm', '4 pm'];
/** When a test is run. Anything typed is accepted, e.g. 'Tue, Thu, Sat'. */
export const SCHEDULED_DAYS = [
  'Daily',
  'Mon, Wed, Fri',
  'Tue, Thu, Sat',
  'Mon, Thu',
  'Tue, Fri',
  'Wed, Sat',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];
/** When a report is ready. */
export const REPORTING_TIMES = [
  'Same Day',
  'Next Day',
  '2nd Day',
  '3rd Day',
  '4th Day',
  '5th Day',
  '1 week',
];
export const TECHNOLOGIES = [
  'Spectrophotometry',
  'Immunoassay',
  'CLIA',
  'ELISA',
  'Electrolyte analyser',
  'Microscopy',
  'Culture',
];
export const TEST_MODES = ['Manual', 'Automated', 'Semi-automated'];
export const PERFORM_AT = ['In House', 'Outsourced'];
