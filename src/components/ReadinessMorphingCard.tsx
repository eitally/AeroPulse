import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bike,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Footprints,
  Sliders,
  Sparkles,
  Zap,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutEvent,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { ChartInfoTooltip } from './ChartInfoTooltip';
import { ThreshBrandWatermark } from './AeroPulseLogo';
import { downloadGarminFitWorkoutFile } from '../utils/fitWorkoutEncoder';
import {
  EffortZoneCode,
  ZONE_META,
  classifyZoneFromPct,
  parseWorkoutSteps,
} from '../utils/workoutParser';

export type MorphReadinessMode =
  | 'AUTO'
  | 'SUPERCOMPENSATION'
  | 'BALANCED'
  | 'CAUTION_PIVOT'
  | 'RECOVERY_FLUSH';

interface ReadinessMorphingCardProps {
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
  athleteProfile: AthleteProfile;
  distanceUnit: DistanceUnit;
  defaultExpanded?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  placementLabel?: string;
  onSyncMorphedToCalendar: (eventInput: {
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
  onOpenAthleteProfileModal: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

interface SkylineStep {
  label: string;
  durationMins: number;
  pctFtp: number;
  targetWatts: number;
  targetWkg: string;
  hrCeilingBpm: number;
  zoneCode: EffortZoneCode;
  zoneName: string;
  zoneColor: string;
  diffBadge?: string;
}

function parseStepsToSkyline(
  syntax: string,
  activeFtp: number,
  profile: AthleteProfile
): SkylineStep[] {
  return parseWorkoutSteps(syntax).map((parsed) => {
    const pctFtp = parsed.intensityPct;
    const targetWatts = Math.round((pctFtp / 100) * activeFtp);
    const targetWkg = (targetWatts / Math.max(35, profile.weightKg)).toFixed(2);
    const zInfo = classifyZoneFromPct(pctFtp, profile);
    return {
      label: parsed.label,
      durationMins: parsed.durationMins,
      pctFtp,
      targetWatts,
      targetWkg,
      hrCeilingBpm: zInfo.hrCeilingBpm,
      zoneCode: zInfo.code,
      zoneName: zInfo.name,
      zoneColor: zInfo.color,
    };
  });
}

function computeSummaryFromSkyline(steps: SkylineStep[]) {
  const totalMins = steps.reduce((acc, s) => acc + s.durationMins, 0);
  const weightedIfSquared =
    steps.reduce((acc, s) => acc + s.durationMins * Math.pow(s.pctFtp / 100, 2), 0) /
    Math.max(1, totalMins);
  const tss = Math.max(12, Math.round((totalMins / 60) * weightedIfSquared * 100));
  const ifVal = Number(Math.sqrt(weightedIfSquared).toFixed(2));
  return { totalMins, tss, ifVal };
}

export const ReadinessMorphingCard: React.FC<ReadinessMorphingCardProps> = ({
  wellnessDays,
  activities,
  plannedEvents,
  athleteProfile,
  distanceUnit,
  defaultExpanded = false,
  isExpanded: controlledExpanded,
  onToggleExpand,
  placementLabel = 'Daily Workout Prescription',
  onSyncMorphedToCalendar,
  onOpenAthleteProfileModal,
  onOpenCoachWithPrompt,
}) => {
  const [internalExpanded, setInternalExpanded] = useState<boolean>(defaultExpanded);
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const handleToggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };
  const [selectedMode, setSelectedMode] = useState<MorphReadinessMode>('AUTO');
  const [sportMode, setSportMode] = useState<'Cycling' | 'Running'>('Cycling');
  const [envMode, setEnvMode] = useState<'INDOOR' | 'OUTDOOR'>('INDOOR');
  const [isSyncingCalendar, setIsSyncingCalendar] = useState<boolean>(false);
  const [syncedBanner, setSyncedBanner] = useState<string | null>(null);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Latest morning wellness
  const latestWellness = useMemo(() => {
    if (wellnessDays.length === 0) {
      return {
        date: todayIso,
        ctl: 71.4,
        atl: 53.0,
        tsb: 18.4,
        loadRatio: 0.74,
        rampRate: -1.8,
        hrvRMSSD: 52,
        hrvBaseline7d: 51,
        hrvNormalBandLow: 44,
        hrvNormalBandHigh: 62,
        restingHR: athleteProfile.restingHr || 49,
        sleepSecs: 26340,
        sleepScore: 75,
        weightKg: athleteProfile.weightKg || 70.0,
        readinessStatus: 'Optimal' as const,
        dailyLoad: 55,
      };
    }
    return wellnessDays[wellnessDays.length - 1];
  }, [wellnessDays, todayIso, athleteProfile]);

  // Most recent non-zero HRV & Sleep
  const recentHrvDay = useMemo(() => {
    for (let i = wellnessDays.length - 1; i >= 0; i--) {
      if (wellnessDays[i].hrvRMSSD > 0) return wellnessDays[i];
    }
    return latestWellness;
  }, [wellnessDays, latestWellness]);

  const recentSleepDay = useMemo(() => {
    for (let i = wellnessDays.length - 1; i >= 0; i--) {
      if (wellnessDays[i].sleepSecs > 0 || wellnessDays[i].sleepScore > 0) {
        return wellnessDays[i];
      }
    }
    return latestWellness;
  }, [wellnessDays, latestWellness]);

  // Most recent endurance workout (>20 mins) for Cardiac Decoupling trigger
  const lastEnduranceWorkout = useMemo(() => {
    return (
      activities.find(
        (a) =>
          a.movingTimeSecs >= 1200 &&
          (a.sportCategory === 'Cycling' || a.sportCategory === 'Running')
      ) || activities[0]
    );
  }, [activities]);

  const lastDecouplingPct = useMemo(() => {
    if (!lastEnduranceWorkout) return 2.8;
    if (
      typeof lastEnduranceWorkout.aerobicDecouplingPct === 'number' &&
      lastEnduranceWorkout.aerobicDecouplingPct !== 0
    ) {
      return Number(lastEnduranceWorkout.aerobicDecouplingPct.toFixed(1));
    }
    return 2.9;
  }, [lastEnduranceWorkout]);

  // Evaluate 5 Explainable Physiological Triggers
  const triggers = useMemo(() => {
    const hrvDelta = recentHrvDay.hrvRMSSD - (recentHrvDay.hrvBaseline7d || 50);
    const hrvLowFloor = recentHrvDay.hrvNormalBandLow || 44;
    const hrvState: 'optimal' | 'caution' | 'strained' =
      recentHrvDay.hrvRMSSD < hrvLowFloor || hrvDelta <= -7
        ? 'strained'
        : hrvDelta <= -3
          ? 'caution'
          : 'optimal';

    const sleepScore = recentSleepDay.sleepScore || 75;
    const sleepHrs = (recentSleepDay.sleepSecs || 25200) / 3600;
    const sleepState: 'optimal' | 'caution' | 'strained' =
      sleepScore < 62 || sleepHrs < 5.8
        ? 'strained'
        : sleepScore < 74 || sleepHrs < 6.6
          ? 'caution'
          : 'optimal';

    const rhrDelta = (recentHrvDay.restingHR || 49) - (athleteProfile.restingHr || 49);
    const rhrState: 'optimal' | 'caution' | 'strained' =
      rhrDelta >= 5 ? 'strained' : rhrDelta >= 3 ? 'caution' : 'optimal';

    const tsb = latestWellness.tsb;
    const tsbState: 'optimal' | 'caution' | 'strained' =
      tsb < -28 ? 'strained' : tsb < -18 ? 'caution' : 'optimal';

    const decoupleState: 'optimal' | 'caution' | 'strained' =
      lastDecouplingPct > 6.5
        ? 'strained'
        : lastDecouplingPct > 4.8
          ? 'caution'
          : 'optimal';

    // Determine auto-detected morph tier
    const strainedCount = [hrvState, sleepState, rhrState, tsbState, decoupleState].filter(
      (s) => s === 'strained'
    ).length;
    const cautionCount = [hrvState, sleepState, rhrState, tsbState, decoupleState].filter(
      (s) => s === 'caution'
    ).length;

    let autoMode: Exclude<MorphReadinessMode, 'AUTO'> = 'BALANCED';
    if (strainedCount >= 2 || (hrvState === 'strained' && sleepState !== 'optimal')) {
      autoMode = 'RECOVERY_FLUSH';
    } else if (strainedCount === 1 || cautionCount >= 2) {
      autoMode = 'CAUTION_PIVOT';
    } else if (
      hrvDelta >= 2 &&
      sleepScore >= 78 &&
      tsb >= -12 &&
      lastDecouplingPct <= 4.0
    ) {
      autoMode = 'SUPERCOMPENSATION';
    }

    return {
      autoMode,
      items: [
        {
          id: 'hrv',
          label: 'Overnight HRV (rMSSD)',
          value: `${recentHrvDay.hrvRMSSD} ms`,
          detail: `${hrvDelta >= 0 ? `+${hrvDelta}` : hrvDelta} ms vs ${recentHrvDay.hrvBaseline7d} ms 7d avg`,
          state: hrvState,
        },
        {
          id: 'sleep',
          label: 'Sleep Score',
          value: `Score ${sleepScore}`,
          detail: `${sleepHrs.toFixed(1)}h duration`,
          state: sleepState,
        },
        {
          id: 'rhr',
          label: 'Resting HR vs Profile',
          value: `${recentHrvDay.restingHR} bpm`,
          detail: `${rhrDelta >= 0 ? `+${rhrDelta}` : rhrDelta} bpm vs ${athleteProfile.restingHr} bpm base`,
          state: rhrState,
        },
        {
          id: 'tsb',
          label: 'Form (TSB) & Load Ratio',
          value: `TSB ${tsb > 0 ? `+${tsb.toFixed(0)}` : tsb.toFixed(0)}`,
          detail: `CTL ${latestWellness.ctl.toFixed(0)} · ATL ${latestWellness.atl.toFixed(0)}`,
          state: tsbState,
        },
        {
          id: 'decouple',
          label: 'Last Workout Decoupling',
          value: `${lastDecouplingPct}% Pa:Hr`,
          detail: lastDecouplingPct <= 5 ? '<5% Coupled' : '>5% Drift Warning',
          state: decoupleState,
        },
      ],
    };
  }, [recentHrvDay, recentSleepDay, latestWellness, lastDecouplingPct, athleteProfile]);

  const effectiveMode: Exclude<MorphReadinessMode, 'AUTO'> =
    selectedMode === 'AUTO' ? triggers.autoMode : selectedMode;

  // Active FTP from synced AthleteProfile (Indoor FTP for Virtual/Trainer, Outdoor FTP for Outdoor, Run FTP for Running)
  const activeFtp = useMemo(() => {
    if (sportMode === 'Running') {
      return athleteProfile.runFtp || 340;
    }
    return envMode === 'INDOOR'
      ? athleteProfile.indoorFtp || athleteProfile.ftp || 300
      : athleteProfile.ftp || 300;
  }, [sportMode, envMode, athleteProfile]);

  // Baseline / Scheduled Workout (uses today's plannedEvent if present, or default build session)
  const baselineWorkout = useMemo(() => {
    const todayPlanned = plannedEvents.find(
      (ev) => ev.date.slice(0, 10) === todayIso && ev.sportCategory === sportMode
    );
    if (todayPlanned && todayPlanned.workoutSyntax) {
      const steps = parseStepsToSkyline(
        todayPlanned.workoutSyntax,
        activeFtp,
        athleteProfile
      );
      const summary = computeSummaryFromSkyline(steps);
      return {
        title: todayPlanned.name,
        sourceLabel: 'Scheduled on Calendar Today',
        syntax: todayPlanned.workoutSyntax,
        steps,
        ...summary,
      };
    }

    // Default structured baseline workout for the active sport
    const defaultSyntax =
      sportMode === 'Cycling'
        ? `- 12m 58% FTP Warmup\n- 6m 96% FTP Threshold Block 1\n- 3m 55% FTP Recovery\n- 6m 100% FTP Threshold Block 2\n- 3m 55% FTP Recovery\n- 5m 108% FTP VO2max Ceiling\n- 3m 55% FTP Recovery\n- 5m 108% FTP VO2max Ceiling\n- 10m 54% FTP Cooldown`
        : `- 12m 62% FTP Easy Warmup Jog\n- 5m 98% FTP Threshold Cruise 1\n- 2m 55% FTP Float Recovery\n- 5m 100% FTP Threshold Cruise 2\n- 2m 55% FTP Float Recovery\n- 4m 108% FTP VO2max Track Repeat\n- 2m 55% FTP Float Recovery\n- 4m 108% FTP VO2max Track Repeat\n- 10m 55% FTP Cooldown`;

    const steps = parseStepsToSkyline(defaultSyntax, activeFtp, athleteProfile);
    const summary = computeSummaryFromSkyline(steps);
    return {
      title:
        sportMode === 'Cycling'
          ? 'Threshold + VO2max Ceiling Progression'
          : 'Threshold Cruise + VO2max Track Repeats',
      sourceLabel: 'Baseline Build Prescription',
      syntax: defaultSyntax,
      steps,
      ...summary,
    };
  }, [plannedEvents, todayIso, sportMode, activeFtp, athleteProfile]);

  // Morphed Workout Prescription based on effectiveMode + synced AthleteProfile zones
  const morphedWorkout = useMemo(() => {
    let morphedTitle = baselineWorkout.title;
    let rationale = '';
    let badgeLabel = '';
    let badgeTone = '';
    let morphedLines: { line: string; diffBadge?: string }[] = [];

    if (effectiveMode === 'SUPERCOMPENSATION') {
      morphedTitle = `${baselineWorkout.title} (+Supercompensation Surge)`;
      badgeLabel = 'Optimal Readiness · +5% Progressive Overload';
      badgeTone =
        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35';
      rationale = `Your overnight HRV (${recentHrvDay.hrvRMSSD} ms) is above baseline, Sleep Score is ${recentSleepDay.sleepScore}, and last workout decoupling was ${lastDecouplingPct}% (<5%). Work intervals are nudged +3% FTP (${Math.round(activeFtp * 1.03)}W ceiling) with an added progression repeat to capitalize on supercompensation.`;

      morphedLines = baselineWorkout.steps.map((s) => {
        if (s.pctFtp >= 88) {
          const boostedPct = Math.min(122, s.pctFtp + 3);
          const cleanLabel = s.label
            .replace(/\d{2,3}\s*%/, `${boostedPct}%`)
            .replace(/^\d+\s*(m|min|mins)\s*/i, '');
          return {
            line: `- ${s.durationMins + 1}m ${boostedPct}% FTP ${cleanLabel.replace(/^\d+%\s*FTP\s*/i, '')}`,
            diffBadge: `+3% FTP · +1m`,
          };
        }
        return { line: `- ${s.label}` };
      });
    } else if (effectiveMode === 'BALANCED') {
      morphedTitle = `${baselineWorkout.title} (Zone-Calibrated)`;
      badgeLabel = 'Balanced Readiness · 100% Target Prescription';
      badgeTone = 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35';
      rationale = `Autonomic markers are stable within your 7-day corridor (HRV ${recentHrvDay.hrvRMSSD} ms, RHR ${recentHrvDay.restingHR} bpm) and Form is ${latestWellness.tsb.toFixed(0)}. Execute the full baseline interval progression calibrated to your ${envMode === 'INDOOR' ? 'Indoor/Virtual' : 'Outdoor'} FTP (${activeFtp}W) and LTHR (${athleteProfile.lthr} bpm).`;

      morphedLines = baselineWorkout.steps.map((s) => ({
        line: `- ${s.label}`,
        diffBadge: 'On Target',
      }));
    } else if (effectiveMode === 'CAUTION_PIVOT') {
      const ssMidPct = Math.round(
        ((athleteProfile.sweetSpotMinPct || 84) + (athleteProfile.sweetSpotMaxPct || 94)) / 2
      );
      morphedTitle =
        sportMode === 'Cycling'
          ? `3x10m Sweet Spot Pivot (${ssMidPct}% FTP)`
          : `3x8m Sub-Threshold Tempo Cruise`;
      badgeLabel = 'Autonomic Caution · Morphed Z5/Z4 → Z3 Sweet Spot';
      badgeTone = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35';
      rationale = `Physiological caution detected (Sleep Score ${recentSleepDay.sleepScore} / HRV ${recentHrvDay.hrvRMSSD} ms). High-strain Z5 VO2max & suprathreshold blocks have been morphed into controlled Z3 Sweet Spot intervals (${Math.round((ssMidPct / 100) * activeFtp)}W, HR capped ≤${athleteProfile.hrZones[2]?.maxBpm || athleteProfile.lthr - 6} bpm) to stimulate aerobic enzyme density without sympathetic overreaching.`;

      morphedLines = [
        { line: `- 12m 56% FTP Smooth Warmup`, diffBadge: 'Z1 Warmup' },
        {
          line: `- 10m ${ssMidPct}% FTP Sweet Spot Block 1`,
          diffBadge: 'Morphed Z4 → Z3',
        },
        { line: `- 4m 54% FTP Active Recovery`, diffBadge: '+1m Recovery' },
        {
          line: `- 10m ${ssMidPct}% FTP Sweet Spot Block 2`,
          diffBadge: 'Morphed Z5 → Z3',
        },
        { line: `- 4m 54% FTP Active Recovery`, diffBadge: '+1m Recovery' },
        {
          line: `- 10m ${ssMidPct - 2}% FTP Sweet Spot Block 3`,
          diffBadge: 'HR Cap Z3',
        },
        { line: `- 10m 52% FTP Easy Cooldown`, diffBadge: 'Z1 Flush' },
      ];
    } else {
      // RECOVERY_FLUSH
      morphedTitle =
        sportMode === 'Cycling'
          ? '45m Z1/Z2 Autonomic Parasympathetic Flush'
          : '35m Z1/Z2 Easy Parasympathetic Recovery Jog';
      badgeLabel = 'Autonomic Strain · Morphed to Z1/Z2 Recovery Flush';
      badgeTone = 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35';
      rationale = `Autonomic strain protection triggered: high-intensity intervals are replaced with a strictly capped Z1/Z2 parasympathetic flush (≤65% FTP / ${Math.round(activeFtp * 0.65)}W, HR ≤${athleteProfile.hrZones[1]?.maxBpm || Math.round(athleteProfile.lthr * 0.84)} bpm) to accelerate vagal rebound while preserving aerobic volume.`;

      morphedLines = [
        { line: `- 10m 50% FTP Easy Spin Warmup`, diffBadge: 'Z1 Recovery' },
        {
          line: `- 25m 64% FTP Z2 Aerobic Capillary Flush`,
          diffBadge: 'Morphed Z4/Z5 → Z2',
        },
        { line: `- 10m 48% FTP Parasympathetic Cooldown`, diffBadge: 'Z1 Flush' },
      ];
    }

    const syntax = morphedLines.map((m) => m.line).join('\n');
    const parsedSteps = parseStepsToSkyline(syntax, activeFtp, athleteProfile).map(
      (step, idx) => ({
        ...step,
        diffBadge: morphedLines[idx]?.diffBadge,
      })
    );
    const summary = computeSummaryFromSkyline(parsedSteps);

    // Projected tomorrow TSB for Baseline vs Morphed
    const projTomorrowTsbBaseline = Number(
      (
        latestWellness.ctl +
        (baselineWorkout.tss - latestWellness.ctl) / 42 -
        (latestWellness.atl + (baselineWorkout.tss - latestWellness.atl) / 7)
      ).toFixed(1)
    );
    const projTomorrowTsbMorphed = Number(
      (
        latestWellness.ctl +
        (summary.tss - latestWellness.ctl) / 42 -
        (latestWellness.atl + (summary.tss - latestWellness.atl) / 7)
      ).toFixed(1)
    );

    return {
      title: morphedTitle,
      badgeLabel,
      badgeTone,
      rationale,
      syntax,
      steps: parsedSteps,
      ...summary,
      tssDelta: summary.tss - baselineWorkout.tss,
      minsDelta: summary.totalMins - baselineWorkout.totalMins,
      projTomorrowTsbBaseline,
      projTomorrowTsbMorphed,
    };
  }, [
    effectiveMode,
    baselineWorkout,
    recentHrvDay,
    recentSleepDay,
    lastDecouplingPct,
    activeFtp,
    athleteProfile,
    sportMode,
    envMode,
    latestWellness,
  ]);

  const handleSyncToIntervalsCalendar = async () => {
    setIsSyncingCalendar(true);
    setSyncedBanner(null);
    try {
      await onSyncMorphedToCalendar({
        date: todayIso,
        name: morphedWorkout.title,
        sportCategory: sportMode,
        environmentPreference: envMode,
        plannedDurationSecs: morphedWorkout.totalMins * 60,
        plannedLoad: morphedWorkout.tss,
        workoutSyntax: morphedWorkout.syntax,
        description: `${morphedWorkout.rationale} [Calibrated to ${envMode === 'INDOOR' ? 'Indoor' : 'Outdoor'} FTP ${activeFtp}W · LTHR ${athleteProfile.lthr}bpm]`,
        replaceExistingDate: true,
      });
      setSyncedBanner(
        `Saved "${morphedWorkout.title}" (${morphedWorkout.tss} TSS) to your Training Calendar for ${todayIso} and pushed structured steps to Intervals.icu (syncs automatically to Garmin Connect watches & Edge head units if linked).`
      );
      window.setTimeout(() => setSyncedBanner(null), 6500);
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const handleDownloadZwo = () => {
    const xmlSteps = morphedWorkout.steps
      .map((s) => {
        const durSecs = s.durationMins * 60;
        const powerDec = (s.pctFtp / 100).toFixed(2);
        return `    <SteadyState Duration="${durSecs}" Power="${powerDec}" />`;
      })
      .join('\n');

    const zwoContent = `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>AeroPulse Readiness Engine</author>
  <name>${morphedWorkout.title.replace(/[<>&"]/g, '')}</name>
  <description>${morphedWorkout.rationale.replace(/[<>&"]/g, '')} (FTP ${activeFtp}W)</description>
  <sportType>${sportMode === 'Cycling' ? 'bike' : 'run'}</sportType>
  <workout>
${xmlSteps}
  </workout>
</workout_file>`;

    const blob = new Blob([zwoContent], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${todayIso}-${morphedWorkout.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.zwo`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadErg = () => {
    let elapsedMins = 0;
    const dataLines: string[] = [];
    for (const s of morphedWorkout.steps) {
      dataLines.push(`${elapsedMins.toFixed(2)}\t${s.targetWatts}`);
      elapsedMins += s.durationMins;
      dataLines.push(`${elapsedMins.toFixed(2)}\t${s.targetWatts}`);
    }

    const ergContent = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = ${morphedWorkout.title} (Calibrated to ${activeFtp}W FTP)
FILE NAME = ${todayIso}-aeropulse.erg
FTP = ${activeFtp}
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
${dataLines.join('\n')}
[END COURSE DATA]`;

    const blob = new Blob([ergContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${todayIso}-${morphedWorkout.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.erg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadFit = () => {
    downloadGarminFitWorkoutFile(
      {
        name: morphedWorkout.title,
        sport: sportMode,
        steps: morphedWorkout.steps.map((s, idx) => ({
          label: s.label,
          durationSecs: s.durationMins * 60,
          targetMinWatts: Math.max(40, s.targetWatts - 10),
          targetMaxWatts: s.targetWatts + 10,
          targetMinHrBpm: Math.max(90, s.hrCeilingBpm - 12),
          targetMaxHrBpm: s.hrCeilingBpm,
          intensity:
            idx === 0
              ? 'warmup'
              : idx === morphedWorkout.steps.length - 1 && morphedWorkout.steps.length > 1
                ? 'cooldown'
                : s.pctFtp <= 60
                  ? 'rest'
                  : 'active',
        })),
      },
      todayIso
    );
  };

  const handlePushDirectGarmin = async () => {
    setIsSyncingCalendar(true);
    setSyncedBanner(null);
    try {
      const garminBearer = localStorage.getItem('aeropulse_garmin_bearer_token') || '';
      const garminOauth1 = localStorage.getItem('aeropulse_garmin_oauth1_token') || '';
      const garminSecret = localStorage.getItem('aeropulse_garmin_oauth1_secret') || '';
      const resp = await fetch('/api/garmin/workout/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(garminBearer ? { 'x-garmin-bearer-token': garminBearer } : {}),
          ...(garminOauth1 ? { 'x-garmin-oauth1-token': garminOauth1 } : {}),
          ...(garminSecret ? { 'x-garmin-oauth1-secret': garminSecret } : {}),
        },
        body: JSON.stringify({
          date: todayIso,
          name: morphedWorkout.title,
          sportCategory: sportMode,
          ftpWatts: activeFtp,
          lthrBpm: athleteProfile.lthr,
          description: `${morphedWorkout.rationale} [Calibrated to ${activeFtp}W FTP · LTHR ${athleteProfile.lthr}bpm]`,
          steps: morphedWorkout.steps.map((s, idx) => ({
            label: s.label,
            durationSecs: s.durationMins * 60,
            targetPctFtp: s.pctFtp,
            targetWatts: s.targetWatts,
            targetMinWatts: Math.max(40, s.targetWatts - 10),
            targetMaxWatts: s.targetWatts + 10,
            hrCeilingBpm: s.hrCeilingBpm,
            stepType:
              idx === 0
                ? 'warmup'
                : idx === morphedWorkout.steps.length - 1 && morphedWorkout.steps.length > 1
                  ? 'cooldown'
                  : s.pctFtp <= 60
                    ? 'recovery'
                    : 'interval',
          })),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.pushed) {
        setSyncedBanner(
          data.message ||
            `Pushed "${morphedWorkout.title}" directly to Garmin Connect Calendar (${todayIso})!`
        );
      } else {
        setSyncedBanner(
          data.error ||
            'Connect your Garmin account in Data Sources to push directly, or click "Export Garmin .FIT" below.'
        );
      }
      window.setTimeout(() => setSyncedBanner(null), 7000);
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  return (
    <section className="relative rounded-2xl liquid-glass overflow-hidden">
      {/* Signature 2px THRESH Top Hairline */}
      <div className="absolute top-0 left-0 right-0 h-[2px] ap-brand-hairline pointer-events-none" />
      <ThreshBrandWatermark className="w-28 h-28 absolute -right-4 -top-4 text-[#0B4F9E] dark:text-sky-400" />

      {/* Top Bar: Collapsible Summary Header */}
      <div
        className={`relative px-4 sm:px-5 py-3 bg-slate-50/70 dark:bg-white/[0.02] ${
          isExpanded ? 'border-b border-slate-200 dark:border-white/10' : ''
        } flex flex-wrap items-center justify-between gap-3`}
      >
        <div className="flex flex-wrap items-center gap-2 select-none">
          <button
            type="button"
            onClick={handleToggleExpand}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0B4F9E] hover:bg-[#093e7d] text-white text-[11px] font-bold tracking-wide uppercase shadow-2xs transition-colors cursor-pointer"
          >
            <Sparkles className="w-3 h-3" />
            <span>{placementLabel}</span>
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 ml-0.5 opacity-80" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 ml-0.5 opacity-80" />
            )}
          </button>

          <div onClick={(e) => e.stopPropagation()}>
            <ChartInfoTooltip
              title="Adaptive Daily Workout Prescription"
              subtitle="Closed-Loop Autonomic & Zone-Calibrated Prescription"
              whatItMeasures="Evaluates 5 daily physiological signals (Overnight HRV vs. 7d baseline, Sleep Score, Resting HR delta, Form/TSB, and last workout Cardiac Decoupling %) against your synced Power and HR zones to dynamically adapt today's scheduled workout."
              benchmarks="Optimal Supercompensation: HRV >= +2ms vs 7d avg & Sleep >= 78 (+3% FTP progression). Caution Pivot: HRV depressed 3–6ms or Sleep < 74 (morphs Z5/Z4 into Z3 Sweet Spot). Strain Recovery: HRV below 60d floor or decoupling > 6.5% (caps session at Z1/Z2 <65% FTP)."
              liveStatus={{
                label: `${morphedWorkout.title} · ${morphedWorkout.tss} TSS (${morphedWorkout.tssDelta >= 0 ? `+${morphedWorkout.tssDelta}` : morphedWorkout.tssDelta} vs baseline)`,
                state:
                  effectiveMode === 'RECOVERY_FLUSH' || effectiveMode === 'CAUTION_PIVOT'
                    ? 'warning'
                    : 'optimal',
                interpretation: morphedWorkout.rationale,
              }}
              coachingAction="Expand the card to compare the scheduled vs. adapted Effort Zone Skylines, save to calendar, or export a .ZWO / .ERG workout file."
            />
          </div>
        </div>

        {isExpanded && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Live Synced Athlete Profile & Zones Trigger Button */}
            <button
              type="button"
              onClick={onOpenAthleteProfileModal}
              className="min-h-[30px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl liquid-glass-subtle hover:border-blue-500/50 text-[11px] font-mono text-slate-700 dark:text-slate-200 transition-colors"
              title="Inspect or edit Athlete Profile, FTP, Weight & 7-Zone Power/HR Tables"
            >
              <Sliders className="w-3 h-3 text-blue-500" />
              <span>
                {envMode === 'INDOOR' ? 'Indoor' : 'Outdoor'} FTP{' '}
                <strong className="text-blue-600 dark:text-sky-300">{activeFtp}W</strong>
              </span>
              <span className="opacity-40">·</span>
              <span>LTHR {athleteProfile.lthr}bpm</span>
              <span className="opacity-40">·</span>
              <span>
                {distanceUnit === 'mi'
                  ? `${(athleteProfile.weightKg * 2.20462).toFixed(1)} lbs`
                  : `${athleteProfile.weightKg.toFixed(1)} kg`}
              </span>
            </button>

            {/* Sport & Modality Toggle */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-xl liquid-capsule-track text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setSportMode('Cycling');
                  setEnvMode('INDOOR');
                }}
                className={`px-2 py-1 rounded-lg inline-flex items-center gap-1 transition-all ${
                  sportMode === 'Cycling' && envMode === 'INDOOR'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Bike className="w-3 h-3" />
                <span>Virtual Bike</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSportMode('Cycling');
                  setEnvMode('OUTDOOR');
                }}
                className={`px-2 py-1 rounded-lg inline-flex items-center gap-1 transition-all ${
                  sportMode === 'Cycling' && envMode === 'OUTDOOR'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Bike className="w-3 h-3" />
                <span>Outdoor Bike</span>
              </button>
              <button
                type="button"
                onClick={() => setSportMode('Running')}
                className={`px-2 py-1 rounded-lg inline-flex items-center gap-1 transition-all ${
                  sportMode === 'Running'
                    ? 'liquid-capsule-active text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Footprints className="w-3 h-3" />
                <span>Run</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {syncedBanner && (
        <div className="mx-4 sm:mx-5 mt-3 rounded-xl bg-emerald-500/15 border border-emerald-500/35 px-3.5 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{syncedBanner}</span>
        </div>
      )}

      {/* Expandable Body: Triggers Strip + Side-by-Side Original vs Morphed Effort Zone Skylines + Action Bar */}
      {isExpanded && (
        <div className="space-y-4 pb-5">
          {/* Explainable Physiological Triggers Strip */}
          <div className="px-4 sm:px-5 py-2.5 bg-white/40 dark:bg-slate-950/40 border-b border-slate-200/60 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Why It Adapted:
              </span>
              {triggers.items.map((t) => {
                const pillClass =
                  t.state === 'optimal'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                    : t.state === 'caution'
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25'
                      : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25';
                return (
                  <div
                    key={t.id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] ${pillClass}`}
                    title={`${t.label}: ${t.value} (${t.detail})`}
                  >
                    <span className="font-semibold">{t.label.split(' ')[0]}:</span>
                    <span className="font-mono font-bold tabular-nums">{t.value}</span>
                    <span className="opacity-75 text-[10px] hidden sm:inline">({t.detail})</span>
                  </div>
                );
              })}
            </div>

            {/* Readiness State Simulator Switcher */}
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-[10px] text-slate-400 font-medium hidden xl:inline">
                Mode:
              </span>
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-[10px]">
                {(
                  [
                    { id: 'AUTO', label: 'Auto' },
                    { id: 'SUPERCOMPENSATION', label: 'Push (+5%)' },
                    { id: 'BALANCED', label: '100%' },
                    { id: 'CAUTION_PIVOT', label: 'Sweet Spot Pivot' },
                    { id: 'RECOVERY_FLUSH', label: 'Z1/Z2 Flush' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMode(m.id)}
                    className={`px-2 py-0.5 rounded-md transition-all whitespace-nowrap ${
                      selectedMode === m.id
                        ? 'liquid-capsule-active text-blue-600 dark:text-sky-300 font-semibold'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-4 sm:px-5 space-y-4">
          {/* Side-by-Side Comparison Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT PANEL: ORIGINAL / SCHEDULED WORKOUT SKYLINE */}
            <div className="rounded-xl bg-slate-50/85 dark:bg-slate-900/75 border border-slate-200/90 dark:border-slate-800 p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                      1. {baselineWorkout.sourceLabel}
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                      {baselineWorkout.title}
                    </h3>
                  </div>
                  <div className="text-right font-mono tabular-nums text-xs shrink-0">
                    <div className="font-bold text-slate-900 dark:text-slate-100">
                      {baselineWorkout.totalMins}m · {baselineWorkout.tss} TSS
                    </div>
                    <div className="text-[10px] text-slate-500">
                      IF {baselineWorkout.ifVal} · Next TSB{' '}
                      {morphedWorkout.projTomorrowTsbBaseline > 0
                        ? `+${morphedWorkout.projTomorrowTsbBaseline}`
                        : morphedWorkout.projTomorrowTsbBaseline}
                    </div>
                  </div>
                </div>

                {/* Original Effort Zone Skyline */}
                <div className="rounded-lg bg-white dark:bg-slate-950/90 border border-slate-200/80 dark:border-slate-800 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>Baseline Effort Zone Skyline</span>
                    <span>FTP {activeFtp}W</span>
                  </div>
                  <div className="relative h-16 w-full flex items-end gap-0.5 pt-1">
                    {baselineWorkout.steps.map((s, idx) => (
                      <div
                        key={idx}
                        style={{
                          flex: s.durationMins,
                          height: `${ZONE_META[s.zoneCode].heightPct}%`,
                          backgroundColor: s.zoneColor,
                        }}
                        className="rounded-t-[2px] opacity-85 hover:opacity-100 transition-opacity"
                        title={`${s.label} — ${s.durationMins}m @ ${s.targetWatts}W (${s.pctFtp}% FTP, ${s.zoneCode})`}
                      />
                    ))}
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2A9D8F]/75" />
                  </div>
                </div>

                {/* Compact Step List */}
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {baselineWorkout.steps.map((s, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded bg-white/70 dark:bg-slate-950/50 border border-slate-200/60 dark:border-slate-800/70"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
                          style={{ backgroundColor: s.zoneColor }}
                        />
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                          {s.zoneCode}
                        </span>
                        <span className="truncate text-slate-600 dark:text-slate-300">
                          {s.label}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-500 shrink-0">
                        {s.targetWatts}W · ≤{s.hrCeilingBpm}bpm
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: READINESS-MORPHED WORKOUT SKYLINE */}
            <div className="rounded-xl bg-blue-500/[0.04] dark:bg-sky-500/[0.06] border border-blue-500/35 p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-blue-600 dark:text-sky-400 font-bold flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      <span>2. Adapted Workout Prescription</span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {morphedWorkout.title}
                    </h3>
                  </div>
                  <div className="text-right font-mono tabular-nums text-xs shrink-0">
                    <div className="font-bold text-blue-600 dark:text-sky-300">
                      {morphedWorkout.totalMins}m · {morphedWorkout.tss} TSS{' '}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15">
                        {morphedWorkout.tssDelta >= 0
                          ? `+${morphedWorkout.tssDelta}`
                          : morphedWorkout.tssDelta}{' '}
                        TSS
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      IF {morphedWorkout.ifVal} · Next TSB{' '}
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {morphedWorkout.projTomorrowTsbMorphed > 0
                          ? `+${morphedWorkout.projTomorrowTsbMorphed}`
                          : morphedWorkout.projTomorrowTsbMorphed}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Morphed Effort Zone Skyline */}
                <div className="rounded-lg bg-white dark:bg-slate-950/90 border border-blue-500/30 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono text-blue-600 dark:text-sky-300">
                    <span>Adapted Effort Zone Skyline (Z1–Z6+)</span>
                    <span>
                      {envMode === 'INDOOR' ? 'Virtual' : 'Outdoor'} FTP {activeFtp}W ·{' '}
                      {(activeFtp / Math.max(35, athleteProfile.weightKg)).toFixed(2)} W/kg
                    </span>
                  </div>
                  <div className="relative h-16 w-full flex items-end gap-0.5 pt-1">
                    {morphedWorkout.steps.map((s, idx) => (
                      <div
                        key={idx}
                        style={{
                          flex: s.durationMins,
                          height: `${ZONE_META[s.zoneCode].heightPct}%`,
                          backgroundColor: s.zoneColor,
                        }}
                        className="rounded-t-[2px] transition-all"
                        title={`${s.label} — ${s.durationMins}m @ ${s.targetWatts}W (${s.pctFtp}% FTP, ${s.targetWkg} W/kg, ≤${s.hrCeilingBpm} bpm)`}
                      />
                    ))}
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2A9D8F]" />
                  </div>
                </div>

                {/* Morphed Step List with Diff Badges */}
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {morphedWorkout.steps.map((s, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded bg-white/90 dark:bg-slate-950/80 border border-blue-500/20"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2 h-2 rounded-xs shrink-0"
                          style={{ backgroundColor: s.zoneColor }}
                        />
                        <span className="font-mono font-bold text-slate-900 dark:text-white">
                          {s.zoneCode}
                        </span>
                        <span className="truncate text-slate-700 dark:text-slate-200 font-medium">
                          {s.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                        {s.diffBadge && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-sky-300 font-semibold">
                            {s.diffBadge}
                          </span>
                        )}
                        <span className="font-bold text-indigo-600 dark:text-indigo-300">
                          {s.targetWatts}W
                        </span>
                        <span className="text-rose-600 dark:text-rose-400 text-[10px]">
                          ≤{s.hrCeilingBpm}bpm
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Action & Export Bar */}
          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSyncToIntervalsCalendar}
                disabled={isSyncingCalendar}
                className="min-h-[36px] inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition-all"
              >
                <CalendarCheck className="w-3.5 h-3.5" />
                <span>
                  {isSyncingCalendar
                    ? 'Saving to Calendar...'
                    : 'Save Workout to Calendar'}
                </span>
              </button>

              <button
                type="button"
                onClick={handlePushDirectGarmin}
                disabled={isSyncingCalendar}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl bg-[#007CC3] hover:bg-[#0066a1] disabled:opacity-60 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors"
                title="Push structured workout directly to your Garmin Connect Calendar for wireless sync to your Garmin watch or Edge head unit"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Push to Garmin Connect</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadFit}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl liquid-glass-subtle hover:border-blue-500/50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                title="Download native Garmin .FIT binary workout file for Garmin watches & Edge head units"
              >
                <Download className="w-3.5 h-3.5 text-emerald-500" />
                <span>Export Garmin .FIT</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadZwo}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl liquid-glass-subtle hover:border-blue-500/50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                title="Download structured .ZWO workout file"
              >
                <Download className="w-3.5 h-3.5 text-orange-500" />
                <span>Export .ZWO</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadErg}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl liquid-glass-subtle hover:border-blue-500/50 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                title="Download .ERG workout file calibrated to your synced FTP"
              >
                <Download className="w-3.5 h-3.5 text-sky-500" />
                <span>Export .ERG ({activeFtp}W)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                onOpenCoachWithPrompt(
                  `Explain today's readiness-morphed workout ("${morphedWorkout.title}", ${morphedWorkout.tss} TSS) given my HRV (${recentHrvDay.hrvRMSSD} ms vs ${recentHrvDay.hrvBaseline7d} ms 7d avg), Sleep Score (${recentSleepDay.sleepScore}), Form (TSB ${latestWellness.tsb.toFixed(1)}), and synced FTP (${activeFtp}W) / LTHR (${athleteProfile.lthr} bpm).`
                )
              }
              className="min-h-[34px] inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-sky-400 hover:underline"
            >
              <span>Discuss Prescription with AI Coach</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
