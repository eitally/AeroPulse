import type { SportCategory, TrackTargetEventGroup } from '../../types';
import {
  ENDURANCE_PLAN_ARCHETYPES,
  type EndurancePlanArchetypeId,
} from '../../physiology/cyclingPrescriptionEngine';

import type { AllTrackFieldArchetypeId } from '../../physiology/allEventsPlanEngine';

export type TrackArchetypeId =
  | 'TRACK_800M'
  | 'TRACK_1500_MILE'
  | 'TRACK_3000_3200M'
  | 'TRACK_5000M'
  | AllTrackFieldArchetypeId;

export type GoalArchetypeId = TrackArchetypeId | EndurancePlanArchetypeId;

export type GoalArchetypeCategory = 'ALL' | 'CYCLING' | 'ROAD' | 'TRACK' | 'SWIM_TRI';

export interface GoalArchetypeTemplate {
  id: GoalArchetypeId;
  category: Exclude<GoalArchetypeCategory, 'ALL'>;
  badge: string;
  title: string;
  subtitle: string;
  sportCategory: SportCategory;
  targetLabel: string;
  defaultWeeks: 4 | 8 | 12 | 16;
  trackEventGroup?: TrackTargetEventGroup;
  targetProgressionLevels: [number, number, number, number, number, number];
}

export const TRACK_ARCHETYPES: GoalArchetypeTemplate[] = [
  {
    id: 'TRACK_800M',
    category: 'TRACK',
    badge: 'Track · 800m',
    title: '800m Track Specialization',
    subtitle: 'Speed-Reserve Flys, Critical Velocity & Specific 300m Rhythm',
    sportCategory: 'Running',
    targetLabel: "CS+D' · ASR Peak",
    defaultWeeks: 12,
    trackEventGroup: '800M',
    targetProgressionLevels: [6.8, 7.6, 8.2, 8.8, 9.2, 9.5],
  },
  {
    id: 'TRACK_1500_MILE',
    category: 'TRACK',
    badge: 'Track · 1500m / Mile',
    title: '1500m / Mile Track Architect',
    subtitle: 'Sub-T Cruises, Tinman CV & Un-Clamped R-Pace Quarter Repeats',
    sportCategory: 'Running',
    targetLabel: '400m R-Pace + CV',
    defaultWeeks: 12,
    trackEventGroup: '1500_MILE',
    targetProgressionLevels: [7.4, 7.9, 8.5, 9.0, 8.8, 8.2],
  },
  {
    id: 'TRACK_3000_3200M',
    category: 'TRACK',
    badge: 'Track · 3000m / 3200m',
    title: '3000m / 3200m Championship Build',
    subtitle: 'Norwegian Sub-T Volume, CV Progressions & VO2max Economy',
    sportCategory: 'Running',
    targetLabel: 'Sub-T · CV · 3K I',
    defaultWeeks: 12,
    trackEventGroup: '3000_3200M',
    targetProgressionLevels: [8.0, 8.4, 8.8, 9.1, 7.8, 6.8],
  },
  {
    id: 'TRACK_5000M',
    category: 'TRACK',
    badge: 'Track · 5000m',
    title: '5000m Track Endurance Peak',
    subtitle: 'Sub-T 1000m Density, 1200m CV Grinders & 5K Race Control',
    sportCategory: 'Running',
    targetLabel: 'High Sub-T + 5K I',
    defaultWeeks: 16,
    trackEventGroup: '5000M',
    targetProgressionLevels: [8.6, 8.8, 9.0, 8.9, 7.2, 6.2],
  },
  {
    id: 'TRACK_SPRINTS',
    category: 'TRACK',
    badge: 'Track · Sprints (100m / 200m / 400m)',
    title: 'Sprints & 4×100m / 4×400m Speed Build',
    subtitle: 'Block Acceleration, Fly-30m MaxV, Wickets & Relay Handoff Progression',
    sportCategory: 'Running',
    targetLabel: 'Blocks · Fly 30m · SE',
    defaultWeeks: 12,
    targetProgressionLevels: [6.0, 6.8, 7.6, 8.4, 8.8, 9.2],
  },
  {
    id: 'TRACK_HURDLES',
    category: 'TRACK',
    badge: 'Track · Hurdles (100H / 110H / 300H)',
    title: 'Hurdles Rhythm & Stride Pattern Peak',
    subtitle: '3-Step Lead/Trail Attack, 300mH Curve Rhythm & Speed Maintenance',
    sportCategory: 'Running',
    targetLabel: '3-Step · 300H · Fast Leg',
    defaultWeeks: 12,
    targetProgressionLevels: [6.2, 7.0, 7.8, 8.5, 8.9, 9.1],
  },
  {
    id: 'TRACK_JUMPS_PV',
    category: 'TRACK',
    badge: 'Field · Jumps & Pole Vault',
    title: 'Runway Approach, Jumps & Pole Vault Progression',
    subtitle: 'Board Accuracy, Short-Run Plant/Vaults & Elastic Tendon Prehab',
    sportCategory: 'Running',
    targetLabel: 'Runway · Plant · Elasticity',
    defaultWeeks: 12,
    targetProgressionLevels: [6.0, 6.7, 7.4, 8.0, 8.3, 8.6],
  },
  {
    id: 'TRACK_THROWS',
    category: 'TRACK',
    badge: 'Field · Shot, Discus & Javelin',
    title: 'Throws Power Ring & Contrast Peak',
    subtitle: 'Standing/Full Ring Tech, Heavy/Light Implement Contrast & Shoulder Care',
    sportCategory: 'Running',
    targetLabel: 'Stands · Full Ring · Contrast',
    defaultWeeks: 12,
    targetProgressionLevels: [6.0, 6.6, 7.3, 7.9, 8.2, 8.5],
  },
  {
    id: 'TRACK_MULTI',
    category: 'TRACK',
    badge: 'Combined · Pent / Hept / Dec',
    title: 'Multi-Events Balanced Track & Field Peak',
    subtitle: 'Sequenced Hurdles + Jumps + Throws + Closing 800m/1500m Durability',
    sportCategory: 'Running',
    targetLabel: 'Hurdles · Jumps · Throws · 800/1500',
    defaultWeeks: 12,
    targetProgressionLevels: [6.5, 7.2, 7.9, 8.5, 8.7, 8.9],
  },
];

export const ALL_GOAL_ARCHETYPES: GoalArchetypeTemplate[] = [
  ...ENDURANCE_PLAN_ARCHETYPES.map((a) => ({ ...a })),
  ...TRACK_ARCHETYPES,
];

export const WEEKDAY_CHIPS = [
  { offset: 0, label: 'Mon' },
  { offset: 1, label: 'Tue' },
  { offset: 2, label: 'Wed' },
  { offset: 3, label: 'Thu' },
  { offset: 4, label: 'Fri' },
  { offset: 5, label: 'Sat' },
  { offset: 6, label: 'Sun' },
] as const;
