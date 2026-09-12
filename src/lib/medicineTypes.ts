/**
 * The dosage-form options the intake card's "Type" field picks from —
 * closed enough to be a dropdown, but not fixed for good: a pharmacist can
 * add one that's missing via the "+" next to it.
 */
export const MEDICINE_TYPES: string[] = [
  'Tablet',
  'Capsule',
  'Soft Gelatin Capsule',
  'Syrup',
  'Suspension',
  'Oral Solution',
  'Oral Drops',
  'Powder',
  'Granules',
  'Sachet',
  'Effervescent Tablet',
  'Dispersible Tablet',
  'Chewable Tablet',
  'Sublingual Tablet',
  'Lozenge',
  'Mouth Dissolving Tablet',
  'Injection',
  'Infusion',
  'Cream',
  'Ointment',
  'Gel',
  'Lotion',
  'Liniment',
  'Solution',
  'Spray',
  'Patch',
  'Eye Drops',
  'Eye Ointment',
  'Ear Drops',
  'Nasal Drops',
  'Nasal Spray',
  'Inhaler',
  'Nebulizer Solution',
  'Respules',
  'Suppository',
  'Pessary / Vaginal Tablet',
  'Enema',
  'Mouthwash',
  'Gargle',
  'Dental Gel',
  'Shampoo',
  'Soap',
  'Medicated Powder',
  'Transdermal Patch',
];

const STORAGE_KEY = 'shield-console-custom-medicine-types';

/**
 * Types a reviewer has added on top of the built-in list above. There's no
 * dedicated table for this vocabulary, so it's kept in this browser's
 * `localStorage` — good enough for "the option I just added is still there
 * next time I open this", without a schema change for what is, underneath,
 * still free text (`app.prescription_medicine.pack`).
 */
export function loadCustomMedicineTypes(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Adds [type] to the saved custom list (no-op if blank or already present,
 *  built-in or custom) and returns the updated list. */
export function addCustomMedicineType(type: string): string[] {
  const trimmed = type.trim();
  const existing = loadCustomMedicineTypes();
  if (!trimmed || MEDICINE_TYPES.includes(trimmed) || existing.includes(trimmed)) {
    return existing;
  }
  const next = [...existing, trimmed];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full -- the new type still works for this session
    // via component state, it just won't be remembered next time.
  }
  return next;
}
