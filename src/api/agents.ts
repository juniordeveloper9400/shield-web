import { query } from '@/lib/db';
import { fromEnum, iso } from '@/lib/mappers';
import type { AgentLevel, PendingAgent } from '@/types';

type Row = Record<string, unknown>;

const REQUEST_COLUMNS = `
    r.id, r.name, r.phone, r.requested_level AS level, r.requested_area AS area,
    r.first_name, r.middle_name, r.last_name, r.dob,
    r.aadhaar, r.pan, r.address, r.pincode, r.place, r.account_number,
    r.created_at,
    pa.code AS parent_code, pa.name AS parent_name
  FROM app.agent_request r
  LEFT JOIN app.agent pa ON pa.id = r.parent_agent_id
`;

function toPendingAgent(r: Row): PendingAgent {
  return {
    id: String(r.id),
    code: `REQ-${String(r.id)}`,
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

/** Every agent-registration request awaiting review, oldest first. */
export async function listPendingAgents(): Promise<PendingAgent[]> {
  const rows = await query<Row>(
    `SELECT ${REQUEST_COLUMNS}
     WHERE r.status = 'PENDING'
     ORDER BY r.created_at`,
  );
  return rows.map(toPendingAgent);
}

/** One pending request by `app.agent_request.id`, for the detail page. */
export async function getPendingAgent(id: string): Promise<PendingAgent | null> {
  const rows = await query<Row>(
    `SELECT ${REQUEST_COLUMNS}
     WHERE r.id = $1 AND r.status = 'PENDING'
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
 * Approves a request: creates the real `app.agent` row at the level / parent /
 * area the admin confirmed, links it back onto the request, and marks the
 * request APPROVED. Returns `false` (a safe no-op) when the request is no
 * longer pending; throws when the tier is already full — one national agent,
 * six regions.
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
  // A named slot (region, or any state/district/assembly/lsgd/ward below it)
  // holds exactly one agent. This used to check REGION only, which let two
  // requests for the same state (or district, ...) both get approved into
  // two separate app.agent rows heading the same slot -- the team tree then
  // shows whichever one it happens to match first and silently drops the
  // other. area_id alone is enough to detect the clash: it is NULL for a
  // free-text-place agent (never matches) and otherwise unique to one row in
  // one geo table, so no level filter is needed.
  const dup = await query<Row>(
    `SELECT 1 FROM app.agent
     WHERE approval_status = 'APPROVED'
       AND area_id = (SELECT requested_area_id FROM app.agent_request WHERE id = $1)
     LIMIT 1`,
    [id],
  );
  if (dup.length > 0) {
    throw new Error('That position is already held by another agent.');
  }

  const rows = await query<Row>(
    `
    WITH req AS (
      UPDATE app.agent_request
         SET status = 'APPROVED', reviewed_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *
    ),
    ins AS (
      INSERT INTO app.agent (
        code, name, phone, level, parent_id, area, area_id,
        first_name, middle_name, last_name, dob, aadhaar, pan,
        address, pincode, place, account_number, approval_status, active
      )
      SELECT
        'SHD-AGT-' || lpad((
          COALESCE(
            (SELECT max(substring(code from '[0-9]+$')::int) FROM app.agent), 0
          ) + 1)::text, 3, '0'),
        r.name, r.phone, $2::app.agent_level, $3, $4, r.requested_area_id,
        r.first_name, r.middle_name, r.last_name, r.dob, r.aadhaar, r.pan,
        r.address, r.pincode, r.place, r.account_number, 'APPROVED', true
      FROM req r
      RETURNING id
    ),
    link AS (
      UPDATE app.agent_request SET agent_id = (SELECT id FROM ins)
       WHERE id = $1
       RETURNING id
    )
    SELECT id FROM ins
    `,
    [id, level, opts.parentId ?? null, opts.area ?? ''],
  );
  return rows.length > 0;
}

/**
 * Rejects a request with a reason the recruiter sees in the app. Returns
 * `false` when the request is no longer pending. The request row is kept (as
 * `REJECTED`) and no `app.agent` row is created, so the slot frees up.
 */
export async function rejectAgent(id: string, note: string): Promise<boolean> {
  const reason = note.trim();
  if (!reason) {
    throw new Error('A rejection needs a reason.');
  }
  const rows = await query<Row>(
    `UPDATE app.agent_request
       SET status = 'REJECTED', reviewer_note = $2,
           reviewed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING id`,
    [id, reason],
  );
  return rows.length > 0;
}
