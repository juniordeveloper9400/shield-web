import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAsync } from '@/lib/useAsync';
import {
  calculateKmCharge,
  distanceRateNote,
  getDistanceTiers,
  matchDistanceTier,
  type DistanceRate,
} from '@/lib/labCharges';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import {
  listLabCharges,
  saveLabCharge,
  type LabCharge,
  type LabChargeInput,
} from '@/api/labCharges';

const defaultDistanceRate: DistanceRate = {
  firstKm: 3,
  firstAmount: 20,
  secondKm: 5,
  secondAmount: 50,
  extraPerKm: 15,
};

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50';

function formatInr(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(n);
}

export default function LabChargesPage() {
  const { accessToken } = useAuth();
  const { data, loading, error, reload } = useAsync(() => listLabCharges(accessToken), [accessToken]);

  const [activeTab, setActiveTab] = useState<'fuel' | 'technician'>('fuel');

  // Edit modals state
  const [editingFuel, setEditingFuel] = useState<boolean>(false);
  const [fuelDraft, setFuelDraft] = useState<DistanceRate & { isActive: boolean }>({
    ...defaultDistanceRate,
    isActive: true,
  });

  const [editingTech, setEditingTech] = useState<boolean>(false);
  const [techDraft, setTechDraft] = useState<{ amount: number; isActive: boolean }>({
    amount: 10,
    isActive: true,
  });

  // Simulator test km input
  const [testKm, setTestKm] = useState<string>('4.5');

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Extract fuel distance charge and technician charge rows
  const distanceCharges = (data ?? []).filter((r) => r.kind === 'DISTANCE');
  const activeDistance = distanceCharges.find((r) => r.isActive) ?? distanceCharges[0];
  const currentRate: DistanceRate = activeDistance?.kind === 'DISTANCE'
    ? {
        firstKm: activeDistance.firstKm,
        firstAmount: activeDistance.firstAmount,
        secondKm: activeDistance.secondKm,
        secondAmount: activeDistance.secondAmount,
        extraPerKm: activeDistance.extraPerKm,
      }
    : defaultDistanceRate;
  const isFuelActive = Boolean(activeDistance?.isActive);

  const techCharges = (data ?? []).filter((r) => r.kind === 'TECHNICIAN');
  const currentTech = techCharges.find((r) => r.isActive) ?? techCharges[0];
  const techAmount = currentTech?.amount ?? 10;
  const isTechActive = Boolean(currentTech?.isActive);

  const tiers = getDistanceTiers(currentRate);

  // Calculator simulation
  const numericTestKm = parseFloat(testKm);
  const testMatch = !isNaN(numericTestKm) && numericTestKm > 0
    ? matchDistanceTier(numericTestKm, currentRate)
    : null;

  function openEditFuel() {
    setFuelDraft({
      ...currentRate,
      isActive: isFuelActive,
    });
    setFormError(null);
    setEditingFuel(true);
  }

  function openEditTech() {
    setTechDraft({
      amount: techAmount,
      isActive: isTechActive,
    });
    setFormError(null);
    setEditingTech(true);
  }

  async function handleToggleFuelActive() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const input: LabChargeInput = {
        name: activeDistance?.name || 'Home collection distance',
        kind: 'DISTANCE',
        ...currentRate,
        isActive: !isFuelActive,
      };
      await saveLabCharge(activeDistance?.id ?? null, input, accessToken);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not toggle fuel charge status.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleTechActive() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const input: LabChargeInput = {
        name: currentTech?.name || 'Technician visit',
        kind: 'TECHNICIAN',
        amount: techAmount,
        isActive: !isTechActive,
      };
      await saveLabCharge(currentTech?.id ?? null, input, accessToken);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not toggle technician charge status.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveFuel() {
    if (busy) return;
    if (fuelDraft.secondKm <= fuelDraft.firstKm) {
      setFormError('The second distance limit must be greater than the first distance limit.');
      return;
    }
    if (fuelDraft.secondAmount < fuelDraft.firstAmount) {
      setFormError('Charge for the second distance limit must not be less than the first limit.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const input: LabChargeInput = {
        name: activeDistance?.name || 'Home collection distance',
        kind: 'DISTANCE',
        firstKm: fuelDraft.firstKm,
        firstAmount: fuelDraft.firstAmount,
        secondKm: fuelDraft.secondKm,
        secondAmount: fuelDraft.secondAmount,
        extraPerKm: fuelDraft.extraPerKm,
        isActive: fuelDraft.isActive,
      };
      await saveLabCharge(activeDistance?.id ?? null, input, accessToken);
      setEditingFuel(false);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save fuel charge.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTech() {
    if (busy) return;
    if (fuelDraft.secondAmount < 0) {
      setFormError('Fee must not be negative.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const input: LabChargeInput = {
        name: currentTech?.name || 'Technician visit',
        kind: 'TECHNICIAN',
        amount: techDraft.amount,
        isActive: techDraft.isActive,
      };
      await saveLabCharge(currentTech?.id ?? null, input, accessToken);
      setEditingTech(false);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save technician charge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Lab Charges"
        subtitle="Manage dynamic fuel distance calculation and technician visit fees for lab bookings."
      />

      {error && (
        <div role="alert" className="mb-5 flex items-center justify-between rounded-xl bg-rose-50 p-4 text-sm text-rose-700 border border-rose-200">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">
          Loading lab charges...
        </div>
      ) : (
        <div className="space-y-6">
          {/* Two Main Tabs */}
          <div className="flex border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('fuel')}
              className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'fuel'
                  ? 'border-brand-600 text-brand-700 bg-brand-50/40 rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon name="deliveries" className="h-4 w-4" />
              <span>Fuel Charge (Distance Rates)</span>
              <Badge tone={isFuelActive ? 'green' : 'gray'}>
                {isFuelActive ? 'Active' : 'Inactive'}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('technician')}
              className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-colors ${
                activeTab === 'technician'
                  ? 'border-brand-600 text-brand-700 bg-brand-50/40 rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon name="users" className="h-4 w-4" />
              <span>Technician Charge</span>
              <Badge tone={isTechActive ? 'green' : 'gray'}>
                {isTechActive ? 'Active' : 'Inactive'}
              </Badge>
            </button>
          </div>

          {/* ================= TAB 1: FUEL CHARGE ================= */}
          {activeTab === 'fuel' && (
            <div className="space-y-6">
              {/* Status & Control Banner */}
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold text-slate-800">
                      Home Collection Distance Rates
                    </h3>
                    <Badge tone={isFuelActive ? 'green' : 'gray'}>
                      {isFuelActive ? 'Active in Lab Orders' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 max-w-2xl">
                    Charges are automatically calculated per order based on customer kilometer distance,
                    applying the active 3-tier distance rate range below.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    variant={isFuelActive ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={busy}
                    onClick={handleToggleFuelActive}
                  >
                    {isFuelActive ? 'Deactivate calculation' : 'Activate calculation'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={openEditFuel}>
                    <Icon name="edit" className="mr-1.5 h-3.5 w-3.5" />
                    Edit rate limits
                  </Button>
                </div>
              </div>

              {/* 3 Distance Range Cards */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Active KM Range Tiers (3 Cards)
                  </h4>
                  <span className="text-xs text-slate-400">
                    Calculated dynamically in Lab Order section
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  {/* Card 1: Up to 3 km */}
                  <div
                    className={`relative flex flex-col justify-between rounded-xl border p-5 shadow-sm transition-all ${
                      testMatch?.tier === 1
                        ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-200'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          Card 1 · Short Distance
                        </span>
                        {isFuelActive && (
                          <span className="flex h-2 w-2 rounded-full bg-emerald-500" title="Active" />
                        )}
                      </div>
                      <h4 className="mt-3 text-lg font-bold text-slate-900">
                        {tiers[0].rangeLabel}
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        {tiers[0].description}
                      </p>
                    </div>

                    <div className="mt-6 border-t border-slate-100 pt-4">
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-black text-slate-800">
                          {formatInr(currentRate.firstAmount)}
                        </span>
                        <span className="text-xs font-medium text-slate-400">Flat rate</span>
                      </div>
                      <div className="mt-2 text-[11px] text-slate-400">
                        Range: 0 km to {currentRate.firstKm} km
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Over 3 km through 5 km */}
                  <div
                    className={`relative flex flex-col justify-between rounded-xl border p-5 shadow-sm transition-all ${
                      testMatch?.tier === 2
                        ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-200'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                          Card 2 · Mid Distance
                        </span>
                        {isFuelActive && (
                          <span className="flex h-2 w-2 rounded-full bg-blue-500" title="Active" />
                        )}
                      </div>
                      <h4 className="mt-3 text-lg font-bold text-slate-900">
                        {tiers[1].rangeLabel}
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        {tiers[1].description}
                      </p>
                    </div>

                    <div className="mt-6 border-t border-slate-100 pt-4">
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-black text-slate-800">
                          {formatInr(currentRate.secondAmount)}
                        </span>
                        <span className="text-xs font-medium text-slate-400">Flat rate</span>
                      </div>
                      <div className="mt-2 text-[11px] text-slate-400">
                        Range: &gt; {currentRate.firstKm} km to {currentRate.secondKm} km
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Above 5 km */}
                  <div
                    className={`relative flex flex-col justify-between rounded-xl border p-5 shadow-sm transition-all ${
                      testMatch?.tier === 3
                        ? 'border-purple-500 bg-purple-50/40 ring-2 ring-purple-200'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 ring-1 ring-purple-200">
                          Card 3 · Long Distance
                        </span>
                        {isFuelActive && (
                          <span className="flex h-2 w-2 rounded-full bg-purple-500" title="Active" />
                        )}
                      </div>
                      <h4 className="mt-3 text-lg font-bold text-slate-900">
                        {tiers[2].rangeLabel}
                      </h4>
                      <p className="mt-1 text-xs text-slate-500">
                        {tiers[2].description}
                      </p>
                    </div>

                    <div className="mt-6 border-t border-slate-100 pt-4">
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-black text-slate-800">
                          {formatInr(currentRate.secondAmount)}
                          <span className="text-sm font-semibold text-slate-500">
                            {' '}+ {formatInr(currentRate.extraPerKm)}/km
                          </span>
                        </span>
                        <span className="text-xs font-medium text-slate-400">Base + per km</span>
                      </div>
                      <div className="mt-2 text-[11px] text-slate-400">
                        Base: {formatInr(currentRate.secondAmount)} for first {currentRate.secondKm} km + {formatInr(currentRate.extraPerKm)} per started km beyond
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Distance Rate Test Calculator */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Icon name="deliveries" className="h-4 w-4 text-brand-600" />
                      Test Rate Calculation Simulator
                    </h4>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Enter any distance in kilometers to test how the 3 cards calculate charges in Lab Orders:
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-slate-600">
                      Distance (km):
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="1000"
                      value={testKm}
                      onChange={(e) => setTestKm(e.target.value)}
                      className="h-9 w-28 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                  </div>
                </div>

                {testMatch && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/60 p-3.5">
                    <div className="flex items-center gap-3">
                      <span className="rounded-md bg-brand-600 px-2 py-1 text-xs font-bold text-white">
                        Card {testMatch.tier}
                      </span>
                      <div>
                        <div className="text-xs font-medium text-brand-900">
                          {testMatch.tierLabel}
                        </div>
                        <div className="text-[11px] text-brand-700">
                          {testMatch.explanation}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Calculated Charge</div>
                      <div className="text-lg font-black text-brand-700">
                        {formatInr(testMatch.charge)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Note summary banner */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">Current formula note: </span>
                {distanceRateNote(currentRate)}
              </div>
            </div>
          )}

          {/* ================= TAB 2: TECHNICIAN CHARGE ================= */}
          {activeTab === 'technician' && (
            <div className="space-y-6">
              {/* Status & Control Banner */}
              <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-semibold text-slate-800">
                      Technician Visit Fee
                    </h3>
                    <Badge tone={isTechActive ? 'green' : 'gray'}>
                      {isTechActive ? 'Active in Lab Orders' : 'Inactive'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 max-w-2xl">
                    Standard service fee charged for technician home collection visits.
                    Can be applied independently or combined with the dynamic fuel distance charge in Lab Orders.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    variant={isTechActive ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={busy}
                    onClick={handleToggleTechActive}
                  >
                    {isTechActive ? 'Deactivate fee' : 'Activate fee'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={openEditTech}>
                    <Icon name="edit" className="mr-1.5 h-3.5 w-3.5" />
                    Edit technician fee
                  </Button>
                </div>
              </div>

              {/* Technician Fee Card */}
              <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                    Standard Service Fee
                  </span>
                  <Badge tone={isTechActive ? 'green' : 'gray'}>
                    {isTechActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="mt-5">
                  <span className="text-xs text-slate-400 uppercase font-semibold tracking-wider">
                    Fee per home visit
                  </span>
                  <div className="mt-1 text-4xl font-black text-slate-900">
                    {formatInr(techAmount)}
                  </div>
                </div>

                <p className="mt-4 text-xs text-slate-500 leading-relaxed">
                  When enabled, staff can apply this flat fee directly to home collection bookings in the Lab Order section with one click.
                </p>

                <div className="mt-6 border-t border-slate-100 pt-4 flex justify-end">
                  <Button variant="secondary" size="sm" onClick={openEditTech}>
                    Update amount
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit Fuel Rates Modal */}
      <Modal
        open={editingFuel}
        onClose={() => {
          if (!busy) setEditingFuel(false);
        }}
        title="Edit Fuel Distance Rates (3 Tiers)"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setEditingFuel(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              form="fuel-rate-form"
              type="submit"
            >
              {busy ? 'Saving...' : 'Save rates'}
            </Button>
          </>
        }
      >
        <form
          id="fuel-rate-form"
          className="space-y-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveFuel();
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            {/* Card 1 settings */}
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3.5 space-y-3">
              <h5 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                Card 1 · Short Distance Limit &amp; Rate
              </h5>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  Up to distance (km)
                  <input
                    required
                    type="number"
                    min="0.1"
                    step="0.1"
                    className={inputClass}
                    value={fuelDraft.firstKm}
                    onChange={(e) =>
                      setFuelDraft({ ...fuelDraft, firstKm: parseFloat(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Charge for Card 1 (₹)
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    className={inputClass}
                    value={fuelDraft.firstAmount}
                    onChange={(e) =>
                      setFuelDraft({ ...fuelDraft, firstAmount: parseFloat(e.target.value) || 0 })
                    }
                  />
                </label>
              </div>
            </div>

            {/* Card 2 settings */}
            <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3.5 space-y-3">
              <h5 className="text-xs font-bold text-blue-800 uppercase tracking-wider">
                Card 2 · Mid Distance Limit &amp; Rate
              </h5>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  Over Card 1 through limit (km)
                  <input
                    required
                    type="number"
                    min="0.1"
                    step="0.1"
                    className={inputClass}
                    value={fuelDraft.secondKm}
                    onChange={(e) =>
                      setFuelDraft({ ...fuelDraft, secondKm: parseFloat(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Charge for Card 2 (₹)
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    className={inputClass}
                    value={fuelDraft.secondAmount}
                    onChange={(e) =>
                      setFuelDraft({ ...fuelDraft, secondAmount: parseFloat(e.target.value) || 0 })
                    }
                  />
                </label>
              </div>
            </div>

            {/* Card 3 settings */}
            <div className="rounded-lg border border-purple-100 bg-purple-50/30 p-3.5 space-y-3">
              <h5 className="text-xs font-bold text-purple-800 uppercase tracking-wider">
                Card 3 · Long Distance Incremental Rate
              </h5>
              <label className="block text-xs font-medium text-slate-600">
                Additional charge per started km above {fuelDraft.secondKm} km (₹)
                <input
                  required
                  type="number"
                  min="0"
                  step="1"
                  className={inputClass}
                  value={fuelDraft.extraPerKm}
                  onChange={(e) =>
                    setFuelDraft({ ...fuelDraft, extraPerKm: parseFloat(e.target.value) || 0 })
                  }
                />
              </label>
            </div>

            {/* Active switch */}
            <label className="flex items-center gap-2.5 pt-1 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={fuelDraft.isActive}
                onChange={(e) => setFuelDraft({ ...fuelDraft, isActive: e.target.checked })}
              />
              <span>Set fuel distance rate calculation as Active in Lab Orders</span>
            </label>
          </fieldset>

          {formError && (
            <p role="alert" className="text-xs font-semibold text-rose-700">
              {formError}
            </p>
          )}
        </form>
      </Modal>

      {/* Edit Technician Fee Modal */}
      <Modal
        open={editingTech}
        onClose={() => {
          if (!busy) setEditingTech(false);
        }}
        title="Edit Technician Visit Fee"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setEditingTech(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              form="tech-fee-form"
              type="submit"
            >
              {busy ? 'Saving...' : 'Save fee'}
            </Button>
          </>
        }
      >
        <form
          id="tech-fee-form"
          className="space-y-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveTech();
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <label className="block text-xs font-medium text-slate-600">
              Technician visit fee (INR)
              <input
                required
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                value={techDraft.amount}
                onChange={(e) =>
                  setTechDraft({ ...techDraft, amount: parseFloat(e.target.value) || 0 })
                }
              />
            </label>

            <label className="flex items-center gap-2.5 pt-1 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={techDraft.isActive}
                onChange={(e) => setTechDraft({ ...techDraft, isActive: e.target.checked })}
              />
              <span>Set technician visit fee as Active in Lab Orders</span>
            </label>
          </fieldset>

          {formError && (
            <p role="alert" className="text-xs font-semibold text-rose-700">
              {formError}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}
