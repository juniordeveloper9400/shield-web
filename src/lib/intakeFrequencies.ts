/**
 * Standard dosing-frequency shorthand a reviewer can pick from a dropdown
 * instead of remembering it, same idea as the Type dropdown.
 *
 * Every entry here fills Intake, and only Intake -- intakeCode is the
 * three-digit code it writes (once/twice/three-times daily, one digit per
 * dose). Four-times-daily, bedtime-only and interval-based frequencies
 * (every 4/6/8/12 hours) don't fit that three-slot shape at all, so they
 * live in Route & time instead (see routeTimes.ts) -- picking one of those
 * sets that field, and only that field, the same way one of these sets
 * Intake and only Intake. Neither list writes into the other's field.
 */
export interface FrequencyPreset {
  /** The clinical shorthand, e.g. "BD" — shown in the dropdown. */
  code: string;
  description: string;
  /** The three-digit Intake code this fills. A custom addition uses
   *  whatever the reviewer typed as the code itself, verbatim. */
  intakeCode: string | null;
}

export const INTAKE_FREQUENCIES: FrequencyPreset[] = [
  { code: 'OD — morning (1-0-0)', description: 'Once daily', intakeCode: '100' },
  { code: 'OD — afternoon (0-1-0)', description: 'Once daily', intakeCode: '010' },
  { code: 'OD — night (0-0-1)', description: 'Once daily', intakeCode: '001' },
  { code: 'BD / BID (1-0-1)', description: 'Twice daily', intakeCode: '101' },
  { code: 'TDS / TID (1-1-1)', description: 'Three times daily', intakeCode: '111' },
];

const STORAGE_KEY = 'shield-console-custom-intake-frequencies';

/** Frequencies a reviewer has added on top of the list above, kept in this
 *  browser's `localStorage`. A custom entry's code IS the Intake value it
 *  writes -- this list only ever fills Intake, so there's nowhere else for
 *  a typed addition to go. */
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
        intakeCode: String(v.code),
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
    { code: trimmedCode, description: description.trim(), intakeCode: trimmedCode },
  ];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full -- still works for this session via
    // component state, just won't be remembered next time.
  }
  return next;
}
