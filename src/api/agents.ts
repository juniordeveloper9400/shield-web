import { api, ApiError } from '@/lib/api';
import { fromEnum, num } from '@/lib/mappers';
import type {
  AgentCustomer,
  AgentCustomerPlan,
  AgentLevel,
  AgentRow,
  AgentWithdrawalEntry,
  PendingAgent,
} from '@/types';

/** A `GET /v1/staff/agent-requests[/:id]` row — several ids come back as
 *  JSON numbers (bigint columns), not the string ids shieldweb's own types
 *  use; mapped below. */
interface PendingAgentApiRow {
  id: number;
  name: string;
  phone: string;
  requestedLevel: string;
  requestedArea: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string | null;
  aadhaar: string;
  pan: string;
  address: string;
  pincode: string;
  place: string;
  accountNumber: string;
  createdAt: string;
  parentCode: string | null;
  parentName: string | null;
}

function toPendingAgent(r: PendingAgentApiRow): PendingAgent {
  return {
    id: String(r.id),
    code: `REQ-${r.id}`,
    name: r.name,
    phone: r.phone,
    level: fromEnum<AgentLevel>(r.requestedLevel),
    area: r.requestedArea,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    dob: r.dob ?? '',
    aadhaar: r.aadhaar,
    pan: r.pan,
    address: r.address,
    pincode: r.pincode,
    place: r.place,
    accountNumber: r.accountNumber,
    createdAt: r.createdAt,
    parentCode: r.parentCode ?? '',
    parentName: r.parentName ?? '',
  };
}

/** Every agent-registration request awaiting review, oldest first. */
export async function listPendingAgents(token: string | null): Promise<PendingAgent[]> {
  const rows = await api.get<PendingAgentApiRow[]>('/v1/staff/agent-requests', token);
  return rows.map(toPendingAgent);
}

/** One pending request by `app.agent_request.id`, for the detail page. */
export async function getPendingAgent(id: string, token: string | null): Promise<PendingAgent | null> {
  try {
    const row = await api.get<PendingAgentApiRow>(`/v1/staff/agent-requests/${id}`, token);
    return toPendingAgent(row);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Approves a request: creates the real `app.agent` row at the level /
 * parent / area the admin confirmed, links it back onto the request, and
 * marks the request APPROVED. [opts] overrides the recruiter's own
 * request wherever it's given — every field left unset falls back to
 * what was originally requested, except [parentId], which derives the
 * geographically correct parent when left unset (same convention
 * `convertToAgent` uses). Returns `false` (a safe no-op) when the request
 * is no longer pending; throws when a tier is full or the slot is taken.
 */
export async function approveAgent(
  id: string,
  opts: {
    level: AgentLevel;
    parentId?: string | null;
    area?: string;
    areaId?: string | null;
  },
  token: string | null,
): Promise<boolean> {
  try {
    await api.post(
      `/v1/staff/agent-requests/${id}/approve`,
      {
        level: opts.level.toUpperCase(),
        parentId: opts.parentId ? Number(opts.parentId) : null,
        area: opts.area,
        areaId: opts.areaId,
      },
      token,
    );
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return false;
    throw err;
  }
}

/**
 * Rejects a request with a reason the recruiter sees in the app. Returns
 * `false` when the request is no longer pending. The request row is kept
 * (as `REJECTED`) and no `app.agent` row is created, so the slot frees up.
 */
export async function rejectAgent(id: string, note: string, token: string | null): Promise<boolean> {
  const reason = note.trim();
  if (!reason) {
    throw new Error('A rejection needs a reason.');
  }
  try {
    await api.post(`/v1/staff/agent-requests/${id}/reject`, { note: reason }, token);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return false;
    throw err;
  }
}

// ---- the live roster ("All agents") -----------------------------------
//
// Distinct from the approval queue above: these are agents actually working
// today, not requests waiting to be decided. Editing one re-assigns their
// level/parent/position with the same rules approving a request enforces;
// "removing" one switches them off (`active = false`) rather than deleting
// the row outright.

interface AgentApiRow {
  id: number;
  code: string;
  name: string;
  phone: string;
  level: string;
  area: string;
  areaId: string | null;
  active: boolean;
  parentId: number | null;
  createdAt: string;
  parentCode: string | null;
  parentName: string | null;
  earned: unknown;
  redeemed: unknown;
  personalSales: unknown;
  movedToWallet: unknown;
  /** Only on `listApprovedAgents`'s own roster read — absent on the plain
   *  `getApprovedAgent` by-id read, which has no reason to join it in. */
  plansSold?: unknown;
}

function toAgentRow(r: AgentApiRow): AgentRow {
  return {
    id: String(r.id),
    code: r.code,
    name: r.name,
    phone: r.phone,
    level: fromEnum<AgentLevel>(r.level),
    area: r.area,
    areaId: r.areaId,
    active: r.active,
    parentId: r.parentId == null ? null : String(r.parentId),
    parentCode: r.parentCode ?? '',
    parentName: r.parentName ?? '',
    createdAt: r.createdAt,
    earned: num(r.earned),
    redeemed: num(r.redeemed),
    personalSales: num(r.personalSales),
    movedToWallet: num(r.movedToWallet),
    plansSold: r.plansSold == null ? 0 : num(r.plansSold),
  };
}

/** Every approved agent — the whole live roster, not just who is pending. */
export async function listApprovedAgents(token: string | null): Promise<AgentRow[]> {
  const rows = await api.get<AgentApiRow[]>('/v1/staff/agents', token);
  return rows.map(toAgentRow);
}

/** One approved agent by `app.agent.id`, for the edit page. */
export async function getApprovedAgent(id: string, token: string | null): Promise<AgentRow | null> {
  try {
    const row = await api.get<AgentApiRow>(`/v1/staff/agents/${id}`, token);
    return toAgentRow(row);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Re-assigns an already-approved agent's level, parent, and named slot —
 * the same rules as approving a request (one national, six regions, one
 * agent per slot), with this agent's own current row excluded from every
 * check so confirming their existing position again never refuses itself.
 */
export async function updateAgentPosition(
  id: string,
  opts: {
    level: AgentLevel;
    parentId?: string | null;
    area?: string;
    areaId?: string | null;
  },
  token: string | null,
): Promise<void> {
  await api.patch(
    `/v1/staff/agents/${id}/position`,
    {
      level: opts.level.toUpperCase(),
      parentId: opts.parentId ? Number(opts.parentId) : null,
      area: opts.area ?? '',
      areaId: opts.areaId ?? null,
    },
    token,
  );
}

/** Switches an agent on or off. See this section's own doc for why this,
 *  not a delete, is what "remove" means here. */
export async function setAgentActive(id: string, active: boolean, token: string | null): Promise<void> {
  await api.patch(`/v1/staff/agents/${id}/active`, { active }, token);
}

// ---- Agent Portal: money flow for one agent --------------------------

interface AgentCustomerPlanApiRow {
  id: number;
  agentCustomerId: number;
  tierKind: string;
  amount: unknown;
  activatedOn: string;
}

interface AgentCustomerApiRow {
  id: number;
  name: string;
  phone: string;
  createdAt: string;
  plans: AgentCustomerPlanApiRow[];
}

function toPlan(p: AgentCustomerPlanApiRow): AgentCustomerPlan {
  return { id: String(p.id), tierKind: p.tierKind, amount: num(p.amount), activatedOn: p.activatedOn };
}

/** This agent's own direct customers and the plans they've activated —
 *  what generated [AgentRow.personalSales]/[AgentRow.earned], not just the
 *  totals themselves. */
export async function listAgentCustomers(id: string, token: string | null): Promise<AgentCustomer[]> {
  const rows = await api.get<AgentCustomerApiRow[]>(`/v1/staff/agents/${id}/customers`, token);
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    phone: r.phone,
    createdAt: r.createdAt,
    plans: r.plans.map(toPlan),
  }));
}

interface AgentWithdrawalApiRow {
  id: number;
  amount: unknown;
  status: string;
  requestedOn: string;
  approvedAt: string | null;
  paymentReference: string | null;
  note: string | null;
}

/** This agent's own withdrawal history — money actually paid out, or still
 *  pending/rejected. */
export async function listAgentWithdrawals(id: string, token: string | null): Promise<AgentWithdrawalEntry[]> {
  const rows = await api.get<AgentWithdrawalApiRow[]>(`/v1/staff/agents/${id}/withdrawals`, token);
  return rows.map((r) => ({
    id: String(r.id),
    amount: num(r.amount),
    status: r.status.toLowerCase() as AgentWithdrawalEntry['status'],
    requestedOn: r.requestedOn,
    approvedAt: r.approvedAt,
    paymentReference: r.paymentReference ?? '',
    note: r.note ?? '',
  }));
}
