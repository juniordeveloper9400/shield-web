import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlyBalanceOf, redeemedThisMonth, availablePlanAllowance } from '../src/lib/walletMonth.ts';

test('unused allowance carries forward and earlier spending cannot be reused', () => {
  const cards = [{ loaded: 11000, issuedOn: '2026-08-15' }];
  const entries = [{ kind: 'SPEND', amount: -400, occurredOn: '2026-08-20' }];
  assert.equal(availablePlanAllowance(cards, entries, new Date(2026, 8, 14), 10600), 516);
  assert.equal(availablePlanAllowance(cards, entries, new Date(2026, 8, 15), 10600), 1432);
  assert.equal(availablePlanAllowance(cards, entries, new Date(2026, 8, 15), 100), 100);
});

test('commission spends do not reduce carried plan allowance', () => {
  assert.equal(availablePlanAllowance([{ loaded: 11000, issuedOn: '2026-08-15' }], [
    { kind: 'REFERRAL_EARNINGS', amount: 200, occurredOn: '2026-08-20' },
    { kind: 'SPEND', amount: -300, occurredOn: '2026-08-21' },
  ], new Date(2026, 8, 15), 10900), 1732);
});

test('month-end, future activation and final release boundaries', () => {
  const cards = [{ loaded: 11000, issuedOn: '2026-01-31' }];
  assert.equal(availablePlanAllowance(cards, [], new Date(2026, 0, 30), 11000), 0);
  assert.equal(availablePlanAllowance(cards, [], new Date(2026, 1, 28), 11000), 1832);
  assert.equal(availablePlanAllowance(cards, [], new Date(2026, 2, 1), 11000), 1832);
  assert.equal(availablePlanAllowance(cards, [], new Date(2027, 0, 31), 11000), 10992);
});

const NOW = new Date(2026, 8, 20, 16, 0); // 20 Sep 2026, local
const spend = (amount, occurredOn) => ({ kind: 'SPEND', amount: -amount, occurredOn });
const credit = (kind, amount, occurredOn) => ({ kind, amount, occurredOn });

test('nothing drawn yet', () => {
  assert.equal(redeemedThisMonth([], NOW), 0);
  assert.equal(redeemedThisMonth([credit('ACTIVATION', 11000, '2026-09-01')], NOW), 0);
});

test('counts every debit dated in the current month, and only those', () => {
  const entries = [
    spend(500, '2026-08-31'), // last month
    spend(140, '2026-09-02'),
    spend(60, '2026-09-19'),
    spend(999, '2026-10-01'), // next month, dated ahead
  ];
  assert.equal(redeemedThisMonth(entries, NOW), 200);
});

test('credits and points never count as redeemed', () => {
  const entries = [
    credit('ACTIVATION', 11000, '2026-09-01'),
    credit('BONUS', 1100, '2026-09-01'),
    credit('POINTS_REDEEMED', 50, '2026-09-10'),
    spend(100, '2026-09-11'),
  ];
  assert.equal(redeemedThisMonth(entries, NOW), 100);
});

test('commission earnings are spent first and never count against the allowance', () => {
  const entries = [credit('REFERRAL_EARNINGS', 100, '2026-09-05'), spend(140, '2026-09-06')];
  assert.equal(redeemedThisMonth(entries, NOW), 40); // 100 came from earnings
});

test('the earnings pool runs out part-way through', () => {
  const entries = [
    credit('AGENT_EARNINGS', 100, '2026-09-01'),
    spend(60, '2026-09-02'), // all from earnings
    spend(60, '2026-09-03'), // 40 left in the pool → 20 counts
  ];
  assert.equal(redeemedThisMonth(entries, NOW), 20);
});

test('earnings spent in an earlier month are still used up', () => {
  const entries = [
    credit('AGENT_EARNINGS', 100, '2026-08-10'),
    spend(100, '2026-08-11'), // uses the whole pool last month
    spend(70, '2026-09-04'), // so this one counts in full
  ];
  assert.equal(redeemedThisMonth(entries, NOW), 70);
});

test('order matters: a debit before the earnings arrive counts in full', () => {
  const entries = [spend(80, '2026-09-02'), credit('REFERRAL_EARNINGS', 500, '2026-09-03')];
  assert.equal(redeemedThisMonth(entries, NOW), 80);
});

test('the month is the calendar month, across a year boundary too', () => {
  const january = new Date(2026, 0, 5);
  const entries = [spend(300, '2025-12-30'), spend(40, '2026-01-02')];
  assert.equal(redeemedThisMonth(entries, january), 40);
});

test('monthly balance is what is left, and never negative', () => {
  assert.equal(monthlyBalanceOf(916, 0), 916);
  assert.equal(monthlyBalanceOf(916, 400), 516);
  assert.equal(monthlyBalanceOf(916, 916), 0);
  assert.equal(monthlyBalanceOf(916, 1200), 0);
  assert.equal(monthlyBalanceOf(0, 0), 0);
});
