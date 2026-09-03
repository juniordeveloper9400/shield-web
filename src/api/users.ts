import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import type {
  AgentLevel,
  AgentOption,
  AppUser,
  InvestorPlanType,
  MemberAddress,
  MemberPatient,
  UserDetail,
} from '@/types';

type Row = Record<string, unknown>;

/**
 * Every app member (`app.users`), newest first, tagged with the persona the
 * Super Admin has granted them — `member`, `agent` (an `app.agent` row) or
 * `investor` (an `app.investor` row).
 */
export async function listUsers(): Promise<AppUser[]> {
  const rows = (await sql`
    SELECT u.id, u.name, u.phone, u.email,
           u.registration_completed_at IS NOT NULL AS registered,
           u.created_at, u.last_login_at,
           s.code AS home_store_code, s.name AS home_store_name,
           a.code  AS agent_code,  a.level AS agent_level,
           i.code  AS investor_code
    FROM app.users u
    LEFT JOIN app.shield_store s ON s.id = u.home_store_id
    LEFT JOIN app.agent a        ON a.member_id = u.id
    LEFT JOIN app.investor i     ON i.member_id = u.id
    WHERE u.deleted_at IS NULL
    ORDER BY u.created_at DESC
  `) as Row[];

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? '—'),
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    registered: r.registered === true,
    homeStoreCode: String(r.home_store_code ?? ''),
    homeStoreName: String(r.home_store_name ?? '—'),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    lastLoginAt: iso(r.last_login_at) ?? '',
    persona: r.agent_code ? 'agent' : r.investor_code ? 'investor' : 'member',
    agentCode: String(r.agent_code ?? ''),
    agentLevel: r.agent_level
      ? fromEnum<AgentLevel>(String(r.agent_level))
      : '',
    investorCode: String(r.investor_code ?? ''),
  }));
}

/**
 * The full profile for one member: the registration fields `listUsers` leaves
 * out, plus every patient (`app.patient`) and delivery address
 * (`app.member_address`) they have added. Loaded when the user's modal opens.
 */
export async function getUserDetail(userId: string): Promise<UserDetail> {
  const profileRows = (await query<Row>(
    `
    SELECT u.gender, u.dob, u.address, u.place, u.pincode, u.state,
           u.reward_points, u.referral_code, u.registration_completed_at,
           r.name  AS referred_by_name,
           r.phone AS referred_by_phone
    FROM app.users u
    LEFT JOIN app.users r ON r.id = u.referred_by_member_id
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId],
  )) as Row[];
  const p = profileRows[0] ?? {};

  const patientRows = (await query<Row>(
    `
    SELECT id, name, relation, gender, dob, phone, address, abha_id, created_at
    FROM app.patient
    WHERE member_id = $1 AND deleted_at IS NULL
    ORDER BY created_at
    `,
    [userId],
  )) as Row[];

  const addressRows = (await query<Row>(
    `
    SELECT ma.id, ma.label, ma.house, ma.area, ma.landmark,
           ma.city, ma.state, ma.pincode, ma.phone, ma.is_default,
           ma.first_name, ma.last_name, ma.created_at,
           pt.name AS patient_name
    FROM app.member_address ma
    LEFT JOIN app.patient pt ON pt.id = ma.patient_id
    WHERE ma.member_id = $1 AND ma.deleted_at IS NULL
    ORDER BY ma.is_default DESC, ma.created_at
    `,
    [userId],
  )) as Row[];

  const patients: MemberPatient[] = patientRows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? '—'),
    relation: fromEnum(String(r.relation ?? '')),
    gender: fromEnum(String(r.gender ?? '')),
    dob: iso(r.dob) ?? '',
    phone: String(r.phone ?? ''),
    address: String(r.address ?? ''),
    abhaId: String(r.abha_id ?? ''),
    createdAt: iso(r.created_at) ?? '',
  }));

  const addresses: MemberAddress[] = addressRows.map((r) => {
    const receiver = [r.first_name, r.last_name]
      .map((x) => String(x ?? '').trim())
      .filter(Boolean)
      .join(' ');
    return {
      id: String(r.id),
      label: fromEnum(String(r.label ?? 'home')),
      receiver,
      house: String(r.house ?? ''),
      area: String(r.area ?? ''),
      landmark: String(r.landmark ?? ''),
      city: String(r.city ?? ''),
      state: String(r.state ?? ''),
      pincode: String(r.pincode ?? ''),
      phone: String(r.phone ?? ''),
      isDefault: r.is_default === true,
      patientName: String(r.patient_name ?? ''),
      createdAt: iso(r.created_at) ?? '',
    };
  });

  return {
    id: userId,
    gender: fromEnum(String(p.gender ?? '')),
    dob: iso(p.dob) ?? '',
    address: String(p.address ?? ''),
    place: String(p.place ?? ''),
    pincode: String(p.pincode ?? ''),
    state: String(p.state ?? ''),
    rewardPoints: num(p.reward_points),
    referralCode: String(p.referral_code ?? ''),
    referredByName: String(p.referred_by_name ?? ''),
    referredByPhone: String(p.referred_by_phone ?? ''),
    registrationCompletedAt: iso(p.registration_completed_at) ?? '',
    patients,
    addresses,
  };
}

/** Existing agents, for the "parent" picker when converting someone. */
export async function listAgentOptions(): Promise<AgentOption[]> {
  const rows = (await sql`
    SELECT id, code, name, level
    FROM app.agent
    ORDER BY level, code
  `) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.code),
    name: String(r.name ?? '—'),
    level: fromEnum<AgentLevel>(String(r.level ?? 'ward')),
  }));
}

/**
 * Makes the user an agent: inserts one `app.agent` row linked to their
 * `app.users` id, with an auto `SHD-AGT-00N` code. No-op (returns null) if
 * they are already an agent or investor.
 */
export async function convertToAgent(
  userId: string,
  opts: { level: AgentLevel; parentId?: string | null; area?: string },
): Promise<string | null> {
  const rows = await query<Row>(
    `
    INSERT INTO app.agent
      (member_id, code, name, phone, level, parent_id, area, approval_status)
    SELECT u.id,
           'SHD-AGT-' || lpad(((SELECT count(*) FROM app.agent) + 1)::text, 3, '0'),
           u.name, u.phone, $2::app.agent_level, $3, $4, 'APPROVED'
    FROM app.users u
    WHERE u.id = $1
      AND NOT EXISTS (SELECT 1 FROM app.agent    WHERE member_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM app.investor WHERE member_id = u.id)
    RETURNING code
    `,
    [userId, opts.level.toUpperCase(), opts.parentId ?? null, opts.area ?? ''],
  );
  return rows.length > 0 ? String(rows[0].code) : null;
}

/**
 * Makes the user an investor: inserts one `app.investor` row. No-op if they
 * are already an agent or investor.
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
): Promise<string | null> {
  const rows = await query<Row>(
    `
    INSERT INTO app.investor
      (member_id, code, name, phone, invested_store_id,
       total_units, unit_price, invested_since, roi_percent, plan_type)
    SELECT u.id,
           'SHD-INV-' || lpad(((SELECT count(*) FROM app.investor) + 1)::text, 3, '0'),
           u.name, u.phone,
           (SELECT id FROM app.shield_store WHERE code = $2),
           $3, $4, current_date, $5, $6::app.investor_plan_type
    FROM app.users u
    WHERE u.id = $1
      AND NOT EXISTS (SELECT 1 FROM app.agent    WHERE member_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM app.investor WHERE member_id = u.id)
    RETURNING code
    `,
    [
      userId,
      opts.storeCode ?? null,
      opts.totalUnits,
      opts.unitPrice,
      opts.roiPercent,
      opts.planType.toUpperCase(),
    ],
  );
  return rows.length > 0 ? String(rows[0].code) : null;
}

/**
 * Drops the user back to a plain member — removes their `app.agent` /
 * `app.investor` row. `ON DELETE SET NULL` / `CASCADE` on the child tables
 * takes their customers, withdrawals and plan-change requests with it.
 */
export async function revokePersona(userId: string): Promise<void> {
  await query(`DELETE FROM app.agent    WHERE member_id = $1`, [userId]);
  await query(`DELETE FROM app.investor WHERE member_id = $1`, [userId]);
}
