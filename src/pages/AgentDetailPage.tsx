import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { canApproveAgents } from '@/config/permissions';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailList } from '@/components/ui/DetailList';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { GeoSlotPicker } from '@/components/agents/GeoSlotPicker';
import { formatCurrency, formatDate, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import {
  getApprovedAgent,
  listAgentCustomers,
  listAgentWithdrawals,
  setAgentActive,
  updateAgentPosition,
} from '@/api/agents';
import { listAgentOptions } from '@/api/users';
import type { AgentCustomer, AgentLevel, AgentWithdrawalEntry } from '@/types';

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

/**
 * An already-approved agent — the management counterpart to
 * [AgentApprovalDetailPage] (which only ever handles a still-pending
 * request). From here an admin can move the agent to a different
 * level/parent/position, or switch them off.
 */
export default function AgentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, accessToken } = useAuth();
  const canManage = user ? canApproveAgents(user.role) : false;

  const { data: agent, loading, error, reload } = useAsync(
    () => getApprovedAgent(id, accessToken),
    [id, accessToken],
  );
  const agentOptions = useAsync(() => listAgentOptions(accessToken), [accessToken]);
  const { data: customersData, loading: customersLoading } = useAsync(
    () => listAgentCustomers(id, accessToken),
    [id, accessToken],
  );
  const { data: withdrawalsData, loading: withdrawalsLoading } = useAsync(
    () => listAgentWithdrawals(id, accessToken),
    [id, accessToken],
  );
  const customers = useMemo(() => customersData ?? [], [customersData]);
  const withdrawals = useMemo(() => withdrawalsData ?? [], [withdrawalsData]);
  const plansSold = useMemo(() => customers.reduce((sum, c) => sum + c.plans.length, 0), [customers]);

  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<AgentLevel>('ward');
  const [parentId, setParentId] = useState('');
  const [position, setPosition] = useState<{ areaId: string | null; area: string }>(
    { areaId: null, area: '' },
  );
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reached from both Agent approvals and the Agent Portal — goes back to
  // whichever one actually led here, rather than a fixed path.
  const back = () => navigate(-1);

  function startEditing() {
    if (!agent) return;
    setLevel(agent.level);
    setParentId(agent.parentId ?? '');
    setPosition({ areaId: null, area: '' });
    setActionError(null);
    setEditing(true);
  }

  async function save() {
    if (!agent) return;
    if (level !== 'national' && !position.areaId) {
      setActionError(`Choose which ${level} this agent heads.`);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await updateAgentPosition(agent.id, {
        level,
        parentId: parentId || null,
        area: position.area,
        areaId: position.areaId,
      }, accessToken);
      setEditing(false);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!agent) return;
    setSaving(true);
    setActionError(null);
    try {
      await setAgentActive(agent.id, !agent.active, accessToken);
      reload();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not change status.',
      );
    } finally {
      setSaving(false);
    }
  }

  // A parent picker excluding the agent itself — reporting to yourself makes
  // no sense and would create a cycle the tree can't walk.
  const parentChoices = (agentOptions.data ?? []).filter(
    (a) => a.id !== id,
  );

  return (
    <>
      <PageHeader
        title={agent ? agent.name : 'Agent'}
        subtitle="An agent already live in the tree — move their position or switch them off."
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
        ) : !agent ? (
          <p className="py-14 text-center text-sm text-slate-400">
            This agent could not be found.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={agent.active ? 'green' : 'gray'}>
                {agent.active ? 'Active' : 'Inactive'}
              </Badge>
              <Badge tone="blue">{titleCase(agent.level)}</Badge>
            </div>

            <DetailList
              rows={[
                { label: 'Name', value: agent.name },
                { label: 'Phone', value: agent.phone },
                { label: 'Agent code', value: agent.code },
                { label: 'Level', value: titleCase(agent.level) },
                { label: 'Position', value: agent.area || '—' },
                {
                  label: 'Reports to',
                  value: agent.parentName
                    ? `${agent.parentName} · ${agent.parentCode}`
                    : '— (top of tree)',
                },
              ]}
            />
          </>
        )}
      </Card>

      {!loading && !error && agent && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Earned" value={formatCurrency(agent.earned)} tone="violet" />
            <StatCard label="Redeemed" value={formatCurrency(agent.redeemed)} tone="blue" />
            <StatCard label="Moved to wallet" value={formatCurrency(agent.movedToWallet)} tone="amber" />
            <StatCard label="Personal sales" value={formatCurrency(agent.personalSales)} tone="green" />
            <StatCard label="Plans sold" value={plansSold} icon="check" />
          </div>

          <Card className="mt-6">
            <div className="border-b border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">Direct customers</h3>
              <p className="text-xs text-slate-400">
                Members this agent personally linked, and the Health Pass plans each has activated.
              </p>
            </div>
            <DataTable
              columns={customerColumns}
              rows={customers}
              loading={customersLoading}
              empty="No customers linked yet."
            />
          </Card>

          <Card className="mt-6">
            <div className="border-b border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">Withdrawal history</h3>
              <p className="text-xs text-slate-400">Earnings this agent has requested paid out.</p>
            </div>
            <DataTable
              columns={withdrawalColumns}
              rows={withdrawals}
              loading={withdrawalsLoading}
              empty="No withdrawals requested yet."
            />
          </Card>
        </>
      )}

      {!loading && !error && agent && (
        <Card className="mt-6 p-5">
          {canManage ? (
            !editing ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={startEditing}>
                  Change level / position
                </Button>
                <Button
                  variant={agent.active ? 'danger' : 'success'}
                  disabled={saving}
                  onClick={toggleActive}
                >
                  {agent.active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm font-medium text-slate-700">Move this agent</p>
                <div className="space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Level
                    <select
                      value={level}
                      onChange={(e) => {
                        setLevel(e.target.value as AgentLevel);
                        setPosition({ areaId: null, area: '' });
                      }}
                      className={`mt-1 ${fieldCls}`}
                    >
                      {AGENT_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {titleCase(l)}
                        </option>
                      ))}
                    </select>
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
                      {parentChoices.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name} ({titleCase(a.level)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <GeoSlotPicker level={level} onChange={setPosition} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onClick={() => {
                      setEditing(false);
                      setActionError(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" disabled={saving} onClick={save}>
                    Save position
                  </Button>
                </div>
              </>
            )
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Only a Super Admin or Admin can move or deactivate an agent.</span>
            </p>
          )}

          {actionError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

const customerColumns: Column<AgentCustomer>[] = [
  { key: 'name', header: 'Customer', render: (c) => c.name },
  { key: 'phone', header: 'Phone', render: (c) => c.phone || '—' },
  { key: 'linked', header: 'Linked on', render: (c) => formatDate(c.createdAt) },
  {
    key: 'plans',
    header: 'Plans activated',
    render: (c) =>
      c.plans.length === 0
        ? '—'
        : c.plans
            .map((p) => `${titleCase(p.tierKind.toLowerCase())} (${formatCurrency(p.amount)}) · ${formatDate(p.activatedOn)}`)
            .join(', '),
  },
];

const withdrawalColumns: Column<AgentWithdrawalEntry>[] = [
  { key: 'amount', header: 'Amount', render: (w) => formatCurrency(w.amount) },
  {
    key: 'status',
    header: 'Status',
    render: (w) => (
      <Badge tone={w.status === 'paid' ? 'green' : w.status === 'rejected' ? 'red' : 'amber'}>
        {titleCase(w.status)}
      </Badge>
    ),
  },
  { key: 'requested', header: 'Requested on', render: (w) => formatDate(w.requestedOn) },
  { key: 'approved', header: 'Approved on', render: (w) => (w.approvedAt ? formatDate(w.approvedAt) : '—') },
  { key: 'reference', header: 'Payment reference', render: (w) => w.paymentReference || '—' },
];
