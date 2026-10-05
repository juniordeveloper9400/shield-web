import type { CommissionReserveEntry, CommissionReserveStore } from '@/api/commissionReserve';

/**
 * Groups reserve ledger entries by the store their activation was made at —
 * each store's company 8%, its agent-pool leftover, and its total — largest
 * first. An entry with no store recorded falls under "Unassigned". Pure, so
 * the figures are checkable without a database.
 */
export function reserveByStore(
  entries: Pick<CommissionReserveEntry, 'storeId' | 'storeCode' | 'storeName' | 'source' | 'amount'>[],
): CommissionReserveStore[] {
  const byStore = new Map<string, CommissionReserveStore>();
  for (const e of entries) {
    const key = e.storeId || 'unassigned';
    const bucket = byStore.get(key) ?? {
      id: key,
      storeId: e.storeId,
      storeCode: e.storeCode,
      storeName: e.storeName,
      total: 0,
      companyShare: 0,
      poolLeftover: 0,
    };
    bucket.total += e.amount;
    if (e.source === 'COMPANY_SHARE') bucket.companyShare += e.amount;
    else bucket.poolLeftover += e.amount;
    byStore.set(key, bucket);
  }
  return [...byStore.values()].sort((a, b) => b.total - a.total);
}
