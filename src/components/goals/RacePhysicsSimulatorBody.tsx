import React from 'react';
import type { AthleteProfile, DistanceUnit } from '../../types';
import type { simulateCoursePacingAndFueling } from '../../physiology/raceSimulator';
import { formatDuration, formatPace } from '../../utils/formatters';

export interface RacePhysicsSimulatorBodyProps {
  formId: string;
  distanceUnit: DistanceUnit;
  athleteProfile?: AthleteProfile;
  simRaceName: string;
  setSimRaceName: React.Dispatch<React.SetStateAction<string>>;
  setSimDistKm: React.Dispatch<React.SetStateAction<number>>;
  setSimElevM: React.Dispatch<React.SetStateAction<number>>;
  setSimTempC: React.Dispatch<React.SetStateAction<number>>;
  setSimAltM: React.Dispatch<React.SetStateAction<number>>;
  isImperial: boolean;
  simDistDisplay: number;
  simElevDisplay: number;
  simTempDisplay: number;
  simAltDisplay: number;
  raceSimulationReport: ReturnType<typeof simulateCoursePacingAndFueling>;
}

export const RacePhysicsSimulatorBody: React.FC<RacePhysicsSimulatorBodyProps> = ({
  formId,
  distanceUnit,
  athleteProfile,
  simRaceName,
  setSimRaceName,
  setSimDistKm,
  setSimElevM,
  setSimTempC,
  setSimAltM,
  isImperial,
  simDistDisplay,
  simElevDisplay,
  simTempDisplay,
  simAltDisplay,
  raceSimulationReport,
}) => {
  return (
    <>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
          <div className="col-span-2">
            <label
              htmlFor={`${formId}-sim-course-name`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Event / Course Name
            </label>
            <input
              id={`${formId}-sim-course-name`}
              type="text"
              value={simRaceName}
              onChange={(e) => setSimRaceName(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-dist`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Distance ({isImperial ? 'mi' : 'km'})
            </label>
            <input
              id={`${formId}-sim-dist`}
              type="number"
              min={1}
              max={400}
              step={0.1}
              value={simDistDisplay}
              onChange={(e) => {
                const raw = Math.max(1, Number(e.target.value) || 5);
                setSimDistKm(isImperial ? Number((raw / 0.621371).toFixed(2)) : raw);
              }}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-elev`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Elevation Gain ({isImperial ? 'ft' : 'm'})
            </label>
            <input
              id={`${formId}-sim-elev`}
              type="number"
              min={0}
              max={25000}
              step={25}
              value={simElevDisplay}
              onChange={(e) => {
                const raw = Math.max(0, Number(e.target.value) || 0);
                setSimElevM(isImperial ? Math.round(raw / 3.28084) : raw);
              }}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-temp`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Temp ({isImperial ? '°F' : '°C'})
            </label>
            <input
              id={`${formId}-sim-temp`}
              type="number"
              min={isImperial ? 20 : -5}
              max={isImperial ? 115 : 45}
              step={1}
              value={simTempDisplay}
              onChange={(e) => {
                const raw = Number(e.target.value) || (isImperial ? 65 : 18);
                setSimTempC(isImperial ? Math.round(((raw - 32) * 5) / 9) : raw);
              }}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label
              htmlFor={`${formId}-sim-alt`}
              className="block text-2xs text-slate-500 mb-1"
            >
              Altitude ({isImperial ? 'ft' : 'm'})
            </label>
            <input
              id={`${formId}-sim-alt`}
              type="number"
              min={0}
              max={14000}
              step={100}
              value={simAltDisplay}
              onChange={(e) => {
                const raw = Math.max(0, Number(e.target.value) || 0);
                setSimAltM(isImperial ? Math.round(raw / 3.28084) : raw);
              }}
              className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-ap-turf/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Predicted Finish Time
            </div>
            <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
              {formatDuration(raceSimulationReport.predictedFinishTimeSecs)}
            </div>
            <div className="text-2xs ap-text-brand">
              {raceSimulationReport.sport === 'Cycling'
                ? `Avg ${raceSimulationReport.averageTargetWatts ?? 0}W · NP ${
                    raceSimulationReport.normalizedTargetWatts ?? 0
                  }W`
                : `Avg ${formatPace(
                    raceSimulationReport.averageTargetPaceSecsPerKm ?? 250,
                    distanceUnit
                  )}`}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-ap-turf/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Environmental &amp; Fade Derating
            </div>
            <div className="mt-0.5 text-sm font-bold text-amber-600 dark:text-amber-400">
              Heat -{raceSimulationReport.thermalDeratingPct}% · Alt -
              {raceSimulationReport.altitudeDeratingPct}%
            </div>
            <div className="text-2xs text-slate-500">
              Durability Fade Cap: -{raceSimulationReport.durabilityDeratingPct}%
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-ap-turf/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Carb Oxidation Target
            </div>
            <div className="mt-0.5 text-base font-bold text-emerald-600 dark:text-emerald-400">
              {raceSimulationReport.fuelingPlan.carbsGramsPerHour} g/hr (
              {raceSimulationReport.fuelingPlan.totalCarbsGrams}g total)
            </div>
            <div className="text-2xs text-slate-500">
              {raceSimulationReport.fuelingPlan.glucoseFructoseRatio} · ~
              {raceSimulationReport.fuelingPlan.gelEquivalentsCount} gels
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/75 dark:bg-ap-turf/60 p-3">
            <div className="text-2xs uppercase tracking-wider text-slate-500">
              Sodium &amp; Hydration
            </div>
            <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">
              {raceSimulationReport.fuelingPlan.sodiumMgPerHour} mg/hr Na+
            </div>
            <div className="text-2xs text-slate-500">
              {raceSimulationReport.fuelingPlan.fluidMlPerHour} mL/hr fluid
              {!athleteProfile?.safeSportHideWeight &&
              raceSimulationReport.fuelingPlan.caffeineMgRecommendation > 0
                ? ` · ${raceSimulationReport.fuelingPlan.caffeineMgRecommendation}mg Caf`
                : ''}
            </div>
          </div>
        </div>

        {/* 5-Segment Pacing & Fueling Cards (Mobile) + Table (Desktop) */}
        <div data-testid="race-physics-mobile-cards" className="md:hidden space-y-2.5">
          {raceSimulationReport.segments.map((seg) => {
            const startUnit = isImperial
              ? (seg.startKm * 0.621371).toFixed(1)
              : seg.startKm;
            const endUnit = isImperial ? (seg.endKm * 0.621371).toFixed(1) : seg.endKm;
            const targetCapLabel =
              raceSimulationReport.sport === 'Cycling'
                ? athleteProfile?.safeSportHideWeight || seg.targetWkg == null
                  ? `${seg.targetWatts ?? 0}W`
                  : `${seg.targetWatts ?? 0}W (${seg.targetWkg} W/kg)`
                : `${formatPace(seg.targetPaceSecsPerKm ?? 250, distanceUnit)} (GAP ${formatPace(
                    seg.targetGapSecsPerKm ?? 245,
                    distanceUnit
                  )})`;
            return (
              <div
                key={`mob-seg-${seg.segmentIndex}`}
                className="rounded-xl ap-card-inset p-3 space-y-1.5 text-xs"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {seg.segmentLabel}{' '}
                    <span className="font-mono text-2xs text-slate-600 dark:text-slate-300">
                      ({startUnit}–{endUnit} {isImperial ? 'mi' : 'km'})
                    </span>
                  </div>
                  <span className="font-mono font-bold ap-text-brand shrink-0">
                    {targetCapLabel}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-2xs text-slate-600 dark:text-slate-300">
                  <span>Split {formatDuration(seg.segmentDurationSecs)}</span>
                  <span>
                    {seg.avgGradePct}% grade · {seg.accumulatedFatigueLabel}
                  </span>
                </div>
                <div className="font-mono text-2xs ap-ink-emerald">
                  {seg.carbsGramsTarget}g CHO · {seg.sodiumMgTarget}mg Na+ · {seg.fluidMlTarget}mL
                </div>
                <p className="text-slate-700 dark:text-slate-200 leading-snug">
                  {seg.coachingCue}
                </p>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                <th scope="col" className="py-2 px-3">Course Segment</th>
                <th scope="col" className="py-2 px-3 text-right">Grade / Fatigue</th>
                <th scope="col" className="py-2 px-3 text-right">Target Cap</th>
                <th scope="col" className="py-2 px-3 text-right">Split Time</th>
                <th scope="col" className="py-2 px-3 text-right">Segment Fueling</th>
                <th scope="col" className="py-2 px-3">Coaching Cue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
              {raceSimulationReport.segments.map((seg) => {
                const startUnit = isImperial
                  ? (seg.startKm * 0.621371).toFixed(1)
                  : seg.startKm;
                const endUnit = isImperial ? (seg.endKm * 0.621371).toFixed(1) : seg.endKm;
                return (
                  <tr
                    key={seg.segmentIndex}
                    className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                  >
                    <td className="py-2.5 px-3 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {seg.segmentLabel}{' '}
                      <span className="font-mono text-2xs text-slate-500">
                        ({startUnit}–{endUnit} {isImperial ? 'mi' : 'km'})
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-300">
                      {seg.avgGradePct}% · {seg.accumulatedFatigueLabel}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold ap-text-brand">
                      {raceSimulationReport.sport === 'Cycling'
                        ? athleteProfile?.safeSportHideWeight || seg.targetWkg == null
                          ? `${seg.targetWatts ?? 0}W`
                          : `${seg.targetWatts ?? 0}W (${seg.targetWkg} W/kg)`
                        : `${formatPace(seg.targetPaceSecsPerKm ?? 250, distanceUnit)} (GAP ${formatPace(
                            seg.targetGapSecsPerKm ?? 245,
                            distanceUnit
                          )})`}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-800 dark:text-slate-200">
                      {formatDuration(seg.segmentDurationSecs)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-emerald-700 dark:text-emerald-300">
                      {seg.carbsGramsTarget}g CHO · {seg.sodiumMgTarget}mg Na+ · {seg.fluidMlTarget}mL
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-300">
                      {seg.coachingCue}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
    </>
  );
};
