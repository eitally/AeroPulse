import React, { useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Shield,
  Users,
} from './icons/PhosphorIcons';
import {
  buildCoachSquadExecutionDigest,
  type DigestFallbackAthleteInput,
} from '../physiology/sessionCheckInAndDigestEngine';
import { evaluateSafeSportPatternWatch } from '../physiology/safeSportPatternWatchEngine';
import { resolveAthleteAgeTier } from '../physiology/ageAndComplianceEngine';
import type { ConnectedAthleteRecord } from '../types';
import { Adherence7dDots } from './charts/MicroGraphics';

export interface CoachExecutionDigestPanelProps {
  roster: ConnectedAthleteRecord[];
  selfFallback: DigestFallbackAthleteInput;
  todayIso: string;
  onInspectAthlete: (athleteId: string) => void;
  onOpenTeamPlan: () => void;
}

export const CoachExecutionDigestPanel: React.FC<CoachExecutionDigestPanelProps> = ({
  roster,
  selfFallback,
  todayIso,
  onInspectAthlete,
  onOpenTeamPlan,
}) => {
  const [filterMode, setFilterMode] = useState<'ALL' | 'ATTENTION' | 'ON_TRACK'>('ALL');

  const digest = useMemo(
    () =>
      buildCoachSquadExecutionDigest({
        roster,
        selfFallback,
        todayIso,
        windowDays: 7,
      }),
    [roster, selfFallback, todayIso]
  );

  const readinessByAthleteId = useMemo(() => {
    const map = new Map<string, { hrv: number; tsb: number; watchLight: string }>();
    for (const ath of roster) {
      const latestW =
        ath.wellnessDays && ath.wellnessDays.length > 0
          ? ath.wellnessDays[ath.wellnessDays.length - 1]
          : null;
      const watchLight = evaluateSafeSportPatternWatch({
        activities: ath.activities || [],
        wellnessDays: ath.wellnessDays || [],
        isMinorU18:
          typeof ath.isMinorU18 === 'boolean'
            ? ath.isMinorU18
            : resolveAthleteAgeTier({
                birthMonthYear: ath.athleteProfile.birthMonthYear,
              }).isMinorU18,
      }).trafficLight;
      map.set(ath.id, {
        hrv: latestW?.hrvRMSSD ?? 0,
        tsb: latestW?.tsb ?? 0,
        watchLight,
      });
    }
    return map;
  }, [roster]);

  const visibleRows = useMemo(() => {
    if (filterMode === 'ATTENTION') {
      return digest.rows.filter((r) => r.attentionReason !== 'ON_TRACK');
    }
    if (filterMode === 'ON_TRACK') {
      return digest.rows.filter((r) => r.attentionReason === 'ON_TRACK');
    }
    return digest.rows;
  }, [digest.rows, filterMode]);

  return (
    <section
      data-testid="coach-execution-digest"
      className="rounded-2xl liquid-glass p-3 sm:p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
          <h2 className="text-sm sm:text-base font-bold text-[#101411] dark:text-[#F4F7F4]">
            Squad Triage (7d)
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter digest rows">
          {(
            [
              { id: 'ALL', label: `All (${digest.rows.length})` },
              {
                id: 'ATTENTION',
                label: `Attention (${digest.rows.filter((r) => r.attentionReason !== 'ON_TRACK').length})`,
              },
              {
                id: 'ON_TRACK',
                label: `On Track (${digest.rows.filter((r) => r.attentionReason === 'ON_TRACK').length})`,
              },
            ] as const
          ).map((f) => {
            const active = filterMode === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilterMode(f.id)}
                className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold cursor-pointer ${
                  active
                    ? 'ap-nav-volt-active'
                    : 'liquid-capsule-track text-slate-700 dark:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4 Crisp Summary Metric Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 font-mono tabular-nums">
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            7d Compliance
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">
            {digest.teamCompliancePct}%
          </div>
        </div>
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Checked In (24h)
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">
            {digest.checkedInLast24hCount}/{digest.totalAthletes}
          </div>
        </div>
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Pain / Safety Swaps
          </div>
          <div
            className={`text-lg font-extrabold ${
              digest.painFlagCount > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {digest.painFlagCount} ({digest.swappedCount} swapped)
          </div>
        </div>
        <div className="rounded-xl ap-card-inset px-3.5 py-2.5">
          <div className="text-2xs uppercase tracking-wider text-slate-600 dark:text-slate-400">
            High Strain / Stress
          </div>
          <div className="text-lg font-extrabold text-slate-900 dark:text-white">
            {digest.highRpeCount}
            {digest.lifeStressCount > 0 ? ` · ${digest.lifeStressCount} stress` : ''}
          </div>
        </div>
      </div>

      {/* Athlete Digest List */}
      {visibleRows.length === 0 ? (
        <div className="rounded-xl ap-card-inset p-4 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <Users className="w-4 h-4 ap-text-brand shrink-0" />
          <span>No athletes match the selected filter right now.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map((row) => {
            const readiness = readinessByAthleteId.get(row.athleteId);
            const hasWatchAlert =
              readiness && readiness.watchLight !== 'GREEN_CLEAR';
            const badgeClass =
              row.attentionReason === 'PAIN_FLAG' ||
              row.attentionReason === 'INJURED' ||
              readiness?.watchLight === 'RED_MEDICAL_REVIEW'
                ? 'ap-status-strained'
                : row.attentionReason === 'HIGH_RPE_STRAIN' ||
                    row.attentionReason === 'HIGH_LIFE_STRESS' ||
                    row.attentionReason === 'MISSED_KEY_SESSIONS' ||
                    hasWatchAlert
                  ? 'ap-status-caution'
                  : 'ap-status-prime';

            return (
              <div
                key={row.athleteId}
                data-testid={`digest-row-${row.athleteId}`}
                className="rounded-xl border border-[#2B5B3F]/15 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ${badgeClass}`}
                    >
                      {row.attentionReason === 'PAIN_FLAG'
                        ? 'Pain Flag'
                        : row.attentionReason === 'INJURED'
                          ? 'Injured'
                          : row.attentionReason === 'HIGH_RPE_STRAIN'
                            ? 'High Strain'
                            : row.attentionReason === 'HIGH_LIFE_STRESS'
                              ? 'High Stress'
                              : row.attentionReason === 'MISSED_KEY_SESSIONS'
                                ? 'Missed Sessions'
                                : readiness?.watchLight === 'RED_MEDICAL_REVIEW'
                                  ? 'Medical Check'
                                  : readiness?.watchLight === 'AMBER_WATCH'
                                    ? 'Needs Review'
                                    : 'On Track'}
                    </span>
                    <span className="font-bold text-[#101411] dark:text-[#F4F7F4] truncate">
                      {row.name}
                    </span>
                    {row.checkInStreakDays > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono bg-amber-500/15 text-amber-700 dark:text-amber-300 tabular-nums">
                        {row.checkInStreakDays}d streak
                      </span>
                    )}
                    {readiness && (readiness.hrv > 0 || readiness.tsb !== 0) && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-card-inset text-[#43584B] dark:text-[#93A39A] tabular-nums">
                        {readiness.hrv > 0 ? `HRV ${Math.round(readiness.hrv)}ms · ` : ''}
                        Form {readiness.tsb >= 0 ? `+${Math.round(readiness.tsb)}` : Math.round(readiness.tsb)}
                      </span>
                    )}
                    {row.eventGroup && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-card-inset text-[#1F3528] dark:text-[#C8D8CE]">
                        {row.eventGroup}
                      </span>
                    )}
                    {row.isSelfFallback && (
                      <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-card-inset text-[#43584B] dark:text-[#93A39A]">
                        Coach Preview
                      </span>
                    )}
                  </div>
                  <div className="text-2xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    {row.attentionReason === 'ON_TRACK' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <Shield className="w-3.5 h-3.5 ap-text-brand shrink-0" />
                    )}
                    <span>{row.attentionSummary}</span>
                    {row.latestCheckIn?.sorenessNote && (
                      <span className="text-slate-500 dark:text-slate-400 truncate">
                        · {row.latestCheckIn.sorenessNote}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 font-mono">
                  <Adherence7dDots
                    completedCount={row.completedCount7d}
                    hasPainFlag={row.attentionReason === 'PAIN_FLAG'}
                  />
                  <div className="text-right tabular-nums">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {row.completedCount7d}/{row.plannedCount7d} ({row.compliancePct}%)
                    </div>
                    <div className="text-2xs text-slate-600 dark:text-slate-400">
                      {row.latestCheckIn ? `RPE ${row.latestCheckIn.rpe}/10` : 'No check-in yet'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      row.isSelfFallback ? onOpenTeamPlan() : onInspectAthlete(row.athleteId)
                    }
                    className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg bg-[#E3ECE5] dark:bg-[#15231B] text-[#1C5436] dark:text-[#C8FF00] text-2xs font-semibold cursor-pointer"
                  >
                    {row.isSelfFallback ? 'Team Plan' : 'Inspect'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
