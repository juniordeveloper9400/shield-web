import { api } from '@/lib/api';
import { fromEnum, toEnum } from '@/lib/mappers';
import type {
  AgentLevel,
  AgentOption,
  AppUser,
  InvestorPlanType,
  MemberAddress,
  MemberPatient,
  UserDetail,
} from '@/types';

/** A `GET /v1/staff/users[/:id]` row — several ids/numerics come back as
 *  JSON numbers (bigint columns), not the string ids shieldweb's own
 *  types use; mapped below. */
interface AppUserApiRow {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  registered: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  homeStoreCode: string | null;
  homeStoreName: string | null;
  agentId: number | null;
  agentCode: string | null;
  agentLevel: string | null;
  investorId: number | null;
  investorCode: string | null;
}

function toAppUser(r: AppUserApiRow): AppUser {
  return {
    id: String(r.id),
    name: r.name,
    phone: r.phone,
    email: r.email ?? '',
    registered: r.registered,
    homeStoreCode: r.homeStoreCode ?? '',
    homeStoreName: r.homeStoreName ?? '—',
    createdAt: r.createdAt,
    lastLoginAt: r.lastLoginAt ?? '',
    persona: r.agentCode ? 'agent' : r.investorCode ? 'investor' : 'member',
    agentCode: r.agentCode ?? '',
    agentLevel: r.agentLevel ? fromEnum<AgentLevel>(r.agentLevel) : '',
    agentId: r.agentId == null ? '' : String(r.agentId),
    investorCode: r.investorCode ?? '',
    investorId: r.investorId == null ? '' : String(r.investorId),
  };
}

/**
 * Every app member, newest first, tagged with the persona the Super Admin
 * has granted them — `member`, `agent` or `investor`. Reads through
 * backend/api's staff users routes now, not Neon directly.
 */
export async function listUsers(storeCode: string | undefined, token: string | null): Promise<AppUser[]> {
  const query = storeCode === undefined ? '' : `?storeCode=${encodeURIComponent(storeCode)}`;
  const rows = await api.get<AppUserApiRow[]>(`/v1/staff/users${query}`, token);
  return rows.map(toAppUser);
}

/** A single member by `app.users.id`, for the detail page. */
export async function getUser(id: string, token: string | null): Promise<AppUser | null> {
  const row = await api.get<AppUserApiRow | null>(`/v1/staff/users/${id}`, token);
  return row ? toAppUser(row) : null;
}

/** A `GET /v1/staff/users/:id/detail` row's patient/address shape — the
 *  backend's own raw Drizzle rows, bigint ids as JSON numbers. */
interface PatientApiRow {
  id: number;
  name: string;
  relation: string;
  gender: string;
  dob: string;
  phone: string;
  address: string;
  abhaId: string;
  createdAt: string;
}

interface AddressApiRow {
  id: number;
  label: string;
  house: string;
  area: string;
  landmark: string;
  city: string | null;
  state: string | null;
  pincode: string;
  phone: string;
  isDefault: boolean;
  patientName: string | null;
  firstName: string;
  lastName: string;
  createdAt: string;
}

function toMemberPatient(r: PatientApiRow): MemberPatient {
  return {
    id: String(r.id),
    name: r.name,
    relation: fromEnum(r.relation),
    gender: fromEnum(r.gender),
    dob: r.dob,
    phone: r.phone,
    address: r.address,
    abhaId: r.abhaId,
    createdAt: r.createdAt,
  };
}

/**
 * The full profile for one member: the registration fields `listUsers`
 * leaves out, plus every patient and delivery address they have added.
 * Loaded when the user's modal opens.
 */
export async function getUserDetail(userId: string, token: string | null): Promise<UserDetail> {
  const r = await api.get<{
    gender: string | null;
    dob: string | null;
    address: string | null;
    place: string | null;
    pincode: string | null;
    state: string | null;
    rewardPoints: number;
    referralCode: string | null;
    registrationCompletedAt: string | null;
    referredByName: string | null;
    referredByPhone: string | null;
    referredByAgentName: string | null;
    referredByAgentCode: string | null;
    patients: PatientApiRow[];
    addresses: AddressApiRow[];
  }>(`/v1/staff/users/${userId}/detail`, token);

  const addresses: MemberAddress[] = r.addresses.map((a) => {
    const receiver = [a.firstName, a.lastName].map((x) => x.trim()).filter(Boolean).join(' ');
    return {
      id: String(a.id),
      label: fromEnum(a.label),
      receiver,
      house: a.house,
      area: a.area,
      landmark: a.landmark,
      city: a.city ?? '',
      state: a.state ?? '',
      pincode: a.pincode,
      phone: a.phone,
      isDefault: a.isDefault,
      patientName: a.patientName ?? '',
      createdAt: a.createdAt,
    };
  });

  return {
    id: userId,
    gender: r.gender ? fromEnum(r.gender) : '',
    dob: r.dob ?? '',
    address: r.address ?? '',
    place: r.place ?? '',
    pincode: r.pincode ?? '',
    state: r.state ?? '',
    rewardPoints: r.rewardPoints,
    referralCode: r.referralCode ?? '',
    referredByName: r.referredByName ?? '',
    referredByPhone: r.referredByPhone ?? '',
    referredByAgentName: r.referredByAgentName ?? '',
    referredByAgentCode: r.referredByAgentCode ?? '',
    registrationCompletedAt: r.registrationCompletedAt ?? '',
    patients: r.patients.map(toMemberPatient),
    addresses,
  };
}

/**
 * Corrects a member's own name/phone directly — used from the prescription
 * review flow when what they typed at registration turns out wrong. This
 * is their account's actual name/phone, so the fix shows everywhere on it
 * (orders, wallet, other scripts), not just the one prescription being
 * reviewed. Returns `false`, changing nothing, when [phone] already
 * belongs to a different account.
 */
export async function updateMemberContact(
  memberId: string,
  input: { name: string; phone: string },
  token: string | null,
): Promise<boolean> {
  const result = await api.patch<{ changed: boolean }>(`/v1/staff/users/${memberId}/contact`, input, token);
  return result.changed;
}

/**
 * Every patient profile a member has added (`app.patient`) — self, family,
 * anyone they've booked care for. Used by the Prescriptions review flow's
 * Patient picker, so a reviewer chooses among the member's own saved
 * patients rather than retyping a name.
 */
export async function listPatients(memberId: string, token: string | null): Promise<MemberPatient[]> {
  const rows = await api.get<PatientApiRow[]>(`/v1/staff/users/${memberId}/patients`, token);
  return rows.map(toMemberPatient);
}

/**
 * Adds a new patient profile under a member's account — the same "add a
 * patient" action available in the app, offered here too so a reviewer who
 * finds no matching patient while checking a prescription's details doesn't
 * have to leave the review to create one first.
 */
export async function createPatient(
  memberId: string,
  input: { name: string; relation: string; dob: string; phone?: string },
  token: string | null,
): Promise<MemberPatient> {
  const row = await api.post<PatientApiRow>(
    `/v1/staff/users/${memberId}/patients`,
    { name: input.name, relation: toEnum(input.relation), dob: input.dob, phone: input.phone ?? '' },
    token,
  );
  return toMemberPatient(row);
}

/**
 * Approved agents only, for the "parent" picker and the one-national /
 * six-region caps. A pending or rejected registration is neither a valid
 * parent nor a slot that counts as taken.
 */
export async function listAgentOptions(token: string | null): Promise<AgentOption[]> {
  const rows = await api.get<{ id: number; code: string; name: string | null; level: string }[]>(
    '/v1/staff/agent-options',
    token,
  );
  return rows.map((r) => ({
    id: String(r.id),
    code: r.code,
    name: r.name ?? '—',
    level: fromEnum<AgentLevel>(r.level),
  }));
}

/**
 * Makes the user an agent: grants one `app.agent` row linked to their
 * `app.users` id. Only members who have completed registration are
 * eligible — the server throws 403 for an incomplete registration, 409
 * when they already have a persona, when a national agent already exists,
 * when all six regions are taken, or when the chosen slot is already held
 * by another approved agent. Returns the new agent's code.
 */
export async function convertToAgent(
  userId: string,
  opts: {
    level: AgentLevel;
    parentId?: string | null;
    area?: string;
    areaId?: string | null;
  },
  token: string | null,
): Promise<string> {
  const result = await api.post<{ code: string }>(
    `/v1/staff/users/${userId}/convert-to-agent`,
    {
      level: opts.level.toUpperCase(),
      parentId: opts.parentId ? Number(opts.parentId) : opts.parentId === null ? null : undefined,
      area: opts.area ?? '',
      areaId: opts.areaId ?? null,
    },
    token,
  );
  return result.code;
}

/**
 * Makes the user an investor: grants one `app.investor` row. Only members
 * who have completed registration are eligible — the server throws 403
 * for an incomplete registration, 409 when they already have a persona.
 * Returns the new investor's code.
 */
export async function convertToInvestor(
  userId: string,
  opts: {
    storeCode?: string | null;
    totalUnits: number;
    unitPrice: number;
    roiPercent: number;
    planType: InvestorPlanType;
  },
  token: string | null,
): Promise<string> {
  const result = await api.post<{ code: string }>(
    `/v1/staff/users/${userId}/convert-to-investor`,
    {
      storeCode: opts.storeCode ?? null,
      totalUnits: opts.totalUnits,
      unitPrice: opts.unitPrice,
      roiPercent: opts.roiPercent,
      planType: opts.planType.toUpperCase(),
    },
    token,
  );
  return result.code;
}

/**
 * Drops the user back to a plain member — removes their `app.agent` /
 * `app.investor` row (whichever they hold). Their customers, withdrawals
 * and plan-change requests go with it.
 */
export async function revokePersona(userId: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/users/${userId}/persona`, token);
}

/**
 * Permanently removes the member through the Admin/Super Admin-only backend
 * endpoint. Migration 0089 purges owned data and sessions atomically; failures
 * leave the member intact. Their phone may register again as a fresh account.
 */
export async function deleteUser(userId: string, token: string | null): Promise<void> {
  await api.delete(`/v1/staff/users/${encodeURIComponent(userId)}`, token);
}
