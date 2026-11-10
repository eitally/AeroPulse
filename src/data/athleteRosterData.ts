import {
  AthletePrivacySettings,
  ConnectedAthleteRecord,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';
import { buildCompleteAthleteProfile } from '../utils/telemetryStorage';

export const DEFAULT_SELF_PRIVACY_SETTINGS: AthletePrivacySettings = {
  shareWellnessAndHrv: 'COACHES_ONLY',
  sharePmcAndZones: 'ALL_CONNECTIONS',
  shareGpsRoutes: 'COACHES_ONLY',
  stravaComplianceShield: true,
  allowCoachCalendarEdits: true,
};

/**
 * Returns an empty roster by default (zero fictional seeded athletes).
 */
export function buildInitialConnectedAthletes(): ConnectedAthleteRecord[] {
  return [];
}

/**
 * Builds a clean, unfabricated roster connection placeholder when inviting an athlete by code or name.
 */
export function createConnectedAthleteRecord(
  query: string,
  role: 'COACH_EDIT' | 'FRIEND_VIEW',
  specialty: 'Running' | 'Cycling'
): ConnectedAthleteRecord {
  const clean = query.trim();
  const initials =
    clean
      .replace(/^TH-\d+-/i, '')
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('')
      .slice(0, 2) || 'AT';

  const isInviteCode = /^(TH|AP)-\d+/i.test(clean);
  const inviteCode = isInviteCode
    ? clean.toUpperCase().replace(/^AP-/, 'TH-')
    : `TH-${Math.floor(1000 + Math.random() * 8999)}-${initials}`;

  return {
    id: `athlete-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: isInviteCode ? `Athlete (${inviteCode})` : clean,
    avatarInitials: initials,
    location: 'Connected via Thresh Invite',
    stravaAthleteId: '',
    inviteCode,
    role,
    status: 'CONNECTED',
    primarySport: specialty,
    primaryGoalSummary: 'Awaiting synced telemetry',
    athleteProfile: buildCompleteAthleteProfile(null),
    privacySettings: { ...DEFAULT_SELF_PRIVACY_SETTINGS },
    wellnessDays: [],
    activities: [],
    plannedEvents: [],
    targetGoals: [],
  };
}

/**
 * Checks whether an activity originated from Strava and is therefore restricted from
 * cross-athlete comparison or coaching feeds under the Strava API Agreement.
 */
export function isStravaSourcedActivity(activity: UnifiedActivity): boolean {
  if (!activity) return false;
  if (activity.stravaId && !activity.intervalsId) return true;
  if (
    Array.isArray(activity.sourceBadges) &&
    activity.sourceBadges.includes('Strava') &&
    !activity.sourceBadges.includes('Garmin') &&
    !activity.sourceBadges.includes('Intervals.icu')
  ) {
    return true;
  }
  return false;
}

/**
 * Applies the athlete's granular Privacy Settings & Strava API Clean-Room Shield
 * based on whether the viewer has 'COACH_EDIT' or 'FRIEND_VIEW' access.
 * Strictly strips Strava-only activities from cross-athlete views.
 */
export function applyAthletePrivacyShield(record: ConnectedAthleteRecord): {
  wellnessDays: UnifiedWellnessDay[];
  activities: UnifiedActivity[];
  redactedWellness: boolean;
  redactedGpsRoutes: boolean;
} {
  const isCoach = record.role === 'COACH_EDIT';
  const p = record.privacySettings;

  const allowWellness =
    p.shareWellnessAndHrv === 'ALL_CONNECTIONS' ||
    (p.shareWellnessAndHrv === 'COACHES_ONLY' && isCoach);

  const allowGps =
    p.shareGpsRoutes === 'ALL_CONNECTIONS' ||
    (p.shareGpsRoutes === 'COACHES_ONLY' && isCoach);

  const filteredWellness = record.wellnessDays.map((w) => {
    if (allowWellness) return w;
    return {
      ...w,
      hrvRMSSD: 0,
      restingHR: 0,
      sleepScore: 0,
      sleepSecs: 0,
    };
  });

  const nonStravaActivities = record.activities.filter((a) => !isStravaSourcedActivity(a));

  const filteredActivities = nonStravaActivities.map((a) => {
    if (allowGps) return a;
    return {
      ...a,
      routeLatLngs: undefined,
      summaryPolyline: undefined,
      streams: a.streams
        ? {
            ...a.streams,
            latlng: undefined,
          }
        : undefined,
    };
  });

  return {
    wellnessDays: filteredWellness,
    activities: filteredActivities,
    redactedWellness: !allowWellness,
    redactedGpsRoutes: !allowGps,
  };
}
