import type { Tone } from '@/components/ui/Badge';
import type { PrescriptionMedicineStatus } from '@/types';

/** `PrescriptionMedicineStatus` — a pharmacist-only note on each medicine
 *  line, changeable any time it's edited; never shown in the member's app.
 *  Shared between `PrescriptionReviewModal` (where it's set) and
 *  `BillEditorModal` (where a prescription's medicines are grouped by it
 *  when offered as bill-line candidates), so the two can never label the
 *  same status differently. */
export const STOCK_STATUS_LABEL: Record<PrescriptionMedicineStatus, string> = {
  available: 'Stock available',
  out_of_stock: 'Out of stock',
  not_possible: 'Not possible',
};

export const STOCK_STATUS_TONE: Record<PrescriptionMedicineStatus, Tone> = {
  available: 'green',
  out_of_stock: 'amber',
  not_possible: 'red',
};

export const STOCK_STATUS_OPTIONS = (
  Object.keys(STOCK_STATUS_LABEL) as PrescriptionMedicineStatus[]
).map((value) => ({ value, label: STOCK_STATUS_LABEL[value] }));
