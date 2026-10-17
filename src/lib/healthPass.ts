/**
 * Per-card Health Pass status/release math for the admin console's own
 * Health Passes page — a straight port of the member app's own
 * `WalletCard` getters (`lib/module/wallet/wallet_service.dart`), so a plan
 * never reads "Active" in the app and "Waiting" here. Pure and synchronous,
 * same reason `wallet-month.ts` (backend/api) is a separate copy rather
 * than a shared import: each surface keeps its own.
 */

/** A card carries this many months of validity, same figure the member app
 *  sells plans on (`PrivilegeProgramme.validityMonths`). */
export const VALIDITY_MONTHS = 12;

export interface HealthPassCardDates {
  /** `YYYY-MM-DD` — when the card was issued; validity and the monthly
   *  instalment day both run from here. */
  issuedOn: string;
  /** `YYYY-MM-DD` — already computed server-side at approval, trusted as
   *  given rather than re-derived from [issuedOn] here. */
  expiresOn: string;
}

function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** A twelfth of what the card carries — what comes due each month, off the
 *  same rule the card was sold on. */
export function monthlyRedeemableOf(loaded: number): number {
  return Math.floor(loaded / VALIDITY_MONTHS);
}

/** The day of the month this card's instalment falls due in the month
 *  [asOf] falls in — clamped to that month's length, so a card issued on
 *  the 31st comes due on the 28th in February rather than slipping into
 *  March. */
export function dueDayIn(issuedOn: string, asOf: Date): Date {
  const issued = parseDate(issuedOn);
  const lastOfMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();
  return new Date(asOf.getFullYear(), asOf.getMonth(), Math.min(issued.getDate(), lastOfMonth));
}

/** Whether this card's instalment for the month [asOf] falls in has been
 *  released — never true before issue or after expiry. */
export function isActiveOn(dates: HealthPassCardDates, asOf: Date): boolean {
  const issued = parseDate(dates.issuedOn);
  const expires = parseDate(dates.expiresOn);
  if (asOf > expires || asOf < issued) return false;
  return asOf >= dueDayIn(dates.issuedOn, asOf);
}

/** The next day this card comes due: this month's if it hasn't passed,
 *  otherwise next month's. */
export function nextDueOn(issuedOn: string, asOf: Date): Date {
  const thisMonth = dueDayIn(issuedOn, asOf);
  if (asOf >= thisMonth) return dueDayIn(issuedOn, new Date(asOf.getFullYear(), asOf.getMonth() + 1, 1));
  return thisMonth;
}

/** Which instalment of [VALIDITY_MONTHS] the card is on, counting from one
 *  on the day it was issued. */
export function instalmentOn(issuedOn: string, asOf: Date): number {
  const issued = parseDate(issuedOn);
  let months = (asOf.getFullYear() - issued.getFullYear()) * 12 + (asOf.getMonth() - issued.getMonth());
  if (asOf.getDate() < dueDayIn(issuedOn, asOf).getDate()) {
    // This month's hasn't been released yet, so the card is still on the one before it.
    months -= 1;
  }
  return Math.min(Math.max(months + 1, 1), VALIDITY_MONTHS);
}

/** What has been released off this card so far: one instalment for every
 *  month that has come due. */
export function releasedBy(loaded: number, issuedOn: string, asOf: Date): number {
  const issued = parseDate(issuedOn);
  if (asOf < issued) return 0;
  return monthlyRedeemableOf(loaded) * instalmentOn(issuedOn, asOf);
}

/** What's still locked up in the card, waiting on later months. */
export function remainingAfter(loaded: number, issuedOn: string, asOf: Date): number {
  const left = loaded - releasedBy(loaded, issuedOn, asOf);
  return left < 0 ? 0 : left;
}

export function isExpired(expiresOn: string, now: Date = new Date()): boolean {
  return now > parseDate(expiresOn);
}

/** The three states a plan reads as, same labels the app's wallet card uses. */
export type PlanState = 'active' | 'waiting' | 'expired';

export function planStateOf(dates: HealthPassCardDates, asOf: Date): PlanState {
  if (isExpired(dates.expiresOn, asOf)) return 'expired';
  return isActiveOn(dates, asOf) ? 'active' : 'waiting';
}
