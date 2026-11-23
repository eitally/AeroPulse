import React, { useEffect, useId, useMemo, useState } from 'react';
import { computeStravaActivityLoadV2, STRAVA_LOAD_MODEL_VERSION } from '../physiology/stravaLoadCalibration';
import { formatLocalWallClockIso } from '../utils/stopwatchActivitySynthesizer';
import {
  useTelemetryWorkspace,
  type TelemetryWorkspaceContextValue,
} from '../contexts/TelemetryWorkspaceContext';
import type {
  AthleteGearItem,
  AthleteProfile,
  DistanceUnit,
  TrackFootwearClass,
  UnifiedActivity,
} from '../types';
import { CheckCircle2, Plus, Timer } from './icons/PhosphorIcons';

interface QuickRunLoggerCardProps {
  distanceUnit: DistanceUnit;
  athleteProfile: AthleteProfile;
  onSaveRun: (activity: UnifiedActivity) => void;
  compact?: boolean;
  gearItems?: AthleteGearItem[];
}

const FOOTWEAR_OPTIONS: Array<{ id: TrackFootwearClass; label: string }> = [
  { id: 'DAILY_TRAINER', label: 'Daily Trainers' },
  { id: 'LIGHTWEIGHT_FLAT_SUPER_TRAINER', label: 'Racing Flats' },
  { id: 'CARBON_SUPER_SPIKE', label: 'Track Spikes' },
];

export const QuickRunLoggerCard: React.FC<QuickRunLoggerCardProps> = ({
  distanceUnit,
  athleteProfile,
  onSaveRun,
  compact = false,
  gearItems: gearItemsProp,
}) => {
  const formId = useId();
  let wsCtx: TelemetryWorkspaceContextValue | null = null;
  try {
    wsCtx = useTelemetryWorkspace();
  } catch {
    wsCtx = null;
  }
  const effectiveGearItems = gearItemsProp ?? wsCtx?.effectiveGearItems ?? [];
  const activeShoes = useMemo(
    () => effectiveGearItems.filter((g) => g.type === 'SHOE' && !g.retired),
    [effectiveGearItems]
  );
  const defaultShoeId = useMemo(
    () => activeShoes.find((g) => g.primary)?.id || activeShoes[0]?.id || '',
    [activeShoes]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('Easy Run');
  const [distanceInput, setDistanceInput] = useState(distanceUnit === 'mi' ? '4.0' : '6.5');
  const [durationMinsInput, setDurationMinsInput] = useState('32');
  const [rpe, setRpe] = useState(5);
  const [footwearClass, setFootwearClass] = useState<TrackFootwearClass>('DAILY_TRAINER');
  const [selectedGearId, setSelectedGearId] = useState<string>(defaultShoeId);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedGearId && defaultShoeId) {
      setSelectedGearId(defaultShoeId);
    }
  }, [defaultShoeId, selectedGearId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rawDist = Math.max(0.1, Number(distanceInput) || 1);
    const distanceMeters = Math.round(
      distanceUnit === 'mi' ? rawDist * 1609.344 : rawDist * 1000
    );
    const movingTimeSecs = Math.max(120, Math.round((Number(durationMinsInput) || 30) * 60));
    const avgPaceSecsPerKm =
      distanceMeters > 0 ? Math.round((movingTimeSecs * 1000) / distanceMeters) : 300;

    // Derive conservative IF from 1–10 RPE when no GPS watch or HR strap is worn
    const estAvgHr = Math.round(118 + Math.max(1, Math.min(10, rpe)) * 7.2);
    const loadResult = computeStravaActivityLoadV2({
      sportCategory: 'Running',
      rawSportType: 'Run',
      name: title.trim() || 'Logged Run',
      environment: 'OUTDOOR',
      movingTimeSecs,
      distanceMeters,
      avgHr: estAvgHr,
      maxHr: athleteProfile.maxHr || 192,
      avgPaceSecsPerKm,
      calibratedFtp: athleteProfile.ftp || 250,
      calibratedBikeLthr: athleteProfile.lthr || 168,
      calibratedRunLthr: athleteProfile.runLthr || athleteProfile.lthr || 170,
      calibratedThresholdPaceSecsPerKm: athleteProfile.thresholdPaceSecsPerKm || 260,
      restingHr: athleteProfile.restingHr || 52,
    });

    const speedMPerMin = movingTimeSecs > 0 ? (distanceMeters / movingTimeSecs) * 60 : 200;
    const estEf = Number((speedMPerMin / Math.max(100, estAvgHr)).toFixed(2));
    const selectedShoe = activeShoes.find((g) => g.id === selectedGearId) || null;
    const startDateLocal = formatLocalWallClockIso();
    const activity: UnifiedActivity = {
      id: `manual-run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      startDateLocal,
      name: title.trim() || 'Logged Run',
      sportCategory: 'Running',
      environment: 'OUTDOOR',
      subType: footwearClass === 'CARBON_SUPER_SPIKE' ? 'Track' : 'Road',
      movingTimeSecs,
      distanceMeters,
      elevationGainMeters: 0,
      intensityFactor: loadResult.intensityFactor,
      trainingLoad: loadResult.trainingLoad,
      loadModelVersion: STRAVA_LOAD_MODEL_VERSION,
      avgHr: estAvgHr,
      maxHr: Math.min(athleteProfile.maxHr || 195, estAvgHr + 12),
      avgPaceSecsPerKm,
      aerobicDecouplingPct: 0,
      efficiencyFactor: estEf,
      firstHalfEf: estEf,
      secondHalfEf: estEf,
      zoneSecs: { hr: [0, movingTimeSecs, 0, 0, 0, 0, 0] },
      footwearClass,
      ...(selectedShoe ? { gearId: selectedShoe.id, gearName: selectedShoe.name } : {}),
      stravaPrCount: 0,
      segmentEfforts: [],
      sourceBadges: [],
      quickLog: {
        rpe,
        feelRating: rpe >= 8 ? 'HEAVY' : rpe <= 4 ? 'STRONG' : 'NORMAL',
        footwearClass,
        ...(selectedShoe ? { gearId: selectedShoe.id, gearName: selectedShoe.name } : {}),
        notes: 'Logged via watchless Quick Run entry',
        loggedAt: new Date().toISOString(),
      },
    };

    onSaveRun(activity);
    setSavedToast(`Saved ${rawDist.toFixed(1)} ${distanceUnit} · ${loadResult.trainingLoad} TSS`);
    setIsOpen(false);
    window.setTimeout(() => setSavedToast(null), 4000);
  };

  if (!isOpen) {
    return (
      <div className="inline-flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="quick-log-run-btn"
          onClick={() => setIsOpen(true)}
          className={
            compact
              ? 'ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer'
              : 'min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl liquid-glass-subtle hover:border-ap-clay dark:hover:border-ap-volt text-slate-800 dark:text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer'
          }
        >
          <Plus className="w-3.5 h-3.5 ap-text-brand" />
          <span>Log Run</span>
        </button>
        {savedToast && (
          <span className="inline-flex items-center gap-1 text-2xs font-mono font-semibold ap-ink-emerald">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{savedToast}</span>
          </span>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="quick-log-run-form"
      className="rounded-xl border border-stone-300/80 dark:border-ap-edge-dark bg-ap-inset dark:bg-ap-turf p-3.5 space-y-3 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
          <Timer className="w-4 h-4 ap-text-brand" />
          <span>Log Today&apos;s Run (Watchless Entry)</span>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="min-h-[36px] px-2 text-2xs font-mono text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Easy Run / Shakeout"
            className="min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs text-slate-900 dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor={`${formId}-dist`}>
          <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">
            Distance ({distanceUnit})
          </span>
          <input
            id={`${formId}-dist`}
            type="number"
            step="0.1"
            min="0.1"
            value={distanceInput}
            onChange={(e) => setDistanceInput(e.target.value)}
            className="min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-mono text-slate-900 dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor={`${formId}-mins`}>
          <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">
            Duration (mins)
          </span>
          <input
            id={`${formId}-mins`}
            type="number"
            min="2"
            value={durationMinsInput}
            onChange={(e) => setDurationMinsInput(e.target.value)}
            className="min-h-[40px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-mono text-slate-900 dark:text-white"
          />
        </label>

        <label className="flex flex-col gap-1" htmlFor={`${formId}-rpe`}>
          <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">
            Effort (RPE {rpe}/10)
          </span>
          <input
            id={`${formId}-rpe`}
            type="range"
            min={1}
            max={10}
            value={rpe}
            onChange={(e) => setRpe(Number(e.target.value))}
            className="min-h-[40px] accent-[#B83A24] dark:accent-[#D8FF2A]"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {activeShoes.length > 0 && (
            <select
              data-testid="quick-log-shoe-select"
              aria-label="Shoe or spike used"
              value={selectedGearId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedGearId(nextId);
                const chosen = activeShoes.find((g) => g.id === nextId);
                if (chosen?.footwearClass) {
                  setFootwearClass(chosen.footwearClass);
                }
              }}
              className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-2xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
            >
              <option value="">Shoe Closet (Optional)</option>
              {activeShoes.map((shoe) => (
                <option key={shoe.id} value={shoe.id}>
                  {shoe.name}
                  {shoe.primary ? ' (Primary)' : ''}
                </option>
              ))}
            </select>
          )}
          {FOOTWEAR_OPTIONS.map((fw) => (
            <button
              key={fw.id}
              type="button"
              onClick={() => setFootwearClass(fw.id)}
              className={`min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-2xs font-semibold cursor-pointer ${
                footwearClass === fw.id
                  ? 'ap-nav-volt-active'
                  : 'bg-white dark:bg-ap-carbon border border-stone-300 dark:border-ap-edge-dark text-slate-700 dark:text-slate-300'
              }`}
            >
              {fw.label}
            </button>
          ))}
        </div>

        <button
          type="submit"
          data-testid="quick-log-run-submit"
          className="ap-btn-primary !min-h-[40px] px-4 py-1.5 text-xs font-bold cursor-pointer"
        >
          Save Run
        </button>
      </div>
    </form>
  );
};
