import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveByStore } from '../src/lib/reserveByStore.ts';

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
