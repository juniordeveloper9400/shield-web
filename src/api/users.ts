import { sql, query } from '@/lib/db';
import { fromEnum, iso, num } from '@/lib/mappers';
import { deriveParentAgentId, resyncGeoSlotAgent } from '@/api/geo';
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

/** `app.users` + home branch + persona row → the shape the console renders. */
function toAppUser(r: Row): AppUser {
  return {
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
    agentLevel: r.agent_level ? fromEnum<AgentLevel>(String(r.agent_level)) : '',
    investorCode: String(r.investor_code ?? ''),
  };
}

const USER_COLUMNS = `
    u.id, u.name, u.phone, u.email,
    u.registration_completed_at IS NOT NULL AS registered,
    u.created_at, u.last_login_at,
    s.code AS home_store_code, s.name AS home_store_name,
    a.code  AS agent_code,  a.level AS agent_level,
    i.code  AS investor_code
  FROM app.users u
  LEFT JOIN app.shield_store s ON s.id = u.home_store_id
  LEFT JOIN app.agent a        ON a.member_id = u.id
  LEFT JOIN app.investor i     ON i.member_id = u.id
`;

/**
 * Every app member (`app.users`), newest first, tagged with the persona the
 * Super Admin has granted them — `member`, `agent` (an `app.agent` row) or
 * `investor` (an `app.investor` row).
 */
export async function listUsers(): Promise<AppUser[]> {
  const rows = await query<Row>(
    `SELECT ${USER_COLUMNS}
     WHERE u.deleted_at IS NULL
     ORDER BY u.created_at DESC`,
  );
  return rows.map(toAppUser);
}

/** A single member by `app.users.id`, for the detail page. */
export async function getUser(id: string): Promise<AppUser | null> {
  const rows = await query<Row>(
    `SELECT ${USER_COLUMNS} WHERE u.id = $1 AND u.deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0] ? toAppUser(rows[0]) : null;
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

/**
 * Corrects a member's own name/phone directly on `app.users` — used from the
 * prescription review flow when what they typed at registration turns out
 * wrong. This is their account's actual name/phone, so the fix shows
 * everywhere on it (orders, wallet, other scripts), not just the one
 * prescription being reviewed. Returns `false`, changing nothing, when
 * [phone] already belongs to a different account.
 */
export async function updateMemberContact(
  memberId: string,
  input: { name: string; phone: string },
): Promise<boolean> {
  const rows = await query<Row>(
    `
    UPDATE app.users u
       SET name = $2, phone = $3, updated_at = now()
     WHERE u.id = $1
       AND NOT EXISTS (
         SELECT 1 FROM app.users o WHERE o.phone = $3 AND o.id <> $1
       )
     RETURNING id
    `,
    [memberId, input.name.trim(), input.phone.trim()],
  );
  return rows.length > 0;
}

/**
 * Corrects a saved patient profile's name — `app.patient.name`. The same
 * patient row can be named on other prescriptions and saved addresses, so
 * this changes how they show up everywhere, not just on the prescription
 * being reviewed.
 */
export async function updatePatientName(
  patientId: string,
  name: string,
): Promise<void> {
  await query(`UPDATE app.patient SET name = $2, updated_at = now() WHERE id = $1`, [
    patientId,
    name.trim(),
  ]);
}

/**
 * Approved agents only, for the "parent" picker and the one-national /
 * six-region caps. A pending or rejected registration is neither a valid
 * parent nor a slot that counts as taken.
 */
export async function listAgentOptions(): Promise<AgentOption[]> {
  const rows = (await sql`
    SELECT id, code, name, level
    FROM app.agent
    WHERE approval_status = 'APPROVED'
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
 * Throws when [userId] has not finished registration — a member can only be
 * made an agent or investor once their `app.users` row has a
 * `registration_completed_at`. Called after a convert INSERT touches no rows,
 * so the caller can tell "not registered" apart from "already has a persona".
 */
async function assertRegistered(userId: string): Promise<void> {
  const rows = await query<Row>(
    `SELECT registration_completed_at IS NOT NULL AS registered
     FROM app.users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (rows[0] && rows[0].registered === false) {
    throw new Error(
      'This member has not completed registration yet — they cannot be ' +
        'converted to an agent or investor.',
    );
  }
}

/**
 * Makes the user an agent: inserts one `app.agent` row linked to their
 * `app.users` id, with an auto `SHD-AGT-00N` code. Only members who have
 * completed registration are eligible. Returns null (no-op) when they are
 * already an agent or investor; throws when registration is incomplete, when a
 * national agent already exists, when all six regions are taken, or when the
 * chosen slot is already held by another approved agent.
 */
export async function convertToAgent(
  userId: string,
  opts: {
    level: AgentLevel;
    parentId?: string | null;
    area?: string;
    /** The `app.region` / `app.state` / … row this agent heads — required
     *  for every level below national, same as the app's own registration
     *  form. Without it the agent can never lock into a slot in the team
     *  tree; see [Agent.areaId]'s doc on the Flutter side. */
    areaId?: string | null;
  },
): Promise<string | null> {
  const level = opts.level.toUpperCase();

  // The top of the tree is fixed in shape: exactly one national agent, and at
  // most six regions. Check before inserting so the admin gets a clear reason
  // rather than a silent no-op.
  if (level === 'NATIONAL' || level === 'REGION') {
    const [tally] = await query<Row>(
      `SELECT
         count(*) FILTER (WHERE level = 'NATIONAL') AS national,
         count(*) FILTER (WHERE level = 'REGION')   AS region
       FROM app.agent`,
    );
    const nationalCount = Number(tally?.national ?? 0);
    const regionCount = Number(tally?.region ?? 0);
    if (level === 'NATIONAL' && nationalCount >= 1) {
      throw new Error(
        'There is already a national agent — only one is allowed.',
      );
    }
    if (level === 'REGION' && regionCount >= 6) {
      throw new Error(
        'All six regions already have an agent — no more region agents can be added.',
      );
    }
  }

  // A named slot holds exactly one agent. Refuse a second one into a slot an
  // approved agent already occupies — the same rule the app's own
  // registration screen enforces before it ever reaches this console.
  if (opts.areaId) {
    const dup = await query<Row>(
      `SELECT 1 FROM app.agent
       WHERE area_id = $1 AND approval_status = 'APPROVED'
       LIMIT 1`,
      [opts.areaId],
    );
    if (dup.length > 0) {
      throw new Error('That position is already held by another agent.');
    }
  }

  // An admin who leaves "Parent agent" at "(top of tree)" almost always
  // means "I haven't thought about it", not "this agent truly reports to
  // nobody" -- derive the geographically correct one instead of taking that
  // as a deliberate choice. An explicit pick always wins over this.
  const parentId =
    opts.parentId ?? (await deriveParentAgentId(level, opts.areaId));

  const rows = await query<Row>(
    `
    INSERT INTO app.agent
      (member_id, code, name, phone, level, parent_id, area, area_id, approval_status)
    SELECT u.id,
           'SHD-AGT-' || lpad((
             COALESCE(
               (SELECT max(substring(code from '[0-9]+$')::int) FROM app.agent),
               0
             ) + 1)::text, 3, '0'),
           u.name, u.phone, $2::app.agent_level, $3, $4, $5::uuid, 'APPROVED'
    FROM app.users u
    WHERE u.id = $1
      AND u.registration_completed_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM app.agent    WHERE member_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM app.investor WHERE member_id = u.id)
    RETURNING code
    `,
    [userId, level, parentId, opts.area ?? '', opts.areaId ?? null],
  );
  if (rows.length > 0) {
    // Mirror the new agent onto their geo slot's own row — see
    // resyncGeoSlotAgent's doc.
    await resyncGeoSlotAgent(level, opts.areaId ?? null);
    return String(rows[0].code);
  }
  await assertRegistered(userId);
  return null;
}

/**
 * Makes the user an investor: inserts one `app.investor` row. Only members who
 * have completed registration are eligible. Returns null (no-op) when they are
 * already an agent or investor; throws when registration is incomplete.
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
           'SHD-INV-' || lpad((
             COALESCE(
               (SELECT max(substring(code from '[0-9]+$')::int) FROM app.investor),
               0
             ) + 1)::text, 3, '0'),
           u.name, u.phone,
           (SELECT id FROM app.shield_store WHERE code = $2),
           $3, $4, current_date, $5, $6::app.investor_plan_type
    FROM app.users u
    WHERE u.id = $1
      AND u.registration_completed_at IS NOT NULL
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
  if (rows.length > 0) {
    return String(rows[0].code);
  }
  await assertRegistered(userId);
  return null;
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
