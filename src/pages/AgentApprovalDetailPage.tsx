import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canApproveAgents } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { Icon } from '@/components/ui/Icon';
import { GeoSlotPicker } from '@/components/agents/GeoSlotPicker';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { approveAgent, getPendingAgent, rejectAgent } from '@/api/agents';
import { listAgentOptions } from '@/api/users';
import type { AgentLevel } from '@/types';

const AGENT_LEVELS: AgentLevel[] = [
  'national',
  'region',
  'state',
  'district',
  'assembly',
  'lsgd',
  'ward',
];

const fieldCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

export default function AgentApprovalDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canApprove = user ? canApproveAgents(user.role) : false;

  const { data: selected, loading, error, reload } = useAsync(
    () => getPendingAgent(id),
    [id],
  );
  const agents = useAsync(listAgentOptions, []);

  const [level, setLevel] = useState<AgentLevel>('ward');
  const [parentId, setParentId] = useState('');
  // Only asked for when [level] is changed away from what the recruiter
  // requested — the request's own requested_area_id already names a real
  // slot at the *requested* level, and approveAgent falls back to it
  // automatically when this stays unset, but that id would name the wrong
  // kind of place once the level itself changes.
  const [position, setPosition] = useState<{ areaId: string | null; area: string }>(
    { areaId: null, area: '' },
  );
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pre-fill the form with what the recruiter chose in the app.
  useEffect(() => {
    if (!selected) return;
    setLevel(selected.level);
  }, [selected]);
  useEffect(() => {
    if (!selected || !agents.data) return;
    const parent = agents.data.find((a) => a.code === selected.parentCode);
    if (parent) setParentId(parent.id);
  }, [selected, agents.data]);

  const tierCounts = useMemo(() => {
    const rows = agents.data ?? [];
    return {
      national: rows.filter((a) => a.level === 'national').length,
      region: rows.filter((a) => a.level === 'region').length,
    };
  }, [agents.data]);
  const nationalFull = tierCounts.national >= 1;
  const regionFull = tierCounts.region >= 6;

  const back = () => navigate('/agent-approvals');

  async function approve() {
    if (!canApprove) {
      setActionError('Only a Super Admin or Admin can approve agents.');
      return;
    }
    if (level === 'national' && nationalFull) {
      setActionError('There is already a national agent — only one is allowed.');
      return;
    }
    if (level === 'region' && regionFull) {
      setActionError(
        'All six regions already have an agent — no more region agents can be added.',
      );
      return;
    }
    const levelChanged = selected && level !== selected.level;
    if (levelChanged && level !== 'national' && !position.areaId) {
      setActionError(`Choose which ${level} this agent heads.`);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const ok = await approveAgent(id, {
        level,
        parentId: parentId || null,
        // Unchanged from what was requested: keep the recruiter's own
        // area / requested_area_id (areaId left unset so the server falls
        // back to it) rather than overwriting an already-correct value
        // with whatever happens to be sitting in `position` unrelated.
        area: levelChanged ? position.area : selected?.area ?? '',
        areaId: levelChanged ? position.areaId : undefined,
      });
      if (!ok) {
        setActionError('This agent is no longer pending — reloading.');
        reload();
        return;
      }
      back();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setSaving(false);
    }
  }

  async function reject() {
    if (!canApprove) {
      setActionError('Only a Super Admin or Admin can reject agents.');
      return;
    }
    if (!note.trim()) {
      setActionError('Give the recruit a reason for the rejection.');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const ok = await rejectAgent(id, note);
      if (!ok) {
        setActionError('This agent is no longer pending — reloading.');
        reload();
        return;
      }
      back();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not reject.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={selected ? selected.name : 'Agent approval'}
        subtitle="New agent — review the KYC and set the position"
        actions={
          <Button variant="secondary" size="sm" onClick={back}>
            ← Back
          </Button>
        }
      />

      <Card className="p-5">
        {loading ? (
          <p className="py-14 text-center text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="py-14 text-center text-sm text-rose-500">{error}</p>
        ) : !selected ? (
          <p className="py-14 text-center text-sm text-slate-400">
            This agent is not awaiting approval.
          </p>
        ) : (
          <>
            <div className="mb-3">
              <Badge tone="amber">Pending approval</Badge>
            </div>

            <DetailList
              rows={[
                { label: 'Name', value: selected.name },
                { label: 'Phone', value: selected.phone },
                { label: 'Agent code', value: selected.code },
                {
                  label: 'Date of birth',
                  value: selected.dob ? formatDate(selected.dob) : '—',
                },
                { label: 'Aadhaar', value: selected.aadhaar || '—' },
                { label: 'PAN', value: selected.pan || '—' },
                { label: 'Address', value: selected.address || '—' },
                {
                  label: 'PIN / Place',
                  value:
                    [selected.pincode, selected.place]
                      .filter(Boolean)
                      .join(' · ') || '—',
                },
                {
                  label: 'Bank account',
                  value: selected.accountNumber || '—',
                },
                {
                  label: 'Reports to',
                  value: selected.parentName
                    ? `${selected.parentName} · ${selected.parentCode}`
                    : '—',
                },
                {
                  label: 'Requested level',
                  value: titleCase(selected.level),
                },
                { label: 'Requested position', value: selected.area || '—' },
                {
                  label: 'Submitted',
                  value: formatDateTime(selected.createdAt),
                },
              ]}
            />

            {canApprove && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Confirm the agent's position
                </p>
                <div className="space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Level
                    <select
                      value={level}
                      onChange={(e) => setLevel(e.target.value as AgentLevel)}
                      className={`mt-1 ${fieldCls}`}
                    >
                      {AGENT_LEVELS.map((l) => {
                        const full =
                          (l === 'national' && nationalFull) ||
                          (l === 'region' && regionFull);
                        return (
                          <option key={l} value={l} disabled={full}>
                            {titleCase(l)}
                            {full ? ' — already filled' : ''}
                          </option>
                        );
                      })}
                    </select>
                    {(nationalFull || regionFull) && (
                      <span className="mt-1 block text-xs font-normal normal-case text-slate-400">
                        {nationalFull && 'A national agent already exists. '}
                        {regionFull && 'All six regions are taken. '}
                        Those levels can't be assigned again.
                      </span>
                    )}
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Parent agent{' '}
                    <span className="font-normal text-slate-400">— optional</span>
                    <select
                      value={parentId}
                      onChange={(e) => setParentId(e.target.value)}
                      className={`mt-1 ${fieldCls}`}
                    >
                      <option value="">(top of tree)</option>
                      {(agents.data ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name} ({titleCase(a.level)})
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected && level === selected.level ? (
                    <p className="text-xs text-slate-500">
                      Position: <span className="font-medium text-slate-700">
                        {selected.area || '—'}
                      </span>{' '}
                      — as requested. Change the level above to pick a
                      different one.
                    </p>
                  ) : (
                    <GeoSlotPicker level={level} onChange={setPosition} />
                  )}
                </div>

                <div className="mt-4">
                  {rejecting ? (
                    <>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">
                        Reason for rejection
                      </label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder="The recruit sees this on their pending card, e.g. 'Aadhaar number does not match the name given.'"
                        className={fieldCls}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={saving}
                          onClick={() => {
                            setRejecting(false);
                            setActionError(null);
                          }}
                        >
                          Back
                        </Button>
                        <Button
                          variant="danger"
                          disabled={saving}
                          onClick={reject}
                        >
                          Confirm rejection
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        disabled={saving}
                        onClick={() => setRejecting(true)}
                      >
                        Reject
                      </Button>
                      <Button
                        variant="success"
                        disabled={saving}
                        onClick={approve}
                      >
                        <Icon name="check" className="h-4 w-4" /> Approve agent
                      </Button>
                    </div>
                  )}
                  {!rejecting && (
                    <p className="mt-3 text-xs text-slate-400">
                      Approving switches the agent on at the level and position
                      above; they can then sign in and recruit under themselves.
                    </p>
                  )}
                </div>
              </div>
            )}

            {!canApprove && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This agent is awaiting review. Only a Super Admin or Admin can
                  approve or reject it.
                </span>
              </p>
            )}

            {actionError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
