import assert from 'node:assert/strict';
import test from 'node:test';
import { cashPendingOf, billProgress, receiveHeading } from '../src/lib/billCash.ts';

test('an uncollected bill owes its whole amount in cash', () => {
  assert.equal(cashPendingOf({ billAmount: 800, billWalletCollected: 0, billCashCollected: 0 }), 800);
});

test('a bill the wallet covers in full leaves nothing in cash', () => {
  assert.equal(cashPendingOf({ billAmount: 800, billWalletCollected: 800, billCashCollected: 0 }), 0);
});

test('a split bill owes only what the wallet did not cover, once the counter has taken it', () => {
  assert.equal(cashPendingOf({ billAmount: 800, billWalletCollected: 300, billCashCollected: 500 }), 0);
  assert.equal(cashPendingOf({ billAmount: 800, billWalletCollected: 300, billCashCollected: 0 }), 500);
});

test('an overpayment never reads as negative cash', () => {
  assert.equal(cashPendingOf({ billAmount: 100, billWalletCollected: 100, billCashCollected: 20 }), 0);
});

const order = (over) => ({
  billStatus: 'pending', billLines: [], billableItemNames: [], ...over,
});

test('bill progress: nothing billed is pending, all billable items billed is billed', () => {
  assert.equal(billProgress(order({})), 'pending');
  assert.equal(
    billProgress(order({ billLines: [{ name: 'A' }], billableItemNames: ['a'] })),
    'billed',
  );
});

test('bill progress: some but not all billable items billed is partial', () => {
  assert.equal(
    billProgress(order({ billLines: [{ name: 'A' }], billableItemNames: ['A', 'B'] })),
    'partial',
  );
});

test('the receive heading reads Completed once paid, whatever the items say', () => {
  assert.equal(receiveHeading(order({ billStatus: 'paid' })), 'Completed');
  assert.equal(
    receiveHeading(order({ billStatus: 'paid', billLines: [{ name: 'A' }], billableItemNames: ['A', 'B'] })),
    'Completed',
  );
});

test('the receive heading reads Partially billed for an unpaid partial bill, else Pending', () => {
  assert.equal(
    receiveHeading(order({ billLines: [{ name: 'A' }], billableItemNames: ['A', 'B'] })),
    'Partially billed',
  );
  assert.equal(receiveHeading(order({})), 'Pending');
});

import { isSelectedForBill } from '../src/lib/billCash.ts';

test('a standard order item is selected for the bill only when stock is available', () => {
  assert.equal(isSelectedForBill('standard', 'available'), true);
  assert.equal(isSelectedForBill('standard', 'out_of_stock'), false);
  assert.equal(isSelectedForBill('standard', 'not_possible'), false);
});

test('a prescription medicine is selected unless the counter marked it not possible', () => {
  assert.equal(isSelectedForBill('prescription', 'available'), true);
  assert.equal(isSelectedForBill('prescription', 'out_of_stock'), true);
  assert.equal(isSelectedForBill('prescription', 'not_possible'), false);
});
