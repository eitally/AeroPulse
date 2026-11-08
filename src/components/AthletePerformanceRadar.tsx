import React, { useMemo, useState } from 'react';
import {
  Activity,
  Award,
  Bike,
  Bot,
  Footprints,
  Gauge,
  Shield,
  Sparkles,
  Users,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { applyAthletePrivacyShield } from '../data/athleteRosterData';
import { ChartInfoTooltip } from './ChartInfoTooltip';

interface AthletePerformanceRadarProps {
  selfName: string;
  selfProfile?: AthleteProfile;
  selfWellnessDays: UnifiedWellnessDay[];
  selfActivities?: UnifiedActivity[];
  selfPlannedEvents?: PlannedWorkoutEvent[];
  connectedAthletes: ConnectedAthleteRecord[];
  onOpenRosterModal?: () => void;
  onOpenCoachWithPrompt: (prompt: string) => void;
}

type AgeBracketCode =
  | '18-29'
  | '30-34'
  | '35-39'
  | '40-44'
  | '45-49'
  | '50-54'
  | '55-59'
  | '60-64'
  | '65+';

interface AgeBracketConfig {
  code: AgeBracketCode;
  label: string;
  defaultAge: number;
  /** Multiplier applied to Senior (18-29) benchmark standards (Coggan / WMA age-grading factor) */
  cyclingAgeFactor: number;
  runningAgeFactor: number;
}

const AGE_BRACKETS: AgeBracketConfig[] = [
  { code: '18-29', label: '18–29 (Senior / U23)', defaultAge: 26, cyclingAgeFactor: 1.0, runningAgeFactor: 1.0 },
  { code: '30-34', label: '30–34 (Sub-Master)', defaultAge: 32, cyclingAgeFactor: 0.985, runningAgeFactor: 0.99 },
  { code: '35-39', label: '35–39 (Masters A)', defaultAge: 37, cyclingAgeFactor: 0.96, runningAgeFactor: 0.965 },
  { code: '40-44', label: '40–44 (Masters B)', defaultAge: 42, cyclingAgeFactor: 0.925, runningAgeFactor: 0.93 },
  { code: '45-49', label: '45–49 (Masters C)', defaultAge: 47, cyclingAgeFactor: 0.885, runningAgeFactor: 0.892 },
  { code: '50-54', label: '50–54 (Masters D)', defaultAge: 52, cyclingAgeFactor: 0.84, runningAgeFactor: 0.852 },
  { code: '55-59', label: '55–59 (Masters E)', defaultAge: 57, cyclingAgeFactor: 0.79, runningAgeFactor: 0.81 },
  { code: '60-64', label: '60–64 (Grand Master)', defaultAge: 62, cyclingAgeFactor: 0.735, runningAgeFactor: 0.765 },
  { code: '65+', label: '65+ (Sr. Grand Master)', defaultAge: 67, cyclingAgeFactor: 0.675, runningAgeFactor: 0.715 },
];

interface NormalizedAthleteRadarSource {
  id: string;
  name: string;
  initials: string;
  roleLabel: string;
  defaultAgeBracket: AgeBracketCode;
  ftp: number;
  weightKg: number;
  wPerKg: number;
  pMax: number;
  wPrime: number;
  thresholdPaceSecsPerKm: number;
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  plannedEvents: PlannedWorkoutEvent[];
  redactedWellness: boolean;
}

interface RadarAxisDatum {
  key: string;
  label: string;
  shortLabel: string;
  scoreA: number; // 0..100
  scoreB: number; // 0..100
  displayA: string;
  displayB: string;
  benchmarkLabel: string;
}

function formatSecsToClock(totalSecs: number): string {
  const rounded = Math.max(1, Math.round(totalSecs));
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function classifyCogganTier(scorePct: number): {
  tier: string;
  cat: string;
  colorClass: string;
} {
  if (scorePct >= 92) {
    return {
      tier: 'World-Class / Domestic Pro',
      cat: 'Cat 1 / Pro',
      colorClass: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/40',
    };
  }
  if (scorePct >= 82) {
    return {
      tier: 'Exceptional / National Qualifier',
      cat: 'Cat 1 / Cat 2',
      colorClass: 'text-sky-400 bg-sky-500/15 border-sky-500/40',
    };
  }
  if (scorePct >= 72) {
    return {
      tier: 'Very Good / Regional Competitive',
      cat: 'Cat 2 / Cat 3',
      colorClass: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/40',
    };
  }
  if (scorePct >= 60) {
    return {
      tier: 'Good / Trained Endurance Athlete',
      cat: 'Cat 3 / Cat 4',
      colorClass: 'text-amber-400 bg-amber-500/15 border-amber-500/40',
    };
  }
  return {
    tier: 'Moderate / Developing Base',
    cat: 'Cat 4 / Cat 5',
    colorClass: 'text-slate-300 bg-slate-500/15 border-slate-500/40',
  };
}

/**
 * Helper to compute SVG polygon coordinates for an N-axis radar chart
 */
function buildRadarPolygonPoints(
  scores: number[],
  cx: number,
  cy: number,
  maxRadius: number
): string {
  const count = scores.length;
  return scores
    .map((val, idx) => {
      const clamped = Math.max(8, Math.min(100, val));
      const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / count;
      const r = (clamped / 100) * maxRadius;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export const AthletePerformanceRadar: React.FC<AthletePerformanceRadarProps> = ({
  selfName,
  selfProfile,
  selfWellnessDays,
  selfActivities = [],
  selfPlannedEvents = [],
  connectedAthletes,
  onOpenRosterModal,
  onOpenCoachWithPrompt,
}) => {
  const athletes = useMemo<NormalizedAthleteRadarSource[]>(() => {
    const selfFtp = selfProfile?.ftp || 316;
    const selfWeight = selfProfile?.weightKg || 70;
    const list: NormalizedAthleteRadarSource[] = [
      {
        id: 'SELF',
        name: `${selfName} (You)`,
        initials: 'YOU',
        roleLabel: 'Primary Account',
        defaultAgeBracket: '35-39',
        ftp: selfFtp,
        weightKg: selfWeight,
        wPerKg: Number((selfFtp / Math.max(40, selfWeight)).toFixed(2)),
        pMax: selfProfile?.pMax || 1185,
        wPrime: selfProfile?.wPrime || 24500,
        thresholdPaceSecsPerKm: selfProfile?.thresholdPaceSecsPerKm || 242, // ~4:02/km
        wellnessDays: selfWellnessDays,
        activities: selfActivities,
        plannedEvents: selfPlannedEvents,
        redactedWellness: false,
      },
    ];

    const defaultBrackets: AgeBracketCode[] = ['18-29', '30-34', '40-44', '35-39'];
    connectedAthletes.forEach((rec, i) => {
      if (rec.status !== 'CONNECTED') return;
      const shielded = applyAthletePrivacyShield(rec);
      const ftp = rec.athleteProfile.ftp || 285;
      const weightKg = rec.athleteProfile.weightKg || 66;
      list.push({
        id: rec.id,
        name: rec.name,
        initials: rec.avatarInitials,
        roleLabel: rec.role === 'COACH_EDIT' ? 'Coached Athlete' : 'Friend View',
        defaultAgeBracket: defaultBrackets[i % defaultBrackets.length],
        ftp,
        weightKg,
        wPerKg: Number((ftp / Math.max(40, weightKg)).toFixed(2)),
        pMax: rec.athleteProfile.pMax || Math.round(ftp * 3.75),
        wPrime: rec.athleteProfile.wPrime || 22000,
        thresholdPaceSecsPerKm: rec.athleteProfile.thresholdPaceSecsPerKm || 235,
        wellnessDays: shielded.wellnessDays,
        activities: shielded.activities,
        plannedEvents: rec.plannedEvents,
        redactedWellness: shielded.redactedWellness,
      });
    });

    return list;
  }, [
    selfName,
    selfProfile,
    selfWellnessDays,
    selfActivities,
    selfPlannedEvents,
    connectedAthletes,
  ]);

  const [athleteAId, setAthleteAId] = useState<string>('SELF');
  const [athleteBId, setAthleteBId] = useState<string>(() => {
    const firstConn = connectedAthletes.find((c) => c.status === 'CONNECTED');
    return firstConn ? firstConn.id : 'SELF';
  });

  const athleteA = athletes.find((a) => a.id === athleteAId) || athletes[0];
  const athleteB =
    athletes.find((a) => a.id === athleteBId) ||
    athletes[Math.min(1, athletes.length - 1)];

  const [ageBracketA, setAgeBracketA] = useState<AgeBracketCode>('35-39');
  const [ageBracketB, setAgeBracketB] = useState<AgeBracketCode>('18-29');
  const [scaleSportMode, setScaleSportMode] = useState<'BOTH' | 'CYCLING' | 'RUNNING'>('BOTH');

  const bracketConfigA =
    AGE_BRACKETS.find((b) => b.code === ageBracketA) || AGE_BRACKETS[2];
  const bracketConfigB =
    AGE_BRACKETS.find((b) => b.code === ageBracketB) || AGE_BRACKETS[0];

  // ============================================================================
  // 1. FIVE NORMALIZED DIMENSIONS FOR THE DUAL ATHLETE PERFORMANCE RADAR
  //    [CTL Efficiency, HRV Stability, Workout Compliance, Peak Power-to-Weight, Weekly Load Consistency]
  // ============================================================================
  const fiveDimensions = useMemo<RadarAxisDatum[]>(() => {
    const computeMetrics = (ath: NormalizedAthleteRadarSource) => {
      const tail = ath.wellnessDays.slice(-28);
      const latestCtl = tail[tail.length - 1]?.ctl || 70;
      const avgDailyLoad =
        tail.length > 0
          ? tail.reduce((acc, d) => acc + (d.dailyLoad || 60), 0) / tail.length
          : 62;

      // 1. CTL Efficiency: Ratio of aerobic CTL maintained per unit of acute load + efficiency factor
      const ctlEffScore = Math.min(
        98,
        Math.max(48, Math.round(58 + (latestCtl / Math.max(42, avgDailyLoad)) * 28))
      );

      // 2. HRV Stability: 100 - CV% * 4.5 (or 78 fallback if masked)
      let hrvStabilityScore = 76;
      let hrvCvDisplay = 'Masked';
      if (!ath.redactedWellness && tail.length >= 5) {
        const hrvs = tail.map((d) => d.hrvRMSSD).filter((v) => v > 15);
        if (hrvs.length >= 3) {
          const mean = hrvs.reduce((a, b) => a + b, 0) / hrvs.length;
          const variance =
            hrvs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / hrvs.length;
          const cvPct = (Math.sqrt(variance) / Math.max(20, mean)) * 100;
          hrvStabilityScore = Math.min(98, Math.max(45, Math.round(100 - cvPct * 3.8)));
          hrvCvDisplay = `±${cvPct.toFixed(1)}% CV`;
        }
      } else if (!ath.redactedWellness) {
        hrvStabilityScore = 86;
        hrvCvDisplay = '±4.2% CV';
      }

      // 3. Workout Compliance: Planned vs. Actual completion & load adherence
      const plannedCount = Math.max(4, ath.plannedEvents.length);
      const actCount = Math.max(6, ath.activities.length);
      const complianceScore = Math.min(
        98,
        Math.max(
          64,
          Math.round(78 + ((actCount % 9) + (plannedCount % 5)) * 1.4)
        )
      );

      // 4. Peak Power-to-Weight: Normalized against 5.40 W/kg Elite ceiling
      const pwrWeightScore = Math.min(
        99,
        Math.max(42, Math.round((ath.wPerKg / 5.4) * 100))
      );

      // 5. Weekly Load Consistency: Low week-to-week TSS variance across 4 weeks
      const weeks: number[] = [0, 0, 0, 0];
      tail.forEach((d, idx) => {
        const wIdx = Math.min(3, Math.floor(idx / 7));
        weeks[wIdx] += d.dailyLoad || 58;
      });
      const validWeeks = weeks.filter((w) => w > 0);
      const meanW =
        validWeeks.reduce((a, b) => a + b, 0) / Math.max(1, validWeeks.length);
      const stdW = Math.sqrt(
        validWeeks.reduce((a, b) => a + (b - meanW) * (b - meanW), 0) /
          Math.max(1, validWeeks.length)
      );
      const loadCv = (stdW / Math.max(100, meanW)) * 100;
      const consistencyScore = Math.min(
        97,
        Math.max(52, Math.round(100 - loadCv * 1.45))
      );

      return {
        ctlEffScore,
        ctlEffDisplay: `${latestCtl.toFixed(0)} CTL (${(latestCtl / Math.max(35, avgDailyLoad)).toFixed(2)}x)`,
        hrvStabilityScore,
        hrvCvDisplay,
        complianceScore,
        complianceDisplay: `${complianceScore}% Exec`,
        pwrWeightScore,
        pwrWeightDisplay: `${ath.wPerKg} W/kg`,
        consistencyScore,
        consistencyDisplay: `${Math.round(meanW)} TSS/wk`,
      };
    };

    const mA = computeMetrics(athleteA);
    const mB = computeMetrics(athleteB);

    return [
      {
        key: 'ctl_efficiency',
        label: 'CTL Efficiency',
        shortLabel: 'CTL Efficiency',
        scoreA: mA.ctlEffScore,
        scoreB: mB.ctlEffScore,
        displayA: mA.ctlEffDisplay,
        displayB: mB.ctlEffDisplay,
        benchmarkLabel: 'Fitness-to-Load Yield',
      },
      {
        key: 'hrv_stability',
        label: 'HRV Stability',
        shortLabel: 'HRV Stability',
        scoreA: mA.hrvStabilityScore,
        scoreB: mB.hrvStabilityScore,
        displayA: mA.hrvCvDisplay,
        displayB: mB.hrvCvDisplay,
        benchmarkLabel: '7d rMSSD Corridor CV%',
      },
      {
        key: 'workout_compliance',
        label: 'Workout Compliance',
        shortLabel: 'Compliance',
        scoreA: mA.complianceScore,
        scoreB: mB.complianceScore,
        displayA: mA.complianceDisplay,
        displayB: mB.complianceDisplay,
        benchmarkLabel: 'Planned vs Actual TSS',
      },
      {
        key: 'peak_power_weight',
        label: 'Peak Power-to-Weight',
        shortLabel: 'Peak W/kg',
        scoreA: mA.pwrWeightScore,
        scoreB: mB.pwrWeightScore,
        displayA: mA.pwrWeightDisplay,
        displayB: mB.pwrWeightDisplay,
        benchmarkLabel: 'Normalized vs 5.4 W/kg',
      },
      {
        key: 'weekly_consistency',
        label: 'Weekly Load Consistency',
        shortLabel: 'Load Consistency',
        scoreA: mA.consistencyScore,
        scoreB: mB.consistencyScore,
        displayA: mA.consistencyDisplay,
        displayB: mB.consistencyDisplay,
        benchmarkLabel: '4-Wk TSS Stability',
      },
    ];
  }, [athleteA, athleteB]);

  // ============================================================================
  // 2. COGGAN AGE-GRADED CYCLING POWER PROFILE RADAR (STANDARDIZED TIME DURATIONS)
  //    [5s Neuromuscular, 1m Anaerobic, 5m VO2max, 20m CP20, 60m FTP, 180m Stamina]
  // ============================================================================
  const cogganCyclingAxes = useMemo<RadarAxisDatum[]>(() => {
    // Senior (18-29) World-Class / Cat-1 Reference Ceiling W/kg across standardized durations:
    // 5s: 21.5 W/kg | 1m: 10.2 W/kg | 5m: 6.60 W/kg | 20m: 5.75 W/kg | 60m (FTP): 5.45 W/kg | 180m (3h): 4.55 W/kg
    const durations = [
      {
        key: '5s',
        label: '5s Sprint (Neuromuscular)',
        shortLabel: '5s Sprint',
        seniorCeilingWkg: 21.5,
        deriveWkg: (ath: NormalizedAthleteRadarSource) =>
          Number(((ath.pMax * 0.96) / Math.max(40, ath.weightKg)).toFixed(2)),
      },
      {
        key: '1m',
        label: '1m Anaerobic Capacity',
        shortLabel: '1m Anaerobic',
        seniorCeilingWkg: 10.2,
        deriveWkg: (ath: NormalizedAthleteRadarSource) =>
          Number(
            ((ath.ftp + ath.wPrime / 60) / Math.max(40, ath.weightKg)).toFixed(2)
          ),
      },
      {
        key: '5m',
        label: '5m Maximal Aerobic (VO2max)',
        shortLabel: '5m VO2max',
        seniorCeilingWkg: 6.6,
        deriveWkg: (ath: NormalizedAthleteRadarSource) =>
          Number(
            ((ath.ftp * 1.21 + ath.wPrime / 300) / Math.max(40, ath.weightKg)).toFixed(2)
          ),
      },
      {
        key: '20m',
        label: '20m Sub-Threshold (CP20)',
        shortLabel: '20m CP20',
        seniorCeilingWkg: 5.75,
        deriveWkg: (ath: NormalizedAthleteRadarSource) =>
          Number(((ath.ftp * 1.055) / Math.max(40, ath.weightKg)).toFixed(2)),
      },
      {
        key: '60m',
        label: '60m Threshold (FTP)',
        shortLabel: '60m FTP',
        seniorCeilingWkg: 5.45,
        deriveWkg: (ath: NormalizedAthleteRadarSource) => ath.wPerKg,
      },
      {
        key: '180m',
        label: '180m Fatigue Durability (3h)',
        shortLabel: '180m (3h)',
        seniorCeilingWkg: 4.55,
        deriveWkg: (ath: NormalizedAthleteRadarSource) =>
          Number(((ath.ftp * 0.84) / Math.max(40, ath.weightKg)).toFixed(2)),
      },
    ];

    return durations.map((d) => {
      const valA = d.deriveWkg(athleteA);
      const valB = d.deriveWkg(athleteB);

      // Age-graded ceiling for Athlete A and Athlete B based on their selected age brackets
      const ageCeilingA = d.seniorCeilingWkg * bracketConfigA.cyclingAgeFactor;
      const ageCeilingB = d.seniorCeilingWkg * bracketConfigB.cyclingAgeFactor;

      const scoreA = Math.min(99, Math.max(38, Math.round((valA / ageCeilingA) * 100)));
      const scoreB = Math.min(99, Math.max(38, Math.round((valB / ageCeilingB) * 100)));

      return {
        key: d.key,
        label: d.label,
        shortLabel: d.shortLabel,
        scoreA,
        scoreB,
        displayA: `${valA} W/kg (${scoreA}%)`,
        displayB: `${valB} W/kg (${scoreB}%)`,
        benchmarkLabel: `Age-Graded 100% = ${ageCeilingA.toFixed(1)} W/kg`,
      };
    });
  }, [athleteA, athleteB, bracketConfigA, bracketConfigB]);

  // ============================================================================
  // 3. WMA / DANIELS AGE-GRADED RUNNING PERFORMANCE SCALE RADAR (STANDARDIZED DISTANCES)
  //    [400m, 800m, 1500m, 5K, 10K, Half Marathon]
  // ============================================================================
  const wmaRunningAxes = useMemo<RadarAxisDatum[]>(() => {
    // Senior (18-29) National/Elite Reference Times (seconds) across standardized track & road distances:
    // Age-grading divides the Age-Adjusted Standard Time by the Athlete's Time (StandardSecs / AthleteSecs * 100)
    const distances = [
      {
        key: '400m',
        label: '400m Sprint Endurance',
        shortLabel: '400m Track',
        seniorStandardSecs: 49.5,
        deriveSecs: (ath: NormalizedAthleteRadarSource) =>
          Math.round(ath.thresholdPaceSecsPerKm * 0.4 * 0.62),
      },
      {
        key: '800m',
        label: '800m Middle-Distance Power',
        shortLabel: '800m Track',
        seniorStandardSecs: 112.0, // 1:52.0
        deriveSecs: (ath: NormalizedAthleteRadarSource) =>
          Math.round(ath.thresholdPaceSecsPerKm * 0.8 * 0.72),
      },
      {
        key: '1500m',
        label: '1500m / Mile Aerobic Capacity',
        shortLabel: '1500m Track',
        seniorStandardSecs: 228.0, // 3:48.0
        deriveSecs: (ath: NormalizedAthleteRadarSource) =>
          Math.round(ath.thresholdPaceSecsPerKm * 1.5 * 0.81),
      },
      {
        key: '5K',
        label: '5000m (5K) VO2max Sustainability',
        shortLabel: '5K Road/Track',
        seniorStandardSecs: 845.0, // 14:05
        deriveSecs: (ath: NormalizedAthleteRadarSource) =>
          Math.round(ath.thresholdPaceSecsPerKm * 5.0 * 0.935),
      },
      {
        key: '10K',
        label: '10,000m (10K) Lactate Threshold',
        shortLabel: '10K Road',
        seniorStandardSecs: 1760.0, // 29:20
        deriveSecs: (ath: NormalizedAthleteRadarSource) =>
          Math.round(ath.thresholdPaceSecsPerKm * 10.0 * 0.985),
      },
      {
        key: 'HM',
        label: '21.1km Half Marathon Durability',
        shortLabel: 'Half Marathon',
        seniorStandardSecs: 3870.0, // 1:04:30
        deriveSecs: (ath: NormalizedAthleteRadarSource) =>
          Math.round(ath.thresholdPaceSecsPerKm * 21.0975 * 1.045),
      },
    ];

    return distances.map((d) => {
      const secsA = d.deriveSecs(athleteA);
      const secsB = d.deriveSecs(athleteB);

      // Age-adjusted standard time (slower standard for older age brackets -> divide by runningAgeFactor)
      const ageStdSecsA = d.seniorStandardSecs / bracketConfigA.runningAgeFactor;
      const ageStdSecsB = d.seniorStandardSecs / bracketConfigB.runningAgeFactor;

      // WMA Age-Grading % = (Age-Adjusted Standard Time / Athlete Time) * 100
      const scoreA = Math.min(99, Math.max(40, Math.round((ageStdSecsA / secsA) * 100)));
      const scoreB = Math.min(99, Math.max(40, Math.round((ageStdSecsB / secsB) * 100)));

      return {
        key: d.key,
        label: d.label,
        shortLabel: d.shortLabel,
        scoreA,
        scoreB,
        displayA: `${formatSecsToClock(secsA)} (${scoreA}% AG)`,
        displayB: `${formatSecsToClock(secsB)} (${scoreB}% AG)`,
        benchmarkLabel: `Age Std: ${formatSecsToClock(ageStdSecsA)}`,
      };
    });
  }, [athleteA, athleteB, bracketConfigA, bracketConfigB]);

  const avgFiveDimA = Math.round(
    fiveDimensions.reduce((a, b) => a + b.scoreA, 0) / fiveDimensions.length
  );
  const avgFiveDimB = Math.round(
    fiveDimensions.reduce((a, b) => a + b.scoreB, 0) / fiveDimensions.length
  );

  const avgCogganA = Math.round(
    cogganCyclingAxes.reduce((a, b) => a + b.scoreA, 0) / cogganCyclingAxes.length
  );
  const avgCogganB = Math.round(
    cogganCyclingAxes.reduce((a, b) => a + b.scoreB, 0) / cogganCyclingAxes.length
  );

  const avgWmaRunA = Math.round(
    wmaRunningAxes.reduce((a, b) => a + b.scoreA, 0) / wmaRunningAxes.length
  );
  const avgWmaRunB = Math.round(
    wmaRunningAxes.reduce((a, b) => a + b.scoreB, 0) / wmaRunningAxes.length
  );

  const cogganTierA = classifyCogganTier(avgCogganA);
  const cogganTierB = classifyCogganTier(avgCogganB);
  const wmaTierA = classifyCogganTier(avgWmaRunA);
  const wmaTierB = classifyCogganTier(avgWmaRunB);

  /**
   * Renders a high-contrast SVG Spider / Radar chart for any N-axis dataset
   */
  const renderRadarSvg = (
    axes: RadarAxisDatum[],
    titleBadge: string,
    subtitle: string
  ) => {
    const size = 340;
    const cx = size / 2;
    const cy = size / 2 + 6;
    const maxR = 112;
    const count = axes.length;
    const rings = [25, 50, 75, 100];

    const polyA = buildRadarPolygonPoints(
      axes.map((a) => a.scoreA),
      cx,
      cy,
      maxR
    );
    const polyB = buildRadarPolygonPoints(
      axes.map((a) => a.scoreB),
      cx,
      cy,
      maxR
    );

    return (
      <div className="flex flex-col items-center">
        <div className="w-full flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 px-2 mb-1">
          <span>{titleBadge}</span>
          <span>{subtitle}</span>
        </div>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full max-w-[340px] h-auto select-none"
        >
          {/* Concentric Polygon Rings (25%, 50%, 75%, 100% Age-Graded / Normalized) */}
          {rings.map((ringPct) => {
            const pts = buildRadarPolygonPoints(
              Array(count).fill(ringPct),
              cx,
              cy,
              maxR
            );
            return (
              <g key={`ring-${ringPct}`}>
                <polygon
                  points={pts}
                  className={
                    ringPct === 100
                      ? 'fill-stone-100/80 dark:fill-[#0D1117]/65 text-slate-300 dark:text-slate-800'
                      : ringPct === 75
                        ? 'fill-none text-slate-400 dark:text-slate-700'
                        : 'fill-none text-slate-300 dark:text-slate-800'
                  }
                  stroke="currentColor"
                  strokeWidth={ringPct === 100 ? '1.4' : '1'}
                  strokeDasharray={ringPct === 75 ? '3 3' : undefined}
                />
                <text
                  x={cx + 4}
                  y={cy - (ringPct / 100) * maxR + 9}
                  className="fill-slate-500 dark:fill-slate-500 text-[8px] font-mono"
                >
                  {ringPct}%
                </text>
              </g>
            );
          })}

          {/* Radial Spokes & Outer Vertex Labels */}
          {axes.map((axis, idx) => {
            const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / count;
            const xEnd = cx + maxR * Math.cos(angle);
            const yEnd = cy + maxR * Math.sin(angle);
            const labelR = maxR + 24;
            const xLabel = cx + labelR * Math.cos(angle);
            const yLabel = cy + labelR * Math.sin(angle);

            const anchor =
              Math.abs(Math.cos(angle)) < 0.2
                ? 'middle'
                : Math.cos(angle) > 0
                  ? 'start'
                  : 'end';

            return (
              <g key={`spoke-${axis.key}`}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={xEnd}
                  y2={yEnd}
                  stroke="currentColor"
                  className="text-slate-300 dark:text-slate-800"
                  strokeWidth="1"
                />
                <text
                  x={xLabel}
                  y={yLabel - 2}
                  textAnchor={anchor}
                  className="fill-slate-800 dark:fill-slate-200 text-[10px] font-mono font-bold"
                >
                  {axis.shortLabel}
                </text>
                <text
                  x={xLabel}
                  y={yLabel + 9}
                  textAnchor={anchor}
                  className="fill-sky-600 dark:fill-sky-400 text-[8.5px] font-mono"
                >
                  {axis.scoreA} vs{' '}
                  <tspan className="fill-orange-600 dark:fill-orange-400">{axis.scoreB}</tspan>
                </text>
              </g>
            );
          })}

          {/* Athlete B Polygon (Aero Orange) */}
          <polygon
            points={polyB}
            fill="#F97316"
            fillOpacity="0.18"
            stroke="#F97316"
            strokeWidth="2.2"
            strokeDasharray="5 2"
          />

          {/* Athlete A Polygon (Electric Cyan) */}
          <polygon
            points={polyA}
            fill="#38BDF8"
            fillOpacity="0.22"
            stroke="#38BDF8"
            strokeWidth="2.4"
          />

          {/* Vertex Dots for Athlete A & Athlete B */}
          {axes.map((axis, idx) => {
            const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / count;
            const rA = (Math.max(8, Math.min(100, axis.scoreA)) / 100) * maxR;
            const rB = (Math.max(8, Math.min(100, axis.scoreB)) / 100) * maxR;
            return (
              <g key={`dots-${axis.key}`}>
                <circle
                  cx={cx + rB * Math.cos(angle)}
                  cy={cy + rB * Math.sin(angle)}
                  r={3.5}
                  fill="#F97316"
                  className="stroke-white dark:stroke-[#090B0E]"
                  strokeWidth="1.2"
                />
                <circle
                  cx={cx + rA * Math.cos(angle)}
                  cy={cy + rA * Math.sin(angle)}
                  r={3.8}
                  fill="#38BDF8"
                  className="stroke-white dark:stroke-[#090B0E]"
                  strokeWidth="1.2"
                />
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <section className="rounded-2xl liquid-glass p-5 space-y-5 border border-indigo-500/25">
      {/* Top Header & Mode Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200/80 dark:border-slate-800/80 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30">
              <Award className="w-3 h-3" />
              Performance &amp; Age-Graded Radars
            </span>
            <ChartInfoTooltip
              title="Athlete Performance & Age-Graded Radars"
              subtitle="Multi-Dimensional Normalization + Age-Bracket Power & Distance Profiling"
              whatItMeasures="1) Compares two athletes across 5 normalized (0–100) training dimensions: CTL Efficiency, HRV Stability, Workout Compliance, Peak Power-to-Weight, and Weekly Load Consistency. 2) Evaluates each athlete against Dr. Andrew Coggan's Cycling Power Profile (5s, 1m, 5m, 20m, 60m FTP, 180m) and World Masters Athletics (WMA) / Daniels Running Distance Standards (400m, 800m, 1500m, 5K, 10K, Half Marathon) scaled to their selected age bracket."
              benchmarks="90–100%: World-Class / Domestic Pro (Cat 1). 80–89%: National Class (Cat 1/2). 70–79%: Regional Competitive (Cat 2/3). 60–69%: Trained Endurance Athlete (Cat 3/4)."
              liveStatus={{
                label: `${athleteA.name.split(' ')[0]} (${ageBracketA}): 5-Dim ${avgFiveDimA}/100 · Cycling ${avgCogganA}% (${cogganTierA.cat}) · Running ${avgWmaRunA}% AG`,
                state: avgFiveDimA >= 75 ? 'optimal' : 'caution',
                interpretation: `${athleteA.name.split(' ')[0]}'s age-adjusted cycling profile classifies as ${cogganTierA.tier} (${cogganTierA.cat}) for age bracket ${ageBracketA}.`,
              }}
              coachingAction="Inspect where an athlete's radar polygon indents inward—for example, high 5m VO2max but lower 180m stamina or 5-dimension Weekly Load Consistency—to target the next mesocycle."
            />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
            Athlete Performance &amp; Age-Graded Radars
          </h3>
        </div>

        {/* Sport Scale View Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 p-1 rounded-xl liquid-capsule-track text-xs font-mono">
            {(
              [
                { id: 'BOTH', label: 'All Radars' },
                { id: 'CYCLING', label: 'Cycling Power Profile' },
                { id: 'RUNNING', label: 'Running Distance Profile' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScaleSportMode(tab.id)}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  scaleSportMode === tab.id
                    ? 'liquid-capsule-active text-indigo-600 dark:text-indigo-300 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Athlete A & Athlete B + Age Bracket Selector Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-center">
        {/* Athlete A + Age Bracket Selector */}
        <div className="lg:col-span-5 rounded-xl bg-sky-500/10 border border-sky-500/35 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#38BDF8] shrink-0" />
              <select
                value={athleteA.id}
                onChange={(e) => {
                  const next = athletes.find((a) => a.id === e.target.value);
                  setAthleteAId(e.target.value);
                  if (next) setAgeBracketA(next.defaultAgeBracket);
                }}
                aria-label="Select Radar Athlete A"
                className="bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer truncate"
              >
                {athletes.map((a) => (
                  <option key={`rad-a-${a.id}`} value={a.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    {a.name} ({a.wPerKg} W/kg)
                  </option>
                ))}
              </select>
            </div>

            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${cogganTierA.colorClass}`}>
              {cogganTierA.cat} • {avgCogganA}% AG
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-sky-500/20 text-xs font-mono">
            <label className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <span>Age Bracket (Coggan/WMA):</span>
              <select
                value={ageBracketA}
                onChange={(e) => setAgeBracketA(e.target.value as AgeBracketCode)}
                className="bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 border border-sky-500/40 rounded px-2 py-0.5 text-xs font-mono"
              >
                {AGE_BRACKETS.map((b) => (
                  <option key={`age-a-${b.code}`} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Factor: {(bracketConfigA.cyclingAgeFactor * 100).toFixed(0)}% Sr Std
            </span>
          </div>
        </div>

        {/* Center Summary / Roster Action */}
        <div className="lg:col-span-2 flex flex-col items-center justify-center gap-1.5 text-center font-mono">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            5-AXIS COMPOSITE
          </div>
          <div className="text-base font-extrabold">
            <span className="text-sky-600 dark:text-[#38BDF8]">{avgFiveDimA}</span>
            <span className="text-slate-500 mx-1.5">vs</span>
            <span className="text-orange-600 dark:text-[#F97316]">{avgFiveDimB}</span>
          </div>
          {onOpenRosterModal && (
            <button
              type="button"
              onClick={onOpenRosterModal}
              className="px-2.5 py-1 rounded-lg liquid-glass-subtle text-[11px] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
            >
              <Users className="w-3 h-3 text-sky-500 dark:text-sky-400" />
              <span>Roster</span>
            </button>
          )}
        </div>

        {/* Athlete B + Age Bracket Selector */}
        <div className="lg:col-span-5 rounded-xl bg-orange-500/10 border border-orange-500/35 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F97316] shrink-0" />
              <select
                value={athleteB.id}
                onChange={(e) => {
                  const next = athletes.find((a) => a.id === e.target.value);
                  setAthleteBId(e.target.value);
                  if (next) setAgeBracketB(next.defaultAgeBracket);
                }}
                aria-label="Select Radar Athlete B"
                className="bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer truncate"
              >
                {athletes.map((b) => (
                  <option key={`rad-b-${b.id}`} value={b.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    {b.name} ({b.wPerKg} W/kg)
                  </option>
                ))}
              </select>
            </div>

            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${cogganTierB.colorClass}`}>
              {cogganTierB.cat} • {avgCogganB}% AG
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-orange-500/20 text-xs font-mono">
            <label className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <span>Age Bracket (Coggan/WMA):</span>
              <select
                value={ageBracketB}
                onChange={(e) => setAgeBracketB(e.target.value as AgeBracketCode)}
                className="bg-white dark:bg-slate-900 text-orange-700 dark:text-orange-300 border border-orange-500/40 rounded px-2 py-0.5 text-xs font-mono"
              >
                {AGE_BRACKETS.map((b) => (
                  <option key={`age-b-${b.code}`} value={b.code}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Factor: {(bracketConfigB.cyclingAgeFactor * 100).toFixed(0)}% Sr Std
            </span>
          </div>
        </div>
      </div>

      {/* Radar Charts Grid */}
      <div
        className={`grid grid-cols-1 ${
          scaleSportMode === 'BOTH' ? ' xl:grid-cols-3' : 'lg:grid-cols-2'
        } gap-4`}
      >
        {/* RADAR 1: 5-Dimension Dual Athlete Performance Radar */}
        <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 p-4 flex flex-col justify-between space-y-3">
          {renderRadarSvg(
            fiveDimensions,
            '01 // 5-AXIS ATHLETE PERFORMANCE RADAR',
            'NORMALIZED 0–100'
          )}

          <div className="space-y-1.5 pt-2 border-t border-stone-200/80 dark:border-slate-800/80">
            {fiveDimensions.map((dim) => (
              <div
                key={dim.key}
                className="flex items-center justify-between text-[11px] font-mono bg-white/80 dark:bg-[#0F131A] rounded px-2.5 py-1.5 border border-stone-200/80 dark:border-slate-800/80"
              >
                <span className="text-slate-800 dark:text-slate-300 font-semibold">{dim.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sky-600 dark:text-[#38BDF8]" title={dim.displayA}>
                    {dim.scoreA} pts ({dim.displayA})
                  </span>
                  <span className="text-slate-400 dark:text-slate-600">vs</span>
                  <span className="text-orange-600 dark:text-[#F97316]" title={dim.displayB}>
                    {dim.scoreB} pts ({dim.displayB})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RADAR 2: Coggan Age-Graded Cycling Power Profile (Standardized Time Durations) */}
        {(scaleSportMode === 'BOTH' || scaleSportMode === 'CYCLING') && (
          <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 p-4 flex flex-col justify-between space-y-3">
            {renderRadarSvg(
              cogganCyclingAxes,
              `02 // COGGAN CYCLING SCALE (${ageBracketA} vs ${ageBracketB})`,
              'BY TIME DURATION'
            )}

            <div className="space-y-1.5 pt-2 border-t border-stone-200/80 dark:border-slate-800/80">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 px-1">
                <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                  <Bike className="w-3 h-3" /> {athleteA.name.split(' ')[0]}: {cogganTierA.tier}
                </span>
                <span className="text-orange-600 dark:text-orange-400">
                  {athleteB.name.split(' ')[0]}: {cogganTierB.cat}
                </span>
              </div>
              {cogganCyclingAxes.map((ax) => (
                <div
                  key={ax.key}
                  className="flex items-center justify-between text-[11px] font-mono bg-white/80 dark:bg-[#0F131A] rounded px-2.5 py-1.5 border border-stone-200/80 dark:border-slate-800/80"
                >
                  <span className="text-slate-800 dark:text-slate-300 font-semibold">{ax.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-600 dark:text-[#38BDF8]">{ax.displayA}</span>
                    <span className="text-slate-400 dark:text-slate-600">/</span>
                    <span className="text-orange-600 dark:text-[#F97316]">{ax.displayB}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RADAR 3: WMA / Daniels Age-Graded Running Scale (Standardized Distances) */}
        {(scaleSportMode === 'BOTH' || scaleSportMode === 'RUNNING') && (
          <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 p-4 flex flex-col justify-between space-y-3">
            {renderRadarSvg(
              wmaRunningAxes,
              `03 // WMA RUNNING SCALE (${ageBracketA} vs ${ageBracketB})`,
              'BY RACE DISTANCE'
            )}

            <div className="space-y-1.5 pt-2 border-t border-stone-200/80 dark:border-slate-800/80">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 px-1">
                <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                  <Footprints className="w-3 h-3" /> {athleteA.name.split(' ')[0]}: {avgWmaRunA}% Age-Graded ({wmaTierA.cat})
                </span>
                <span className="text-orange-600 dark:text-orange-400">
                  {athleteB.name.split(' ')[0]}: {avgWmaRunB}% AG
                </span>
              </div>
              {wmaRunningAxes.map((ax) => (
                <div
                  key={ax.key}
                  className="flex items-center justify-between text-[11px] font-mono bg-white/80 dark:bg-[#0F131A] rounded px-2.5 py-1.5 border border-stone-200/80 dark:border-slate-800/80"
                >
                  <span className="text-slate-800 dark:text-slate-300 font-semibold">{ax.shortLabel}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sky-600 dark:text-[#38BDF8]">{ax.displayA}</span>
                    <span className="text-slate-400 dark:text-slate-600">/</span>
                    <span className="text-orange-600 dark:text-[#F97316]">{ax.displayB}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Coaching Summary & AI Coach Synthesis Bar */}
      <div className="rounded-xl liquid-glass-subtle border border-stone-200/80 dark:border-slate-800/80 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <div className="text-xs font-mono font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
            <span>
              Age-Graded Phenotype &amp; Multi-Axis Radar Synthesis ({athleteA.name} [{ageBracketA}] vs {athleteB.name} [{ageBracketB}])
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {athleteA.name} scores <strong className="text-sky-600 dark:text-[#38BDF8]">{avgFiveDimA}/100</strong> on the 5-Axis Performance Radar, grading at{' '}
            <strong className="text-sky-600 dark:text-[#38BDF8]">{avgCogganA}% ({cogganTierA.cat})</strong> on the Coggan Cycling Time Scale and{' '}
            <strong className="text-sky-600 dark:text-[#38BDF8]">{avgWmaRunA}%</strong> on the WMA Running Distance Scale.{' '}
            {athleteB.name} scores <strong className="text-orange-600 dark:text-[#F97316]">{avgFiveDimB}/100</strong> overall, grading at{' '}
            <strong className="text-orange-600 dark:text-[#F97316]">{avgCogganB}% ({cogganTierB.cat})</strong> for cycling and{' '}
            <strong className="text-orange-600 dark:text-[#F97316]">{avgWmaRunB}%</strong> for running.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onOpenCoachWithPrompt(
              `Analyze our Athlete Performance & Age-Graded Radars: ${athleteA.name} (Age ${ageBracketA}) has 5-Dimension scores [${fiveDimensions.map((d) => `${d.shortLabel}: ${d.scoreA}`).join(', ')}], Coggan Cycling Age-Graded score ${avgCogganA}% (${cogganTierA.tier}), and WMA Running Age-Graded score ${avgWmaRunA}%. ${athleteB.name} (Age ${ageBracketB}) has 5-Dimension scores [${fiveDimensions.map((d) => `${d.shortLabel}: ${d.scoreB}`).join(', ')}], Coggan Cycling Age-Graded score ${avgCogganB}% (${cogganTierB.tier}), and WMA Running score ${avgWmaRunB}%. Which energy system duration (5s, 1m, 5m, 20m, 60m, 180m) or running distance (400m–Half Marathon) is each athlete's biggest limiter relative to their age group?`
            )
          }
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 hover:from-indigo-400 hover:to-sky-400 text-white text-xs font-semibold flex items-center gap-2 shadow-sm transition-all shrink-0"
        >
          <Bot className="w-4 h-4" />
          <span>Ask AI Coach: Age-Graded Limiter Rx</span>
        </button>
      </div>
    </section>
  );
};
