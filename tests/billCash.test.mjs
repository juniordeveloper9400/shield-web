import assert from 'node:assert/strict';
import test from 'node:test';
import { cashPendingOf } from '../src/lib/billCash.ts';

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
