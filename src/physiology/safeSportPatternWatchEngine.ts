import type {
  SafeSportBiomarkerAlertRecipient,
  SafeSportPatternSignal,
  SafeSportPatternWatchReport,
  StudentAthleteCheckIn,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types.ts';

export interface SafeSportPatternWatchParams {
  activities: UnifiedActivity[];
  wellnessDays?: UnifiedWellnessDay[];
  checkIn?: StudentAthleteCheckIn;
  isMinorU18?: boolean;
  hasParentGuardianCc?: boolean;
  hasAthleticTrainer?: boolean;
  referenceDateIso?: string;
}

const DAY_MS = 86_400_000;

const mean = (vals: number[]): number =>
  vals.length === 0 ? 0 : vals.reduce((acc, v) => acc + v, 0) / vals.length;

function isHardSession(act: UnifiedActivity): boolean {
  const name = (act.name || '').toLowerCase();
  const hasWorkIntervals = Boolean(act.intervals && act.intervals.some((i) => i.type === 'WORK'));
  const highRpe = (act.quickLog?.rpe ?? 0) >= 7;
  const highLoad = (act.trainingLoad ?? 0) >= 65;
  return (
    act.subType === 'Track' ||
    Boolean(act.officialRaceData) ||
    hasWorkIntervals ||
    highRpe ||
    highLoad ||
    /\b(track|intervals?|tempo|threshold|race|meets?|repeats?|vo2|fartlek|time trial|5000m|3200m|1600m|800m)\b|\d+\s*[x×]\s*\d+/i.test(
      name
    )
  );
}

function isEasySubmaximalRun(act: UnifiedActivity): boolean {
  if (act.sportCategory !== 'Running') return false;
  if ((act.movingTimeSecs || 0) < 1200 || (act.distanceMeters || 0) < 2000) return false;
  if (!(act.avgHr > 90)) return false;
  if (isHardSession(act)) return false;
  return true;
}

function extractActivityEf(act: UnifiedActivity): number | null {
  if (act.sportCategory !== 'Running') return null;
  if ((act.movingTimeSecs || 0) < 1200 || !(act.avgHr > 90)) return null;
  if (typeof act.efficiencyFactor === 'number' && act.efficiencyFactor > 0.3) {
    return act.efficiencyFactor;
  }
  if (act.distanceMeters > 1500 && act.movingTimeSecs > 0) {
    const speedMpm = act.distanceMeters / (act.movingTimeSecs / 60);
    return Number((speedMpm / act.avgHr).toFixed(3));
  }
  return null;
}

function extractHrr60Samples(act: UnifiedActivity): number[] {
  const samples: number[] = [];
  if (act.streams?.time && act.streams?.heartrate && act.intervals?.length) {
    const times = act.streams.time;
    const hrs = act.streams.heartrate;
    for (const iv of act.intervals) {
      if (iv.type !== 'WORK') continue;
      const workEnd = iv.startTimeSecs + iv.durationSecs;
      const targetT = workEnd + 60;
      let startHr: number | null = null;
      let end60Hr: number | null = null;
      for (let i = 0; i < times.length; i++) {
        if (startHr === null && times[i] >= workEnd) {
          startHr = hrs[i];
        }
        if (times[i] >= targetT) {
          end60Hr = hrs[i];
          break;
        }
      }
      if (startHr !== null && end60Hr !== null && startHr > 110 && startHr > end60Hr) {
        samples.push(Math.round(startHr - end60Hr));
      }
    }
    if (samples.length > 0) return samples;
  }

  if (act.intervals && act.intervals.length >= 2) {
    for (let i = 0; i < act.intervals.length - 1; i++) {
      const cur = act.intervals[i];
      const next = act.intervals[i + 1];
      if (cur.type === 'WORK' && next.type === 'RECOVERY' && next.durationSecs >= 45) {
        const peak = cur.maxHr ?? cur.avgHr;
        if (peak && next.avgHr && peak > 120 && peak > next.avgHr) {
          samples.push(Math.round(peak - next.avgHr));
        }
      }
    }
  }
  return samples;
}

/**
 * Ethical U18 RED-S / Iron Depletion / PHV Growth-Plate Pattern Watch.
 * Evaluates strictly longitudinal cardiac drift, chronotropic blunting, efficiency factor decay,
 * 60s HR recovery drops, serum ferritin, and growth-plate traction pain over 14d vs 28-56d windows.
 * Zero weight, BMI, body-fat %, or W/kg fields are ever read, computed, stored, or emitted.
 */
export function evaluateSafeSportPatternWatch(
  params: SafeSportPatternWatchParams
): SafeSportPatternWatchReport {
  const {
    activities = [],
    wellnessDays = [],
    checkIn,
    isMinorU18 = false,
    hasParentGuardianCc = false,
    hasAthleticTrainer = false,
    referenceDateIso,
  } = params;

  const refDateStr = (referenceDateIso || new Date().toISOString()).slice(0, 10);
  const refMs = Date.parse(`${refDateStr}T23:59:59Z`);

  const datedActivities = activities
    .map((act) => {
      const d = (act.startDateLocal || '').slice(0, 10);
      const ms = Date.parse(`${d}T12:00:00Z`);
      const ageDays = Number.isFinite(ms) ? (refMs - ms) / DAY_MS : Infinity;
      return { act, ageDays };
    })
    .filter((entry) => entry.ageDays >= 0 && entry.ageDays <= 56);

  const has56dHistory = datedActivities.some((entry) => entry.ageDays > 28);
  const windowBaselineDays: 28 | 56 = has56dHistory ? 56 : 28;

  const recentActs = datedActivities.filter((e) => e.ageDays <= 14).map((e) => e.act);
  const baselineActs = datedActivities
    .filter((e) => e.ageDays > 14 && e.ageDays <= 56)
    .map((e) => e.act);

  const signals: SafeSportPatternSignal[] = [];

  // 1. Submaximal Easy Run Cardiac Drift (+8 bpm or more over 14d vs 28-56d baseline)
  const recentEasy = recentActs.filter(isEasySubmaximalRun);
  const baselineEasy = baselineActs.filter(isEasySubmaximalRun);
  let deltaEasyHrBpm: number | null = null;
  if (recentEasy.length >= 1 && baselineEasy.length >= 1) {
    const baseHr = mean(baselineEasy.map((a) => a.avgHr));
    const recHr = mean(recentEasy.map((a) => a.avgHr));
    deltaEasyHrBpm = Number((recHr - baseHr).toFixed(1));
    if (deltaEasyHrBpm >= 8) {
      signals.push({
        signalId: 'EASY_HR_DRIFT_ELEVATED',
        severity: deltaEasyHrBpm >= 11 ? 'ACTION_REQUIRED' : 'WATCH',
        title: 'Submaximal Easy-Run HR Drift',
        metricValue: `${Math.round(recHr)} bpm`,
        baselineValue: `${Math.round(baseHr)} bpm`,
        deltaDisplay: `+${deltaEasyHrBpm.toFixed(1)} bpm`,
        guidance:
          'Sustained upward HR drift at easy aerobic pace is a classic early cardiovascular marker of low energy availability or iron depletion.',
      });
    }
  }

  // 2. Chronotropic Blunting (suppressed peak/max HR on hard sessions vs baseline despite high strain)
  const recentHard = recentActs.filter((a) => a.sportCategory === 'Running' && isHardSession(a) && a.maxHr > 120);
  const baselineHard = baselineActs.filter((a) => a.sportCategory === 'Running' && isHardSession(a) && a.maxHr > 120);
  const sortedWellness = [...wellnessDays].sort((a, b) => a.date.localeCompare(b.date));
  const latestWellness = sortedWellness[sortedWellness.length - 1];
  const highStrainContext =
    (latestWellness ? latestWellness.ctl - latestWellness.atl <= -10 : false) ||
    checkIn?.energyFeel === 'FLAT' ||
    recentHard.some((a) => (a.quickLog?.rpe ?? 0) >= 7 || (a.trainingLoad ?? 0) >= 65);

  let chronotropicBluntingDetected = false;
  if (recentHard.length >= 1 && baselineHard.length >= 1) {
    const baseMaxHr = mean(baselineHard.map((a) => a.maxHr));
    const recMaxHr = mean(recentHard.map((a) => a.maxHr));
    const dropBpm = Number((baseMaxHr - recMaxHr).toFixed(1));
    if (dropBpm >= 6 && (highStrainContext || dropBpm >= 8)) {
      chronotropicBluntingDetected = true;
      signals.push({
        signalId: 'CHRONOTROPIC_BLUNTING',
        severity: dropBpm >= 10 ? 'ACTION_REQUIRED' : 'WATCH',
        title: 'Chronotropic Blunting on Quality Efforts',
        metricValue: `${Math.round(recMaxHr)} bpm peak`,
        baselineValue: `${Math.round(baseMaxHr)} bpm peak`,
        deltaDisplay: `-${dropBpm.toFixed(1)} bpm`,
        guidance:
          'Suppressed max HR during track or hard efforts under elevated training load warrants reduced anaerobic volume and medical review.',
      });
    }
  }

  // 3. Running Efficiency Factor Decay (ΔEF <= -6%)
  const recentEfVals = recentActs.map(extractActivityEf).filter((v): v is number => v !== null);
  const baseEfVals = baselineActs.map(extractActivityEf).filter((v): v is number => v !== null);
  let deltaEfficiencyFactorPct: number | null = null;
  if (recentEfVals.length >= 1 && baseEfVals.length >= 1) {
    const baseEf = mean(baseEfVals);
    const recEf = mean(recentEfVals);
    deltaEfficiencyFactorPct = Number((((recEf - baseEf) / Math.max(0.1, baseEf)) * 100).toFixed(1));
    if (deltaEfficiencyFactorPct <= -6.0) {
      signals.push({
        signalId: 'EFFICIENCY_FACTOR_DECAY',
        severity: deltaEfficiencyFactorPct <= -9.0 ? 'ACTION_REQUIRED' : 'WATCH',
        title: 'Aerobic Efficiency Factor (EF) Drop',
        metricValue: `${recEf.toFixed(2)}`,
        baselineValue: `${baseEf.toFixed(2)}`,
        deltaDisplay: `${deltaEfficiencyFactorPct.toFixed(1)}%`,
        guidance:
          '14-day speed-to-HR efficiency fell >= 6% beneath baseline. Prioritize sleep, carbohydrate refueling around sessions, and reduced density.',
      });
    }
  }

  // 4. 60s Heart-Rate Recovery Drop (ΔHRR60 <= -6 bpm)
  const recentHrr60 = recentActs.flatMap(extractHrr60Samples);
  const baseHrr60 = baselineActs.flatMap(extractHrr60Samples);
  let deltaHrr60Bpm: number | null = null;
  if (recentHrr60.length >= 1 && baseHrr60.length >= 1) {
    const baseHrr = mean(baseHrr60);
    const recHrr = mean(recentHrr60);
    deltaHrr60Bpm = Number((recHrr - baseHrr).toFixed(1));
    if (deltaHrr60Bpm <= -6) {
      signals.push({
        signalId: 'HRR60_PARASYMPATHETIC_DROP',
        severity: deltaHrr60Bpm <= -10 ? 'ACTION_REQUIRED' : 'WATCH',
        title: '60s Heart-Rate Recovery (HRR60) Blunted',
        metricValue: `${Math.round(recHrr)} bpm drop`,
        baselineValue: `${Math.round(baseHrr)} bpm drop`,
        deltaDisplay: `${deltaHrr60Bpm.toFixed(1)} bpm`,
        guidance:
          'Post-interval 60s parasympathetic rebound slowed >= 6 bpm. Swap next spiked session for low-impact aerobic recovery.',
      });
    }
  }

  // 5. Serum Ferritin Screening (< 30 depleted, 30-49.9 suboptimal for distance runners)
  let ferritinStatus: SafeSportPatternWatchReport['ferritinStatus'] = 'UNKNOWN';
  if (typeof checkIn?.ferritinNgMl === 'number' && Number.isFinite(checkIn.ferritinNgMl)) {
    const f = checkIn.ferritinNgMl;
    if (f < 30) {
      ferritinStatus = 'DEPLETED_UNDER_30';
      signals.push({
        signalId: 'SERUM_FERRITIN_LOW',
        severity: 'ACTION_REQUIRED',
        title: 'Serum Ferritin Depleted (< 30 ng/mL)',
        metricValue: `${f.toFixed(0)} ng/mL`,
        baselineValue: '>= 50 ng/mL target',
        deltaDisplay: `${Math.round(f - 50)} ng/mL`,
        guidance:
          'Clinical iron deficiency impairs oxygen delivery and VO2max adaptations. Refer to team sports medicine / physician before iron supplementation.',
      });
    } else if (f < 50) {
      ferritinStatus = 'SUBOPTIMAL_30_50';
      signals.push({
        signalId: 'SERUM_FERRITIN_LOW',
        severity: 'WATCH',
        title: 'Serum Ferritin Borderline (30–49 ng/mL)',
        metricValue: `${f.toFixed(0)} ng/mL`,
        baselineValue: '>= 50 ng/mL target',
        deltaDisplay: `${Math.round(f - 50)} ng/mL`,
        guidance:
          'Borderline iron stores for endurance runners. Discuss dietary heme-iron intake and physician lab follow-up.',
      });
    } else {
      ferritinStatus = 'OPTIMAL';
    }
  }

  // 6. Adolescent PHV Growth-Plate Traction Soreness (Osgood-Schlatter Knee / Sever's Heel)
  const kneeScore = checkIn?.kneeGrowthPlateSoreness ?? 0;
  const heelScore = checkIn?.heelApophysisSoreness ?? 0;
  const maxPhvScore = Math.max(kneeScore, heelScore);
  const phvGrowthPlateFlag = maxPhvScore >= 1;
  if (phvGrowthPlateFlag) {
    const site =
      kneeScore >= heelScore ? 'Tibial Tuberosity (Knee)' : 'Calcaneal Apophysis (Heel)';
    signals.push({
      signalId: 'PHV_GROWTH_PLATE_SORENESS',
      severity: maxPhvScore >= 2 ? 'ACTION_REQUIRED' : 'WATCH',
      title: `PHV Growth-Plate Traction Watch (${site})`,
      metricValue: `${maxPhvScore}/3`,
      baselineValue: '0/3 pain-free',
      deltaDisplay: `+${maxPhvScore}`,
      guidance:
        maxPhvScore >= 2
          ? 'PROTECT GROWTH PLATE: Pause plyometrics, hurdles, and spikes immediately; route to Athletic Trainer / Aqua Jog.'
          : 'Early apophyseal traction sensitivity. Eliminate track spikes & hard downhill/bounding work this week.',
    });
  }

  // Overall Traffic Light & Ethical Routing
  const hasActionRequired = signals.some((s) => s.severity === 'ACTION_REQUIRED');
  const medicalWatchCluster =
    signals.length >= 2 &&
    (ferritinStatus !== 'UNKNOWN' && ferritinStatus !== 'OPTIMAL'
      ? true
      : deltaEasyHrBpm !== null && deltaEasyHrBpm >= 8 && deltaEfficiencyFactorPct !== null && deltaEfficiencyFactorPct <= -6);

  const trafficLight: SafeSportPatternWatchReport['trafficLight'] =
    hasActionRequired || medicalWatchCluster || maxPhvScore >= 2 || ferritinStatus === 'DEPLETED_UNDER_30'
      ? 'RED_MEDICAL_REVIEW'
      : signals.length >= 1
        ? 'AMBER_WATCH'
        : 'GREEN_CLEAR';

  const authorizedRecipients: SafeSportBiomarkerAlertRecipient[] = ['ATHLETE_SELF'];
  if (isMinorU18 || hasParentGuardianCc) {
    authorizedRecipients.push('PARENT_GUARDIAN_CC');
  }
  if (hasAthleticTrainer || trafficLight === 'RED_MEDICAL_REVIEW') {
    authorizedRecipients.push('ATHLETIC_TRAINER_MEDICAL');
  }

  let headline = 'Autonomic, Aerobic Efficiency & Growth-Plate Markers Clear';
  let athleteGuidance =
    '14-day cardiac efficiency, recovery HR, and growth-plate status sit cleanly inside your personal baseline (zero weight tracking).';
  let coachSafeSummaryLabel = 'Clear — Normal Training Progression';

  if (trafficLight === 'RED_MEDICAL_REVIEW') {
    headline = 'Medical / AT Review Recommended · Non-Weight Biomarker Shift';
    athleteGuidance =
      'Multiple non-weight endurance & tissue signals shifted beneath baseline. Pause high-density spiked work and coordinate privately with your healthcare provider / Athletic Trainer.';
    coachSafeSummaryLabel =
      'AT / Medical Review & Load Modification Recommended (Zero-Weight Private Signal)';
  } else if (trafficLight === 'AMBER_WATCH') {
    headline = 'Early Non-Weight Pattern Watch · Monitor Recovery & Fueling';
    athleteGuidance =
      'One early cardiac, iron, or growth-plate signal stepped outside baseline. Emphasize 8.5h+ sleep, post-run carbohydrate/protein intake, and daily trainers.';
    coachSafeSummaryLabel =
      'Early Watch — Prioritize Recovery & Trainers Only (Zero-Weight Private Signal)';
  }

  const medicalRoutingSummary = isMinorU18
    ? `Private U18 Route: Athlete Self${hasParentGuardianCc ? ' + Parent/Guardian CC' : ''}${authorizedRecipients.includes('ATHLETIC_TRAINER_MEDICAL') ? ' + Certified Athletic Trainer' : ''} (weight, BMI & W/kg strictly excluded).`
    : authorizedRecipients.includes('ATHLETIC_TRAINER_MEDICAL')
      ? 'Private Athlete + Athletic Trainer / Medical Staff (weight, BMI & W/kg strictly excluded).'
      : 'Private Athlete Only (solo adult — weight, BMI & W/kg strictly excluded).';

  return {
    evaluatedAtIso: new Date().toISOString(),
    windowRecentDays: 14,
    windowBaselineDays,
    trafficLight,
    zeroWeightCompliant: true,
    isMinorU18,
    deltaEasyHrBpm,
    chronotropicBluntingDetected,
    deltaEfficiencyFactorPct,
    deltaHrr60Bpm,
    ferritinStatus,
    phvGrowthPlateFlag,
    signals,
    headline,
    athleteGuidance,
    medicalRoutingSummary,
    authorizedRecipients,
    coachSafeSummaryLabel,
  };
}
