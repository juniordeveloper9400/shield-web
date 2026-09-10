import { query } from '@/lib/db';
import { fromEnum, iso } from '@/lib/mappers';
import type { AgentLevel, PendingAgent } from '@/types';

type Row = Record<string, unknown>;

const PENDING_COLUMNS = `
    a.id, a.code, a.name, a.phone, a.level, a.area,
    a.first_name, a.middle_name, a.last_name, a.dob,
    a.aadhaar, a.pan, a.address, a.pincode, a.place, a.account_number,
    a.created_at,
    pa.code AS parent_code, pa.name AS parent_name
  FROM app.agent a
  LEFT JOIN app.agent pa ON pa.id = a.parent_id
`;

function toPendingAgent(r: Row): PendingAgent {
  return {
    id: String(r.id),
    code: String(r.code ?? ''),
    name: String(r.name ?? '—'),
    phone: String(r.phone ?? ''),
    level: fromEnum<AgentLevel>(String(r.level ?? 'ward')),
    area: String(r.area ?? ''),
    firstName: String(r.first_name ?? ''),
    middleName: String(r.middle_name ?? ''),
    lastName: String(r.last_name ?? ''),
    dob: iso(r.dob) ?? '',
    aadhaar: String(r.aadhaar ?? ''),
    pan: String(r.pan ?? ''),
    address: String(r.address ?? ''),
    pincode: String(r.pincode ?? ''),
    place: String(r.place ?? ''),
    accountNumber: String(r.account_number ?? ''),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    parentCode: String(r.parent_code ?? ''),
    parentName: String(r.parent_name ?? ''),
  };
}

/** Every agent registered from the app and still awaiting review, oldest first. */
export async function listPendingAgents(): Promise<PendingAgent[]> {
  const rows = await query<Row>(
    `SELECT ${PENDING_COLUMNS}
     WHERE a.approval_status = 'PENDING'
     ORDER BY a.created_at`,
  );
  return rows.map(toPendingAgent);
}

/** One pending agent by `app.agent.id`, for the detail page. */
export async function getPendingAgent(id: string): Promise<PendingAgent | null> {
  const rows = await query<Row>(
    `SELECT ${PENDING_COLUMNS}
     WHERE a.id = $1 AND a.approval_status = 'PENDING'
     LIMIT 1`,
    [id],
  );
  return rows[0] ? toPendingAgent(rows[0]) : null;
}

/** The current tally of live agents at the capped tiers. */
async function cappedTierCounts(): Promise<{ national: number; region: number }> {
  const [tally] = await query<Row>(
    `SELECT
       count(*) FILTER (WHERE level = 'NATIONAL') AS national,
       count(*) FILTER (WHERE level = 'REGION')   AS region
     FROM app.agent
     WHERE approval_status = 'APPROVED'`,
  );
  return {
    national: Number(tally?.national ?? 0),
    region: Number(tally?.region ?? 0),
  };
}

/**
 * Approves a pending agent: sets the level/parent/area the admin chose, flips
 * `approval_status` to `APPROVED` and switches the agent on. Returns `false`
 * (a safe no-op) when the row is no longer pending; throws when the tier is
 * already full — one national agent, six regions.
 */
export async function approveAgent(
  id: string,
  opts: { level: AgentLevel; parentId?: string | null; area?: string },
): Promise<boolean> {
  const level = opts.level.toUpperCase();
  if (level === 'NATIONAL' || level === 'REGION') {
    const { national, region } = await cappedTierCounts();
    if (level === 'NATIONAL' && national >= 1) {
      throw new Error(
        'There is already a national agent — only one is allowed.',
      );
    }
    if (level === 'REGION' && region >= 6) {
      throw new Error(
        'All six regions already have an agent — no more region agents can be added.',
      );
    }
  }

  const rows = await query<Row>(
    `UPDATE app.agent
       SET approval_status = 'APPROVED',
           active          = true,
           level           = $2::app.agent_level,
           parent_id       = $3,
           area            = $4,
           reviewed_at     = now()
     WHERE id = $1 AND approval_status = 'PENDING'
     RETURNING id`,
    [id, level, opts.parentId ?? null, opts.area ?? ''],
  );
  return rows.length > 0;
}

/**
 * Rejects a pending agent with a reason the recruiter sees in the app. Returns
 * `false` when the row is no longer pending. The row is kept (as `REJECTED`),
 * not deleted, and its slot frees up.
 */
export async function rejectAgent(id: string, note: string): Promise<boolean> {
  const reason = note.trim();
  if (!reason) {
    throw new Error('A rejection needs a reason.');
  }
  const rows = await query<Row>(
    `UPDATE app.agent
       SET approval_status = 'REJECTED',
           active          = false,
           reviewer_note   = $2,
           reviewed_at     = now()
     WHERE id = $1 AND approval_status = 'PENDING'
     RETURNING id`,
    [id, reason],
  );
  return rows.length > 0;
}
