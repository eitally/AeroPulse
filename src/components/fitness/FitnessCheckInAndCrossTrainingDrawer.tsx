import React from 'react';
import type {
  CrossTrainingModality,
  DistanceUnit,
  SportCategory,
  UnifiedWellnessDay,
} from '../../types';
import type {
  computeCrossTrainingEquivalence,
  evaluateStudentAthleteGuardrail,
} from '../../physiology';
import type { evaluateSafeSportPatternWatch } from '../../physiology/safeSportPatternWatchEngine';

export interface FitnessCheckInAndCrossTrainingDrawerProps {
  formId: string;
  todayIso: string;
  distanceUnit: DistanceUnit;
  latestDay: UnifiedWellnessDay;
  isStudentContext: boolean;
  showNcaaCara?: boolean;
  showGrowthPlatePhv?: boolean;
  studentGuardrail: ReturnType<typeof evaluateStudentAthleteGuardrail>;
  safeSportWatchReport: ReturnType<typeof evaluateSafeSportPatternWatch>;
  crossTrainEquiv: ReturnType<typeof computeCrossTrainingEquivalence>;
  academicStress: 1 | 2 | 3 | 4 | 5;
  setAcademicStress: React.Dispatch<React.SetStateAction<1 | 2 | 3 | 4 | 5>>;
  shinBoneSoreness: 0 | 1 | 2 | 3;
  setShinBoneSoreness: React.Dispatch<React.SetStateAction<0 | 1 | 2 | 3>>;
  achillesSoreness: 0 | 1 | 2 | 3;
  setAchillesSoreness: React.Dispatch<React.SetStateAction<0 | 1 | 2 | 3>>;
  kneeGrowthPlateSoreness: 0 | 1 | 2 | 3;
  setKneeGrowthPlateSoreness: React.Dispatch<React.SetStateAction<0 | 1 | 2 | 3>>;
  heelApophysisSoreness: 0 | 1 | 2 | 3;
  setHeelApophysisSoreness: React.Dispatch<React.SetStateAction<0 | 1 | 2 | 3>>;
  crossTrainModality: CrossTrainingModality;
  setCrossTrainModality: React.Dispatch<React.SetStateAction<CrossTrainingModality>>;
  crossTrainMins: number;
  setCrossTrainMins: React.Dispatch<React.SetStateAction<number>>;
  crossTrainRpe: number;
  setCrossTrainRpe: React.Dispatch<React.SetStateAction<number>>;
  crossTrainToast: string | null;
  setCrossTrainToast: React.Dispatch<React.SetStateAction<string | null>>;
  onSyncMorphedToCalendar?: (eventInput: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
}

export const FitnessCheckInAndCrossTrainingDrawer: React.FC<
  FitnessCheckInAndCrossTrainingDrawerProps
> = ({
  formId,
  todayIso,
  distanceUnit,
  latestDay,
  isStudentContext,
  showNcaaCara = false,
  showGrowthPlatePhv,
  studentGuardrail,
  safeSportWatchReport,
  crossTrainEquiv,
  academicStress,
  setAcademicStress,
  shinBoneSoreness,
  setShinBoneSoreness,
  achillesSoreness,
  setAchillesSoreness,
  kneeGrowthPlateSoreness,
  setKneeGrowthPlateSoreness,
  heelApophysisSoreness,
  setHeelApophysisSoreness,
  crossTrainModality,
  setCrossTrainModality,
  crossTrainMins,
  setCrossTrainMins,
  crossTrainRpe,
  setCrossTrainRpe,
  crossTrainToast,
  setCrossTrainToast,
  onSyncMorphedToCalendar,
}) => {
  const effectiveShowGrowthPlatePhv = showGrowthPlatePhv ?? isStudentContext;
  return (
            <div className="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1 text-xs">
                {/* Left 6 Cols: 5-Second Readiness & Soreness Check-In */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-ap-turf/70 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {isStudentContext
                        ? '5-Second Student-Athlete Check-In'
                        : '5-Second Soreness & Life-Stress Check-In'}
                    </span>
                    <span className="px-2 py-0.5 rounded ap-status-info font-mono text-2xs font-bold">
                      Intensity Cap: {studentGuardrail.intensityScalePct}%
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label
                        htmlFor={`${formId}-academic-stress`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        {isStudentContext ? 'School / Exam Stress' : 'Life / Work Stress'}
                      </label>
                      <select
                        id={`${formId}-academic-stress`}
                        value={academicStress}
                        onChange={(e) =>
                          setAcademicStress(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      >
                        <option value={1}>
                          {isStudentContext ? '1 — Normal Classes' : '1 — Low / Routine'}
                        </option>
                        <option value={2}>
                          {isStudentContext ? '2 — Light Papers' : '2 — Manageable Week'}
                        </option>
                        <option value={3}>
                          {isStudentContext ? '3 — Midterms / Labs' : '3 — Busy / Moderate'}
                        </option>
                        <option value={4}>
                          {isStudentContext ? '4 — Heavy Exams' : '4 — Heavy Workload'}
                        </option>
                        <option value={5}>
                          {isStudentContext ? '5 — Finals / All-Nighter' : '5 — Exhausted / Poor Sleep'}
                        </option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-shin-pain`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Shin / Foot Bone Pain
                      </label>
                      <select
                        id={`${formId}-shin-pain`}
                        value={shinBoneSoreness}
                        onChange={(e) =>
                          setShinBoneSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Zero Pain</option>
                        <option value={1}>1 — Mild Diffuse Tightness</option>
                        <option value={2}>2 — Focal Point Tenderness</option>
                        <option value={3}>3 — Hop / Walk Pain (Stop)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-achilles-soreness`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Achilles / Calf Tendon
                      </label>
                      <select
                        id={`${formId}-achilles-soreness`}
                        value={achillesSoreness}
                        onChange={(e) =>
                          setAchillesSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Springy / Clear</option>
                        <option value={1}>1 — Morning Stiffness</option>
                        <option value={2}>2 — Pinch Soreness</option>
                        <option value={3}>3 — Sharp Load Pain</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor={`${formId}-phv-knee`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        {effectiveShowGrowthPlatePhv ? 'Knee Growth-Plate' : 'Front Knee Tendon'}
                      </label>
                      <select
                        id={`${formId}-phv-knee`}
                        data-testid="phv-knee-select"
                        value={kneeGrowthPlateSoreness}
                        onChange={(e) =>
                          setKneeGrowthPlateSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Pain-Free</option>
                        <option value={1}>1 — Post-Jump Tightness</option>
                        <option value={2}>2 — Tender Kneecap / Bump</option>
                        <option value={3}>3 — Pause Jumps &amp; Spikes</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-phv-heel`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        {effectiveShowGrowthPlatePhv ? 'Heel Growth-Plate' : 'Heel / Plantar Soreness'}
                      </label>
                      <select
                        id={`${formId}-phv-heel`}
                        data-testid="phv-heel-select"
                        value={heelApophysisSoreness}
                        onChange={(e) =>
                          setHeelApophysisSoreness(Number(e.target.value) as 0 | 1 | 2 | 3)
                        }
                        className="w-full min-h-[44px] sm:min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      >
                        <option value={0}>0 — Pain-Free</option>
                        <option value={1}>1 — Warmup Soreness</option>
                        <option value={2}>2 — Squeeze Tenderness</option>
                        <option value={3}>3 — Avoid Impact</option>
                      </select>
                    </div>
                  </div>

                  <p className="text-2xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {studentGuardrail.recommendation}
                  </p>
                </div>

                {/* Right 6 Cols: Training Room Cross-Training -> Virtual Running Miles Converter */}
                <div className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-ap-turf/70 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">
                      Training Room Cross-Training → Virtual Miles
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono text-2xs font-bold tabular-nums">
                      ≈{' '}
                      {distanceUnit === 'km'
                        ? `${crossTrainEquiv.equivalentRunKm} virtual km`
                        : `${crossTrainEquiv.equivalentRunMiles} virtual mi`}{' '}
                      · {crossTrainEquiv.estimatedSystemicTss} TSS ({crossTrainEquiv.impactLoadSavedPct}% impact saved)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label
                        htmlFor={`${formId}-crosstrain-modality`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Modality
                      </label>
                      <select
                        id={`${formId}-crosstrain-modality`}
                        value={crossTrainModality}
                        onChange={(e) =>
                          setCrossTrainModality(e.target.value as CrossTrainingModality)
                        }
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      >
                        <option value="AQUA_JOGGING">Aqua Jogging</option>
                        <option value="ALTER_G">AlterG (75% BW)</option>
                        <option value="ELLIPTICAL">Elliptical (90+ RPM)</option>
                        <option value="ARC_TRAINER">Arc Trainer</option>
                        <option value="STATIONARY_BIKE">Spin / Smart Bike</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-crosstrain-mins`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Duration (min)
                      </label>
                      <input
                        id={`${formId}-crosstrain-mins`}
                        type="number"
                        min={10}
                        max={240}
                        step={5}
                        value={crossTrainMins}
                        onChange={(e) => setCrossTrainMins(Math.max(10, Number(e.target.value) || 30))}
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${formId}-crosstrain-rpe`}
                        className="block text-2xs font-mono text-slate-500 mb-1"
                      >
                        Effort RPE (1–10)
                      </label>
                      <input
                        id={`${formId}-crosstrain-rpe`}
                        type="number"
                        min={1}
                        max={10}
                        value={crossTrainRpe}
                        onChange={(e) =>
                          setCrossTrainRpe(Math.max(1, Math.min(10, Number(e.target.value) || 6)))
                        }
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-1 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-2xs text-slate-500 flex-1 min-w-[180px]">
                      {crossTrainEquiv.coachingNote}
                      {showNcaaCara ? ` (${crossTrainEquiv.caraCountableHours}h NCAA CARA)` : ''}
                    </span>
                    {onSyncMorphedToCalendar && (
                      <button
                        type="button"
                        onClick={async () => {
                          await onSyncMorphedToCalendar({
                            date: todayIso,
                            name: `Training Room Swap: ${crossTrainEquiv.durationMins}m ${crossTrainEquiv.modalityLabel}`,
                            sportCategory:
                              crossTrainModality === 'STATIONARY_BIKE' ? 'Cycling' : 'Multisport',
                            environmentPreference: 'INDOOR',
                            plannedDurationSecs: crossTrainEquiv.durationMins * 60,
                            plannedLoad: crossTrainEquiv.estimatedSystemicTss,
                            workoutSyntax: `Warmup\n- 10m RPE 4\n\nMain Set\n- ${Math.max(
                              10,
                              crossTrainEquiv.durationMins - 15
                            )}m RPE ${crossTrainEquiv.rpe}\n\nCooldown\n- 5m RPE 3`,
                            description: `${crossTrainEquiv.coachingNote} Equivalent to ${crossTrainEquiv.equivalentRunMiles} virtual running miles (${crossTrainEquiv.impactLoadSavedPct}% bone-impact reduction).`,
                            replaceExistingDate: true,
                          });
                          setCrossTrainToast(
                            `Scheduled ${crossTrainEquiv.durationMins}m ${crossTrainEquiv.modalityLabel} (≈ ${crossTrainEquiv.equivalentRunMiles} virtual mi · ${crossTrainEquiv.estimatedSystemicTss} TSS) for ${todayIso}.`
                          );
                          window.setTimeout(() => setCrossTrainToast(null), 4000);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-ap-cobalt hover:bg-[#16422A] dark:bg-ap-volt dark:hover:bg-[#B5EB00] text-white dark:text-ap-obsidian font-semibold text-xs whitespace-nowrap"
                      >
                        Schedule Cross-Training Swap
                      </button>
                    )}
                  </div>

                  {crossTrainToast && (
                    <div className="rounded-lg ap-status-prime px-2.5 py-1.5 text-2xs font-medium">
                      {crossTrainToast}
                    </div>
                  )}
                </div>
              </div>

              {/* Zero-Weight Longitudinal Energy, Iron & Growth-Plate Watch (TRK-12) */}
              <div
                data-testid="safesport-pattern-watch-card"
                className="rounded-xl ap-card-inset p-3.5 space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-2xs font-bold uppercase ${
                        safeSportWatchReport.trafficLight === 'RED_MEDICAL_REVIEW'
                          ? 'ap-status-strained'
                          : safeSportWatchReport.trafficLight === 'AMBER_WATCH'
                            ? 'ap-status-caution'
                            : 'ap-status-prime'
                      }`}
                    >
                      {safeSportWatchReport.trafficLight === 'RED_MEDICAL_REVIEW'
                        ? 'Medical / AT Review'
                        : safeSportWatchReport.trafficLight === 'AMBER_WATCH'
                          ? 'Pattern Watch'
                          : 'Zero-Weight Clear'}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {effectiveShowGrowthPlatePhv
                        ? `Longitudinal Energy, Iron & Growth-Plate Watch (${safeSportWatchReport.windowRecentDays}d vs ${safeSportWatchReport.windowBaselineDays}d)`
                        : `Longitudinal Energy & Iron Watch (${safeSportWatchReport.windowRecentDays}d vs ${safeSportWatchReport.windowBaselineDays}d)`}
                    </span>
                  </div>
                  <span className="font-mono text-2xs text-slate-600 dark:text-slate-300">
                    {safeSportWatchReport.medicalRoutingSummary}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-2xs tabular-nums">
                  <div className="rounded-lg bg-white/80 dark:bg-ap-carbon/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">Easy HR Drift</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {safeSportWatchReport.deltaEasyHrBpm !== null
                        ? `${safeSportWatchReport.deltaEasyHrBpm >= 0 ? '+' : ''}${safeSportWatchReport.deltaEasyHrBpm} bpm`
                        : 'Calibrating'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-ap-carbon/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">Efficiency (EF)</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {safeSportWatchReport.deltaEfficiencyFactorPct !== null
                        ? `${safeSportWatchReport.deltaEfficiencyFactorPct >= 0 ? '+' : ''}${safeSportWatchReport.deltaEfficiencyFactorPct}%`
                        : 'Calibrating'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-ap-carbon/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">60s HR Recovery</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {safeSportWatchReport.deltaHrr60Bpm !== null
                        ? `${safeSportWatchReport.deltaHrr60Bpm >= 0 ? '+' : ''}${safeSportWatchReport.deltaHrr60Bpm} bpm`
                        : 'Calibrating'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/80 dark:bg-ap-carbon/80 px-2.5 py-2 border border-slate-200/80 dark:border-white/10">
                    <div className="text-slate-500 dark:text-slate-400">
                      {effectiveShowGrowthPlatePhv ? 'Ferritin / PHV' : 'Iron / Ferritin'}
                    </div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {effectiveShowGrowthPlatePhv && safeSportWatchReport.phvGrowthPlateFlag
                        ? 'PHV Protection'
                        : safeSportWatchReport.ferritinStatus === 'DEPLETED_UNDER_30'
                          ? 'Ferritin < 30'
                          : safeSportWatchReport.ferritinStatus === 'SUBOPTIMAL_30_50'
                            ? 'Ferritin 30–49'
                            : safeSportWatchReport.ferritinStatus === 'OPTIMAL'
                              ? 'Optimal >= 50'
                              : 'Zero Weight Logged'}
                    </div>
                  </div>
                </div>

                <p className="text-2xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {safeSportWatchReport.athleteGuidance}
                </p>
              </div>
            </div>
  );
};
