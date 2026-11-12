import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_TEAM_PALETTE_PRESETS,
  buildFreeNativeSmsUri,
  calibrateThresholdsFromSeedMark,
  computeAccessibleTeamPalette,
  contrastRatio,
  getOrgTypeSafeguardingDefaults,
  parseBulkRosterCsvOrText,
} from '../src/physiology/teamOnboardingEngine';
import {
  generateQrCodeSvgMarkup,
  generateQrMatrix,
} from '../src/utils/teamQrHelper';
import {
  broadcastWorkoutToTeamSquad,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  previewTeamJoinInvite,
  requestEmailOtpCode,
  syncAthleteSnapshotAcrossTeams,
  verifyEmailOtpCode,
} from '../server/teamService';

describe('Team Onboarding, Custom Branding, Resend Bulk Invites & Safeguarding', () => {
  const originalResendKey = process.env.RESEND_API_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    if (originalResendKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalResendKey;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('automatically enables Safe-Sport Weight Shield and Parent/Guardian CC for High School teams', () => {
    const hs = getOrgTypeSafeguardingDefaults('HIGH_SCHOOL');
    expect(hs.defaultSafeSportShield).toBe(true);
    expect(hs.enableParentGuardianCc).toBe(true);

    const college = getOrgTypeSafeguardingDefaults('COLLEGIATE');
    expect(college.defaultSafeSportShield).toBe(true);
    expect(college.enableParentGuardianCc).toBe(false);

    const veloClub = getOrgTypeSafeguardingDefaults('CYCLING_CLUB');
    expect(veloClub.defaultSafeSportShield).toBe(false);
    expect(veloClub.enableParentGuardianCc).toBe(false);
  });

  it('clamps extreme school colors to WCAG 2.1 AA >= 4.5:1 on both Light (#FFFFFF/#E9EFE9) and Dark (#15231B/#121419) surfaces plus button foregrounds', () => {
    // Bright athletic yellow (#FACC15) fails raw contrast on white; dark navy (#0A192F) fails on matte carbon
    const extreme = computeAccessibleTeamPalette('#FACC15', '#0A192F');
    expect(contrastRatio(extreme.primaryOnLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(extreme.primaryOnLight, '#E9EFE9')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(extreme.primaryOnDark, '#15231B')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(extreme.primaryOnDark, '#121419')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(extreme.secondaryOnLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(extreme.secondaryOnDark, '#15231B')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(extreme.primaryOnLight, extreme.textOnPrimaryLight)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(extreme.primaryOnDark, extreme.textOnPrimaryDark)).toBeGreaterThanOrEqual(4.5);

    for (const preset of CURATED_TEAM_PALETTE_PRESETS) {
      const p = computeAccessibleTeamPalette(preset.primaryHex, preset.secondaryHex);
      expect(contrastRatio(p.primaryOnLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.primaryOnDark, '#15231B')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.primaryOnLight, p.textOnPrimaryLight)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.primaryOnDark, p.textOnPrimaryDark)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('parses CSV, Google Sheets TSV, and contact lists with Parent CC, phone normalization, and U18 flags', () => {
    const csv = [
      'Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark',
      'Maya Chen, maya@paly.edu, (650) 555-0142, Varsity, 2028, parent.chen@family.org, 18:10 5K',
      ' Jordan Brooks , jordan@paly.edu , 415-555-0199 , Junior Varsity , 29 , , 5:18 1600m',
    ].join('\n');

    const rows = parseBulkRosterCsvOrText(csv, 'HIGH_SCHOOL', 'Varsity');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      invitedName: 'Maya Chen',
      invitedEmail: 'maya@paly.edu',
      invitedPhone: '+16505550142',
      squadGroup: 'Varsity',
      graduationYear: 2028,
      parentGuardianEmail: 'parent.chen@family.org',
      seedMarkOrFtp: '18:10 5K',
      isMinorU18: true,
    });
    expect(rows[1].graduationYear).toBe(2029);
    expect(rows[1].squadGroup).toBe('Junior Varsity');

    // Angle-bracket email paste format
    const contactPaste = 'Alex Rivera <alex.rivera@club.org>\nsam.taylor@club.org';
    const clubRows = parseBulkRosterCsvOrText(contactPaste, 'RUNNING_CLUB', 'Track Group');
    expect(clubRows).toHaveLength(2);
    expect(clubRows[0].invitedName).toBe('Alex Rivera');
    expect(clubRows[1].invitedName).toBe('Sam Taylor');
    expect(clubRows[0].isMinorU18).toBe(false);

    // Zero-cost native SMS link builder (no Twilio)
    const smsUri = buildFreeNativeSmsUri(
      '+16505550142',
      {
        name: 'Palo Alto High Varsity XC',
        joinCode: 'PALY-26',
        coachDisplayName: 'Rivera',
      },
      'https://thresh.app/join/paly-xc?t=abc123',
      'Maya'
    );
    expect(smsUri.startsWith('sms:+16505550142?&body=')).toBe(true);
    expect(decodeURIComponent(smsUri)).toContain('PALY-26');
  });

  it('calibrates beginner VDOT running pace & cycling FTP from natural-language race marks', () => {
    const fiveK = calibrateThresholdsFromSeedMark('17:30 5K', 'Running', 'mi');
    expect(fiveK.vdotEstimate).toBeGreaterThan(54);
    expect(fiveK.vdotEstimate).toBeLessThan(62);
    expect(fiveK.thresholdPaceSecsPerKm).toBeGreaterThan(210);
    expect(fiveK.thresholdPaceSecsPerKm).toBeLessThan(260);

    const twentyMinBike = calibrateThresholdsFromSeedMark('20m 300W', 'Cycling', 'mi');
    expect(twentyMinBike.cyclingFtpWatts).toBe(285);
  });

  it('generates valid ISO 18004 QR matrices with intact 7x7 finder corners for locker-room posters', () => {
    const matrix = generateQrMatrix('https://thresh.app/join/palo-alto-xc');
    expect(matrix.length).toBeGreaterThanOrEqual(25);
    // Top-left 7x7 outer ring corners + 3x3 center module must be dark
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][6]).toBe(true);
    expect(matrix[6][0]).toBe(true);
    expect(matrix[3][3]).toBe(true);
    expect(matrix[1][1]).toBe(false);

    const svg = generateQrCodeSvgMarkup('https://thresh.app/join/palo-alto-xc', '#14532D');
    expect(svg).toContain('<svg');
    expect(svg).toContain('#14532D');
  });

  it('supports full Resend invite dispatch with Parent CC, Multi-Team membership, Squad Broadcasts, and Clean-Room / Safe-Sport snapshot sync', async () => {
    const coachSid = crypto.randomBytes(16).toString('hex');
    const athleteSid = crypto.randomBytes(16).toString('hex');
    const originUrl = 'https://thresh.app';

    // 1. Coach creates a High School team (safeguarding defaults omitted -> must default ON)
    const hsTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Gunn High XC ${crypto.randomInt(100, 999)}`,
      shortName: 'GUNN XC',
      orgType: 'HIGH_SCHOOL',
      primaryHex: '#991B1B',
      secondaryHex: '#1E293B',
      coachDisplayName: 'Coach Lee',
    });

    expect(hsTeam.brand.defaultSafeSportShield).toBe(true);
    expect(hsTeam.brand.enableParentGuardianCc).toBe(true);
    expect(hsTeam.myRole).toBe('HEAD_COACH');

    // 2. Configure mock Resend REST API and send bulk roster invite with Parent CC
    process.env.RESEND_API_KEY = 're_mock_live_key_123';
    const resendBodies: Array<Record<string, any>> = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.body) {
        resendBodies.push(JSON.parse(String(init.body)));
      }
      return new Response(JSON.stringify({ id: 're_msg_001' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const bulkResult = await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: hsTeam.brand.teamId,
      originUrl,
      rawCsvOrText: [
        'Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark',
        'Elena Vance, elena.vance@gunn.edu, 650-555-0177, Varsity, 2028, guardian.vance@family.com, 18:40 5K',
      ].join('\n'),
    });

    expect(bulkResult.addedCount).toBe(1);
    expect(bulkResult.emailedCount).toBe(1);
    expect(resendBodies).toHaveLength(1);
    expect(resendBodies[0].to).toEqual(['elena.vance@gunn.edu']);
    expect(resendBodies[0].cc).toEqual(['guardian.vance@family.com']);
    expect(resendBodies[0].html).toContain('Safe-Sport');

    const invitedMember = bulkResult.summary!.memberships.find(
      (m) => m.invitedEmail === 'elena.vance@gunn.edu'
    )!;
    expect(invitedMember.status).toBe('INVITED');
    expect(invitedMember.magicJoinUrl).toContain(`/join/${hsTeam.brand.slug}?t=`);

    // Extract personalized token from magicJoinUrl
    const tokenParam = new URL(invitedMember.magicJoinUrl!).searchParams.get('t')!;

    // 3. Athlete opens link -> funnel transitions INVITED -> OPENED
    const preview = await previewTeamJoinInvite(hsTeam.brand.slug, tokenParam);
    expect(preview.found).toBe(true);
    expect(preview.membership?.invitedName).toBe('Elena Vance');
    expect(preview.membership?.seedMarkOrFtp).toBe('18:40 5K');

    const afterOpenCoachView = (await listTeamsForUser(coachSid, originUrl)).find(
      (t) => t.brand.teamId === hsTeam.brand.teamId
    )!;
    expect(afterOpenCoachView.openedCount).toBeGreaterThanOrEqual(2); // Coach + Elena

    // 4. Athlete claims HS team AND also joins an off-season Running Club (Multi-Team!)
    const claimHs = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl,
      codeOrSlug: hsTeam.brand.slug,
      inviteToken: tokenParam,
      athleteName: 'Elena Vance',
    });
    expect(claimHs.ok).toBe(true);
    expect(claimHs.safeSportShieldEnforced).toBe(true);

    const clubTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Peninsula Distance Club ${crypto.randomInt(100, 999)}`,
      shortName: 'PDC',
      orgType: 'RUNNING_CLUB',
      coachDisplayName: 'Coach Marco',
    });
    expect(clubTeam.brand.defaultSafeSportShield).toBe(false);

    const claimClub = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl,
      codeOrSlug: clubTeam.brand.joinCode,
      athleteName: 'Elena Vance',
    });
    expect(claimClub.ok).toBe(true);

    const athleteTeams = await listTeamsForUser(athleteSid, originUrl);
    expect(athleteTeams).toHaveLength(2);

    // 5. Coach broadcasts workout to Varsity squad
    const afterBroadcast = await broadcastWorkoutToTeamSquad({
      callerSid: coachSid,
      teamId: hsTeam.brand.teamId,
      originUrl,
      targetSquadGroup: 'Varsity',
      date: '2026-11-12',
      name: '5x1000m @ CV Pace',
      sportCategory: 'Running',
      plannedDurationSecs: 3300,
      plannedLoad: 72,
      workoutSyntax: '- 5x 4m 100% Pace',
      description: 'Stay relaxed through 600m.',
    });
    expect(afterBroadcast?.broadcastWorkouts).toHaveLength(1);

    // 6. Athlete syncs snapshot with 1 Garmin run + 1 Strava-only run + weightKg
    await syncAthleteSnapshotAcrossTeams({
      callerSid: athleteSid,
      originUrl,
      athleteName: 'Elena Vance',
      snapshot: {
        hasConnectedWatch: true,
        verdictLabel: 'Productive · Balanced',
        readinessScore: 88,
        ctl: 51,
        atl: 54,
        tsb: -3,
        acuteLoad7d: 340,
        lowAerobicPct: 76,
        highAerobicPct: 18,
        neuromuscularPct: 6,
        caraHours7d: 7.2,
        ftpWatts: 245,
        thresholdPaceSecsPerKm: 232,
        safeSportHideWeight: false,
        wellnessDays: [
          {
            date: '2026-11-11',
            ctl: 51,
            atl: 54,
            tsb: -3,
            rampRate: 3.1,
            dailyLoad: 62,
            restingHR: 49,
            hrvRMSSD: 68,
            hrvBaseline7d: 64,
            hrvStatus: 'Balanced',
            sleepSecs: 29500,
            sleepScore: 87,
            readinessStatus: 'Optimal',
            weightKg: 54.5,
          },
        ],
        activities: [
          {
            id: 'garmin-101',
            name: 'Morning Baylands Progression',
            sportCategory: 'Running',
            environment: 'OUTDOOR',
            startDateLocal: '2026-11-11T07:00:00Z',
            movingTimeSecs: 2800,
            distanceMeters: 10000,
            elevationGainMeters: 42,
            trainingLoad: 62,
            sourceBadges: ['GARMIN'],
          } as any,
          {
            id: 'strava-999',
            stravaId: '999999',
            name: 'Private Strava Commute',
            sportCategory: 'Cycling',
            environment: 'OUTDOOR',
            startDateLocal: '2026-11-10T17:00:00Z',
            movingTimeSecs: 1500,
            distanceMeters: 8000,
            elevationGainMeters: 30,
            trainingLoad: 25,
            sourceBadges: ['STRAVA'],
          } as any,
        ],
      },
    });

    const coachTeamsAfterSync = await listTeamsForUser(coachSid, originUrl);
    const hsCoachView = coachTeamsAfterSync.find(
      (t) => t.brand.teamId === hsTeam.brand.teamId
    )!;
    const syncedElenaHs = hsCoachView.memberships.find(
      (m) => m.invitedName === 'Elena Vance'
    )!;

    // Clean-Room Firewall must strip Strava-only activity; Garmin activity stays
    expect(syncedElenaHs.liveSnapshot?.activities).toHaveLength(1);
    expect(syncedElenaHs.liveSnapshot?.activities?.[0].id).toBe('garmin-101');
    // High School Safe-Sport Shield must mask weightKg on wellnessDays!
    expect(syncedElenaHs.liveSnapshot?.safeSportHideWeight).toBe(true);
    expect(syncedElenaHs.liveSnapshot?.wellnessDays?.[0].weightKg).toBe(0);
  });

  it('issues and verifies 6-digit cross-device Email OTP codes via Resend and auto-links pending invites', async () => {
    delete process.env.RESEND_API_KEY;
    const uniqueEmail = `runner.${crypto.randomInt(1000, 9999)}@college.edu`;

    const otpReq = await requestEmailOtpCode(uniqueEmail);
    expect(otpReq.ok).toBe(true);
    expect(otpReq.devPreviewCode).toMatch(/^\d{6}$/);

    const badVerify = await verifyEmailOtpCode(uniqueEmail, '000000');
    expect(badVerify.ok).toBe(false);

    const goodVerify = await verifyEmailOtpCode(uniqueEmail, otpReq.devPreviewCode!);
    expect(goodVerify.ok).toBe(true);
    expect(goodVerify.sid).toMatch(/^[a-f0-9]{32}$/);
  });
});
