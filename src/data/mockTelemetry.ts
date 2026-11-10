import {
  AnnualMileageGoal,
  CoachChatMessage,
  PowerPaceCurvePoint,
} from '../types';

const CURRENT_YEAR = new Date().getFullYear();

export const INITIAL_ANNUAL_MILEAGE_GOALS: AnnualMileageGoal[] = [
  {
    sportCategory: 'Running',
    year: CURRENT_YEAR,
    targetDistanceMeters: 0,
  },
  {
    sportCategory: 'Cycling',
    year: CURRENT_YEAR,
    targetDistanceMeters: 0,
  },
];

export const INITIAL_POWER_PACE_CURVES: PowerPaceCurvePoint[] = [];

export const INITIAL_CHAT_MESSAGES: CoachChatMessage[] = [
  {
    id: 'msg-welcome',
    role: 'assistant',
    content:
      'Welcome to **Thresh AI Coach**. Connect Garmin Connect, Intervals.icu, or upload `.FIT` / `.GPX` files to calibrate your morning readiness, Banister CTL/ATL/TSB load model, and structured daily prescriptions.',
    timestamp: 'Ready',
    citedMetrics: [],
  },
];
