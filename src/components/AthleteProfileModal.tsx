import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Activity,
  Bike,
  Check,
  Footprints,
  Heart,
  RefreshCw,
  Scale,
  Shield,
  Sliders,
  UserCheck,
  X,
  Zap,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  DistanceUnit,
  ScholasticDivision,
  ThresholdHistoryEntry,
  UnifiedWellnessDay,
} from '../types';
import { useModalDialog } from '../hooks/useModalDialog';
import {
  buildCompleteAthleteProfile,
  buildHrZonesFromCeilings,
  buildPowerZonesFromCeilings,
} from '../utils/telemetryStorage';

interface AthleteProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  athleteProfile: AthleteProfile;
  latestWellness?: UnifiedWellnessDay;
  distanceUnit: DistanceUnit;
  intervalsConnected: boolean;
  isSyncingProfile: boolean;
  onSyncProfileFromRemote: () => Promise<void>;
  onSaveProfileOverride: (updated: AthleteProfile) => Promise<void>;
}

export const AthleteProfileModal: React.FC<AthleteProfileModalProps> = ({
  isOpen,
  onClose,
  athleteProfile,
  latestWellness,
  distanceUnit,
  intervalsConnected,
  isSyncingProfile,
  onSyncProfileFromRemote,
  onSaveProfileOverride,
}) => {
  const [hrTab, setHrTab] = useState<'CYCLING' | 'RUNNING'>('CYCLING');
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [pendingDeleteHistoryId, setPendingDeleteHistoryId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const fieldId = useId();

  useModalDialog({
    isOpen,
    onClose,
    dialogRef,
  });

  // Editable form state synced with athleteProfile prop
  const [weightKg, setWeightKg] = useState<number>(athleteProfile.weightKg);
  const [restingHr, setRestingHr] = useState<number>(athleteProfile.restingHr);
  const [vo2MaxCycling, setVo2MaxCycling] = useState<number>(athleteProfile.vo2MaxCycling);
  const [vo2MaxRunning, setVo2MaxRunning] = useState<number>(athleteProfile.vo2MaxRunning);
  const [ftp, setFtp] = useState<number>(athleteProfile.ftp);
  const [indoorFtp, setIndoorFtp] = useState<number>(athleteProfile.indoorFtp);
  const [wPrime, setWPrime] = useState<number>(athleteProfile.wPrime);
  const [pMax, setPMax] = useState<number>(athleteProfile.pMax);
  const [lthr, setLthr] = useState<number>(athleteProfile.lthr);
  const [maxHr, setMaxHr] = useState<number>(athleteProfile.maxHr);
  const [runFtp, setRunFtp] = useState<number>(athleteProfile.runFtp);
  const [runLthr, setRunLthr] = useState<number>(athleteProfile.runLthr);
  const [runMaxHr, setRunMaxHr] = useState<number>(athleteProfile.runMaxHr);
  const [thresholdPaceSecsPerKm, setThresholdPaceSecsPerKm] = useState<number>(
    athleteProfile.thresholdPaceSecsPerKm
  );
  const [effectiveDate, setEffectiveDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [thresholdHistory, setThresholdHistory] = useState<ThresholdHistoryEntry[]>(
    athleteProfile.thresholdHistory || []
  );
  const [safeSportHideWeight, setSafeSportHideWeight] = useState<boolean>(
    Boolean(athleteProfile.safeSportHideWeight)
  );
  const [academicDivision, setAcademicDivision] = useState<ScholasticDivision>(
    athleteProfile.academicDivision || 'CLUB_OPEN'
  );
  const [competitionGender, setCompetitionGender] = useState<'MEN' | 'WOMEN'>(
    athleteProfile.competitionGender || 'MEN'
  );
  const [ferritinInput, setFerritinInput] = useState<string>(
    athleteProfile.ferritinNgMl ? String(athleteProfile.ferritinNgMl) : ''
  );

  useEffect(() => {
    setWeightKg(athleteProfile.weightKg);
    setRestingHr(athleteProfile.restingHr);
    setVo2MaxCycling(athleteProfile.vo2MaxCycling);
    setVo2MaxRunning(athleteProfile.vo2MaxRunning);
    setFtp(athleteProfile.ftp);
    setIndoorFtp(athleteProfile.indoorFtp);
    setWPrime(athleteProfile.wPrime);
    setPMax(athleteProfile.pMax);
    setLthr(athleteProfile.lthr);
    setMaxHr(athleteProfile.maxHr);
    setRunFtp(athleteProfile.runFtp);
    setRunLthr(athleteProfile.runLthr);
    setRunMaxHr(athleteProfile.runMaxHr);
    setThresholdPaceSecsPerKm(athleteProfile.thresholdPaceSecsPerKm);
    setThresholdHistory(athleteProfile.thresholdHistory || []);
    setSafeSportHideWeight(Boolean(athleteProfile.safeSportHideWeight));
    setAcademicDivision(athleteProfile.academicDivision || 'CLUB_OPEN');
    setCompetitionGender(athleteProfile.competitionGender || 'MEN');
    setFerritinInput(athleteProfile.ferritinNgMl ? String(athleteProfile.ferritinNgMl) : '');
  }, [athleteProfile]);

  if (!isOpen) return null;

  const livePowerCeilings = athleteProfile.powerZones.map((z) => z.maxPct);
  const livePowerNames = athleteProfile.powerZones.map((z) => z.name);
  const previewPowerZones = buildPowerZonesFromCeilings(
    ftp,
    indoorFtp,
    livePowerCeilings,
    livePowerNames
  );

  const previewBikeHrZones =
    lthr === athleteProfile.lthr && maxHr === athleteProfile.maxHr
      ? athleteProfile.hrZones
      : buildHrZonesFromCeilings(lthr, maxHr);

  const previewRunHrZones =
    runLthr === athleteProfile.runLthr && runMaxHr === athleteProfile.runMaxHr
      ? athleteProfile.runHrZones
      : buildHrZonesFromCeilings(runLthr, runMaxHr);

  const outdoorWkg = (ftp / Math.max(35, weightKg)).toFixed(2);
  const indoorWkg = (indoorFtp / Math.max(35, weightKg)).toFixed(2);
  const weightLbs = (weightKg * 2.20462).toFixed(1);

  const formatPace = (secsPerKm: number) => {
    const secs = distanceUnit === 'mi' ? secsPerKm * 1.60934 : secsPerKm;
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}/${distanceUnit}`;
  };

  const handlePullFromRemote = async () => {
    setSavedToast(null);
    await onSyncProfileFromRemote();
    setSavedToast('Synced latest thresholds, zones & weight from Intervals.icu & Garmin!');
    window.setTimeout(() => setSavedToast(null), 4000);
  };

  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEffDate = (effectiveDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const nextEntry: ThresholdHistoryEntry = {
      id: `th-${cleanEffDate}`,
      effectiveDate: cleanEffDate,
      ftp,
      indoorFtp,
      lthr,
      runLthr,
      thresholdPaceSecsPerKm,
      weightKg,
    };
    const mergedHistory = [
      ...thresholdHistory.filter((h) => h.effectiveDate.slice(0, 10) !== cleanEffDate),
      nextEntry,
    ].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    setThresholdHistory(mergedHistory);

    const updated = buildCompleteAthleteProfile(
      {
        ...athleteProfile,
        weightKg,
        restingHr,
        vo2MaxCycling,
        vo2MaxRunning,
        ftp,
        indoorFtp,
        wPrime,
        pMax,
        lthr,
        maxHr,
        runFtp,
        runLthr,
        runMaxHr,
        thresholdPaceSecsPerKm,
        powerZones: previewPowerZones,
        hrZones: previewBikeHrZones,
        runHrZones: previewRunHrZones,
        thresholdHistory: mergedHistory,
        safeSportHideWeight,
        academicDivision,
        competitionGender,
        ferritinNgMl:
          ferritinInput.trim() && Number(ferritinInput) > 0
            ? Number(ferritinInput)
            : undefined,
        source: 'CUSTOM_OVERRIDE',
        lastSyncedAt: new Date().toISOString(),
      },
      latestWellness
    );
    await onSaveProfileOverride(updated);
    setSavedToast(
      `Saved thresholds effective ${cleanEffDate} — historical TSS prior to ${cleanEffDate} remains protected.`
    );
    window.setTimeout(() => setSavedToast(null), 4000);
  };

  const handleDeleteHistoryEntry = async (entryId: string) => {
    const next = thresholdHistory.filter((h) => h.id !== entryId);
    setThresholdHistory(next);
    const updated = buildCompleteAthleteProfile(
      {
        ...athleteProfile,
        thresholdHistory: next,
        source: 'CUSTOM_OVERRIDE',
      },
      latestWellness
    );
    await onSaveProfileOverride(updated);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#070F0B]/82 flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="thresh-athlete-profile-title"
        className="w-full max-w-5xl rounded-2xl liquid-glass border border-slate-200/80 dark:border-slate-700/80 p-5 sm:p-6 space-y-5 shadow-2xl my-auto max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-wider ap-text-brand font-semibold">
              <UserCheck className="w-3.5 h-3.5" />
              <span>Athlete Profile &amp; Sport Zones</span>
              <span className="px-2 py-0.5 rounded-md ap-status-prime text-2xs">
                {athleteProfile.source === 'CUSTOM_OVERRIDE'
                  ? 'Custom Seed Calibrated'
                  : athleteProfile.source === 'INTERVALS_GARMIN'
                    ? 'Synced Profile'
                    : 'Calibrated Baseline'}
              </span>
            </div>
            <h2
              id="thresh-athlete-profile-title"
              className="text-xl font-bold text-slate-900 dark:text-slate-100"
            >
              {athleteProfile.name} · Pace, FTP &amp; Sport Zone Calibration
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Directly powers your adapted workout prescriptions, calendar effort zones, power curves, and zone distribution analysis.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePullFromRemote}
              disabled={isSyncingProfile}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl ap-btn-primary disabled:opacity-60 px-3.5 py-2 text-xs font-semibold whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingProfile ? 'animate-spin' : ''}`} />
              <span>
                {isSyncingProfile
                  ? 'Syncing Profile & Zones...'
                  : 'Sync Latest Profile & Zones'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close Athlete Profile modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {savedToast && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl ap-status-prime px-3.5 py-2.5 text-xs font-medium flex items-center gap-2"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{savedToast}</span>
          </div>
        )}

        {/* Top Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-2xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              <span>Outdoor FTP</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {ftp}W{' '}
              {!safeSportHideWeight && (
                <span className="text-xs font-semibold text-sky-500">({outdoorWkg} W/kg)</span>
              )}
            </div>
            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">
              eFTP {athleteProfile.eFtp}W · W&apos; {(wPrime / 1000).toFixed(1)}kJ
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-2xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Bike className="w-3 h-3 text-indigo-500" />
              <span>Indoor Trainer FTP</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {indoorFtp}W{' '}
              {!safeSportHideWeight && (
                <span className="text-xs font-semibold text-indigo-400">({indoorWkg} W/kg)</span>
              )}
            </div>
            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">
              Sweet Spot {athleteProfile.sweetSpotMinPct}–{athleteProfile.sweetSpotMaxPct}%
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-2xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Heart className="w-3 h-3 text-rose-500" />
              <span>Cycling LTHR / Max</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {lthr} <span className="text-xs font-normal text-slate-600 dark:text-slate-400">/ {maxHr} bpm</span>
            </div>
            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">
              Resting HR {restingHr} bpm
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-2xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Scale className="w-3 h-3 text-emerald-500" />
              <span>Body Weight</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {safeSportHideWeight
                ? 'Hidden'
                : distanceUnit === 'mi'
                  ? `${weightLbs} lbs`
                  : `${weightKg.toFixed(1)} kg`}
            </div>
            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">
              {safeSportHideWeight
                ? 'Safe-Sport Shield ON'
                : distanceUnit === 'mi'
                  ? `${weightKg.toFixed(1)} kg`
                  : `${weightLbs} lbs`}
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-2xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Footprints className="w-3 h-3 text-emerald-500" />
              <span>Run LT Pace &amp; FTP</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {formatPace(thresholdPaceSecsPerKm)}
            </div>
            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">
              Run FTP {runFtp}W · LTHR {runLthr} bpm
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-2xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Activity className="w-3 h-3 text-sky-500" />
              <span>VO2max</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {vo2MaxCycling} <span className="text-xs font-normal text-slate-600 dark:text-slate-400">/ {vo2MaxRunning}</span>
            </div>
            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">Bike / Run mL/kg/min</div>
          </div>
        </div>

        {/* Editable Thresholds Form */}
        <form
          onSubmit={handleSaveManual}
          className="rounded-2xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-4 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Sliders className="w-3.5 h-3.5 text-blue-500" />
              <span>Fine-Tune Thresholds &amp; Biometrics (Auto-Recalculates Zone Tables Below)</span>
            </div>
            <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">
              {intervalsConnected ? 'Connected to Intervals.icu' : 'Local / Sandbox Calibration'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
            <div>
              <label
                htmlFor={`${fieldId}-weight`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Weight ({distanceUnit === 'mi' ? 'lbs' : 'kg'})
              </label>
              {safeSportHideWeight ? (
                <div
                  id={`${fieldId}-weight`}
                  className="w-full min-h-[40px] rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1.5 font-mono text-2xs text-emerald-700 dark:text-emerald-300 flex items-center"
                >
                  Protected (Safe-Sport)
                </div>
              ) : (
                <input
                  id={`${fieldId}-weight`}
                  type="number"
                  step="0.1"
                  min={distanceUnit === 'mi' ? 80 : 35}
                  max={distanceUnit === 'mi' ? 350 : 160}
                  value={
                    distanceUnit === 'mi'
                      ? Number((weightKg * 2.20462).toFixed(1))
                      : Number(weightKg.toFixed(1))
                  }
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setWeightKg(distanceUnit === 'mi' ? Number((val / 2.20462).toFixed(2)) : val);
                  }}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
                />
              )}
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-rhr`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Resting HR (bpm)
              </label>
              <input
                id={`${fieldId}-rhr`}
                type="number"
                min={30}
                max={100}
                value={restingHr}
                onChange={(e) => setRestingHr(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-ftp`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Outdoor FTP (W)
              </label>
              <input
                id={`${fieldId}-ftp`}
                type="number"
                min={100}
                max={550}
                value={ftp}
                onChange={(e) => setFtp(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-indoor-ftp`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Indoor Trainer FTP (W)
              </label>
              <input
                id={`${fieldId}-indoor-ftp`}
                type="number"
                min={100}
                max={550}
                value={indoorFtp}
                onChange={(e) => setIndoorFtp(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-lthr`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Bike LTHR (bpm)
              </label>
              <input
                id={`${fieldId}-lthr`}
                type="number"
                min={110}
                max={210}
                value={lthr}
                onChange={(e) => setLthr(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-max-hr`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Bike Max HR (bpm)
              </label>
              <input
                id={`${fieldId}-max-hr`}
                type="number"
                min={130}
                max={230}
                value={maxHr}
                onChange={(e) => setMaxHr(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-wprime`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                W&apos; Anaerobic (J)
              </label>
              <input
                id={`${fieldId}-wprime`}
                type="number"
                step={500}
                min={8000}
                max={45000}
                value={wPrime}
                onChange={(e) => setWPrime(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-run-ftp`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Run FTP (W)
              </label>
              <input
                id={`${fieldId}-run-ftp`}
                type="number"
                min={120}
                max={550}
                value={runFtp}
                onChange={(e) => setRunFtp(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-lt-pace`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Run LT Pace ({formatPace(thresholdPaceSecsPerKm)})
              </label>
              <input
                id={`${fieldId}-lt-pace`}
                type="range"
                min={180}
                max={360}
                step={1}
                value={thresholdPaceSecsPerKm}
                onChange={(e) => setThresholdPaceSecsPerKm(Number(e.target.value))}
                className="w-full accent-[#558B00] dark:accent-[#C8FF00] mt-2 min-h-[32px]"
                title={`Adjust Lactate Threshold Run Pace: ${formatPace(thresholdPaceSecsPerKm)}`}
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-run-lthr`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Run LTHR (bpm)
              </label>
              <input
                id={`${fieldId}-run-lthr`}
                type="number"
                min={110}
                max={215}
                value={runLthr}
                onChange={(e) => setRunLthr(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-run-max-hr`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Run Max HR (bpm)
              </label>
              <input
                id={`${fieldId}-run-max-hr`}
                type="number"
                min={130}
                max={230}
                value={runMaxHr}
                onChange={(e) => setRunMaxHr(Number(e.target.value))}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full min-h-[44px] rounded-xl ap-btn-primary font-semibold text-xs cursor-pointer"
              >
                Save &amp; Apply Zones
              </button>
            </div>
          </div>

          {/* Safe-Sport / RED-S Protection & Scholastic / Collegiate Settings */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-3 items-center text-xs">
            <label className="md:col-span-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 px-3 py-2.5 flex items-start justify-between gap-3 cursor-pointer">
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>Safe-Sport / RED-S Protection (Hide Weight &amp; W/kg)</span>
                </div>
                <p className="text-2xs text-slate-600 dark:text-slate-300">
                  Masks body weight and W/kg across student-athlete views while keeping pace, HR, and absolute watts active.
                </p>
              </div>
              <input
                type="checkbox"
                checked={safeSportHideWeight}
                onChange={(e) => setSafeSportHideWeight(e.target.checked)}
                className="mt-1 accent-emerald-600 w-4 h-4 shrink-0"
              />
            </label>

            <div className="md:col-span-3">
              <label
                htmlFor={`${fieldId}-division`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Scholastic / Collegiate Division
              </label>
              <select
                id={`${fieldId}-division`}
                value={academicDivision}
                onChange={(e) => setAcademicDivision(e.target.value as ScholasticDivision)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              >
                <option value="HS_VARSITY">High School Varsity / Prep</option>
                <option value="NCAA_D1">NCAA Division I</option>
                <option value="NCAA_D2">NCAA Division II</option>
                <option value="NCAA_D3">NCAA Division III</option>
                <option value="CLUB_OPEN">Club / Post-Collegiate Open</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor={`${fieldId}-gender`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Standards Category
              </label>
              <select
                id={`${fieldId}-gender`}
                value={competitionGender}
                onChange={(e) => setCompetitionGender(e.target.value as 'MEN' | 'WOMEN')}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              >
                <option value="MEN">Men&apos;s Standards</option>
                <option value="WOMEN">Women&apos;s Standards</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor={`${fieldId}-ferritin`}
                className="block text-2xs font-medium text-slate-600 dark:text-slate-300 mb-1"
              >
                Serum Ferritin (ng/mL)
              </label>
              <input
                id={`${fieldId}-ferritin`}
                type="number"
                step="0.1"
                min={1}
                max={400}
                placeholder="Optional (e.g. 42)"
                value={ferritinInput}
                onChange={(e) => setFerritinInput(e.target.value)}
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 py-1.5 font-mono text-xs"
              />
            </div>
          </div>
        </form>

        {/* Side-by-Side 7-Zone Power & 7-Zone Heart Rate Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: 7-Zone Cycling Power Table (Outdoor Watts, Indoor Watts, W/kg) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Cycling 7-Zone Power Table
                </h3>
                <p className="text-2xs text-slate-500 dark:text-slate-400">
                  Calibrated for Outdoor ({ftp}W) &amp; Virtual/Indoor ({indoorFtp}W)
                  {safeSportHideWeight
                    ? ' · Safe-Sport Mode'
                    : ` @ ${distanceUnit === 'mi' ? `${weightLbs} lbs` : `${weightKg.toFixed(1)} kg`}`}
                </p>
              </div>
              <span className="text-2xs font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-sky-300 font-semibold">
                {safeSportHideWeight ? 'Safe-Sport' : `${outdoorWkg} W/kg`}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    <th className="py-1.5 pr-2">Zone</th>
                    <th className="py-1.5 px-2 text-right">% FTP</th>
                    <th className="py-1.5 px-2 text-right">Outdoor (W)</th>
                    <th className="py-1.5 px-2 text-right">Virtual (W)</th>
                    <th className="py-1.5 pl-2 text-right">W/kg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 font-mono tabular-nums text-2xs">
                  {previewPowerZones.map((pz) => {
                    const minWkg = (pz.minWatts / Math.max(35, weightKg)).toFixed(1);
                    const maxWkg = (pz.maxWatts / Math.max(35, weightKg)).toFixed(1);
                    return (
                      <tr key={pz.code} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2 pr-2 font-sans">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-xs shrink-0"
                              style={{ backgroundColor: pz.color }}
                            />
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              {pz.code}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300 truncate max-w-[125px]">
                              {pz.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right text-slate-500 dark:text-slate-400">
                          {pz.zone === 7 ? `>${pz.minPct - 1}%` : `${pz.minPct}–${pz.maxPct}%`}
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-slate-900 dark:text-slate-100">
                          {pz.zone === 7 ? `>${pz.minWatts}W` : `${pz.minWatts}–${pz.maxWatts}W`}
                        </td>
                        <td className="py-2 px-2 text-right font-semibold text-indigo-600 dark:text-indigo-300">
                          {pz.zone === 7
                            ? `>${pz.minIndoorWatts}W`
                            : `${pz.minIndoorWatts}–${pz.maxIndoorWatts}W`}
                        </td>
                        <td className="py-2 pl-2 text-right text-slate-500 dark:text-slate-400">
                          {safeSportHideWeight
                            ? '—'
                            : pz.zone === 7
                              ? `>${minWkg}`
                              : `${minWkg}–${maxWkg}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Sport Heart Rate Table (Garmin 5-Zone or Friel 7-Zone) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {(hrTab === 'CYCLING' ? previewBikeHrZones : previewRunHrZones).length}-Zone Heart Rate Table ({hrTab === 'CYCLING' ? 'Cycling' : 'Running'})
                </h3>
                <p className="text-2xs text-slate-500 dark:text-slate-400">
                  {hrTab === 'CYCLING'
                    ? `LTHR ${lthr} bpm · Max HR ${maxHr} bpm · RHR ${restingHr} bpm`
                    : `Run LTHR ${runLthr} bpm · Run Max HR ${runMaxHr} bpm`}
                </p>
              </div>

              <div
                role="group"
                aria-label="Heart rate zone sport"
                className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs"
              >
                <button
                  type="button"
                  aria-pressed={hrTab === 'CYCLING'}
                  onClick={() => setHrTab('CYCLING')}
                  className={`min-h-[44px] sm:min-h-[30px] px-2.5 py-1 rounded-md transition-all ${
                    hrTab === 'CYCLING'
                      ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Cycling HR
                </button>
                <button
                  type="button"
                  aria-pressed={hrTab === 'RUNNING'}
                  onClick={() => setHrTab('RUNNING')}
                  className={`min-h-[44px] sm:min-h-[30px] px-2.5 py-1 rounded-md transition-all ${
                    hrTab === 'RUNNING'
                      ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Running HR
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    <th className="py-1.5 pr-2">Zone</th>
                    <th className="py-1.5 px-2 text-right">% LTHR</th>
                    <th className="py-1.5 pl-2 text-right">Target Heart Rate (BPM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 font-mono tabular-nums text-2xs">
                  {(hrTab === 'CYCLING' ? previewBikeHrZones : previewRunHrZones).map((hz) => (
                    <tr key={hz.code} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-2 font-sans">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: hz.color }}
                          />
                          <span className="font-mono font-bold text-slate-900 dark:text-white">
                            {hz.code}
                          </span>
                          <span className="text-slate-600 dark:text-slate-300 truncate max-w-[165px]">
                            {hz.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-500 dark:text-slate-400">
                        {hz.minPctLthr}–{hz.maxPctLthr}%
                      </td>
                      <td className="py-2 pl-2 text-right font-bold text-rose-600 dark:text-rose-400">
                        {hz.minBpm} – {hz.maxBpm} bpm
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Time-Versioned Threshold History Ledger (Historical TSS Protection) */}
        <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Effective-Dated Threshold Ledger
              </h3>
              <p className="text-2xs text-slate-500 dark:text-slate-400">
                Version FTP, LTHR, and LT Pace by date so raising your FTP today never retroactively distorts historical TSS or CTL.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
              <span>Effective Date for Next Save:</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-mono text-slate-900 dark:text-white"
              />
            </label>
          </div>

          {thresholdHistory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-xs text-slate-500 dark:text-slate-400">
              No dated threshold snapshots recorded yet. Saving thresholds above will stamp your first effective-date baseline ({effectiveDate}).
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {[...thresholdHistory]
                .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="font-mono tabular-nums space-y-0.5">
                      <div className="font-bold text-[#1D4ED8] dark:text-sky-300">
                        From {entry.effectiveDate}
                      </div>
                      <div className="text-2xs text-slate-600 dark:text-slate-300">
                        {entry.ftp}W FTP · {entry.lthr} bpm · {formatPace(entry.thresholdPaceSecsPerKm)}
                      </div>
                    </div>
                    {pendingDeleteHistoryId === entry.id ? (
                      <div className="inline-flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            handleDeleteHistoryEntry(entry.id);
                            setPendingDeleteHistoryId(null);
                          }}
                          className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-rose-600 text-white text-2xs font-mono font-bold"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteHistoryId(null)}
                          className="min-h-[44px] sm:min-h-[32px] px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-2xs font-mono"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDeleteHistoryId(entry.id)}
                        aria-label={`Remove threshold history entry from ${entry.effectiveDate}`}
                        className="min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg text-2xs font-mono text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        title="Remove threshold history entry"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
