/**
 * Standard dosing-frequency shorthand a reviewer can pick from a dropdown
 * instead of remembering it — same idea as the Type dropdown, but Intake's
 * three digits (morning-afternoon-night) can't represent all of them.
 *
 * `intakeCode` is the three-digit code to fill Intake with when the
 * frequency fits that shape (once/twice/three-times daily — one digit per
 * dose). Four-times-daily, bedtime-only and interval-based ones (every 4/6/
 * 8/12 hours) don't fit three slots at all, so picking one of those fills
 * Route & time instead, as free text — it says how/when to take it just as
 * well, and doesn't force a made-up digit pattern onto a code that means
 * something different.
 */
export interface FrequencyPreset {
  /** The clinical shorthand, e.g. "BD" — shown in the dropdown and used as
   *  the Route & time text for anything that doesn't fit Intake. */
  code: string;
  description: string;
  /** The three-digit Intake code this fills, or null when the frequency
   *  doesn't fit the morning-afternoon-night shape (goes to Route & time
   *  instead). */
  intakeCode: string | null;
}

export const INTAKE_FREQUENCIES: FrequencyPreset[] = [
  { code: 'OD — morning (1-0-0)', description: 'Once daily', intakeCode: '100' },
  { code: 'OD — afternoon (0-1-0)', description: 'Once daily', intakeCode: '010' },
  { code: 'OD — night (0-0-1)', description: 'Once daily', intakeCode: '001' },
  { code: 'BD / BID (1-0-1)', description: 'Twice daily', intakeCode: '101' },
  { code: 'TDS / TID (1-1-1)', description: 'Three times daily', intakeCode: '111' },
  { code: 'QDS / QID (1-1-1-1)', description: 'Four times daily', intakeCode: null },
  { code: 'HS', description: 'At bedtime', intakeCode: null },
  { code: 'q4h', description: 'Every 4 hours', intakeCode: null },
  { code: 'q6h', description: 'Every 6 hours', intakeCode: null },
  { code: 'q8h', description: 'Every 8 hours', intakeCode: null },
  { code: 'q12h', description: 'Every 12 hours', intakeCode: null },
];

const STORAGE_KEY = 'shield-console-custom-intake-frequencies';

/** Frequencies a reviewer has added on top of the list above, kept in this
 *  browser's `localStorage` — always routed to Route & time (a custom one
 *  can't be assumed to fit Intake's three-slot shape). */
export function loadCustomFrequencies(): FrequencyPreset[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is { code: unknown; description: unknown } =>
          typeof v === 'object' && v !== null && 'code' in v,
      )
      .map((v) => ({
        code: String(v.code),
        description: String(v.description ?? ''),
        intakeCode: null,
      }));
  } catch {
    return [];
  }
}

export function addCustomFrequency(
  code: string,
  description: string,
): FrequencyPreset[] {
  const trimmedCode = code.trim();
  const existing = loadCustomFrequencies();
  if (
    !trimmedCode ||
    INTAKE_FREQUENCIES.some((f) => f.code === trimmedCode) ||
    existing.some((f) => f.code === trimmedCode)
  ) {
    return existing;
  }
  const next = [
    ...existing,
    { code: trimmedCode, description: description.trim(), intakeCode: null },
  ];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full -- still works for this session via
    // component state, just won't be remembered next time.
  }
  return next;
}
