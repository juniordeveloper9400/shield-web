import type { LabPackageInput } from '@/types';

/** A blank builder form — what "+ New package" opens to. */
export function blankLabPackage(): LabPackageInput {
  return {
    name: '',
    categoryId: '',
    price: 0,
    mrp: 0,
    forWhom: '',
    sample: '',
    preparation: '',
    reportIn: '',
    about: '',
    testIds: [],
  };
}

/**
 * The first thing wrong with a package about to be saved, in plain words, or
 * `null` when it's good to go — same shape as `validateLabTest`.
 */
export function validateLabPackage(input: LabPackageInput): string | null {
  if (!input.name.trim()) {
    return 'Give the package a name.';
  }
  if (input.testIds.length === 0) {
    return 'Choose at least one test to build the package from.';
  }
  if (!(input.price >= 0)) {
    return 'The price cannot be negative.';
  }
  if (!(input.mrp >= 0)) {
    return 'The MRP cannot be negative.';
  }
  return null;
}
