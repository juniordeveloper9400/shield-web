import assert from 'node:assert/strict';
import test from 'node:test';

import { orderLifecycleStatus } from '../src/lib/orderLifecycle.ts';

/** A minimal, otherwise-"nothing happened yet" order — every stage test
 *  below only overrides the handful of fields orderLifecycleStatus reads. */
function baseOrder(overrides = {}) {
  return {
    id: '1',
    code: 'SH1',
    memberId: '1',
    memberName: 'Test Member',
    memberPhone: '9000000000',
    kind: 'standard',
    status: 'processing',
    itemCount: 1,
    mrpTotal: 100,
    paidTotal: 100,
    deliveryFee: 0,
    storeId: '',
    storeCode: '',
    storeName: '',
    reviewedAt: '',
    convertedToBillAt: '',
    storeContactedAt: '',
    paymentMethod: 'cod',
    paymentMethodCode: 'COD',
    fulfillmentType: 'home_delivery',
    paymentStatus: 'pending',
    deliveryBoyId: '',
    deliveryBoyName: '',
    placedAt: '2026-01-01T00:00:00.000Z',
    lines: [],
    receipt: null,
    billImage: '',
    billedAt: '',
    billAmount: 0,
    billDiscount: 0,
    billStatus: 'pending',
    billLines: [],
    billableItemNames: [],
    ...overrides,
  };
}

test('a brand-new order reads Pending', () => {
  assert.equal(orderLifecycleStatus(baseOrder()), 'pending');
});

test('staff saving/submitting the review alone reads Processed', () => {
  assert.equal(
    orderLifecycleStatus(baseOrder({ reviewedAt: '2026-01-01T01:00:00.000Z' })),
    'processed',
  );
});

test('staff calling/WhatsApping the member alone — no review saved yet — also reads Processed', () => {
  // The exact gap this fix closes: the member's own app has always moved to
  // "Processed" the moment storeContactedAt is set, independent of
  // reviewedAt (OrderStage.derive's own `contacted` check) — the admin
  // console read only reviewedAt, so an order contacted but not yet
  // reviewed showed "Pending" here while the member already saw "Processed".
  assert.equal(
    orderLifecycleStatus(baseOrder({ storeContactedAt: '2026-01-01T01:00:00.000Z' })),
    'processed',
  );
});

test('converting to bill reads Billing even without a separate contact stamp', () => {
  assert.equal(
    orderLifecycleStatus(baseOrder({
      reviewedAt: '2026-01-01T01:00:00.000Z',
      convertedToBillAt: '2026-01-01T02:00:00.000Z',
    })),
    'billing',
  );
});

test('delivered reads Completed regardless of the other stamps', () => {
  assert.equal(
    orderLifecycleStatus(baseOrder({
      status: 'delivered',
      reviewedAt: '2026-01-01T01:00:00.000Z',
      convertedToBillAt: '2026-01-01T02:00:00.000Z',
    })),
    'completed',
  );
});

test('cancelled wins over every other stamp', () => {
  assert.equal(
    orderLifecycleStatus(baseOrder({
      status: 'cancelled',
      reviewedAt: '2026-01-01T01:00:00.000Z',
      convertedToBillAt: '2026-01-01T02:00:00.000Z',
    })),
    'cancelled',
  );
});

// The Prescriptions list reads a script's stage off its linked order, not the
// script's own `status` — which flips to "ordered" the moment it is submitted.
// A freshly submitted script must read Pending, not Completed.
import { prescriptionLifecycleStatus } from '../src/lib/orderLifecycle.ts';

function rx(overrides = {}) {
  return {
    orderStatus: 'processing',
    orderReviewedAt: '',
    orderStoreContactedAt: '',
    orderConvertedToBillAt: '',
    ...overrides,
  };
}

test('a script just submitted into an order reads Pending, not Completed', () => {
  assert.equal(prescriptionLifecycleStatus(rx()), 'pending');
});

test('a script with no linked order at all reads Pending', () => {
  assert.equal(prescriptionLifecycleStatus(rx({ orderStatus: 'processing' })), 'pending');
});

test('a script moves Processed → Billing → Completed with its order', () => {
  assert.equal(prescriptionLifecycleStatus(rx({ orderReviewedAt: '2026-10-03T06:34:00Z' })), 'processed');
  assert.equal(
    prescriptionLifecycleStatus(rx({ orderReviewedAt: '2026-10-03T06:34:00Z', orderConvertedToBillAt: '2026-10-03T06:40:00Z' })),
    'billing',
  );
  assert.equal(prescriptionLifecycleStatus(rx({ orderStatus: 'delivered' })), 'completed');
});

test('a cancelled order cancels the script too', () => {
  assert.equal(prescriptionLifecycleStatus(rx({ orderStatus: 'cancelled' })), 'cancelled');
});
