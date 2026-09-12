import { query } from '@/lib/db';
import { fromEnum, iso } from '@/lib/mappers';
import { deriveParentAgentId, resyncGeoSlotAgent } from '@/api/geo';
import type { AgentLevel, AgentRow, PendingAgent } from '@/types';

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
  opts: {
    level: AgentLevel;
    parentId?: string | null;
    area?: string;
    /** The confirmed slot id. Falls back to the request's own
     *  `requested_area_id` when omitted -- but pass this whenever the admin
     *  picked a position on this screen (via the geo picker), especially
     *  when they changed the level from what was requested: the original
     *  `requested_area_id` names a slot at the *requested* level and can no
     *  longer be trusted once the level itself has changed. */
    areaId?: string | null;
  },
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
       AND area_id = COALESCE(
         $2::uuid,
         (SELECT requested_area_id FROM app.agent_request WHERE id = $1)
       )
     LIMIT 1`,
    [id, opts.areaId ?? null],
  );
  if (dup.length > 0) {
    throw new Error('That position is already held by another agent.');
  }

  // An admin who leaves "Parent agent" at "(top of tree)" almost always
  // means "I haven't thought about it", not "this agent truly reports to
  // nobody" -- derive the geographically correct one instead of taking that
  // as a deliberate choice. An explicit pick always wins over this. Needs
  // the *resolved* area (the confirmed pick, or else what was requested) up
  // front, since parent_id is set in the same INSERT as area_id below.
  let effectiveAreaId = opts.areaId ?? null;
  if (!effectiveAreaId) {
    const [req] = await query<Row>(
      `SELECT requested_area_id::text AS area_id FROM app.agent_request WHERE id = $1`,
      [id],
    );
    effectiveAreaId = (req?.area_id as string | undefined) ?? null;
  }
  const parentId =
    opts.parentId ?? (await deriveParentAgentId(level, effectiveAreaId));

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
        r.name, r.phone, $2::app.agent_level, $3, $4,
        COALESCE($5::uuid, r.requested_area_id),
        r.first_name, r.middle_name, r.last_name, r.dob, r.aadhaar, r.pan,
        r.address, r.pincode, r.place, r.account_number, 'APPROVED', true
      FROM req r
      RETURNING id, area_id::text AS area_id
    ),
    link AS (
      UPDATE app.agent_request SET agent_id = (SELECT id FROM ins)
       WHERE id = $1
       RETURNING id
    )
    SELECT id, area_id FROM ins
    `,
    [id, level, parentId, opts.area ?? '', opts.areaId ?? null],
  );
  if (rows.length === 0) {
    return false;
  }
  // Mirror the new agent onto their geo slot's own row so it's answerable
  // from that row directly, not just by querying app.agent for area_id.
  await resyncGeoSlotAgent(level, rows[0].area_id as string | null);
  return true;
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

// ---- the live roster ("All agents") -----------------------------------
//
// Distinct from the approval queue above: these are agents actually working
// today, not requests waiting to be decided. Editing one re-assigns their
// level/parent/position with the same rules approving a request enforces;
// "removing" one switches them off (`active = false`) rather than deleting
// the row outright, which would either orphan their downline (`parent_id`
// is `ON DELETE SET NULL`) or fail against whatever customer/withdrawal
// history references them, depending on the schema's own delete rules for
// those tables. An admin who genuinely needs the row gone can still do that
// directly against the database; this view only ever switches one off.

const AGENT_COLUMNS = `
    a.id, a.code, a.name, a.phone, a.level, a.area, a.area_id::text AS area_id,
    a.active, a.parent_id::text AS parent_id, a.created_at,
    pa.code AS parent_code, pa.name AS parent_name
  FROM app.agent a
  LEFT JOIN app.agent pa ON pa.id = a.parent_id
`;

function toAgentRow(r: Row): AgentRow {
  return {
    id: String(r.id),
    code: String(r.code ?? ''),
    name: String(r.name ?? '—'),
    phone: String(r.phone ?? ''),
    level: fromEnum<AgentLevel>(String(r.level ?? 'ward')),
    area: String(r.area ?? ''),
    areaId: r.area_id ? String(r.area_id) : null,
    active: r.active === true || r.active === 'true',
    parentId: r.parent_id ? String(r.parent_id) : null,
    parentCode: String(r.parent_code ?? ''),
    parentName: String(r.parent_name ?? ''),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

/** Every approved agent — the whole live roster, not just who is pending. */
export async function listApprovedAgents(): Promise<AgentRow[]> {
  const rows = await query<Row>(
    `SELECT ${AGENT_COLUMNS}
     WHERE a.approval_status = 'APPROVED'
     ORDER BY a.level, a.code`,
  );
  return rows.map(toAgentRow);
}

/** One approved agent by `app.agent.id`, for the edit page. */
export async function getApprovedAgent(id: string): Promise<AgentRow | null> {
  const rows = await query<Row>(
    `SELECT ${AGENT_COLUMNS}
     WHERE a.id = $1 AND a.approval_status = 'APPROVED'
     LIMIT 1`,
    [id],
  );
  return rows[0] ? toAgentRow(rows[0]) : null;
}

/**
 * Re-assigns an already-approved agent's level, parent, and named slot — the
 * same rules as approving a request (one national, six regions, one agent
 * per slot), with this agent's own current row excluded from every check so
 * confirming their existing position again never refuses itself.
 */
export async function updateAgentPosition(
  id: string,
  opts: {
    level: AgentLevel;
    parentId?: string | null;
    area?: string;
    areaId?: string | null;
  },
): Promise<void> {
  const level = opts.level.toUpperCase();
  if (level === 'NATIONAL' || level === 'REGION') {
    const [tally] = await query<Row>(
      `SELECT
         count(*) FILTER (WHERE level = 'NATIONAL' AND id != $1) AS national,
         count(*) FILTER (WHERE level = 'REGION' AND id != $1)   AS region
       FROM app.agent
       WHERE approval_status = 'APPROVED'`,
      [id],
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
  if (opts.areaId) {
    const dup = await query<Row>(
      `SELECT 1 FROM app.agent
       WHERE area_id = $2 AND approval_status = 'APPROVED' AND id != $1
       LIMIT 1`,
      [id, opts.areaId],
    );
    if (dup.length > 0) {
      throw new Error('That position is already held by another agent.');
    }
  }
  // The slot this agent is leaving, if any -- resynced below alongside the
  // one they're joining, so the geo table's own agent_id never keeps
  // pointing at someone who has since moved elsewhere.
  const [before] = await query<Row>(
    `SELECT level, area_id::text AS area_id FROM app.agent WHERE id = $1`,
    [id],
  );
  // Same reasoning as approveAgent / convertToAgent: an unset parent
  // defaults to the geographically correct one, not "top of tree".
  const parentId =
    opts.parentId ?? (await deriveParentAgentId(level, opts.areaId));
  await query(
    `UPDATE app.agent
       SET level = $2::app.agent_level, parent_id = $3, area = $4,
           area_id = $5::uuid, updated_at = now()
     WHERE id = $1`,
    [id, level, parentId, opts.area ?? '', opts.areaId ?? null],
  );
  if (before) {
    await resyncGeoSlotAgent(String(before.level), before.area_id as string | null);
  }
  await resyncGeoSlotAgent(level, opts.areaId ?? null);
}

/** Switches an agent on or off. See this section's own doc for why this,
 *  not a delete, is what "remove" means here. */
export async function setAgentActive(id: string, active: boolean): Promise<void> {
  await query(
    `UPDATE app.agent SET active = $2, updated_at = now() WHERE id = $1`,
    [id, active],
  );
}
