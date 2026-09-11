import { useEffect, useMemo, useState } from 'react';
import { GEO_TIER_ORDER, listSlots, type GeoTier } from '@/api/geo';
import type { AgentLevel, GeoSlot } from '@/types';

const fieldCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

const emptyChain: Record<GeoTier, string> = {
  region: '',
  state: '',
  district: '',
  assembly: '',
  lsgd: '',
  ward: '',
};
const emptyOptions: Record<GeoTier, GeoSlot[]> = {
  region: [],
  state: [],
  district: [],
  assembly: [],
  lsgd: [],
  ward: [],
};

/**
 * A cascading region -> state -> district -> assembly -> lsgd -> ward
 * picker, sized to however many tiers [level] needs (nothing for national).
 * Always starts blank: there is no live "resolve this area_id back to its
 * ancestor chain" lookup, so every caller that needs to *change* an
 * existing agent's position shows their current one as read-only text and
 * only mounts this component when the admin actually chooses to change it
 * — never pre-filled from it.
 *
 * Reports the id/name of the slot at [level] itself via [onChange] whenever
 * the chain resolves that far (both null/empty otherwise), including once
 * on mount — callers that keep a "pending new position" state separate from
 * "current position" are unaffected; one that doesn't would have its
 * current position clobbered by this component's initial blank state, so
 * don't render this until the admin means to change the position.
 */
export function GeoSlotPicker({
  level,
  onChange,
}: {
  level: AgentLevel;
  onChange: (value: { areaId: string | null; area: string }) => void;
}) {
  const [chain, setChain] = useState<Record<GeoTier, string>>(emptyChain);
  const [chainOptions, setChainOptions] =
    useState<Record<GeoTier, GeoSlot[]>>(emptyOptions);

  const neededTiers = useMemo<GeoTier[]>(
    () =>
      level === 'national'
        ? []
        : GEO_TIER_ORDER.slice(0, GEO_TIER_ORDER.indexOf(level as GeoTier) + 1),
    [level],
  );

  function pickTier(tier: GeoTier, value: string) {
    setChain((prev) => {
      const next = { ...prev, [tier]: value };
      GEO_TIER_ORDER.slice(GEO_TIER_ORDER.indexOf(tier) + 1).forEach((t) => {
        next[t] = '';
      });
      return next;
    });
  }

  // A different level needs a differently-shaped chain — start clean.
  useEffect(() => {
    setChain(emptyChain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  useEffect(() => {
    if (!neededTiers.includes('region')) return;
    listSlots('region', null).then((opts) =>
      setChainOptions((prev) => ({ ...prev, region: opts })),
    );
  }, [neededTiers]);
  useEffect(() => {
    if (!neededTiers.includes('state')) return;
    if (!chain.region) {
      setChainOptions((prev) => ({ ...prev, state: [] }));
      return;
    }
    listSlots('state', chain.region).then((opts) =>
      setChainOptions((prev) => ({ ...prev, state: opts })),
    );
  }, [neededTiers, chain.region]);
  useEffect(() => {
    if (!neededTiers.includes('district')) return;
    if (!chain.state) {
      setChainOptions((prev) => ({ ...prev, district: [] }));
      return;
    }
    listSlots('district', chain.state).then((opts) =>
      setChainOptions((prev) => ({ ...prev, district: opts })),
    );
  }, [neededTiers, chain.state]);
  useEffect(() => {
    if (!neededTiers.includes('assembly')) return;
    if (!chain.district) {
      setChainOptions((prev) => ({ ...prev, assembly: [] }));
      return;
    }
    listSlots('assembly', chain.district).then((opts) =>
      setChainOptions((prev) => ({ ...prev, assembly: opts })),
    );
  }, [neededTiers, chain.district]);
  useEffect(() => {
    if (!neededTiers.includes('lsgd')) return;
    if (!chain.assembly) {
      setChainOptions((prev) => ({ ...prev, lsgd: [] }));
      return;
    }
    listSlots('lsgd', chain.assembly).then((opts) =>
      setChainOptions((prev) => ({ ...prev, lsgd: opts })),
    );
  }, [neededTiers, chain.assembly]);
  useEffect(() => {
    if (!neededTiers.includes('ward')) return;
    if (!chain.lsgd) {
      setChainOptions((prev) => ({ ...prev, ward: [] }));
      return;
    }
    listSlots('ward', chain.lsgd).then((opts) =>
      setChainOptions((prev) => ({ ...prev, ward: opts })),
    );
  }, [neededTiers, chain.lsgd]);

  const areaTier = level === 'national' ? null : (level as GeoTier);
  const areaId = areaTier ? chain[areaTier] || null : null;
  const areaName =
    areaTier && areaId
      ? chainOptions[areaTier].find((s) => s.id === areaId)?.name ?? ''
      : '';

  useEffect(() => {
    onChange({ areaId, area: areaName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, areaName]);

  if (neededTiers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Position — the named slot this agent heads
      </p>
      {neededTiers.map((tier, i) => {
        const parentTier = i > 0 ? neededTiers[i - 1] : null;
        const locked = parentTier != null && !chain[parentTier];
        return (
          <label
            key={tier}
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            {tier.charAt(0).toUpperCase() + tier.slice(1)}
            <select
              value={chain[tier]}
              onChange={(e) => pickTier(tier, e.target.value)}
              disabled={locked}
              className={`mt-1 ${fieldCls} disabled:bg-slate-50 disabled:text-slate-400`}
            >
              <option value="">
                {locked ? `Choose a ${parentTier} first` : `Pick a ${tier}`}
              </option>
              {chainOptions[tier].map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.code ? ` (${s.code})` : ''}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
