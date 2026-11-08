import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bike,
  Check,
  Footprints,
  Heart,
  RefreshCw,
  Scale,
  Sliders,
  UserCheck,
  X,
  Zap,
} from "./icons/PhosphorIcons";
import { AthleteProfile, DistanceUnit, UnifiedWellnessDay } from '../types';
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
        source: 'CUSTOM_OVERRIDE',
        lastSyncedAt: new Date().toISOString(),
      },
      latestWellness
    );
    await onSaveProfileOverride(updated);
    setSavedToast('Profile thresholds & 7-zone tables updated across all analytics & workouts.');
    window.setTimeout(() => setSavedToast(null), 4000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl liquid-glass border border-slate-200/80 dark:border-slate-700/80 p-5 sm:p-6 space-y-5 shadow-2xl my-auto max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-semibold">
              <UserCheck className="w-3.5 h-3.5" />
              <span>Athlete Profile &amp; Sport Zones</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 text-[10px]">
                {athleteProfile.source === 'CUSTOM_OVERRIDE'
                  ? 'Custom Calibrated'
                  : 'Synced Profile'}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {athleteProfile.name} · Biometrics, FTP &amp; 7-Zone Calibration
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Directly powers your adapted workout prescriptions, calendar effort zones, power curves, and zone distribution analysis.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePullFromRemote}
              disabled={isSyncingProfile}
              className="min-h-[36px] inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all whitespace-nowrap"
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
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {savedToast && (
          <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/35 px-3.5 py-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{savedToast}</span>
          </div>
        )}

        {/* Top Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              <span>Outdoor FTP</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {ftp}W <span className="text-xs font-semibold text-sky-500">({outdoorWkg} W/kg)</span>
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              eFTP {athleteProfile.eFtp}W · W&apos; {(wPrime / 1000).toFixed(1)}kJ
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Bike className="w-3 h-3 text-indigo-500" />
              <span>Indoor Trainer FTP</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {indoorFtp}W{' '}
              <span className="text-xs font-semibold text-indigo-400">({indoorWkg} W/kg)</span>
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              Sweet Spot {athleteProfile.sweetSpotMinPct}–{athleteProfile.sweetSpotMaxPct}%
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Heart className="w-3 h-3 text-rose-500" />
              <span>Cycling LTHR / Max</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {lthr} <span className="text-xs font-normal text-slate-400">/ {maxHr} bpm</span>
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              Resting HR {restingHr} bpm
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Scale className="w-3 h-3 text-emerald-500" />
              <span>Body Weight</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {distanceUnit === 'mi' ? `${weightLbs} lbs` : `${weightKg.toFixed(1)} kg`}
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              {distanceUnit === 'mi' ? `${weightKg.toFixed(1)} kg` : `${weightLbs} lbs`}
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Footprints className="w-3 h-3 text-emerald-500" />
              <span>Run LT Pace &amp; FTP</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {formatPace(thresholdPaceSecsPerKm)}
            </div>
            <div className="text-[10px] font-mono text-slate-400">
              Run FTP {runFtp}W · LTHR {runLthr} bpm
            </div>
          </div>

          <div className="rounded-xl liquid-glass-subtle p-3 space-y-0.5">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Activity className="w-3 h-3 text-sky-500" />
              <span>VO2max</span>
            </div>
            <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
              {vo2MaxCycling} <span className="text-xs font-normal text-slate-400">/ {vo2MaxRunning}</span>
            </div>
            <div className="text-[10px] font-mono text-slate-400">Bike / Run mL/kg/min</div>
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
            <span className="text-[11px] font-mono text-slate-400">
              {intervalsConnected ? 'Connected to Intervals.icu' : 'Local / Sandbox Calibration'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Weight ({distanceUnit === 'mi' ? 'lbs' : 'kg'})
              </label>
              <input
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
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Resting HR (bpm)
              </label>
              <input
                type="number"
                min={30}
                max={100}
                value={restingHr}
                onChange={(e) => setRestingHr(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Outdoor FTP (W)
              </label>
              <input
                type="number"
                min={100}
                max={550}
                value={ftp}
                onChange={(e) => setFtp(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Indoor Trainer FTP (W)
              </label>
              <input
                type="number"
                min={100}
                max={550}
                value={indoorFtp}
                onChange={(e) => setIndoorFtp(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Bike LTHR (bpm)
              </label>
              <input
                type="number"
                min={110}
                max={210}
                value={lthr}
                onChange={(e) => setLthr(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Bike Max HR (bpm)
              </label>
              <input
                type="number"
                min={130}
                max={230}
                value={maxHr}
                onChange={(e) => setMaxHr(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                W&apos; Anaerobic (J)
              </label>
              <input
                type="number"
                step={500}
                min={8000}
                max={45000}
                value={wPrime}
                onChange={(e) => setWPrime(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Run FTP (W)
              </label>
              <input
                type="number"
                min={120}
                max={550}
                value={runFtp}
                onChange={(e) => setRunFtp(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Run LT Pace ({formatPace(thresholdPaceSecsPerKm)})
              </label>
              <input
                type="range"
                min={180}
                max={360}
                step={1}
                value={thresholdPaceSecsPerKm}
                onChange={(e) => setThresholdPaceSecsPerKm(Number(e.target.value))}
                className="w-full accent-blue-600 mt-2"
                title={`Adjust Lactate Threshold Run Pace: ${formatPace(thresholdPaceSecsPerKm)}`}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Run LTHR (bpm)
              </label>
              <input
                type="number"
                min={110}
                max={215}
                value={runLthr}
                onChange={(e) => setRunLthr(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                Run Max HR (bpm)
              </label>
              <input
                type="number"
                min={130}
                max={230}
                value={runMaxHr}
                onChange={(e) => setRunMaxHr(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 font-mono text-xs"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full min-h-[34px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors"
              >
                Save &amp; Apply Zones
              </button>
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
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Calibrated for Outdoor ({ftp}W) &amp; Virtual/Indoor ({indoorFtp}W) @{' '}
                  {distanceUnit === 'mi' ? `${weightLbs} lbs` : `${weightKg.toFixed(1)} kg`}
                </p>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-sky-300 font-semibold">
                {outdoorWkg} W/kg
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="py-1.5 pr-2">Zone</th>
                    <th className="py-1.5 px-2 text-right">% FTP</th>
                    <th className="py-1.5 px-2 text-right">Outdoor (W)</th>
                    <th className="py-1.5 px-2 text-right">Virtual (W)</th>
                    <th className="py-1.5 pl-2 text-right">W/kg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 font-mono tabular-nums text-[11px]">
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
                          {pz.zone === 7 ? `>${minWkg}` : `${minWkg}–${maxWkg}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: 7-Zone Heart Rate Table (Cycling & Running) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  7-Zone Heart Rate Table ({hrTab === 'CYCLING' ? 'Cycling' : 'Running'})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {hrTab === 'CYCLING'
                    ? `LTHR ${lthr} bpm · Max HR ${maxHr} bpm · RHR ${restingHr} bpm`
                    : `Run LTHR ${runLthr} bpm · Run Max HR ${runMaxHr} bpm`}
                </p>
              </div>

              <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-[10px]">
                <button
                  type="button"
                  onClick={() => setHrTab('CYCLING')}
                  className={`px-2.5 py-1 rounded-md transition-all ${
                    hrTab === 'CYCLING'
                      ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  Cycling HR
                </button>
                <button
                  type="button"
                  onClick={() => setHrTab('RUNNING')}
                  className={`px-2.5 py-1 rounded-md transition-all ${
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
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="py-1.5 pr-2">Zone</th>
                    <th className="py-1.5 px-2 text-right">% LTHR</th>
                    <th className="py-1.5 pl-2 text-right">Target Heart Rate (BPM)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/70 font-mono tabular-nums text-[11px]">
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
      </div>
    </div>
  );
};
