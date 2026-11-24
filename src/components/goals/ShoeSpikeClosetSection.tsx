import React, { useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Footprints,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from '../icons/PhosphorIcons';
import type {
  AthleteGearItem,
  DistanceUnit,
  TrackFootwearClass,
  UnifiedActivity,
} from '../../types';
import {
  TRACK_FOOTWEAR_CLASS_LIST,
  TRACK_FOOTWEAR_CLASS_SPECS,
  computeGearClosetSummaries,
  displayUnitInputToMeters,
  formatGearDistanceValue,
  getDefaultMaxRecommendedMeters,
  getFootwearClassLabel,
  metersToDisplayUnitInput,
  readSavedActivityQuickLogs,
  setPrimaryGearItem,
  toggleRetireGearItem,
  upsertGearItem,
} from '../../utils/gearClosetUtils';
import { getLocalDateIso } from '../../physiology/stravaLoadCalibration';

export interface ShoeSpikeClosetSectionProps {
  gearItems: AthleteGearItem[];
  activities: UnifiedActivity[];
  distanceUnit: DistanceUnit;
  onSaveGearItems: (nextItems: AthleteGearItem[]) => Promise<void> | void;
}

interface GearFormState {
  editingId: string | null;
  name: string;
  brand: string;
  footwearClass: TrackFootwearClass;
  baselineInput: string;
  maxInput: string;
  maxTouched: boolean;
  purchaseDate: string;
  notes: string;
  primary: boolean;
}

function createInitialFormState(unit: DistanceUnit): GearFormState {
  const defaultMeters = getDefaultMaxRecommendedMeters('SHOE', 'DAILY_TRAINER');
  return {
    editingId: null,
    name: '',
    brand: '',
    footwearClass: 'DAILY_TRAINER',
    baselineInput: '0',
    maxInput: metersToDisplayUnitInput(defaultMeters, unit),
    maxTouched: false,
    purchaseDate: getLocalDateIso(),
    notes: '',
    primary: false,
  };
}

export const ShoeSpikeClosetSection: React.FC<ShoeSpikeClosetSectionProps> = ({
  gearItems,
  activities,
  distanceUnit,
  onSaveGearItems,
}) => {
  const formId = useId();
  const unitLabel = distanceUnit === 'mi' ? 'mi' : 'km';
  const [closetTab, setClosetTab] = useState<'ACTIVE' | 'RETIRED'>('ACTIVE');
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [formState, setFormState] = useState<GearFormState>(() =>
    createInitialFormState(distanceUnit)
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const summaries = useMemo(
    () => computeGearClosetSummaries(gearItems, activities, readSavedActivityQuickLogs()),
    [gearItems, activities]
  );

  const activeSummaries = useMemo(
    () => summaries.filter((s) => !s.item.retired),
    [summaries]
  );
  const retiredSummaries = useMemo(
    () => summaries.filter((s) => Boolean(s.item.retired)),
    [summaries]
  );

  const wearAlertsCount = useMemo(
    () =>
      activeSummaries.filter(
        (s) => s.status === 'APPROACHING_RETIREMENT' || s.status === 'REPLACE_SOON'
      ).length,
    [activeSummaries]
  );

  const visibleSummaries = closetTab === 'ACTIVE' ? activeSummaries : retiredSummaries;

  const openAddForm = () => {
    setFormError(null);
    setFormState(createInitialFormState(distanceUnit));
    setIsFormOpen(true);
  };

  const openEditForm = (item: AthleteGearItem) => {
    setFormError(null);
    const cls: TrackFootwearClass = item.footwearClass || 'DAILY_TRAINER';
    setFormState({
      editingId: item.id,
      name: item.name,
      brand: item.brand || '',
      footwearClass: cls,
      baselineInput: metersToDisplayUnitInput(item.distanceMeters || 0, distanceUnit),
      maxInput: metersToDisplayUnitInput(
        item.maxRecommendedMeters || getDefaultMaxRecommendedMeters(item.type, cls),
        distanceUnit
      ),
      maxTouched: true,
      purchaseDate: item.purchaseDate || '',
      notes: item.notes || '',
      primary: Boolean(item.primary),
    });
    setIsFormOpen(true);
  };

  const handleClassChange = (nextClass: TrackFootwearClass) => {
    setFormState((prev) => {
      const nextDefaultMax = getDefaultMaxRecommendedMeters('SHOE', nextClass);
      return {
        ...prev,
        footwearClass: nextClass,
        maxInput: prev.maxTouched
          ? prev.maxInput
          : metersToDisplayUnitInput(nextDefaultMax, distanceUnit),
      };
    });
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formState.name.trim();
    if (!cleanName) {
      setFormError('Enter a shoe or track spike model name.');
      return;
    }

    const existing = formState.editingId
      ? gearItems.find((g) => g.id === formState.editingId)
      : undefined;
    const baselineMeters = displayUnitInputToMeters(formState.baselineInput, distanceUnit);
    const defaultMax = getDefaultMaxRecommendedMeters('SHOE', formState.footwearClass);
    const parsedMax = displayUnitInputToMeters(formState.maxInput, distanceUnit);
    const maxRecommendedMeters = parsedMax >= 1000 ? parsedMax : defaultMax;

    const nextItem: AthleteGearItem = {
      id: existing?.id || `gear-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName.slice(0, 120),
      type: existing?.type || 'SHOE',
      distanceMeters: baselineMeters,
      maxRecommendedMeters,
      primary: formState.primary,
      ...(formState.brand.trim() ? { brand: formState.brand.trim().slice(0, 60) } : {}),
      footwearClass: formState.footwearClass,
      ...(existing?.retired ? { retired: true, retiredAt: existing.retiredAt } : {}),
      ...(formState.purchaseDate.trim() ? { purchaseDate: formState.purchaseDate.trim() } : {}),
      ...(formState.notes.trim() ? { notes: formState.notes.trim().slice(0, 300) } : {}),
    };

    const nextItems = upsertGearItem(gearItems, nextItem);
    await onSaveGearItems(nextItems);
    setIsFormOpen(false);
    setFormError(null);
  };

  const handleSetPrimary = (id: string) => {
    void onSaveGearItems(setPrimaryGearItem(gearItems, id));
  };

  const handleToggleRetire = (id: string) => {
    const next = toggleRetireGearItem(gearItems, id, getLocalDateIso());
    void onSaveGearItems(next);
  };

  const handleConfirmDelete = (id: string) => {
    const next = gearItems.filter((item) => item.id !== id);
    setPendingDeleteId(null);
    void onSaveGearItems(next);
  };

  return (
    <section
      data-testid="shoe-spike-closet-section"
      className="rounded-2xl liquid-glass p-4 sm:p-5 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1.5">
              <Footprints className="w-4 h-4 ap-text-brand" />
              <span>Shoe &amp; Spike Closet</span>
            </h2>
            {wearAlertsCount > 0 && (
              <span
                data-testid="gear-wear-alert-badge"
                className="px-2 py-0.5 rounded-full ap-status-caution text-2xs font-mono font-bold inline-flex items-center gap-1"
              >
                <AlertTriangle className="w-3 h-3" />
                <span>
                  {wearAlertsCount} {wearAlertsCount === 1 ? 'pair needs attention' : 'pairs need attention'}
                </span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Track odometer wear across daily trainers, super trainers, carbon racers, and track spikes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Shoe and spike closet filter"
            className="inline-flex items-center gap-1 p-1 rounded-xl liquid-capsule-track"
          >
            <button
              type="button"
              role="tab"
              data-testid="gear-tab-active"
              aria-selected={closetTab === 'ACTIVE'}
              onClick={() => setClosetTab('ACTIVE')}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                closetTab === 'ACTIVE'
                  ? 'liquid-capsule-active text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Active ({activeSummaries.length})
            </button>
            <button
              type="button"
              role="tab"
              data-testid="gear-tab-retired"
              aria-selected={closetTab === 'RETIRED'}
              onClick={() => setClosetTab('RETIRED')}
              className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                closetTab === 'RETIRED'
                  ? 'liquid-capsule-active text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Retired ({retiredSummaries.length})
            </button>
          </div>

          <button
            type="button"
            data-testid="gear-add-btn"
            onClick={openAddForm}
            className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-3.5 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" weight="bold" />
            <span>Add Shoe / Spike</span>
          </button>
        </div>
      </div>

      {isFormOpen && (
        <form
          onSubmit={(e) => void handleSaveForm(e)}
          data-testid="gear-closet-form"
          className="rounded-xl border border-ap-clay/30 dark:border-ap-volt/35 bg-ap-surface-warm dark:bg-ap-turf p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {formState.editingId ? 'Edit Shoe / Track Spike' : 'Add Shoe or Track Spike'}
            </h3>
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              aria-label="Close footwear form"
              className="min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-[34px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-4">
              <label htmlFor={`${formId}-name`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                Model Name
              </label>
              <input
                id={`${formId}-name`}
                data-testid="gear-input-name"
                type="text"
                value={formState.name}
                onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Dragonfly 2 Elite"
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                required
              />
            </div>

            <div className="sm:col-span-3">
              <label htmlFor={`${formId}-brand`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                Brand (Optional)
              </label>
              <input
                id={`${formId}-brand`}
                data-testid="gear-input-brand"
                type="text"
                value={formState.brand}
                onChange={(e) => setFormState((prev) => ({ ...prev, brand: e.target.value }))}
                placeholder="e.g. Nike, Saucony, Hoka"
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-5">
              <label htmlFor={`${formId}-class`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                Footwear Class
              </label>
              <select
                id={`${formId}-class`}
                data-testid="gear-input-class"
                value={formState.footwearClass}
                onChange={(e) => handleClassChange(e.target.value as TrackFootwearClass)}
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              >
                {TRACK_FOOTWEAR_CLASS_LIST.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.label} ({cls.defaultMaxMiles} mi default)
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor={`${formId}-baseline`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                Baseline Odometer ({unitLabel})
              </label>
              <input
                id={`${formId}-baseline`}
                data-testid="gear-input-baseline"
                type="number"
                min="0"
                step="0.1"
                value={formState.baselineInput}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, baselineInput: e.target.value }))
                }
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-3">
              <label htmlFor={`${formId}-max`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                Retire Limit ({unitLabel})
              </label>
              <input
                id={`${formId}-max`}
                data-testid="gear-input-max"
                type="number"
                min="10"
                step="1"
                value={formState.maxInput}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    maxInput: e.target.value,
                    maxTouched: true,
                  }))
                }
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-3">
              <label htmlFor={`${formId}-date`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                In Service Date
              </label>
              <input
                id={`${formId}-date`}
                type="date"
                value={formState.purchaseDate}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, purchaseDate: e.target.value }))
                }
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-3 flex items-end pb-1">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer min-h-[44px] sm:min-h-[38px]">
                <input
                  type="checkbox"
                  data-testid="gear-input-primary"
                  checked={formState.primary}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, primary: e.target.checked }))
                  }
                  className="w-4 h-4 accent-ap-clay dark:accent-ap-volt"
                />
                <span>Set as Primary Pair</span>
              </label>
            </div>

            <div className="sm:col-span-12">
              <label htmlFor={`${formId}-notes`} className="block text-xs text-slate-600 dark:text-slate-300 mb-1">
                Spike Pin / Cushion Notes (Optional)
              </label>
              <input
                id={`${formId}-notes`}
                type="text"
                value={formState.notes}
                onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g. 6mm pyramid pins, track workouts + 5K meets"
                className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-carbon px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-xs font-semibold text-rose-700 dark:text-rose-300">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="gear-save-btn"
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-4 py-1.5 text-xs font-bold cursor-pointer"
            >
              {formState.editingId ? 'Save Changes' : 'Save to Closet'}
            </button>
          </div>
        </form>
      )}

      {visibleSummaries.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {visibleSummaries.map((summary) => {
            const { item, totalMeters, maxRecommendedMeters, wearPct, status, statusLabel } =
              summary;
            const barPct = Math.min(100, Math.max(0, wearPct));
            const statusClass =
              status === 'REPLACE_SOON'
                ? 'ap-status-strained'
                : status === 'APPROACHING_RETIREMENT'
                  ? 'ap-status-caution'
                  : status === 'RETIRED'
                    ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    : 'ap-status-prime';
            const barColorClass =
              status === 'REPLACE_SOON'
                ? 'bg-rose-600 dark:bg-rose-400'
                : status === 'APPROACHING_RETIREMENT'
                  ? 'bg-amber-600 dark:bg-amber-400'
                  : status === 'RETIRED'
                    ? 'bg-slate-400 dark:bg-slate-500'
                    : 'bg-ap-clay dark:bg-ap-volt';
            const clsLabel =
              item.type === 'BIKE'
                ? 'Bike'
                : getFootwearClassLabel(item.footwearClass);
            const displayTitle = item.brand && !item.name.toLowerCase().startsWith(item.brand.toLowerCase())
              ? `${item.brand} ${item.name}`
              : item.name;
            const defaultMilesForClass =
              TRACK_FOOTWEAR_CLASS_SPECS[item.footwearClass || 'DAILY_TRAINER']?.defaultMaxMiles;

            return (
              <div
                key={item.id}
                data-testid={`gear-card-${item.id}`}
                className="rounded-xl border border-slate-200/90 dark:border-ap-edge-dark bg-white/80 dark:bg-ap-turf/60 p-3.5 space-y-2.5 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                          {displayTitle}
                        </h3>
                        {item.primary && !item.retired && (
                          <span className="px-2 py-0.5 rounded-full bg-ap-clay text-white dark:bg-ap-volt dark:text-ap-obsidian text-2xs font-mono font-bold inline-flex items-center gap-1">
                            <Check className="w-3 h-3" weight="bold" />
                            <span>Primary</span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-2xs font-mono text-slate-600 dark:text-slate-300">
                        <span className="px-1.5 py-0.5 rounded bg-ap-inset dark:bg-ap-carbon font-semibold">
                          {clsLabel}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded font-bold ${statusClass}`}>
                          {statusLabel}
                        </span>
                        {item.retired && item.retiredAt && (
                          <span>Retired {item.retiredAt}</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                        {formatGearDistanceValue(totalMeters, distanceUnit, 1)}
                      </div>
                      <div className="text-2xs text-slate-500 dark:text-slate-400">
                        / {formatGearDistanceValue(maxRecommendedMeters, distanceUnit, 0)} ({wearPct}%)
                      </div>
                    </div>
                  </div>

                  {/* Wear Progress Bar */}
                  <div
                    className="h-2 w-full rounded-full bg-ap-inset dark:bg-ap-carbon overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.min(100, wearPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${displayTitle} wear ${wearPct}%`}
                  >
                    <div
                      className={`h-full rounded-full transition-all ${barColorClass}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-slate-600 dark:text-slate-300">
                    <span>
                      Base {formatGearDistanceValue(summary.baselineMeters, distanceUnit, 1)}
                      {summary.matchedActivityCount > 0
                        ? ` + ${formatGearDistanceValue(summary.matchedActivityMeters, distanceUnit, 1)} (${summary.matchedActivityCount} logged)`
                        : ''}
                    </span>
                    {defaultMilesForClass && item.type === 'SHOE' && (
                      <span>Class norm: {defaultMilesForClass} mi</span>
                    )}
                  </div>

                  {item.notes && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                      {item.notes}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-slate-200/80 dark:border-ap-edge-dark">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!item.retired && !item.primary && (
                      <button
                        type="button"
                        data-testid={`gear-primary-btn-${item.id}`}
                        onClick={() => handleSetPrimary(item.id)}
                        className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg ap-card-inset text-2xs font-semibold text-slate-800 dark:text-slate-100 hover:border-ap-clay dark:hover:border-ap-volt cursor-pointer"
                      >
                        Set Primary
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`gear-edit-btn-${item.id}`}
                      onClick={() => openEditForm(item)}
                      className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg ap-card-inset text-2xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      data-testid={`gear-retire-btn-${item.id}`}
                      onClick={() => handleToggleRetire(item.id)}
                      className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg ap-card-inset text-2xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1 cursor-pointer"
                    >
                      {item.retired ? (
                        <>
                          <RotateCcw className="w-3 h-3" />
                          <span>Restore</span>
                        </>
                      ) : (
                        <span>Retire</span>
                      )}
                    </button>
                  </div>

                  {pendingDeleteId === item.id ? (
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        data-testid={`gear-delete-confirm-${item.id}`}
                        onClick={() => handleConfirmDelete(item.id)}
                        className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-rose-600 text-white text-2xs font-bold cursor-pointer"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                        className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-2xs font-semibold cursor-pointer"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`gear-delete-btn-${item.id}`}
                      onClick={() => setPendingDeleteId(item.id)}
                      aria-label={`Delete ${displayTitle}`}
                      className="min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] inline-flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-ap-edge-dark p-6 text-center text-xs text-slate-600 dark:text-slate-300">
          {closetTab === 'ACTIVE'
            ? 'No active shoes or track spikes logged yet. Add your daily trainers or meet spikes to monitor retirement mileage.'
            : 'No retired shoes or spikes yet.'}
        </div>
      )}
    </section>
  );
};
