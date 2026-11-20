import React from 'react';
import { Gauge } from '../icons/PhosphorIcons';
import type {
  DistanceUnit,
  SpeedReservePhenotype,
  TrackTargetEventGroup,
  TrackTrainingZoneCode,
} from '../../types';
import type { buildTrackSpeedReserveProfile } from '../../physiology/trackSpeedReserveEngine';
import {
  formatTrackSplitToken,
  type generatePeriodizedTrackPlan,
  type TrackStartingPhaseOption,
} from '../../physiology/trackPrescriptionEngine';
import { formatPace } from '../../utils/formatters';

export interface TrackEventPresetSpec {
  seedPlaceholder: string;
  goalPlaceholder: string;
  presets: readonly string[];
}

export function getTrackEventSeedPresets(
  eventGroup?: TrackTargetEventGroup
): TrackEventPresetSpec {
  switch (eventGroup) {
    case '800M':
      return {
        seedPlaceholder: 'e.g. 1:56 or 800m 2:04',
        goalPlaceholder: 'e.g. 1:52 or 800m 1:58',
        presets: ['1:52', '2:00', '2:12', '2:25'],
      };
    case '3000_3200M':
      return {
        seedPlaceholder: 'e.g. 9:15 or 3000m 8:35',
        goalPlaceholder: 'e.g. 8:45 or 3200m 9:30',
        presets: ['8:55', '9:45', '10:45', '12:15'],
      };
    case '5000M':
      return {
        seedPlaceholder: 'e.g. 15:20 or 5k 17:45',
        goalPlaceholder: 'e.g. 14:20 or 5k 17:00',
        presets: ['14:40', '16:15', '18:30', '21:30'],
      };
    case '1500_MILE':
    default:
      return {
        seedPlaceholder: 'e.g. 4:05 or 1500m 3:48.5',
        goalPlaceholder: 'e.g. 3:59 or 1600m 4:25',
        presets: ['4:05', '4:35', '5:15', '6:15'],
      };
  }
}

export interface TrackSpeedReservePanelProps {
  formId: string;
  distanceUnit: DistanceUnit;
  trackEventGroup?: TrackTargetEventGroup;
  trackStartingPhase: TrackStartingPhaseOption;
  setTrackStartingPhase: React.Dispatch<React.SetStateAction<TrackStartingPhaseOption>>;
  trackPhenotypeOverride: SpeedReservePhenotype | 'AUTO';
  setTrackPhenotypeOverride: React.Dispatch<React.SetStateAction<SpeedReservePhenotype | 'AUTO'>>;
  trackSeedInput: string;
  setTrackSeedInput: React.Dispatch<React.SetStateAction<string>>;
  trackGoalInput: string;
  setTrackGoalInput: React.Dispatch<React.SetStateAction<string>>;
  setSelectedPreviewWeekIdx: React.Dispatch<React.SetStateAction<number>>;
  trackSpeedReserveState: {
    profile: ReturnType<typeof buildTrackSpeedReserveProfile>;
    parsedManualSeed: { distanceMeters: number; durationSecs: number } | null;
    goalTimeSecs?: number;
    officialMarkCount: number;
    isCalibratingEstimate: boolean;
  };
  trackPlanBundle: ReturnType<typeof generatePeriodizedTrackPlan> | null;
}

export const TrackSpeedReservePanel: React.FC<TrackSpeedReservePanelProps> = ({
  formId,
  distanceUnit,
  trackEventGroup,
  trackStartingPhase,
  setTrackStartingPhase,
  trackPhenotypeOverride,
  setTrackPhenotypeOverride,
  trackSeedInput,
  setTrackSeedInput,
  trackGoalInput,
  setTrackGoalInput,
  setSelectedPreviewWeekIdx,
  trackSpeedReserveState,
  trackPlanBundle,
}) => {
  const eventPresetSpec = getTrackEventSeedPresets(trackEventGroup);
  return (
              <div
                data-testid="track-speed-reserve-panel"
                className="rounded-xl border border-ap-cobalt/30 dark:border-ap-edge bg-stone-50 dark:bg-ap-carbon p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-ap-cobalt dark:text-ap-volt" />
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                      Track Speed-Reserve &amp; Date-Pace Calibration
                    </h2>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-lg font-mono text-2xs font-bold ${
                      trackSpeedReserveState.isCalibratingEstimate
                        ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {trackSpeedReserveState.isCalibratingEstimate
                      ? 'CALIBRATING · Default Baseline'
                      : trackSpeedReserveState.parsedManualSeed
                        ? `Seeded · ${Math.round(trackSpeedReserveState.parsedManualSeed.distanceMeters)}m in ${formatTrackSplitToken(
                            trackSpeedReserveState.parsedManualSeed.durationSecs
                          )}`
                        : `${trackSpeedReserveState.officialMarkCount} FAT Marks · CS + D'`}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label
                      htmlFor={`${formId}-track-phase`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Season Phase
                    </label>
                    <select
                      id={`${formId}-track-phase`}
                      value={trackStartingPhase}
                      onChange={(e) => {
                        setTrackStartingPhase(e.target.value as TrackStartingPhaseOption);
                        setSelectedPreviewWeekIdx(0);
                      }}
                      className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                    >
                      <option value="FULL_PROGRESSION">Full Periodized Arc</option>
                      <option value="BASE">Base Building &amp; Sub-T</option>
                      <option value="STRENGTH_CV">Strength &amp; Tinman CV</option>
                      <option value="SPECIFIC">Race-Specific Track Peak</option>
                      <option value="PEAK_TAPER">Championship Peak &amp; Taper</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`${formId}-track-phenotype`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      ASR Phenotype
                    </label>
                    <select
                      id={`${formId}-track-phenotype`}
                      value={trackPhenotypeOverride}
                      onChange={(e) =>
                        setTrackPhenotypeOverride(e.target.value as SpeedReservePhenotype | 'AUTO')
                      }
                      className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                    >
                      <option value="AUTO">Auto (From CS + D&apos;)</option>
                      <option value="ENDURANCE">Endurance (Lower D&apos; · Aerobic)</option>
                      <option value="HYBRID">Hybrid (Balanced CS + ASR)</option>
                      <option value="SPEED">Speed Type (High ASR / D&apos;)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`${formId}-track-seed`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Recent Seed Mark
                    </label>
                    <input
                      id={`${formId}-track-seed`}
                      data-testid="track-seed-input"
                      type="text"
                      value={trackSeedInput}
                      onChange={(e) => setTrackSeedInput(e.target.value)}
                      placeholder={eventPresetSpec.seedPlaceholder}
                      className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                    />
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {eventPresetSpec.presets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          data-testid={`track-seed-preset-${preset}`}
                          onClick={() => setTrackSeedInput(preset)}
                          className={`min-h-[44px] sm:min-h-[32px] px-2.5 py-0.5 rounded font-mono text-2xs border cursor-pointer ${
                            trackSeedInput.trim() === preset
                              ? 'bg-ap-cobalt text-white border-ap-cobalt dark:bg-ap-volt dark:text-ap-obsidian font-bold'
                              : 'bg-white dark:bg-ap-turf text-slate-700 dark:text-slate-300 border-stone-300 dark:border-ap-edge-dark'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor={`${formId}-track-goal`}
                      className="block text-2xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
                    >
                      Goal Mark (Optional)
                    </label>
                    <input
                      id={`${formId}-track-goal`}
                      data-testid="track-goal-input"
                      type="text"
                      value={trackGoalInput}
                      onChange={(e) => setTrackGoalInput(e.target.value)}
                      placeholder={eventPresetSpec.goalPlaceholder}
                      className="w-full min-h-[44px] sm:min-h-[42px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono tabular-nums text-xs">
                  <div className="rounded-lg bg-white dark:bg-ap-turf border border-stone-200 dark:border-ap-edge px-3 py-2">
                    <div className="text-2xs text-slate-500">Aerobic VDOT</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {trackSpeedReserveState.profile.vdotAer.toFixed(1)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white dark:bg-ap-turf border border-stone-200 dark:border-ap-edge px-3 py-2">
                    <div className="text-2xs text-slate-500">Critical Speed (CV)</div>
                    <div className="text-sm font-extrabold text-ap-cobalt dark:text-ap-volt">
                      {formatPace(trackSpeedReserveState.profile.criticalPaceSecsPerKm, distanceUnit)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white dark:bg-ap-turf border border-stone-200 dark:border-ap-edge px-3 py-2">
                    <div className="text-2xs text-slate-500">Anaerobic D&apos;</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                      {Math.round(trackSpeedReserveState.profile.dPrimeMeters)} m
                    </div>
                  </div>
                  <div className="rounded-lg bg-white dark:bg-ap-turf border border-stone-200 dark:border-ap-edge px-3 py-2">
                    <div className="text-2xs text-slate-500">Speed Reserve (ASR)</div>
                    <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                      +{trackSpeedReserveState.profile.asrMps.toFixed(2)} m/s ·{' '}
                      {trackPlanBundle?.phenotype || trackSpeedReserveState.profile.phenotype}
                    </div>
                  </div>
                </div>

                {trackPlanBundle?.ambitiousGoalWarning && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 font-mono">
                    Goal exceeds +{trackPlanBundle.deltaMaxPct.toFixed(1)}% 16-week cap (
                    {trackPlanBundle.rawGoalGapPct.toFixed(1)}% gap). Weekly split targets safely clamped.
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono tabular-nums text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-stone-200 dark:border-ap-edge text-2xs text-slate-500">
                        <th className="py-1.5 pr-3">Zone</th>
                        <th className="py-1.5 px-2">Pace</th>
                        <th className="py-1.5 px-2">200m</th>
                        <th className="py-1.5 px-2">400m</th>
                        <th className="py-1.5 px-2">800m</th>
                        <th className="py-1.5 px-2">1000m</th>
                        <th className="py-1.5 pl-2">1600m</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/70 dark:divide-ap-edge/70">
                      {(['E', 'SUB_T', 'T', 'CV', 'I', 'R', 'FR'] as TrackTrainingZoneCode[]).map(
                        (code) => {
                          const row = trackSpeedReserveState.profile.zones[code];
                          return (
                            <tr key={code} data-testid={`track-zone-row-${code}`}>
                              <td className="py-1.5 pr-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                {row.code} ·{' '}
                                <span className="font-normal text-slate-600 dark:text-slate-300">
                                  {row.name}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-ap-cobalt dark:text-ap-volt font-bold">
                                {formatPace(row.paceSecsPerKm, distanceUnit)}
                              </td>
                              <td className="py-1.5 px-2 text-slate-800 dark:text-slate-200">
                                {formatTrackSplitToken(row.splitsSecs.m200)}
                              </td>
                              <td className="py-1.5 px-2 font-bold text-slate-900 dark:text-white">
                                {formatTrackSplitToken(row.splitsSecs.m400)}
                              </td>
                              <td className="py-1.5 px-2 text-slate-800 dark:text-slate-200">
                                {formatTrackSplitToken(row.splitsSecs.m800)}
                              </td>
                              <td className="py-1.5 px-2 text-slate-800 dark:text-slate-200">
                                {formatTrackSplitToken(row.splitsSecs.m1000)}
                              </td>
                              <td className="py-1.5 pl-2 text-slate-800 dark:text-slate-200">
                                {formatTrackSplitToken(row.splitsSecs.m1600)}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
  );
};
