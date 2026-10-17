import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateKmCharge } from '../src/lib/labCharges.ts';
const note = { firstKm: 3, firstAmount: 20, secondKm: 5, secondAmount: 50, extraPerKm: 15 };
test('km charges use the note boundaries and additional started km', () => {
  for (const [km, amount] of [[1, 20], [3, 20], [3.01, 50], [5, 50], [5.01, 65], [6, 65], [6.01, 80], [8, 95]]) assert.equal(calculateKmCharge(km, note), amount);
  assert.equal(calculateKmCharge(4.4, { ...note, firstKm: 2, secondKm: 3.4 }), 65);
});
test('missing notes and invalid km do not produce a free charge', () => {
  assert.equal(calculateKmCharge(6, null), null);
  for (const km of [NaN, Infinity, -1, 0, 10001]) assert.equal(calculateKmCharge(km, note), null);
});
