import type { SubjectLedgerLine, TrialBalanceRow } from '@/api/ledger';

export const ACCOUNT_EXPLANATIONS: Record<string, string> = {
  '1001': 'cash receipts and payments recorded at the store',
  '1002': 'money recorded in bank accounts',
  '1003': 'UPI receipts awaiting settlement',
  '1004': 'amount due from stores to Head Office',
  '2001': 'unused member wallet value owed to members',
  '2002': 'earned agent commissions still payable',
  '2003': 'issued reward points still redeemable',
  '2004': 'company reserve share payable to Head Office',
  '2005': 'unused agent commission pool payable to Head Office',
  '2006': 'amount the store owes Head Office',
  '3001': 'opening balance adjustment from earlier records',
  '4001': 'sales recorded from orders',
  '4002': 'sales recorded from lab services',
  '4003': 'fees recorded from appointments',
  '5001': 'cost of agent commissions',
  '5002': 'discounts recorded on sales',
  '5003': 'cost of member wallet bonuses',
  '5004': 'cost of reward points issued',
  '9000': 'unresolved posting difference awaiting review',
};

export function movementBalance(debit: number, credit: number) {
  const net = Math.round((debit - credit) * 100) / 100;
  return { amount: Math.abs(net), side: net > 0 ? 'Debit' : net < 0 ? 'Credit' : 'Balanced' };
}

export type StoreLedgerRow = TrialBalanceRow & { entityName: string; entityCode: string; id: string };

export function ledgerReportCsv(rows: Omit<StoreLedgerRow, 'id' | 'net'>[], month: string): string {
  const escape = (value: string | number) => {
    const text = String(value);
    // Keep spreadsheet imports from executing entity/account display names.
    const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines: (string | number)[][] = [
    ['Month', 'Store / Head Office', 'Entity code', 'Account code', 'Account', 'Explanation', 'Type', 'Debit movement', 'Credit movement', 'Net movement amount', 'Side', 'Review status'],
    ...rows.map((row) => {
      const balance = movementBalance(row.debit, row.credit);
      return [month, row.entityName, row.entityCode, row.accountCode, row.accountName, ACCOUNT_EXPLANATIONS[row.accountCode] ?? '', row.accountType, row.debit.toFixed(2), row.credit.toFixed(2), balance.amount.toFixed(2), balance.side, row.isProvisional ? 'Provisional' : 'Reviewed'];
    }),
  ];
  return lines.map((line) => line.map(escape).join(',')).join('\r\n');
}

/** Same CSV shape/escaping as `ledgerReportCsv`, for one person's own
 *  account for one month — the individual journal lines behind the
 *  opening/closing balance, not a store-wide movement summary. */
export function subjectLedgerCsv(
  params: { personName: string; accountCode: string; accountName: string; openingBalance: number; closingBalance: number },
  lines: SubjectLedgerLine[],
  month: string,
): string {
  const escape = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows: (string | number)[][] = [
    ['Month', 'Person', 'Account code', 'Account', 'Opening balance', 'Date', 'Event', 'Description', 'Debit', 'Credit'],
    [month, params.personName, params.accountCode, params.accountName, params.openingBalance.toFixed(2), '', '', 'Opening balance', '', ''],
    ...lines.map((l) => [month, params.personName, params.accountCode, params.accountName, '', l.postedOn, l.event, l.description, l.debit.toFixed(2), l.credit.toFixed(2)]),
    [month, params.personName, params.accountCode, params.accountName, params.closingBalance.toFixed(2), '', '', 'Closing balance', '', ''],
  ];
  return rows.map((line) => line.map(escape).join(',')).join('\r\n');
}
