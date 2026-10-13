import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveByStore, filterReserveEntries } from '../src/lib/reserveByStore.ts';

test('selecting a store limits reserve entries and totals to that store', () => {
  const entries = [e('1', 'A', 'COMPANY_SHARE', 80), e('1', 'A', 'POOL_LEFTOVER', 20), e('2', 'B', 'COMPANY_SHARE', 160), e(null, 'Unassigned', 'COMPANY_SHARE', 40)];
  const selected = filterReserveEntries(entries, '1');
  assert.deepEqual(selected, entries.slice(0, 2));
  assert.equal(reserveByStore(selected)[0].total, 100);
  assert.deepEqual(filterReserveEntries(entries, 'all'), entries);
  assert.deepEqual(filterReserveEntries(entries, 'unassigned'), [entries[3]]);
  assert.deepEqual(filterReserveEntries(entries, 'missing'), []);
});

const e = (storeId, storeName, source, amount) => ({
  storeId, storeCode: storeId ? `SHD-${storeId}` : '', storeName, source, amount,
});

test('each store gets its own company share, pool leftover and total', () => {
  const out = reserveByStore([
    e('1', 'Melattur', 'COMPANY_SHARE', 80),
    e('1', 'Melattur', 'POOL_LEFTOVER', 20),
    e('2', 'Makkaraparamba', 'COMPANY_SHARE', 160),
  ]);
  const a = out.find((s) => s.storeId === '1');
  assert.equal(a.total, 100);
  assert.equal(a.companyShare, 80);
  assert.equal(a.poolLeftover, 20);
  assert.equal(out.find((s) => s.storeId === '2').total, 160);
});

test('stores come out largest first', () => {
  const out = reserveByStore([e('1', 'A', 'COMPANY_SHARE', 10), e('2', 'B', 'COMPANY_SHARE', 500)]);
  assert.deepEqual(out.map((s) => s.storeId), ['2', '1']);
});

test('an activation with no store lands under Unassigned, not on any store', () => {
  const out = reserveByStore([e(null, 'Unassigned', 'POOL_LEFTOVER', 40), e('1', 'A', 'COMPANY_SHARE', 80)]);
  const un = out.find((s) => s.id === 'unassigned');
  assert.equal(un.total, 40);
  assert.equal(un.storeId, null);
  assert.equal(out.find((s) => s.storeId === '1').total, 80);
});

test('no entries means no stores', () => {
  assert.deepEqual(reserveByStore([]), []);
});
