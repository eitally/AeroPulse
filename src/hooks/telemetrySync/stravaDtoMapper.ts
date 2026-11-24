import React from 'react';
import type {
  AthleteGearItem,
  AthleteProfile,
  ConnectionStatus,
  DistanceUnit,
  PlannedWorkoutEvent,
  TeamSummaryWithRole,
  ThreshUser,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../../types';
import {
  type ServerConfigStatusResponse,
  type StravaTokenHandshakePayload,
  decodeGooglePolylineClient,
  reclassifyActivityEnvironment,
} from '../../utils/telemetryStorage';
import { hasSessionActiveHint } from '../../utils/sessionHint';

export function hasStravaClientCredentials(): boolean {
  try {
    const notLoggedOut = localStorage.getItem('aeropulse_logged_out') !== '1';
    return Boolean(
      notLoggedOut &&
        (hasSessionActiveHint() ||
          localStorage.getItem('aeropulse_strava_access_token') ||
          localStorage.getItem('aeropulse_strava_refresh_token'))
    );
  } catch {
    return false;
  }
}

export type CompleteStravaAuthFn = (opts: {
  tokens?: StravaTokenHandshakePayload;
  sessionToken?: string;
  hasExistingSyncPolicy?: boolean;
}) => Promise<void>;

export interface WearablesServerConfigStatusResponse extends ServerConfigStatusResponse {
  garminConfigured?: boolean;
  garminAuthMethod?: 'OAUTH' | 'PERSONAL_KEY' | 'NONE';
  garminCanPushWorkouts?: boolean;
  intervalsScope?: string;
  intervalsCanWriteCalendar?: boolean;
  corosConfigured?: boolean;
  corosConnected?: boolean;
  corosAthleteId?: string;
  corosAthleteName?: string;
}

export interface StravaSyncActivityDto {
  stravaId: string | number;
  startDateLocal: string;
  startDateUtcMs?: number;
  name: string;
  sportCategory: UnifiedActivity['sportCategory'];
  rawSportType?: string;
  environment: UnifiedActivity['environment'];
  subType?: UnifiedActivity['subType'];
  movingTimeSecs: number;
  distanceMeters: number;
  elevationGainMeters: number;
  avgPower?: number;
  normalizedPower?: number;
  deviceWatts?: boolean;
  intensityFactor?: number;
  variabilityIndex?: number;
  trainingLoad?: number;
  loadModelVersion?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  avgPaceSecsPerKm?: number;
  efficiencyFactor?: number;
  gearName?: string;
  stravaPrCount?: number;
  kudosCount?: number;
  commentCount?: number;
  achievementCount?: number;
  athleteCount?: number;
  hasKudoed?: boolean;
  kudoers?: UnifiedActivity['kudoers'];
  comments?: UnifiedActivity['comments'];
  summaryPolyline?: string;
  routeLatLngs?: [number, number][];
  startLatLng?: [number, number];
  endLatLng?: [number, number];
  segmentEfforts?: UnifiedActivity['segmentEfforts'];
}

export interface StravaSyncPayload {
  athleteId?: string;
  athleteName?: string;
  athleteProfile?: Partial<AthleteProfile>;
  hasMoreHistory?: boolean;
  nextBeforeEpoch?: number;
  rateLimitPaused?: boolean;
  syncPaused?: boolean;
  missingActivityScope?: boolean;
  stravaTokens?: StravaTokenHandshakePayload;
  gearItems?: AthleteGearItem[];
  redactedStravaCount?: number;
  activities?: StravaSyncActivityDto[];
}

export function toUnifiedFromStravaDto(sa: StravaSyncActivityDto): UnifiedActivity {
  const resolvedRoute =
    Array.isArray(sa.routeLatLngs) && sa.routeLatLngs.length >= 2
      ? sa.routeLatLngs
      : decodeGooglePolylineClient(sa.summaryPolyline);
  return reclassifyActivityEnvironment({
    id: `strava-${sa.stravaId}`,
    stravaId: String(sa.stravaId),
    startDateLocal: sa.startDateLocal,
    ...(typeof sa.startDateUtcMs === 'number' ? { startDateUtcMs: sa.startDateUtcMs } : {}),
    name: sa.name,
    sportCategory: sa.sportCategory,
    rawSportType: sa.rawSportType,
    environment: sa.environment,
    subType: sa.subType || (sa.environment === 'INDOOR' ? 'Smart Trainer' : 'Road'),
    movingTimeSecs: sa.movingTimeSecs,
    distanceMeters: sa.distanceMeters,
    elevationGainMeters: sa.elevationGainMeters,
    avgPower: sa.avgPower,
    normalizedPower: sa.normalizedPower,
    deviceWatts: sa.deviceWatts,
    intensityFactor: sa.intensityFactor,
    trainingLoad: sa.trainingLoad ?? 0,
    loadModelVersion: sa.loadModelVersion,
    avgHr: sa.avgHr || 0,
    maxHr: sa.maxHr || 0,
    avgCadence: sa.avgCadence,
    avgPaceSecsPerKm: sa.avgPaceSecsPerKm,
    gapPaceSecsPerKm: sa.avgPaceSecsPerKm,
    aerobicDecouplingPct: 0,
    efficiencyFactor: sa.efficiencyFactor || 0,
    firstHalfEf: 0,
    secondHalfEf: 0,
    zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
    gearName: sa.gearName,
    stravaPrCount: sa.stravaPrCount || 0,
    kudosCount: sa.kudosCount || 0,
    commentCount: sa.commentCount || 0,
    achievementCount: sa.achievementCount || 0,
    athleteCount: sa.athleteCount || 1,
    hasKudoed: Boolean(sa.hasKudoed),
    kudoers: Array.isArray(sa.kudoers) ? sa.kudoers : [],
    comments: Array.isArray(sa.comments) ? sa.comments : [],
    summaryPolyline: sa.summaryPolyline,
    routeLatLngs: resolvedRoute,
    startLatLng: sa.startLatLng,
    endLatLng: sa.endLatLng,
    segmentEfforts: sa.segmentEfforts || [],
    sourceBadges: ['Strava'],
  });
}

export interface UseTelemetrySyncParams {
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  setActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  wellnessDaysRef: React.MutableRefObject<UnifiedWellnessDay[]>;
  setWellnessDays: React.Dispatch<React.SetStateAction<UnifiedWellnessDay[]>>;
  plannedEventsRef: React.MutableRefObject<PlannedWorkoutEvent[]>;
  setPlannedEvents: React.Dispatch<React.SetStateAction<PlannedWorkoutEvent[]>>;
  gearItemsRef: React.MutableRefObject<AthleteGearItem[]>;
  setGearItems: React.Dispatch<React.SetStateAction<AthleteGearItem[]>>;
  redactedStravaCountRef: React.MutableRefObject<number>;
  setRedactedStravaCount: React.Dispatch<React.SetStateAction<number>>;
  athleteProfileRef: React.MutableRefObject<AthleteProfile>;
  setAthleteProfile: React.Dispatch<React.SetStateAction<AthleteProfile>>;
  setConnectionStatus: React.Dispatch<React.SetStateAction<ConnectionStatus>>;
  setCurrentUser: React.Dispatch<React.SetStateAction<ThreshUser | null>>;
  setDistanceUnit: (unit: DistanceUnit) => void;
  setIdbSavedAt: (val: string | null) => void;
  setIsSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  setSyncError: React.Dispatch<React.SetStateAction<string | null>>;
  setMyTeams: React.Dispatch<React.SetStateAction<TeamSummaryWithRole[]>>;
  setActiveTeamId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveViewedAthleteId: React.Dispatch<React.SetStateAction<string>>;
  idbHydratedRef: React.MutableRefObject<boolean>;
  hasEnteredWorkspace: boolean;
  hasEnteredWorkspaceRef: React.MutableRefObject<boolean>;
  setHasEnteredWorkspace: (val: boolean) => void;
  isSessionLoggedOut: boolean;
  setIsSessionLoggedOut: (val: boolean) => void;
  isSampleDemoMode: boolean;
  completeStravaAuthHandshakeRef: React.MutableRefObject<CompleteStravaAuthFn | null>;
}

export const AUTH_ERROR_LABELS: Record<string, string> = {
  invalid_state_csrf: 'Security verification timed out. Please try signing in again.',
  google_not_configured: 'Google Sign-In is not configured on this server yet.',
  google_token_exchange_failed: 'Google sign-in could not complete token exchange. Check redirect URI configuration.',
  google_userinfo_failed: 'Google sign-in succeeded, but reading your Google profile failed.',
  expired_or_invalid_magic_token: 'That sign-in link has expired or was already used. Request a fresh link.',
  missing_magic_token: 'Missing magic sign-in token.',
  missing_code: 'Authorization code was missing from the provider redirect.',
  internal_error: 'Sign-in hit a temporary server error. Please try again.',
};
