import { api, ApiError } from '@/lib/api';
import { fromEnum, num } from '@/lib/mappers';
import type {
  PrivilegeActivation,
  PrivilegeActivationStatus,
  WalletActivity,
} from '@/types';

/** The shape `GET/PATCH /v1/staff/wallet-cards*` sends back —
 *  WalletService's joined drizzle rows, camelCase. `numeric` columns
 *  (amount/bonus/rechargedExtra/receivedAmount) come back as strings,
 *  same Postgres convention as everywhere else this console reads. */
interface ActivationApiRow {
  id: number;
  uuid: string;
  memberId: number | null;
  memberName: string;
  memberPhone: string;
  tierName: string;
  tierKind: string;
  amount: string;
  bonus: string;
  rechargedExtra: string;
  status: string;
  cardNumber: string | null;
  receiptReference: string | null;
  receiptFileName: string | null;
  receiptImage: string | null;
  reviewerNote: string;
  submittedAt: string;
  reviewedAt: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedReference: string | null;
  receivedOn: string | null;
  receiptVerified: boolean;
  receivedAmount: string | null;
  storeCode: string | null;
  storeName: string | null;
}

function toActivation(r: ActivationApiRow): PrivilegeActivation {
  return {
    id: String(r.id),
    uuid: r.uuid,
    memberId: String(r.memberId ?? ''),
    memberName: r.memberName || '—',
    memberPhone: r.memberPhone || '',
    tier: r.tierName || '—',
    tierKind: fromEnum(r.tierKind || ''),
    amount: num(r.amount),
    bonus: num(r.bonus),
    credited: num(r.amount) + num(r.bonus) + num(r.rechargedExtra),
    status: fromEnum<PrivilegeActivationStatus>(r.status),
    storeCode: r.storeCode || '',
    storeName: r.storeName || '—',
    cardNumber: r.cardNumber || '',
    receiptReference: r.receiptReference || '',
    receiptFileName: r.receiptFileName || '',
    receiptImage: r.receiptImage || '',
    reviewerNote: r.reviewerNote || '',
    submittedAt: r.submittedAt || new Date(0).toISOString(),
    issuedOn: r.issuedOn || '',
    expiresOn: r.expiresOn || '',
    reviewedAt: r.reviewedAt ?? undefined,
    verifiedReference: r.verifiedReference || '',
    receivedOn: r.receivedOn || '',
    receiptVerified: r.receiptVerified === true,
    receivedAmount: num(r.receivedAmount),
  };
}

/** True for the two outcomes the review screen treats as "no longer
 *  actionable, reload" rather than a real error — matches what a
 *  stale/already-decided card used to come back as a plain `false` for
 *  under the old direct-Neon queries. */
function isStaleCardError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 403 || err.status === 404);
}

/**
 * Every privilege-plan activation members have submitted — `app.wallet_card`
 * joined to its member, tier and branch. Pending first, then newest. Migrated
 * off direct Neon onto `GET /v1/staff/wallet-cards` (`WalletService.listCards`)
 * — see backend/docs/migration-plan.md Phase 1.
 */
export async function listActivations(token: string | null): Promise<PrivilegeActivation[]> {
  const rows = await api.get<ActivationApiRow[]>('/v1/staff/wallet-cards', token);
  return rows.map(toActivation);
}

/** A single activation by `app.wallet_card.id`, for the review page. */
export async function getActivation(id: string, token: string | null): Promise<PrivilegeActivation | null> {
  const row = await api.get<ActivationApiRow | null>(`/v1/staff/wallet-cards/${id}`, token);
  return row ? toActivation(row) : null;
}

/**
 * Every privilege plan one member has activated (`app.wallet.member_id`),
 * newest first — the cards shown on their user page and member-plans page.
 */
export async function listActivationsForMember(memberId: string, token: string | null): Promise<PrivilegeActivation[]> {
  const rows = await api.get<ActivationApiRow[]>(`/v1/staff/wallet-cards/member/${memberId}`, token);
  return rows.map(toActivation);
}

/**
 * A member's wallet at a glance — balance and reward points, looked up from
 * the wallet card being reviewed. Lets a reviewer see what the plan will
 * land on top of. Deliberately just these two figures: the review screen
 * shows what is there, never the member's transaction history.
 *
 * Points come from `app.users.reward_points`, not `app.wallet.reward_points`
 * — the latter is a denormalized mirror that only ever moves on redemption
 * (`RewardsService.redeem`, backend/api); nothing that actually credits
 * points (registration, referral levels, order points) ever updates it, so
 * it reads as stale/near-zero for almost every member. `app.users
 * .reward_points` is the one kept in step with the real ledger
 * (`app.reward_point_transaction`) — the same figure `UserDetailPage`
 * already shows (`src/api/users.ts`).
 */
export async function getWalletActivity(walletCardId: string, token: string | null): Promise<WalletActivity> {
  const w = await api.get<{ balance: string; rewardPoints: number }>(
    `/v1/staff/wallet-cards/${walletCardId}/wallet-activity`,
    token,
  );
  return { balance: num(w.balance), rewardPoints: num(w.rewardPoints) };
}

/**
 * Saves the reviewer's own verification checklist for a pending (or
 * on-hold) activation — the UTR they read off their own bank statement, when
 * they saw the transfer land, whether the uploaded receipt image checks out,
 * and what they saw credited. Separate from, and never overwriting, what the
 * member submitted (`receiptReference`, `receiptFileName`, `receiptImage`).
 *
 * Purely an audit record: it never touches status, the wallet, or any
 * commission logic — only [approveActivation] does that, and only once this
 * checklist is complete (see `ActivationDetailPage`'s own doc). A no-op —
 * and returns `false` — once the card is already decided, so a stray save
 * after someone else has approved or rejected it cannot silently succeed.
 */
export async function saveActivationVerification(
  id: string,
  input: {
    verifiedReference: string;
    receivedOn: string; // '' clears it
    receiptVerified: boolean;
    receivedAmount: number | null;
  },
  token: string | null,
): Promise<boolean> {
  return api.patch<boolean>(`/v1/staff/wallet-cards/${id}/verification`, input, token);
}

/**
 * Approves a pending (or on-hold) activation in one call: flips the card to
 * `APPROVED`, writes the `ACTIVATION` + `BONUS` ledger lines, credits the
 * wallet balance (load + bonus), stamps `opened_at`, records the sale as
 * `app.agent_customer_plan` when this member was registered under an
 * agent's code (what the agent portal's "Direct sale" / "Team sales"
 * figures are worked out from), and splits the Health Pass commission pool
 * between the direct-selling agent, the one national agent, and the
 * company's own reserved share.
 *
 * That whole write is now `WalletService.approveCard` (`PATCH
 * /v1/staff/wallet-cards/:id/approve`) — a typed, pg-mem-tested port of what
 * `app.approve_wallet_card_activation` (migration 0033) used to do as the
 * only way to move this money transactionally over the old one-statement-
 * per-HTTP-call Neon driver. See backend/docs/migration-plan.md Phase 1 for
 * why the SQL function is no longer what real approvals call.
 *
 * A no-op — and returns `false` — if the card is already decided (or a
 * stale id), or if the reviewer's own verification checklist
 * ([saveActivationVerification]) is not yet complete: real money moves here,
 * so the backend checks this again itself (a `403`) rather than trusting the
 * console's own disabled button alone.
 */
export async function approveActivation(id: string, token: string | null): Promise<boolean> {
  try {
    await api.patch(`/v1/staff/wallet-cards/${id}/approve`, undefined, token);
    return true;
  } catch (err) {
    if (isStaleCardError(err)) return false;
    throw err;
  }
}

/**
 * Rejects a pending (or on-hold) activation with a reason the member sees in
 * their wallet. Nothing is credited. Returns `false` if the card was already
 * decided.
 */
export async function rejectActivation(id: string, note: string, token: string | null): Promise<boolean> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error('A rejection needs a reason.');
  try {
    await api.patch(`/v1/staff/wallet-cards/${id}/reject`, { note: trimmed }, token);
    return true;
  } catch (err) {
    if (isStaleCardError(err)) return false;
    throw err;
  }
}

/**
 * Neither approves nor rejects — parks a pending activation with a note (the
 * member sees it in their wallet, same as a rejection reason) so a reviewer
 * who needs more from the member before deciding has somewhere to put that
 * down, distinct from silently leaving it untouched in the pending queue.
 * Still fully reversible: [approveActivation] / [rejectActivation] both
 * accept an `ON_HOLD` card the same as a `PENDING` one. Returns `false` if
 * the card was not `PENDING` (already decided, or already on hold).
 */
export async function holdActivation(id: string, note: string, token: string | null): Promise<boolean> {
  const trimmed = note.trim();
  if (!trimmed) throw new Error('Give the member a reason it is on hold.');
  try {
    await api.patch(`/v1/staff/wallet-cards/${id}/hold`, { note: trimmed }, token);
    return true;
  } catch (err) {
    if (isStaleCardError(err)) return false;
    throw err;
  }
}
