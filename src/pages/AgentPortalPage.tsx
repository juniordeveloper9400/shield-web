import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { SearchInput } from '@/components/ui/Filters';
import { formatCurrency, titleCase } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/context/AuthContext';
import { listApprovedAgents } from '@/api/agents';
import type { AgentRow } from '@/types';

/** Deepest-first order the levels actually nest in — National at the top of
 *  the tree, Ward at the bottom. Mirrors `AGENT_LEVELS` on AgentDetailPage,
 *  kept separate since that one's for a level picker, not display order. */
const LEVEL_TONE: Record<AgentRow['level'], 'violet' | 'blue' | 'amber' | 'red' | 'gray' | 'green'> = {
  national: 'violet',
  region: 'blue',
  state: 'amber',
  district: 'red',
  assembly: 'green',
  lsgd: 'gray',
  ward: 'blue',
};

interface TreeNode extends AgentRow {
  children: TreeNode[];
}

/** Builds the national-to-ward tree from the flat roster. An agent whose
 *  own parent isn't in [rows] (a stale/cleared parent_id, or simply the
 *  national agent, who has none) becomes a root — same "unreachable agent
 *  still shows up somewhere" reasoning `AgentService.getEveryoneBelowNational`
 *  documents on the backend, applied here so a data glitch hides nobody. */
function buildTree(rows: AgentRow[]): TreeNode[] {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byLevelThenCode = (a: TreeNode, b: TreeNode) => a.code.localeCompare(b.code);
  for (const node of byId.values()) node.children.sort(byLevelThenCode);
  roots.sort(byLevelThenCode);
  return roots;
}

function matches(row: AgentRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    row.name.toLowerCase().includes(needle) ||
    row.code.toLowerCase().includes(needle) ||
    row.phone.includes(needle) ||
    row.area.toLowerCase().includes(needle)
  );
}

/**
 * Agent Portal: every agent live in the tree, National down to Ward, one
 * collapsible hierarchy instead of a flat table — click through to
 * [AgentDetailPage] for one agent's full money-flow detail (earned,
 * redeemed, personal sales, moved to wallet, direct customers and
 * withdrawal history).
 */
export default function AgentPortalPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error } = useAsync(() => listApprovedAgents(accessToken), [accessToken]);
  const rows = useMemo(() => data ?? [], [data]);
  const [query, setQuery] = useState('');

  const tree = useMemo(() => buildTree(rows), [rows]);
  const q = query.trim().toLowerCase();
  const searchHits = useMemo(() => (q ? rows.filter((r) => matches(r, q)) : []), [rows, q]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          earned: acc.earned + r.earned,
          redeemed: acc.redeemed + r.redeemed,
          movedToWallet: acc.movedToWallet + r.movedToWallet,
          active: acc.active + (r.active ? 1 : 0),
        }),
        { earned: 0, redeemed: 0, movedToWallet: 0, active: 0 },
      ),
    [rows],
  );

  return (
    <>
      <PageHeader
        title="Agent Portal"
        subtitle="Every agent, National down to Ward — open one for their full money-flow detail."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Agents" value={rows.length} icon="users" tone="violet" />
        <StatCard label="Active" value={totals.active} icon="check" tone="green" />
        <StatCard label="Total earned" value={formatCurrency(totals.earned)} tone="blue" />
        <StatCard label="Moved to wallet" value={formatCurrency(totals.movedToWallet)} tone="amber" />
      </div>

      <Card>
        <div className="border-b border-slate-200 p-4">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search by name, code, phone or area…"
          />
        </div>
        {loading ? (
          <p className="py-14 text-center text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="py-14 text-center text-sm text-rose-500">{error}</p>
        ) : rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-slate-400">No agents approved yet.</p>
        ) : q ? (
          searchHits.length === 0 ? (
            <p className="py-14 text-center text-sm text-slate-400">No agent matches “{query}”.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {searchHits.map((row) => (
                <AgentLeafRow key={row.id} row={row} onOpen={() => navigate(`/agents/${row.id}`)} />
              ))}
            </div>
          )
        ) : (
          <div className="p-3">
            {tree.map((root) => (
              <AgentTreeNode key={root.id} node={root} depth={0} onOpen={(id) => navigate(`/agents/${id}`)} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function AgentLeafRow({ row, onOpen }: { row: AgentRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
    >
      <Badge tone={LEVEL_TONE[row.level]}>{titleCase(row.level)}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-800">
          {row.name} <span className="font-normal text-slate-400">· {row.code}</span>
        </p>
        <p className="truncate text-xs text-slate-400">
          {row.area || '—'} · {row.phone}
        </p>
      </div>
      <Badge tone={row.active ? 'green' : 'gray'}>{row.active ? 'Active' : 'Inactive'}</Badge>
      <p className="w-28 shrink-0 text-right text-sm font-semibold text-slate-700">
        {formatCurrency(row.earned)}
      </p>
      <Icon name="chevron-down" className="h-4 w-4 shrink-0 -rotate-90 text-slate-400" />
    </button>
  );
}

function AgentTreeNode({
  node,
  depth,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  onOpen: (id: string) => void;
}) {
  // Open by default down to Region, so the tree reads as a hierarchy at a
  // glance rather than one collapsed National row — a State/District/…
  // subtree with dozens of Ward agents stays collapsed until asked for.
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg py-2 pr-2 hover:bg-slate-50"
        style={{ paddingLeft: depth * 22 + 8 }}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!hasChildren}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100 disabled:opacity-0"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <Icon name="chevron-down" className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <Badge tone={LEVEL_TONE[node.level]}>{titleCase(node.level)}</Badge>
        <button
          type="button"
          onClick={() => onOpen(node.id)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-800 hover:text-brand-600 hover:underline"
        >
          {node.name} <span className="font-normal text-slate-400">· {node.code}</span>
        </button>
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{node.area || '—'}</span>
        <Badge tone={node.active ? 'green' : 'gray'}>{node.active ? 'Active' : 'Inactive'}</Badge>
        <span className="w-24 shrink-0 text-right text-sm font-semibold text-slate-700">
          {formatCurrency(node.earned)}
        </span>
        {hasChildren && (
          <span className="w-16 shrink-0 text-right text-xs text-slate-400">
            {node.children.length} below
          </span>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <AgentTreeNode key={child.id} node={child} depth={depth + 1} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
