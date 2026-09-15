/**
 * Standard route-of-administration / timing shorthand a reviewer can pick
 * from a dropdown for Route & time -- same idea as Type and the Intake
 * preset, but this one always sets Route & time as text, and only Route &
 * time (there's no digit code for it to fit into either way).
 *
 * The six eye/ear routes ([DROP_ROUTE_CODES]) are dosed in drops, not just
 * named by location -- the source table's own "___ (1drp,2drp......)"
 * notation says as much. This used to leave that blank as literal text for
 * the reviewer to hand-edit afterwards; nothing enforced that they actually
 * did, and a sent prescription reading just "OU" (with no drop count at
 * all) is a real dosing instruction quietly missing the one number that
 * makes it usable. [composeDropRoute] / [parseDropRoute] fold the count
 * into the stored value itself instead, so the UI can require it up front.
 */
export interface RoutePreset {
  /** The clinical shorthand, e.g. "SL" or "SC / SQ". */
  code: string;
  description: string;
}

/** The six routes dosed by drop count rather than just a fixed location. */
export const DROP_ROUTE_CODES = ['OU', 'OD', 'OS', 'AU', 'AD', 'AS'] as const;

export type DropRouteCode = (typeof DROP_ROUTE_CODES)[number];

export function isDropRouteCode(code: string): code is DropRouteCode {
  return (DROP_ROUTE_CODES as readonly string[]).includes(code);
}

/** `"OD (2 drops)"` -- what a drop route's Route & time field actually
 *  stores, so the sent instruction always names a real count. */
export function composeDropRoute(code: DropRouteCode, drops: number): string {
  return `${code} (${drops} drop${drops === 1 ? '' : 's'})`;
}

const DROP_ROUTE_PATTERN = /^(OU|OD|OS|AU|AD|AS)\s*\((\d+)\s*drops?\)$/i;

/** Reads a [composeDropRoute] string back into its route code and drop
 *  count -- an existing prescription's saved Route & time, reopened for
 *  editing, needs both to preselect the two pickers correctly. Null for
 *  anything else (every other preset, or free text a reviewer typed). */
export function parseDropRoute(
  value: string,
): { code: DropRouteCode; drops: number } | null {
  const match = DROP_ROUTE_PATTERN.exec(value.trim());
  if (!match) return null;
  const code = match[1].toUpperCase() as DropRouteCode;
  const drops = Number.parseInt(match[2], 10);
  if (!Number.isFinite(drops) || drops < 1) return null;
  return { code, drops };
}

export const ROUTE_TIME_PRESETS: RoutePreset[] = [
  { code: 'SL', description: 'Under the tongue' },
  { code: 'PR', description: 'Per rectum' },
  { code: 'PV', description: 'Per vagina' },
  { code: 'IV', description: 'Into a vein' },
  { code: 'IM', description: 'Into a muscle' },
  { code: 'SC / SQ', description: 'Under the skin' },
  { code: 'LA / TOP', description: 'Applied to skin' },
  { code: 'OU', description: 'Both eyes' },
  { code: 'OD', description: 'Right eye' },
  { code: 'OS', description: 'Left eye' },
  { code: 'AU', description: 'Both ears' },
  { code: 'AD', description: 'Right ear' },
  { code: 'AS', description: 'Left ear' },
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
