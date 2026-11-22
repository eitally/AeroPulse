import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { evaluateSafeSportPatternWatch } from '../src/physiology/safeSportPatternWatchEngine';
import {
  sanitizeTelemetryForCleanRoom,
  stripSafeSportWeightAndBodyCompFields,
} from '../server/cleanRoomFirewall';
import {
  acknowledgeParentConsent,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  syncAthleteSnapshotAcrossTeams,
} from '../server/teamService';
import type { UnifiedActivity, UnifiedWellnessDay } from '../src/types';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function makeEasyRun(dateIso: string, avgHr: number, distanceMeters = 8000, movingTimeSecs = 2400): UnifiedActivity {
  return {
    id: `easy-${dateIso}`,
    startDateLocal: `${dateIso}T07:30:00Z`,
    name: 'Morning Easy Aerobic Run',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Road',
    movingTimeSecs,
    distanceMeters,
    elevationGainMeters: 25,
    trainingLoad: 44,
    avgHr,
    maxHr: avgHr + 15,
    aerobicDecouplingPct: 2.5,
    efficiencyFactor: Number(((distanceMeters / (movingTimeSecs / 60)) / avgHr).toFixed(3)),
    firstHalfEf: 1.4,
    secondHalfEf: 1.38,
    zoneSecs: { hr: [200, 1800, 400, 0, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
  };
}

function makeHardTrackSession(
  dateIso: string,
  maxHr: number,
  workPeakHr: number,
  recHr: number
): UnifiedActivity {
  return {
    id: `hard-${dateIso}`,
    startDateLocal: `${dateIso}T15:30:00Z`,
    name: 'Track Intervals 5x1000m',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs: 2600,
    distanceMeters: 9500,
    elevationGainMeters: 10,
    trainingLoad: 78,
    avgHr: maxHr - 18,
    maxHr,
    aerobicDecouplingPct: 1.8,
    efficiencyFactor: 1.5,
    firstHalfEf: 1.52,
    secondHalfEf: 1.48,
    zoneSecs: { hr: [100, 900, 600, 500, 400, 100, 0] },
    intervals: [
      { id: 'w1', label: '1000m Work', type: 'WORK', startTimeSecs: 600, durationSecs: 200, distanceMeters: 1000, avgHr: workPeakHr, maxHr: workPeakHr },
      { id: 'r1', label: '90s Rec', type: 'RECOVERY', startTimeSecs: 800, durationSecs: 90, distanceMeters: 200, avgHr: recHr },
    ],
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Garmin'],
  };
}

describe('TRK-12: Ethical U18 RED-S / Iron / PHV Early Pattern Watch & Zero-Weight Shielding', () => {
  it('flags longitudinal HR drift, chronotropic blunting, EF drop, HRR60 drop, low ferritin, and PHV soreness with private U18 routing', () => {
    const baselineActs: UnifiedActivity[] = [
      makeEasyRun('2026-10-10', 142, 8200, 2400),
      makeEasyRun('2026-10-14', 143, 8200, 2400),
      makeHardTrackSession('2026-10-17', 194, 192, 146), // HRR60 drop = 46 bpm
    ];
    const recentActs: UnifiedActivity[] = [
      makeEasyRun('2026-11-05', 153, 7600, 2400), // +10.5 bpm HR drift & ~13% EF drop
      makeEasyRun('2026-11-09', 154, 7600, 2400),
      makeHardTrackSession('2026-11-10', 184, 182, 148), // -10 bpm maxHR blunting & HRR60 drop = 34 (-12 bpm)
    ];
    const wellness: UnifiedWellnessDay[] = [
      {
        date: '2026-11-11',
        ctl: 48,
        atl: 62,
        tsb: -14,
        rampRate: 3.0,
        dailyLoad: 60,
        restingHR: 53,
        hrvRMSSD: 55,
        hrvBaseline7d: 64,
        hrvStatus: 'Low',
        sleepSecs: 27000,
        sleepScore: 76,
        readinessStatus: 'Strain',
        weightKg: 0,
      },
    ];

    const report = evaluateSafeSportPatternWatch({
      activities: [...baselineActs, ...recentActs],
      wellnessDays: wellness,
      checkIn: {
        date: '2026-11-11',
        academicStress: 3,
        shinMetatarsalSoreness: 0,
        achillesTendonSoreness: 0,
        kneeGrowthPlateSoreness: 2,
        heelApophysisSoreness: 0,
        sleepHours: 7.5,
        energyFeel: 'FLAT',
        ferritinNgMl: 24,
      },
      isMinorU18: true,
      hasParentGuardianCc: true,
      hasAthleticTrainer: true,
      referenceDateIso: '2026-11-12',
    });

    expect(report.zeroWeightCompliant).toBe(true);
    expect(report.trafficLight).toBe('RED_MEDICAL_REVIEW');
    expect(report.deltaEasyHrBpm).toBeGreaterThanOrEqual(8);
    expect(report.chronotropicBluntingDetected).toBe(true);
    expect(report.deltaEfficiencyFactorPct).toBeLessThanOrEqual(-6);
    expect(report.deltaHrr60Bpm).toBeLessThanOrEqual(-6);
    expect(report.ferritinStatus).toBe('DEPLETED_UNDER_30');
    expect(report.phvGrowthPlateFlag).toBe(true);

    const signalIds = report.signals.map((s) => s.signalId);
    expect(signalIds).toEqual(
      expect.arrayContaining([
        'EASY_HR_DRIFT_ELEVATED',
        'CHRONOTROPIC_BLUNTING',
        'EFFICIENCY_FACTOR_DECAY',
        'HRR60_PARASYMPATHETIC_DROP',
        'SERUM_FERRITIN_LOW',
        'PHV_GROWTH_PLATE_SORENESS',
      ])
    );

    expect(report.authorizedRecipients).toEqual(
      expect.arrayContaining(['ATHLETE_SELF', 'PARENT_GUARDIAN_CC', 'ATHLETIC_TRAINER_MEDICAL'])
    );
    expect(report.coachSafeSummaryLabel).not.toMatch(/\b(?:bmi|kg|lbs)\b|\d+\s*kg/i);
  });

  it('recursively strips weight, BMI, body-fat and W/kg fields via cleanRoomFirewall', () => {
    const raw = {
      name: 'HS Runner',
      weightKg: 53.2,
      bmi: 18.4,
      avgWattsPerKg: 4.1,
      nested: {
        weightLbs: 117,
        bodyFatPct: 12.5,
        wKg: 4.1,
        thresholdPaceSecsPerKm: 230,
      },
      wellnessDays: [
        { date: '2026-11-11', weightKg: 53.2, bmi: 18.4, hrvRMSSD: 64 },
      ],
    };

    const coachMasked = stripSafeSportWeightAndBodyCompFields(raw, {
      maskWellnessWeightKgZero: true,
    }) as Record<string, any>;
    expect(coachMasked.weightKg).toBeUndefined();
    expect(coachMasked.bmi).toBeUndefined();
    expect(coachMasked.avgWattsPerKg).toBeUndefined();
    expect(coachMasked.nested.weightLbs).toBeUndefined();
    expect(coachMasked.nested.bodyFatPct).toBeUndefined();
    expect(coachMasked.nested.wKg).toBeUndefined();
    expect(coachMasked.nested.thresholdPaceSecsPerKm).toBe(230);
    expect(coachMasked.wellnessDays[0].weightKg).toBe(0);
    expect(coachMasked.wellnessDays[0].bmi).toBeUndefined();

    const cleanRoomPayload = sanitizeTelemetryForCleanRoom({
      ...raw,
      isMinorU18: true,
    });
    expect(cleanRoomPayload.zeroWeightEnforced).toBe(true);
    expect(cleanRoomPayload.weightKg).toBeUndefined();
    expect(cleanRoomPayload.wellnessDays[0].weightKg).toBeUndefined();
    expect(cleanRoomPayload.wellnessDays[0].hrvRMSSD).toBe(64);
  });

  it('enforces Safe-Sport zero-weight stripping and teammate vs coach isolation in teamService', async () => {
    const originUrl = 'http://localhost:3000';
    const coachSid = `coach-ss-${crypto.randomUUID()}`;
    const athleteSid = `ath-ss-${crypto.randomUUID()}`;
    const peerSid = `peer-ss-${crypto.randomUUID()}`;

    const hsTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Baylands Prep XC ${crypto.randomInt(100, 999)}`,
      shortName: 'BPX',
      orgType: 'HIGH_SCHOOL',
      coachDisplayName: 'Coach Morales',
    });

    const prevResend = process.env.RESEND_API_KEY;
    const prevFetch = globalThis.fetch;
    let consentToken = '';
    process.env.RESEND_API_KEY = 're_test_trk12';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.resend.com/emails')) {
        const body = JSON.parse(String(init?.body || '{}')) as { html?: string };
        const m = body.html?.match(/\/api\/teams\/parent-consent\?token=([A-Za-z0-9_-]+)/);
        if (m?.[1]) consentToken = m[1];
        return new Response(JSON.stringify({ id: 'em_trk12' }), { status: 200 });
      }
      return prevFetch(input, init);
    }) as any;

    try {
      await claimTeamJoinInvite({
        callerSid: athleteSid,
        originUrl,
        codeOrSlug: hsTeam.brand.joinCode,
        athleteName: 'Lena Brooks',
        parentGuardianEmail: 'parent.lena@family.test',
      });
      await new Promise((r) => setTimeout(r, 20));
      if (consentToken) await acknowledgeParentConsent(consentToken);
      await claimTeamJoinInvite({
        callerSid: peerSid,
        originUrl,
        codeOrSlug: hsTeam.brand.joinCode,
        athleteName: 'Chris Park',
        parentGuardianEmail: 'parent.chris@family.test',
      });
    } finally {
      globalThis.fetch = prevFetch;
      if (prevResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevResend;
    }

    await syncAthleteSnapshotAcrossTeams({
      callerSid: athleteSid,
      originUrl,
      athleteName: 'Lena Brooks',
      snapshot: {
        hasConnectedWatch: true,
        verdictLabel: 'Watch',
        readinessScore: 72,
        ctl: 44,
        atl: 56,
        tsb: -12,
        acuteLoad7d: 310,
        lowAerobicPct: 78,
        highAerobicPct: 16,
        neuromuscularPct: 6,
        caraHours7d: 6.4,
        ftpWatts: 220,
        thresholdPaceSecsPerKm: 242,
        safeSportHideWeight: false,
        avgWattsPerKg: 3.9,
        bmi: 18.9,
        wellnessDays: [
          {
            date: daysAgoIso(1),
            ctl: 44,
            atl: 56,
            tsb: -12,
            rampRate: 2.2,
            dailyLoad: 58,
            restingHR: 52,
            hrvRMSSD: 58,
            hrvBaseline7d: 63,
            hrvStatus: 'Low',
            sleepSecs: 28000,
            sleepScore: 80,
            readinessStatus: 'Caution',
            weightKg: 54.0,
          },
        ],
        activities: [
          makeEasyRun(daysAgoIso(35), 144, 8000, 2400),
          makeEasyRun(daysAgoIso(4), 155, 7600, 2400),
          {
            ...makeEasyRun(daysAgoIso(3), 150, 5000, 1500),
            id: 'strava-leak',
            stravaId: '77777',
            sourceBadges: ['Strava'],
          },
        ],
      } as any,
    });

    const coachTeams = await listTeamsForUser(coachSid, originUrl);
    const coachView = coachTeams.find((t) => t.brand.teamId === hsTeam.brand.teamId)!;
    const lenaCoachRow = coachView.memberships.find((m) => m.invitedName === 'Lena Brooks')!;

    expect(lenaCoachRow.liveSnapshot?.safeSportHideWeight).toBe(true);
    expect(lenaCoachRow.liveSnapshot?.wellnessDays?.[0].weightKg).toBe(0);
    expect((lenaCoachRow.liveSnapshot as any).avgWattsPerKg).toBeUndefined();
    expect((lenaCoachRow.liveSnapshot as any).bmi).toBeUndefined();
    expect(lenaCoachRow.liveSnapshot?.activities?.some((a) => a.id === 'strava-leak')).toBe(false);
    // Coach only sees safe trafficLight + non-stigmatizing summary label (never detailed signals/recipients)
    expect(lenaCoachRow.liveSnapshot?.safeSportWatch?.trafficLight).toMatch(
      /AMBER_WATCH|RED_MEDICAL_REVIEW/
    );
    expect(lenaCoachRow.liveSnapshot?.safeSportWatch?.coachSafeSummaryLabel).toBeTruthy();
    expect(lenaCoachRow.liveSnapshot?.safeSportWatch?.privateAlertForSelfAndParentOnly).toBeUndefined();

    // Athlete self-view retains full private medical alert & recipient routing
    const selfTeams = await listTeamsForUser(athleteSid, originUrl);
    const selfView = selfTeams.find((t) => t.brand.teamId === hsTeam.brand.teamId)!;
    const lenaSelfRow = selfView.memberships.find((m) => m.invitedName === 'Lena Brooks')!;
    expect(
      lenaSelfRow.liveSnapshot?.safeSportWatch?.privateAlertForSelfAndParentOnly?.authorizedRecipients
    ).toEqual(expect.arrayContaining(['ATHLETE_SELF', 'ATHLETIC_TRAINER_MEDICAL']));

    // Teammate view must NOT expose Lena's private Safe-Sport biomarker watch or activities
    const peerTeams = await listTeamsForUser(peerSid, originUrl);
    const peerView = peerTeams.find((t) => t.brand.teamId === hsTeam.brand.teamId)!;
    const lenaPeerRow = peerView.memberships.find((m) => m.invitedName === 'Lena Brooks')!;
    expect(lenaPeerRow.liveSnapshot?.safeSportWatch).toBeUndefined();
    expect(lenaPeerRow.liveSnapshot?.activities).toBeUndefined();
  });
});
