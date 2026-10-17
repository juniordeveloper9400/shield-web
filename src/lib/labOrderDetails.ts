import type { LabBooking } from '@/types';
import { fromLocalInput, toLocalInput } from './labBooking.ts';

export interface OrderPatientDraft {
  bookingPatientId?: number;
  patientId?: number;
  name: string;
  age: string;
  phone: string;
  dob: string;
  gender: string;
  relation: string;
  abhaId: string;
  addressId?: number;
  addressOverride: string;
  address?: string;
  testId?: string;
  testName?: string;
  testPrice?: string;
}

export const blankOrderPatient = (): OrderPatientDraft => ({
  name: '', age: '', phone: '', dob: '', gender: '', relation: '', abhaId: '', addressOverride: '',
});

export function labOrderDetailsDraft(booking: LabBooking) {
  return {
    contactName: booking.contactName ?? booking.memberName,
    contactPhone: booking.contactPhone ?? booking.memberPhone,
    addressPhone: booking.addressPhone,
    labPackageId: booking.labPackageId ?? '',
    storeId: booking.storeId ?? '',
    fulfillmentType: booking.fulfillmentType.toUpperCase(),
    assignedStaffId: booking.assignedStaffId,
    unitPrice: String(booking.unitPrice),
    fixCharge: String(booking.fixCharge ?? 0),
    address: booking.address,
    scheduledFor: toLocalInput(booking.scheduledFor),
    note: booking.note,
    patients: booking.patients.map((p): OrderPatientDraft => ({
      bookingPatientId: p.id ? Number(p.id) : undefined,
      patientId: p.patientId ? Number(p.patientId) : undefined,
      name: p.name, age: p.age == null ? '' : String(p.age),
      phone: p.phone ?? '', dob: p.dob ?? '', gender: p.gender ?? '', relation: p.relation ?? '', abhaId: p.abhaId ?? '',
      addressId: p.addressId ? Number(p.addressId) : undefined, addressOverride: p.addressOverride,
      address: p.address,
      testId: booking.labPackageId,
      testName: booking.packageName,
      testPrice: String(booking.unitPrice),
    })),
  };
}

export type LabOrderDetailsDraft = ReturnType<typeof labOrderDetailsDraft>;

export function validateLabOrderDetails(draft: LabOrderDetailsDraft): string | null {
  if (!draft.contactName.trim()) return 'Enter the booking contact name.';
  for (const phone of [draft.contactPhone, draft.addressPhone, ...draft.patients.map((p) => p.phone)]) {
    if (phone.trim() && !/^\d{10}$/.test(phone.trim())) return 'Phone numbers must contain 10 digits.';
  }
  if (!/^\d+$/.test(draft.labPackageId)) return 'Choose a test or package.';
  if (!/^\d+$/.test(draft.storeId)) return 'Choose a branch.';
  if (!draft.unitPrice.trim() || !Number.isFinite(Number(draft.unitPrice)) || Number(draft.unitPrice) < 0 || !/^\d+(\.\d{1,2})?$/.test(draft.unitPrice)) return 'Enter a non-negative unit price with at most two decimal places.';
  if (draft.fixCharge && (!Number.isFinite(Number(draft.fixCharge)) || Number(draft.fixCharge) < 0 || !/^\d+(\.\d{1,2})?$/.test(draft.fixCharge))) return 'Enter a non-negative fixed charge with at most two decimal places.';
  if (!draft.patients.length) return 'Add at least one patient.';
  for (const p of draft.patients) {
    if (!p.name.trim()) return 'Enter a name for every patient.';
    if (p.age && (!/^\d+$/.test(p.age) || Number(p.age) > 120)) return 'Patient age must be between 0 and 120.';
    if (p.abhaId && !/^\d{14}$/.test(p.abhaId)) return 'ABHA must contain 14 digits or be blank.';
    if (p.dob && (!Number.isFinite(Date.parse(p.dob)) || Date.parse(p.dob) > Date.now() || Number(labPatientAge(p.dob)) > 120)) return 'Enter a valid date of birth.';
  }
  if (draft.scheduledFor && !Number.isFinite(Date.parse(draft.scheduledFor))) return 'Enter a valid schedule.';
  return null;
}

export function labOrderDetailsInput(draft: LabOrderDetailsDraft) {
  return {
    contactName: draft.contactName.trim(), contactPhone: draft.contactPhone.trim(), addressPhone: draft.addressPhone.trim(),
    labPackageId: Number(draft.labPackageId), storeId: Number(draft.storeId),
    fulfillmentType: draft.fulfillmentType as 'HOME_COLLECTION' | 'STORE_VISIT',
    assignedStaffId: draft.fulfillmentType === 'HOME_COLLECTION' && draft.assignedStaffId ? Number(draft.assignedStaffId) : null,
    unitPrice: Number(draft.unitPrice), fixCharge: Number(draft.fixCharge || 0), address: draft.address.trim(),
    scheduledFor: fromLocalInput(draft.scheduledFor), note: draft.note.trim(),
    patients: draft.patients.map((p) => ({ ...p, name: p.name.trim(), age: p.age === '' ? undefined : Number(p.age), phone: p.phone.trim() })),
  };
}

export type LabOrderDetailsInput = ReturnType<typeof labOrderDetailsInput>;

export function labPatientAge(dob: string): string {
  if (!dob || !Number.isFinite(Date.parse(dob))) return '';
  const born = new Date(dob);
  const today = new Date();
  let age = today.getUTCFullYear() - born.getUTCFullYear();
  if (today.getUTCMonth() < born.getUTCMonth() || (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() < born.getUTCDate())) age--;
  return String(age);
}
