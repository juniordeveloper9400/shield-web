export interface DistanceRate {
  firstKm: number;
  firstAmount: number;
  secondKm: number;
  secondAmount: number;
  extraPerKm: number;
}

export interface DistanceTier {
  tierNumber: 1 | 2 | 3;
  title: string;
  rangeLabel: string;
  rateDisplay: string;
  description: string;
  badgeTone: 'emerald' | 'blue' | 'purple';
}

export function calculateKmCharge(km: number, rate?: DistanceRate | null): number | null {
  if (!rate || !Number.isFinite(km) || km <= 0 || km > 10000) return null;
  const amount =
    km <= rate.firstKm
      ? rate.firstAmount
      : km <= rate.secondKm
        ? rate.secondAmount
        : rate.secondAmount + Math.ceil(Math.round((km - rate.secondKm) * 1e6) / 1e6) * rate.extraPerKm;
  return Math.round(amount * 100) / 100;
}

export function distanceRateNote(rate: DistanceRate): string {
  return `Up to ${rate.firstKm} km: ₹${rate.firstAmount}. Over ${rate.firstKm} km through ${rate.secondKm} km: ₹${rate.secondAmount}. Above ${rate.secondKm} km: ₹${rate.secondAmount} plus ₹${rate.extraPerKm} for each additional started kilometre.`;
}

export function getDistanceTiers(rate: DistanceRate): DistanceTier[] {
  return [
    {
      tierNumber: 1,
      title: 'Tier 1 · Short Distance',
      rangeLabel: `Up to ${rate.firstKm} km`,
      rateDisplay: `₹${rate.firstAmount}`,
      description: `Flat charge of ₹${rate.firstAmount} for sample collection within ${rate.firstKm} km.`,
      badgeTone: 'emerald',
    },
    {
      tierNumber: 2,
      title: 'Tier 2 · Mid Distance',
      rangeLabel: `Over ${rate.firstKm} km through ${rate.secondKm} km`,
      rateDisplay: `₹${rate.secondAmount}`,
      description: `Flat charge of ₹${rate.secondAmount} for distances between ${rate.firstKm} km and ${rate.secondKm} km.`,
      badgeTone: 'blue',
    },
    {
      tierNumber: 3,
      title: 'Tier 3 · Long Distance',
      rangeLabel: `Above ${rate.secondKm} km`,
      rateDisplay: `₹${rate.secondAmount} + ₹${rate.extraPerKm}/km`,
      description: `Base fee of ₹${rate.secondAmount} plus ₹${rate.extraPerKm} for each additional started kilometre beyond ${rate.secondKm} km.`,
      badgeTone: 'purple',
    },
  ];
}

export interface MatchResult {
  tier: 1 | 2 | 3;
  tierLabel: string;
  charge: number;
  explanation: string;
}

export function matchDistanceTier(km: number, rate?: DistanceRate | null): MatchResult | null {
  if (!rate || !Number.isFinite(km) || km <= 0 || km > 10000) return null;
  const charge = calculateKmCharge(km, rate);
  if (charge === null) return null;

  if (km <= rate.firstKm) {
    return {
      tier: 1,
      tierLabel: `Up to ${rate.firstKm} km`,
      charge,
      explanation: `Flat charge of ₹${rate.firstAmount} (within ${rate.firstKm} km)`,
    };
  }
  if (km <= rate.secondKm) {
    return {
      tier: 2,
      tierLabel: `Over ${rate.firstKm} km through ${rate.secondKm} km`,
      charge,
      explanation: `Flat charge of ₹${rate.secondAmount} (${rate.firstKm} km – ${rate.secondKm} km)`,
    };
  }
  const extraKm = Math.ceil(Math.round((km - rate.secondKm) * 1e6) / 1e6);
  return {
    tier: 3,
    tierLabel: `Above ${rate.secondKm} km`,
    charge,
    explanation: `₹${rate.secondAmount} base + ${extraKm} started km × ₹${rate.extraPerKm} = ₹${charge}`,
  };
}
