import assert from 'node:assert/strict';
import test from 'node:test';
import { ROLE_PERMISSIONS, STORE_BOUND_ROLES, canAccess, scopeToStore } from '../src/config/permissions.ts';

const rows = [
  { id: '1', storeCode: 'SHD-TIR' },
  { id: '2', storeCode: 'SHD-PON' },
  { id: '3', storeCode: '' },
];

test('scopeToStore narrows to the signed-in admin\'s own store for pharmacy and lab_technician', () => {
  for (const role of ['pharmacy', 'lab_technician']) {
    const scoped = scopeToStore(rows, { role, storeCode: 'SHD-TIR' });
    assert.deepEqual(scoped.map((r) => r.id), ['1']);
  }
});

test('scopeToStore leaves every row alone for a role it does not narrow by, delivery included', () => {
  // delivery carries a storeCode too (STORE_BOUND_ROLES), but scopeToStore
  // deliberately doesn't touch it — see that list's own doc.
  assert.deepEqual(scopeToStore(rows, { role: 'superadmin', storeCode: undefined }), rows);
  assert.deepEqual(scopeToStore(rows, { role: 'lab', storeCode: undefined }), rows);
  assert.deepEqual(scopeToStore(rows, { role: 'delivery', storeCode: 'SHD-TIR' }), rows);
  assert.deepEqual(scopeToStore(rows, null), rows);
});

test('scopeToStore leaves every row alone for a store-bound role with no store assigned yet', () => {
  assert.deepEqual(scopeToStore(rows, { role: 'lab_technician', storeCode: undefined }), rows);
});

test('a Lab Technician can open Lab Orders, Lab Bills and the dashboard, nothing else', () => {
  assert.equal(canAccess('lab_technician', 'lab_orders'), true);
  assert.equal(canAccess('lab_technician', 'lab_bills'), true);
  assert.equal(canAccess('lab_technician', 'dashboard'), true);
  assert.equal(canAccess('lab_technician', 'stores'), false);
  assert.equal(canAccess('lab_technician', 'lab_tests'), false);
  assert.equal(canAccess('lab_technician', 'orders'), false);
});

test('Lab Admin can also open Lab Bills, same as Lab Technician', () => {
  assert.equal(canAccess('lab', 'lab_bills'), true);
});

test('Pharmacy can open the redacted Lab Orders view, but not Lab Bills — that stays lab-only', () => {
  assert.equal(canAccess('pharmacy', 'lab_orders'), true);
  assert.equal(canAccess('pharmacy', 'lab_bills'), false);
});

test('every role in ROLE_PERMISSIONS has a corresponding STORE_BOUND_ROLES entry only if it actually carries a storeCode', () => {
  // Not a completeness check on every role — just pins the three roles this
  // feature cares about into the shared list, so a future edit to one
  // without the other is caught here rather than live.
  for (const role of ['pharmacy', 'delivery', 'lab_technician']) {
    assert.ok(STORE_BOUND_ROLES.includes(role), `${role} should be store-bound`);
  }
  for (const role of ['superadmin', 'admin', 'lab', 'appointments']) {
    assert.ok(!STORE_BOUND_ROLES.includes(role), `${role} should not be store-bound`);
  }
});
