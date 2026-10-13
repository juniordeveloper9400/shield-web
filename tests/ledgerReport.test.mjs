import assert from 'node:assert/strict';
import test from 'node:test';
import { movementBalance, ledgerReportCsv } from '../src/lib/ledgerReport.ts';

test('monthly debit and credit movements show a positive amount and side', () => {
  assert.deepEqual(movementBalance(158, 0), { amount: 158, side: 'Debit' });
  assert.deepEqual(movementBalance(0, 10756), { amount: 10756, side: 'Credit' });
  assert.deepEqual(movementBalance(12.5, 12.5), { amount: 0, side: 'Balanced' });
});

test('CSV preserves store attribution, period, paise and escaped names', () => {
  const csv = ledgerReportCsv([{ entityName: 'Store "A", Kerala', entityCode: 'SHD-A', accountCode: '1001', accountName: 'Cash', accountType: 'ASSET', isProvisional: true, debit: 12.55, credit: 0 }], '2026-10');
  assert.ok(csv.includes('"Store ""A"", Kerala"'));
  assert.ok(csv.includes('2026-10'));
  assert.ok(csv.includes('12.55'));
  assert.ok(csv.includes('Debit'));
  assert.ok(csv.includes('Provisional'));
  assert.ok(!csv.includes('undefined'));
});
