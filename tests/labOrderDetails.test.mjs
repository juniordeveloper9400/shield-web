import assert from 'node:assert/strict';
import test from 'node:test';
import { labOrderDetailsDraft, labOrderDetailsInput, validateLabOrderDetails } from '../src/lib/labOrderDetails.ts';

const booking = {
  memberName: 'Original account', memberPhone: '9000011111', contactName: 'Order contact', contactPhone: '9000022222',
  addressPhone: '', labPackageId: '12', storeId: '3', fulfillmentType: 'home_collection', assignedStaffId: '5',
  unitPrice: 250.5, address: 'Collection address', scheduledFor: '', note: 'Instructions',
  patients: [{ patientId: '7', name: 'Asha', age: 30, phone: '9000033333', dob: '', gender: 'FEMALE', relation: 'SELF', abhaId: '', addressId: '8', addressOverride: '' }],
};

test('order editing preserves owned patient/address references and separates order contacts from account identity', () => {
  const draft = labOrderDetailsDraft(booking);
  draft.contactPhone = '9000099999';
  draft.fulfillmentType = 'STORE_VISIT';
  draft.patients[0].abhaId = '12345678901234';
  assert.equal(validateLabOrderDetails(draft), null);
  const input = labOrderDetailsInput(draft);
  assert.equal(input.contactPhone, '9000099999');
  assert.equal(booking.memberPhone, '9000011111');
  assert.equal(input.assignedStaffId, null);
  assert.equal(input.unitPrice, 250.5);
  assert.equal(input.patients[0].patientId, 7);
  assert.equal(input.patients[0].addressId, 8);
  assert.equal(input.patients[0].abhaId, '12345678901234');
  assert.equal('memberId' in input, false);
});

test('invalid or empty patient details are rejected instead of silently dropping a patient', () => {
  const draft = labOrderDetailsDraft(booking);
  draft.patients[0].name = '  ';
  assert.match(validateLabOrderDetails(draft), /every patient/);
  draft.patients[0].name = 'Asha';
  draft.patients[0].age = '121';
  assert.match(validateLabOrderDetails(draft), /120/);
  draft.patients[0].age = '0';
  assert.equal(validateLabOrderDetails(draft), null);
  draft.unitPrice = '-10';
  assert.match(validateLabOrderDetails(draft), /price/);
  draft.unitPrice = '12.345';
  assert.match(validateLabOrderDetails(draft), /decimal/);
});

test('a withheld test needs no test choice and is never sent back', () => {
  const draft = labOrderDetailsDraft({ ...booking, labPackageId: '', packageName: 'Test hidden', testHidden: true });
  assert.equal(validateLabOrderDetails(draft), null);
  assert.equal('labPackageId' in labOrderDetailsInput(draft), false);
  const visible = labOrderDetailsInput(labOrderDetailsDraft({ ...booking, testHidden: false }));
  assert.equal(visible.labPackageId, 12);
});
