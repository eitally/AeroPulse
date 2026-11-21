import type { PlannedWorkoutEvent, TrackSeasonPhase } from '../types';
import type { GeneratedTrackWeekPlan } from './trackPrescriptionEngine';

export type AllTrackFieldArchetypeId =
  | 'TRACK_SPRINTS'
  | 'TRACK_HURDLES'
  | 'TRACK_JUMPS_PV'
  | 'TRACK_THROWS'
  | 'TRACK_MULTI';

function addUtcDaysIso(baseIso: string, addDays: number): string {
  const [y, m, d] = baseIso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 3) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + addDays);
  return dt.toISOString().slice(0, 10);
}

interface DayBlueprint {
  name: string;
  durationSecs: number;
  load: number;
  syntax: string;
  description: string;
}

const ARCHETYPE_WEEKLY_SESSIONS: Record<AllTrackFieldArchetypeId, DayBlueprint[]> = {
  TRACK_SPRINTS: [
    {
      name: 'Accel & Blocks (10m–40m)',
      durationSecs: 3000,
      load: 64,
      syntax: 'Warmup\n- 15m Sprint Prep\n\nMain Set 1\n- 6x30m @ 98% Blocks (4m walk)\n\nCooldown\n- 10m Core',
      description: 'Short-zone block clearance + projection angle speed.',
    },
    {
      name: 'Max-Velocity Wickets + Fly 30s',
      durationSecs: 3000,
      load: 66,
      syntax: 'Warmup\n- 15m Wicket Runs\n\nMain Set 1\n- 5x30m @ 99% Flying Zone (5m rest)\n\nCooldown\n- 10m Grass Walk',
      description: 'Top-end upright mechanics with full neural recovery.',
    },
    {
      name: 'Tempo Rhythm (100m/200m Grass)',
      durationSecs: 2400,
      load: 44,
      syntax: 'Warmup\n- 10m Jog\n\nMain Set 1\n- 8x100m @ 72% Extensive Tempo (60s walk)\n\nCooldown\n- 10m Mobility',
      description: 'Relaxed extensive capillary work on soft turf — protects hamstrings.',
    },
    {
      name: 'Speed Endurance & Relays (150m/200m)',
      durationSecs: 3300,
      load: 74,
      syntax: 'Warmup\n- 15m Prep + Relay Handoffs\n\nMain Set 1\n- 3x150m @ 94% Speed End. (8m rest)\n\nCooldown\n- 10m Rollout',
      description: '4x100/200m exchange timing plus late-race posture hold.',
    },
  ],
  TRACK_HURDLES: [
    {
      name: 'Block Starts Over 3–5 Hurdles',
      durationSecs: 3000,
      load: 68,
      syntax: 'Warmup\n- 15m Hip Walkovers\n\nMain Set 1\n- 6x50m @ 95% 4-Hurdle Rhythm (4m rest)\n\nCooldown\n- 10m Band Reset',
      description: '8-step approach to H1 and crisp 3-step attack.',
    },
    {
      name: '300mH / 400mH Stride Pattern',
      durationSecs: 3300,
      load: 76,
      syntax: 'Warmup\n- 15m Prep\n\nMain Set 1\n- 3x200m @ 92% Curve Hurdles (6m rest)\n\nCooldown\n- 10m Core',
      description: 'Alternate-leg fluency and curve clearance under speed.',
    },
    {
      name: 'Grass Tempo + Mobility',
      durationSecs: 2400,
      load: 42,
      syntax: 'Warmup\n- 10m Easy\n\nMain Set 1\n- 6x120m @ 74% Grass Strides (60s rest)\n\nCooldown\n- 12m Hurdle Mobility',
      description: 'Low-impact trail-leg mobility & flush between hurdle days.',
    },
    {
      name: 'Speed Mechanics & Relay Work',
      durationSecs: 3000,
      load: 66,
      syntax: 'Warmup\n- 15m Wickets\n\nMain Set 1\n- 4x60m @ 96% Fast Leg (4m rest)\n\nCooldown\n- 10m Recovery',
      description: 'Between-hurdle sprinting velocity without extra barrier fatigue.',
    },
  ],
  TRACK_JUMPS_PV: [
    {
      name: 'Full-Approach Runway / Vault Checks',
      durationSecs: 3600,
      load: 66,
      syntax: 'Warmup\n- 15m Runway Drills\n\nMain Set 1\n- 8x40m Approach Marks & Takeoffs (4m rest)\n\nCooldown\n- 10m Achilles & Core',
      description: 'Consistent penultimate step and active plant/board strike.',
    },
    {
      name: 'Bounding, Depth Jumps & Bar Clearance',
      durationSecs: 3300,
      load: 64,
      syntax: 'Warmup\n- 15m Skip Series\n\nMain Set 1\n- 6x40m Bar / Sand Pit Session (3m rest)\n\nCooldown\n- 10m Thoracic Stretch',
      description: 'Elastic vertical impulse & bar rotation drills.',
    },
    {
      name: 'Sprint Mechanics + Tendon Prehab',
      durationSecs: 2400,
      load: 46,
      syntax: 'Warmup\n- 10m Mobility\n\nMain Set 1\n- 4x30m Flys + Isometric Calf Holds\n\nCooldown\n- 10m Foam Roll',
      description: 'Runway speed maintenance with patellar/achilles isometrics.',
    },
    {
      name: 'Short-Approach Tech + Strength',
      durationSecs: 3000,
      load: 58,
      syntax: 'Warmup\n- 15m Prep\n\nMain Set 1\n- 6x30m 6-Step Short-Run Vaults/Jumps (3m rest)\n\nCooldown\n- 10m Core',
      description: 'High-rep rhythm technical refinement from controlled run.',
    },
  ],
  TRACK_THROWS: [
    {
      name: 'Power Stands + Full Ring Throws (Shot/Disc)',
      durationSecs: 3600,
      load: 58,
      syntax: 'Warmup\n- 15m Shoulder Activation\n\nMain Set 1\n- 15 Standing + 12 Full Ring Throws\n\nCooldown\n- 10m Rotator Care',
      description: 'Hip-to-shoulder separation + reverse block mechanics.',
    },
    {
      name: 'Med-Ball Explosives + Oly Lift',
      durationSecs: 3300,
      load: 68,
      syntax: 'Warmup\n- 15m Dynamic\n\nMain Set 1\n- 12 Med-Ball Slams + 5x3 Clean Pulls\n\nCooldown\n- 10m Posterior Stretch',
      description: 'Rate-of-force production paired with light explosive pulls.',
    },
    {
      name: 'Heavy/Light Implement Contrast',
      durationSecs: 3600,
      load: 62,
      syntax: 'Warmup\n- 15m Arm Circles\n\nMain Set 1\n- 10 Overweight + 12 Competition Throws\n\nCooldown\n- 10m Wrist/Elbow Mobility',
      description: 'Transfer overweight feel immediately to competition weight speed.',
    },
    {
      name: 'Sprint Accel (20m) + Sector Accuracy',
      durationSecs: 2700,
      load: 50,
      syntax: 'Warmup\n- 12m Warmup\n\nMain Set 1\n- 4x20m Starts + 12 Rhythm Throws\n\nCooldown\n- 10m Flush',
      description: 'Light CNS speed + sector discipline pre-meet.',
    },
  ],
  TRACK_MULTI: [
    {
      name: 'Hurdles + High Jump Runway Combo',
      durationSecs: 3600,
      load: 68,
      syntax: 'Warmup\n- 15m Hurdle Walkovers\n\nMain Set 1\n- 5x50m Hurdle Rhythm + 6x30m Curve Pop-Ups\n\nCooldown\n- 10m Mobility',
      description: 'Sequence hurdles cleanly ahead of curve takeoff timing.',
    },
    {
      name: 'Long Jump Marks + Shot / Javelin Block',
      durationSecs: 3600,
      load: 64,
      syntax: 'Warmup\n- 15m Prep\n\nMain Set 1\n- 6 LJ Marks + 15 Comp Throws\n\nCooldown\n- 10m Shoulder Care',
      description: 'Technical Day-1 / Day-2 multi simulation.',
    },
    {
      name: 'Extensive 200m Tempo & Core',
      durationSecs: 2700,
      load: 52,
      syntax: 'Warmup\n- 10m Jog\n\nMain Set 1\n- 5x200m @ 76% Rhythm Tempo (90s walk)\n\nCooldown\n- 10m Core',
      description: '800m/1500m multi-event durability without sore legs.',
    },
    {
      name: 'Sprint Blocks + Pole Vault / Throws Polish',
      durationSecs: 3300,
      load: 62,
      syntax: 'Warmup\n- 15m Sprint Drills\n\nMain Set 1\n- 4x40m Blocks + 6x20m Short-Run PV/Jav\n\nCooldown\n- 10m Recovery',
      description: 'Meet-ready sharp speed and short-approach confidence.',
    },
  ],
};

function resolvePhaseForWeek(
  weekNum: number,
  totalWeeks: number
): { phaseKey: TrackSeasonPhase; phaseLabel: string; isDeload: boolean; isTaper: boolean } {
  if (weekNum === totalWeeks) {
    return { phaseKey: 'PEAK_TAPER', phaseLabel: 'Peak / Championship', isDeload: false, isTaper: true };
  }
  const isDeload = weekNum % 4 === 0 && weekNum < totalWeeks;
  const pct = weekNum / totalWeeks;
  if (pct <= 0.35) {
    return { phaseKey: 'BASE', phaseLabel: isDeload ? 'Base Deload (-30%)' : 'Speed & Tech Foundation', isDeload, isTaper: false };
  }
  if (pct <= 0.7) {
    return { phaseKey: 'STRENGTH_CV', phaseLabel: isDeload ? 'Mid-Season Deload (-30%)' : 'Event Specific Power', isDeload, isTaper: false };
  }
  return { phaseKey: 'SPECIFIC', phaseLabel: isDeload ? 'Pre-Champs Freshener' : 'Meet Speed Sharpening', isDeload, isTaper: false };
}

export function generateAllEventsTrackPlan(params: {
  archetypeId: AllTrackFieldArchetypeId;
  startDateIso: string;
  blockWeeks: 4 | 8 | 12 | 16;
  selectedWeekdays?: number[];
}): GeneratedTrackWeekPlan[] {
  const days = (params.selectedWeekdays && params.selectedWeekdays.length > 0
    ? params.selectedWeekdays
    : [0, 1, 3, 4]
  ).slice(0, 4);
  const templates = ARCHETYPE_WEEKLY_SESSIONS[params.archetypeId];
  const weeks: GeneratedTrackWeekPlan[] = [];

  for (let w = 1; w <= params.blockWeeks; w++) {
    const weekStartIso = addUtcDaysIso(params.startDateIso, (w - 1) * 7);
    const meta = resolvePhaseForWeek(w, params.blockWeeks);
    const loadScale = meta.isTaper ? 0.55 : meta.isDeload ? 0.72 : Math.min(1.12, 0.88 + w * 0.02);

    let weekTss = 0;
    let weekDurationSecs = 0;
    const sessions: PlannedWorkoutEvent[] = days.map((offset, idx) => {
      const bp = templates[idx % templates.length];
      const scaledDuration = Math.round((bp.durationSecs * (meta.isTaper ? 0.7 : 1)) / 60) * 60;
      const scaledLoad = Math.round(bp.load * loadScale);
      weekTss += scaledLoad;
      weekDurationSecs += scaledDuration;
      return {
        id: `alltf-${params.archetypeId.toLowerCase()}-w${w}-d${offset}-${Date.now().toString(36)}-${idx}`,
        date: addUtcDaysIso(weekStartIso, offset),
        name: `Wk${w} · ${bp.name}`,
        sportCategory: 'Running',
        environmentPreference: 'OUTDOOR',
        targetZoneSummary: `${meta.phaseLabel} · ${bp.name}`,
        plannedDurationSecs: scaledDuration,
        plannedLoad: scaledLoad,
        workoutSyntax: bp.syntax,
        description: `${meta.phaseLabel} — ${bp.description}`,
      };
    });

    weeks.push({
      weekNum: w,
      startDate: weekStartIso,
      phaseKey: meta.phaseKey,
      phaseLabel: meta.phaseLabel,
      isDeload: meta.isDeload,
      isTaper: meta.isTaper,
      targetHours: Number((weekDurationSecs / 3600).toFixed(1)),
      targetTss: weekTss,
      targetDistanceKm: Number((weekTss * 0.12).toFixed(1)),
      ambitiousGoalWarning: false,
      zoneDistributionPct: [55, 5, 5, 5, 5, 25],
      sessions,
    });
  }

  return weeks;
}
