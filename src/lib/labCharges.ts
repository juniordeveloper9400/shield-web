export interface DistanceRate {
  firstKm: number; firstAmount: number; secondKm: number; secondAmount: number; extraPerKm: number;
}
export function calculateKmCharge(km: number, rate?: DistanceRate | null): number | null {
  if (!rate || !Number.isFinite(km) || km <= 0 || km > 10000) return null;
  const amount = km <= rate.firstKm ? rate.firstAmount : km <= rate.secondKm ? rate.secondAmount
    : rate.secondAmount + Math.ceil(Math.round((km - rate.secondKm) * 1e6) / 1e6) * rate.extraPerKm;
  return Math.round(amount * 100) / 100;
}
export function distanceRateNote(rate: DistanceRate): string {
  return `Up to ${rate.firstKm} km: ₹${rate.firstAmount}. Over ${rate.firstKm} km through ${rate.secondKm} km: ₹${rate.secondAmount}. Above ${rate.secondKm} km: ₹${rate.secondAmount} plus ₹${rate.extraPerKm} for each additional started kilometre.`;
}
