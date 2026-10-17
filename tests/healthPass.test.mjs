import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VALIDITY_MONTHS,
  dueDayIn,
  instalmentOn,
  isActiveOn,
  isExpired,
  monthlyRedeemableOf,
  nextDueOn,
  planStateOf,
  releasedBy,
  remainingAfter,
} from '../src/lib/healthPass.ts';

// Same card the Flutter app's own wallet_carry_forward_test.dart uses —
// ₹10,992 loaded, a twelfth of which is exactly ₹916 — so these reference
// values are lifted straight from that file rather than re-derived.
const loaded = 10992;
const issuedOn = '2026-08-15';
const expiresOn = '2027-08-15';

test('a twelfth releases on the issue day, then holds until the next one', () => {
  assert.equal(releasedBy(loaded, issuedOn, new Date(2026, 7, 14)), 0);
  assert.equal(releasedBy(loaded, issuedOn, new Date(2026, 7, 15)), 916);
  assert.equal(releasedBy(loaded, issuedOn, new Date(2026, 8, 14)), 916);
  assert.equal(releasedBy(loaded, issuedOn, new Date(2026, 8, 15)), 1832);
  assert.equal(releasedBy(loaded, issuedOn, new Date(2026, 10, 15)), 3664);
});

test('releases stop after 12 instalments without exceeding what was loaded', () => {
  assert.equal(releasedBy(loaded, issuedOn, new Date(2027, 6, 15)), 10992);
  assert.equal(releasedBy(loaded, issuedOn, new Date(2028, 7, 15)), 10992);
  assert.equal(instalmentOn(issuedOn, new Date(2028, 7, 15)), VALIDITY_MONTHS);
});

test('a card issued on the 31st is clamped to the 28th in February, with no early next-month release', () => {
  const endMonthIssued = '2026-01-31';
  assert.equal(releasedBy(loaded, endMonthIssued, new Date(2026, 1, 27)), 916);
  assert.equal(releasedBy(loaded, endMonthIssued, new Date(2026, 1, 28)), 1832);
  assert.equal(releasedBy(loaded, endMonthIssued, new Date(2026, 2, 1)), 1832);
});

test('remainingAfter is what releasedBy has not yet freed, never negative', () => {
  assert.equal(remainingAfter(loaded, issuedOn, new Date(2026, 7, 15)), loaded - 916);
  assert.equal(remainingAfter(loaded, issuedOn, new Date(2028, 7, 15)), 0);
});

test('monthlyRedeemableOf floors to the nearest rupee', () => {
  assert.equal(monthlyRedeemableOf(10992), 916);
  assert.equal(monthlyRedeemableOf(10), 0);
});

test('isActiveOn is false before issue, before the due day, and after expiry', () => {
  assert.equal(isActiveOn({ issuedOn, expiresOn }, new Date(2026, 7, 1)), false); // before issue
  assert.equal(isActiveOn({ issuedOn, expiresOn }, new Date(2026, 7, 15)), true); // due day itself
  assert.equal(isActiveOn({ issuedOn, expiresOn }, new Date(2026, 8, 1)), false); // between due days
  assert.equal(isActiveOn({ issuedOn, expiresOn }, new Date(2027, 8, 16)), false); // after expiry
});

test('nextDueOn rolls to next month once this month\'s has passed', () => {
  assert.deepEqual(nextDueOn(issuedOn, new Date(2026, 7, 10)), dueDayIn(issuedOn, new Date(2026, 7, 10)));
  assert.deepEqual(nextDueOn(issuedOn, new Date(2026, 7, 20)), dueDayIn(issuedOn, new Date(2026, 8, 1)));
});

test('isExpired compares against expiresOn alone', () => {
  assert.equal(isExpired(expiresOn, new Date(2027, 7, 15)), false);
  assert.equal(isExpired(expiresOn, new Date(2027, 7, 16)), true);
});

test('planStateOf prioritizes expired, then whether the due day has come round', () => {
  assert.equal(planStateOf({ issuedOn, expiresOn }, new Date(2026, 7, 1)), 'waiting');
  assert.equal(planStateOf({ issuedOn, expiresOn }, new Date(2026, 7, 15)), 'active');
  assert.equal(planStateOf({ issuedOn, expiresOn }, new Date(2027, 7, 16)), 'expired');
});
