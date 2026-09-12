/**
 * Standard route-of-administration / timing shorthand a reviewer can pick
 * from a dropdown for Route & time -- same idea as Type and the Intake
 * preset, but this one always sets Route & time as text, and only Route &
 * time (there's no digit code for it to fit into either way).
 *
 * A few (the eye/ear drop routes) carry a "___" placeholder for a drop
 * count the source table leaves blank too -- inserted as-is; the reviewer
 * fills in the number by editing the text afterwards.
 */
export interface RoutePreset {
  /** The clinical shorthand, e.g. "SL" or "SC / SQ". */
  code: string;
  description: string;
}

export const ROUTE_TIME_PRESETS: RoutePreset[] = [
  { code: 'SL', description: 'Under the tongue' },
  { code: 'PR', description: 'Per rectum' },
  { code: 'PV', description: 'Per vagina' },
  { code: 'IV', description: 'Into a vein' },
  { code: 'IM', description: 'Into a muscle' },
  { code: 'SC / SQ', description: 'Under the skin' },
  { code: 'LA / TOP', description: 'Applied to skin' },
  { code: 'OU', description: 'Both eyes (___ drop(s))' },
  { code: 'OD', description: 'Right eye (___ drop(s))' },
  { code: 'OS', description: 'Left eye (___ drop(s))' },
  { code: 'AU', description: 'Both ears (___ drop(s))' },
  { code: 'AD', description: 'Right ear (___ drop(s))' },
  { code: 'AS', description: 'Left ear (___ drop(s))' },
  { code: 'DENT', description: 'Applied to teeth / gums' },
  { code: 'AF / AC', description: 'Before meals' },
  { code: 'BF / PC', description: 'After meals' },
  { code: 'SOS', description: 'When required / as needed' },
  { code: 'STAT', description: 'Immediately' },
  { code: 'AM', description: 'Morning' },
  { code: 'PM', description: 'Evening / night' },
  // Dosing frequencies that don't fit Intake's three-slot (morning-
  // afternoon-night) shape -- see intakeFrequencies.ts's own doc. They read
  // as "how/when to take it" just as well from here, and picking one only
  // ever sets this field.
  { code: 'QDS / QID', description: 'Four times daily' },
  { code: 'HS', description: 'At bedtime' },
  { code: 'q4h', description: 'Every 4 hours' },
  { code: 'q6h', description: 'Every 6 hours' },
  { code: 'q8h', description: 'Every 8 hours' },
  { code: 'q12h', description: 'Every 12 hours' },
];

const STORAGE_KEY = 'shield-console-custom-route-times';

/** Route/time entries a reviewer has added on top of the list above, kept
 *  in this browser's `localStorage` — same reasoning as Type and Intake
 *  frequency's own custom lists. */
export function loadCustomRouteTimes(): RoutePreset[] {
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
      .map((v) => ({ code: String(v.code), description: String(v.description ?? '') }));
  } catch {
    return [];
  }
}

export function addCustomRouteTime(
  code: string,
  description: string,
): RoutePreset[] {
  const trimmedCode = code.trim();
  const existing = loadCustomRouteTimes();
  if (
    !trimmedCode ||
    ROUTE_TIME_PRESETS.some((r) => r.code === trimmedCode) ||
    existing.some((r) => r.code === trimmedCode)
  ) {
    return existing;
  }
  const next = [...existing, { code: trimmedCode, description: description.trim() }];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full -- still works for this session via
    // component state, just won't be remembered next time.
  }
  return next;
}
