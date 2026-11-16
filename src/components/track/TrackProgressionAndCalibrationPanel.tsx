import React, { useMemo, useState } from 'react';
import type {
  AthleteProfile,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import {
  computeTrackProgressionLevels,
  runBayesianTrackCalibrator,
  type TrackProgressionAxisId,
} from '../../physiology/trackProgressionAndKalmanEngine';
import { formatPace } from '../../utils/formatters';
import {
  CaretDown,
  CaretUp,
  CheckCircle2,
  Gauge,
  Pulse,
  ShieldCheck,
  Warning,
} from '../icons/PhosphorIcons';

export interface TrackProgressionAndCalibrationPanelProps {
  activities: UnifiedActivity[];
  wellnessDays: UnifiedWellnessDay[];
  athleteProfile?: AthleteProfile;
  distanceUnit: 'mi' | 'km';
  onApplyPosteriorCalibration?: (updatedThresholdPaceSecsPerKm: number, vdotAer: number) => void;
}

const AXIS_BAR_CLASSES: Record<TrackProgressionAxisId, string> = {
  SUB_THRESHOLD_CV: 'bg-teal-600 dark:bg-teal-400',
  VO2MAX_AEROBIC_POWER: 'bg-orange-600 dark:bg-orange-400',
  RACE_PACE_STAMINA: 'bg-amber-600 dark:bg-amber-400',
  GLYCOLYTIC_SPEED_ENDURANCE: 'bg-rose-600 dark:bg-rose-400',
  MAX_VELOCITY_NEUROMUSCULAR: 'bg-indigo-600 dark:bg-indigo-400',
};

export const TrackProgressionAndCalibrationPanel: React.FC<
  TrackProgressionAndCalibrationPanelProps
> = ({
  activities,
  wellnessDays,
  athleteProfile,
  distanceUnit,
  onApplyPosteriorCalibration,
}) => {
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [confirmedQuarantineIds, setConfirmedQuarantineIds] = useState<string[]>([]);
  const [appliedBannerMsg, setAppliedBannerMsg] = useState<string | null>(null);

  const priorPaceSecsKm = athleteProfile?.thresholdPaceSecsPerKm || 228;

  const progression = useMemo(
    () =>
      computeTrackProgressionLevels({
        activities,
        wellnessDays,
        athleteProfile,
      }),
    [activities, wellnessDays, athleteProfile]
  );

  const bayesian = useMemo(
    () =>
      runBayesianTrackCalibrator({
        activities,
        wellnessDays,
        priorThresholdPaceSecsPerKm: priorPaceSecsKm,
        confirmedQuarantineIds,
      }),
    [activities, wellnessDays, priorPaceSecsKm, confirmedQuarantineIds]
  );

  const toggleQuarantineConfirm = (activityId: string) => {
    setConfirmedQuarantineIds((prev) =>
      prev.includes(activityId)
        ? prev.filter((id) => id !== activityId)
        : [...prev, activityId]
    );
  };

  return (
    <section
      data-testid="track-5axis-progression-panel"
      className="rounded-2xl ap-card p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-900/10 dark:border-white/10 pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Gauge className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
            <span>5-Axis Track Progression &amp; Bayesian Calibrator</span>
          </h2>
          <span className="px-2 py-0.5 rounded-md ap-status-info font-mono text-2xs font-bold uppercase">
            14d Decay Onset
          </span>
          {progression.partialCreditCount > 0 && (
            <span className="px-2 py-0.5 rounded-md ap-status-prime font-mono text-2xs font-bold">
              {progression.partialCreditCount}x 85% Stimulus Preserved
            </span>
          )}
          {progression.flukeProtectedCount > 0 && (
            <span className="px-2 py-0.5 rounded-md ap-status-caution font-mono text-2xs font-bold">
              {progression.flukeProtectedCount} Fluke Guarded
            </span>
          )}
        </div>

        <button
          type="button"
          data-testid="toggle-bayesian-quarantine-btn"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((prev) => !prev)}
          className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-2 px-3.5 rounded-xl ap-card-inset text-xs font-mono font-bold text-slate-900 dark:text-white cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
          <span>
            Kalman Audit ({bayesian.acceptedCount} Ok · {bayesian.quarantinedCount} Quarantined)
          </span>
          {drawerOpen ? (
            <CaretUp className="w-3.5 h-3.5" weight="bold" />
          ) : (
            <CaretDown className="w-3.5 h-3.5" weight="bold" />
          )}
        </button>
      </div>

      {/* Execution Score Highlight + Posterior Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono tabular-nums">
        <div className="rounded-xl ap-card-inset p-3 space-y-1">
          <div className="text-2xs uppercase text-slate-600 dark:text-slate-300">
            Work-Only 4-Pillar Execution
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-extrabold text-slate-900 dark:text-white">
              {progression.latestExecutionScore
                ? `${progression.latestExecutionScore.totalScore.toFixed(1)} / 100`
                : 'Awaiting Interval Splits'}
            </span>
            {progression.latestExecutionScore && (
              <span
                className={`px-2 py-0.5 rounded text-2xs font-bold ${
                  progression.latestExecutionScore.restCheatingFlag ||
                  progression.latestExecutionScore.workoutHeroFlag
                    ? 'ap-status-caution'
                    : 'ap-status-prime'
                }`}
              >
                {progression.latestExecutionScore.verdictLabel}
              </span>
            )}
          </div>
          {progression.latestExecutionScore && (
            <div className="text-2xs text-slate-600 dark:text-slate-300">
              Pace {progression.latestExecutionScore.paceAdherenceScore} · Split{' '}
              {progression.latestExecutionScore.splitDisciplineScore} · Rest{' '}
              {progression.latestExecutionScore.restFidelityScore} · Drift{' '}
              {progression.latestExecutionScore.driftRetentionScore}
            </div>
          )}
        </div>

        <div className="rounded-xl ap-card-inset p-3 space-y-1">
          <div className="text-2xs uppercase text-slate-600 dark:text-slate-300">
            Huber-Kalman Critical Speed
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">
            {bayesian.posteriorCsMps.toFixed(2)} m/s · VDOT {bayesian.posteriorVdotAer.toFixed(1)}
          </div>
          <div className="text-2xs text-slate-600 dark:text-slate-300">
            Prior {bayesian.priorCsMps.toFixed(2)} m/s · D&apos; {bayesian.posteriorDPrimeMeters}m
          </div>
        </div>

        <div className="rounded-xl ap-card-inset p-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-2xs uppercase text-slate-600 dark:text-slate-300">
              Posterior Threshold Pace
            </div>
            <div className="text-lg font-extrabold ap-text-brand">
              {formatPace(bayesian.posteriorThresholdPaceSecsPerKm, distanceUnit)}
            </div>
            <div className="text-2xs text-slate-600 dark:text-slate-300">
              Quarantines &lt;180s sprints, wind &gt;2 m/s &amp; rest cheating
            </div>
          </div>
          {onApplyPosteriorCalibration && (
            <button
              type="button"
              data-testid="apply-bayesian-posterior-btn"
              onClick={() => {
                onApplyPosteriorCalibration(
                  bayesian.posteriorThresholdPaceSecsPerKm,
                  bayesian.posteriorVdotAer
                );
                setAppliedBannerMsg(
                  `Applied Bayesian posterior threshold (${formatPace(bayesian.posteriorThresholdPaceSecsPerKm, distanceUnit)} · VDOT ${bayesian.posteriorVdotAer.toFixed(1)}).`
                );
              }}
              className="min-h-[44px] sm:min-h-[38px] px-3 rounded-xl bg-[#1D3828] hover:bg-[#163022] text-white dark:bg-[#183122] dark:text-[#C8FF00] border border-[#2B5B3F] text-2xs font-bold cursor-pointer shrink-0"
            >
              Apply Posterior
            </button>
          )}
        </div>
      </div>

      {appliedBannerMsg && (
        <div
          role="status"
          className="rounded-xl ap-status-prime px-3.5 py-2 text-xs font-mono font-semibold flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" weight="bold" />
          <span>{appliedBannerMsg}</span>
        </div>
      )}

      {/* 5 Track Progression Bars */}
      <div className="space-y-3">
        {progression.axes.map((axis) => {
          const widthPct = Math.min(100, (axis.level / 10) * 100);
          const targetPct = Math.min(100, (axis.targetLevel / 10) * 100);
          return (
            <div key={axis.axisId} className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded ap-card-inset font-bold text-2xs text-slate-800 dark:text-slate-100">
                    {axis.code}
                  </span>
                  <span className="font-sans font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {axis.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {axis.decayedSincePeak > 0.1 && (
                    <span className="text-amber-700 dark:text-amber-400 text-2xs font-bold">
                      -{axis.decayedSincePeak.toFixed(1)} decay (τ={axis.tauDays}d)
                    </span>
                  )}
                  <span
                    className={
                      axis.delta28d >= 0
                        ? 'text-emerald-700 dark:text-emerald-400 font-bold'
                        : 'text-amber-700 dark:text-amber-400 font-bold'
                    }
                  >
                    {axis.delta28d >= 0 ? '+' : ''}
                    {axis.delta28d.toFixed(1)} (28d)
                  </span>
                  <span className="font-extrabold text-slate-900 dark:text-white">
                    Lvl {axis.level.toFixed(1)}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">
                    / {axis.targetLevel.toFixed(1)}
                  </span>
                </div>
              </div>
              <div className="relative h-3 w-full rounded-full bg-slate-200 dark:bg-[#15231B] overflow-hidden">
                <div
                  style={{ width: `${widthPct}%` }}
                  className={`h-full rounded-full transition-all ${AXIS_BAR_CLASSES[axis.axisId]}`}
                />
                <div
                  style={{ left: `${targetPct}%` }}
                  className="absolute top-0 bottom-0 w-1 bg-[#101B15] dark:bg-[#C8FF00]"
                  title={`Target Level: ${axis.targetLevel.toFixed(1)}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Collapsible Bayesian Quarantine Audit Drawer */}
      {drawerOpen && (
        <div
          data-testid="bayesian-quarantine-drawer"
          className="rounded-xl ap-card-inset p-4 space-y-3 border border-emerald-900/15 dark:border-[#244331]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Pulse className="w-4 h-4 ap-text-brand" weight="bold" />
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Bayesian CS / D&apos; / VDOT Calibration Quarantine Ledger
              </span>
            </div>
            <span className="font-mono text-2xs text-slate-600 dark:text-slate-300">
              Confirming a quarantined mark promotes its CS contribution to the posterior
            </span>
          </div>

          {bayesian.auditLog.length === 0 ? (
            <p className="text-xs font-mono text-slate-600 dark:text-slate-300">
              Log a track workout or official FAT race mark to populate the Huber-Kalman audit ledger.
            </p>
          ) : (
            <div className="space-y-2">
              {bayesian.auditLog.slice(-6).reverse().map((row) => (
                <div
                  key={row.activityId}
                  className="rounded-lg bg-white dark:bg-[#101B15] border border-emerald-900/10 dark:border-[#244331] px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-2xs font-bold uppercase ${
                          row.status === 'QUARANTINED'
                            ? 'ap-status-caution'
                            : row.status === 'CONFIRMED_OVERRIDE'
                              ? 'ap-status-info'
                              : 'ap-status-prime'
                        }`}
                      >
                        {row.status === 'QUARANTINED' ? (
                          <span className="inline-flex items-center gap-1">
                            <Warning className="w-3 h-3" weight="bold" />
                            <span>{row.reasonCode}</span>
                          </span>
                        ) : (
                          row.status
                        )}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white truncate">
                        {row.activityName}
                      </span>
                      <span className="font-mono text-2xs text-slate-500 dark:text-slate-400">
                        {row.date}
                      </span>
                    </div>
                    <div className="text-2xs text-slate-600 dark:text-slate-300">
                      {row.reasonDetail}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-2xs tabular-nums shrink-0">
                    <span className="text-slate-700 dark:text-slate-200 font-bold">
                      Implied VDOT {row.impliedVdotAer.toFixed(1)} · K={row.kalmanGainApplied.toFixed(2)}
                    </span>
                    {row.reasonCode !== 'ACCEPTED' && (
                      <button
                        type="button"
                        onClick={() => toggleQuarantineConfirm(row.activityId)}
                        className={`min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg font-bold cursor-pointer ${
                          confirmedQuarantineIds.includes(row.activityId)
                            ? 'ap-status-caution'
                            : 'ap-card-inset text-slate-900 dark:text-white'
                        }`}
                      >
                        {confirmedQuarantineIds.includes(row.activityId)
                          ? 'Re-Quarantine'
                          : 'Confirm Override'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
