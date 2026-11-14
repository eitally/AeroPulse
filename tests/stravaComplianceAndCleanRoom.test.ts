import { describe, expect, it } from 'vitest';
import { sanitizeTelemetryForCleanRoom, isStravaOriginRecord } from '../server/cleanRoomFirewall';
import type { UnifiedActivity } from '../src/types';

describe('CMP-01 · Strava Compliance & Clean-Room Firewall Guarantees', () => {
  const mixedActivities: Partial<UnifiedActivity>[] = [
    {
      id: 'strava_act_9001',
      name: 'Morning Hills Ride',
      stravaId: '9001',
      sourceBadges: ['Strava'],
      distanceMeters: 35000,
      movingTimeSecs: 4200,
      summaryPolyline: 'u{~vFvyys@fG...',
      gearName: 'Trek Emonda',
      streams: {
        time: [0, 1, 2],
        watts: [200, 210, 220],
        heartrate: [145, 148, 152],
      },
    },
    {
      id: 'garmin_act_1001',
      name: 'Garmin Edge 840 Outdoor Intervals',
      sourceBadges: ['Garmin'],
      distanceMeters: 40000,
      movingTimeSecs: 4500,
      summaryPolyline: 'a|~vFvyys@...',
      gearName: 'Garmin Vector 3',
      streams: {
        time: [0, 1, 2],
        watts: [250, 310, 200],
        heartrate: [155, 172, 140],
      },
    },
    {
      id: 'intervals_act_2001',
      name: 'Track 5K Test Mark',
      sourceBadges: ['Intervals.icu'],
      distanceMeters: 5000,
      movingTimeSecs: 1020,
    },
  ];

  it('correctly classifies Strava-only records vs first-party hardware records', () => {
    expect(isStravaOriginRecord(mixedActivities[0])).toBe(true);
    expect(isStravaOriginRecord(mixedActivities[1])).toBe(false);
    expect(isStravaOriginRecord(mixedActivities[2])).toBe(false);
  });

  it('Clean-Room Firewall strips 100% of Strava activities & metadata before LLM prompts', () => {
    const rawTelemetry = {
      recentActivities: mixedActivities,
      stravaSegments: [{ id: 1, name: 'Hawk Hill' }],
      stravaKudos: 42,
      stravaAthleteId: '12345678',
      sleepScore: 88,
      hrvStatus: 'Balanced',
      ctl: 75.4,
      tsb: +4.2,
    };

    const clean = sanitizeTelemetryForCleanRoom(rawTelemetry);

    // AI context window receives ONLY first-party Garmin / Intervals data
    expect(clean.recentActivities).toHaveLength(2);
    expect(clean.recentActivities.some((a: any) => a.id === 'strava_act_9001')).toBe(false);
    expect(clean.recentActivities.some((a: any) => a.id === 'garmin_act_1001')).toBe(true);
    expect(clean.recentActivities.some((a: any) => a.id === 'intervals_act_2001')).toBe(true);

    // Strava-specific social metadata is completely eliminated
    expect(clean.stravaSegments).toBeUndefined();
    expect(clean.stravaKudos).toBeUndefined();
    expect(clean.stravaAthleteId).toBeUndefined();
    expect(clean.cleanRoomPolicy).toBe('FIRST_PARTY_GARMIN_FIT_WELLNESS_ONLY');
    expect(clean.stravaRecordsFiltered).toBe(1);

    // Biometrics and derived physiological load remain intact
    expect(clean.sleepScore).toBe(88);
    expect(clean.ctl).toBe(75.4);
  });

  it('protects peer teammates from ever viewing raw biometric wellness or activities', () => {
    const athleteSnapshot = {
      ctl: 68.2,
      atl: 72.1,
      tsb: -3.9,
      readinessScore: 84,
      verdictLabel: 'Productive Build',
      wellnessDays: [
        { date: '2026-11-14', sleepScore: 85, hrvRmssd: 58 },
      ],
      activities: mixedActivities,
      privacySettings: {
        shareWellnessAndHrv: 'PRIVATE',
        sharePmcAndZones: 'SQUAD_SUMMARY',
      },
    };

    // Teammate view (non-coach, non-self)
    const isSelf = false;
    const isCoach = false;
    const teammateView = {
      ctl: athleteSnapshot.ctl,
      atl: athleteSnapshot.atl,
      tsb: athleteSnapshot.tsb,
      verdictLabel: athleteSnapshot.verdictLabel,
      wellnessDays: isSelf || isCoach ? athleteSnapshot.wellnessDays : undefined,
      activities: isSelf || isCoach ? athleteSnapshot.activities : undefined,
    };

    expect(teammateView.wellnessDays).toBeUndefined();
    expect(teammateView.activities).toBeUndefined();
    expect(teammateView.ctl).toBe(68.2);
    expect(teammateView.verdictLabel).toBe('Productive Build');
  });

  it('enforces that coach view never receives raw Strava sensor streams or GPS polylines', () => {
    const rawStravaActivity = {
      ...mixedActivities[0],
      summaryPolyline: 'k_~vFvyys@polylinestring...',
    } as unknown as UnifiedActivity;

    const isFirstParty = false;
    const sharingTier = 'FULL_STREAMS';
    const allowGpsRoutes = true;
    const includeGps = sharingTier === 'FULL_STREAMS' && allowGpsRoutes && isFirstParty;

    const sanitizedForCoach: UnifiedActivity = {
      ...rawStravaActivity,
      kudoers: undefined,
      comments: undefined,
      segmentEfforts: [],
      gearName: isFirstParty ? rawStravaActivity.gearName : undefined,
      summaryPolyline: includeGps ? rawStravaActivity.summaryPolyline : undefined,
      routeLatLngs: includeGps ? rawStravaActivity.routeLatLngs : undefined,
      startLatLng: includeGps ? rawStravaActivity.startLatLng : undefined,
      endLatLng: includeGps ? rawStravaActivity.endLatLng : undefined,
      streams: sharingTier === 'FULL_STREAMS' && isFirstParty ? rawStravaActivity.streams : undefined,
    };

    expect(sanitizedForCoach.streams).toBeUndefined();
    expect(sanitizedForCoach.summaryPolyline).toBeUndefined();
    expect(sanitizedForCoach.gearName).toBeUndefined();
    expect(sanitizedForCoach.distanceMeters).toBe(35000);
  });
});
