import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { resetAiRateLimitsForTesting } from '../server/secretManager.ts';
import {
  SESSION_COOKIE_NAME,
  deriveUserSessionSid,
  issueSessionToken,
} from '../server/securityUtils.ts';
import {
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  syncAthleteSnapshotAcrossTeams,
} from '../server/teamService.ts';
import { updateMyTeamSharingTier } from '../server/teamLifecycleService.ts';
import { findOrCreateUser } from '../server/authService.ts';
import {
  formatMorphRunLabel,
  formatOneHzHint,
  formatOptimalTunnelLabel,
  formatOrthoChannelLabel,
  formatVerdictLabel,
} from '../src/utils/plainLanguage.ts';
import {
  clearAllUserBrowserStorage,
  DEVICE_PREFERENCE_KEYS,
  STORAGE_KEYS,
} from '../src/utils/storageKeys.ts';
import { WORKOUT_STOPWATCH_PRESETS } from '../src/hooks/useTracksideStopwatch.ts';

describe('Sprint 1B: IA, Post-Join Team Privacy Tiers, Plain Language & Stopwatch Ergonomics (RT-14, RT-24, RT-25)', () => {
  let server: http.Server;
  let baseUrl = '';
  const originUrl = 'http://127.0.0.1:5173';

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    resetAiRateLimitsForTesting();
  });

  it('RT-14: allows adult team members to update post-join sharingTier via PATCH /api/teams/:teamId/members/me/sharing-tier and clears activities on LOAD_ONLY', async () => {
    const unique = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const coachUser = await findOrCreateUser('magic_link', `coach_tier_${unique}`, {
      email: `coach.tier.${unique}@example.com`,
      name: 'Coach Tier',
    });
    const coachSid = deriveUserSessionSid(coachUser.id);
    const created = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Tier Track ${unique}`,
      orgType: 'RUNNING_CLUB',
      primarySport: 'Running',
      coachDisplayName: 'Coach Tier',
    });
    const teamId = created.brand.teamId;

    const athleteUser = await findOrCreateUser('magic_link', `ath_tier_${unique}`, {
      email: `ath.tier.${unique}@example.com`,
      name: 'Adult Runner',
    });
    const athleteSid = deriveUserSessionSid(athleteUser.id);
    const athleteCookie = issueSessionToken(athleteUser.id, athleteSid, 'verified');

    await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl,
      codeOrSlug: created.brand.joinCode,
      athleteName: 'Adult Runner',
      birthMonthYear: '2000-04',
      sharingTier: 'FULL_STREAMS',
    });

    await syncAthleteSnapshotAcrossTeams({
      callerSid: athleteSid,
      athleteName: 'Adult Runner',
      originUrl,
      snapshot: {
        updatedAt: '2026-11-19T12:00:00.000Z',
        ctl: 48,
        atl: 44,
        tsb: 4,
        hasConnectedWatch: true,
        sharingTier: 'FULL_STREAMS',
        activities: [
          {
            id: 'act-1',
            startDateLocal: '2026-11-18T08:00:00',
            name: '10 Mile Tempo',
            sportCategory: 'Running',
            environment: 'OUTDOOR',
            subType: 'Road',
            movingTimeSecs: 3800,
            distanceMeters: 16093,
            elevationGainMeters: 45,
            trainingLoad: 92,
            avgHr: 165,
            maxHr: 181,
            aerobicDecouplingPct: 2.1,
            efficiencyFactor: 1.54,
            firstHalfEf: 1.55,
            secondHalfEf: 1.52,
            zoneSecs: { hr: [300, 1200, 1300, 900, 100, 0, 0] },
            stravaPrCount: 0,
            segmentEfforts: [],
            sourceBadges: ['Garmin'],
          },
        ],
      },
    });

    // Unauthenticated request rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/teams/${teamId}/members/me/sharing-tier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharingTier: 'LOAD_ONLY' }),
    });
    expect(unauthRes.status).toBe(401);

    // Invalid tier rejected with 400
    const badTierRes = await fetch(`${baseUrl}/api/teams/${teamId}/members/me/sharing-tier`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${athleteCookie}`,
      },
      body: JSON.stringify({ sharingTier: 'UNLIMITED' }),
    });
    expect(badTierRes.status).toBe(400);

    // Downgrade to LOAD_ONLY -> immediately clears activities from liveSnapshot
    const downgradeRes = await fetch(`${baseUrl}/api/teams/${teamId}/members/me/sharing-tier`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${athleteCookie}`,
      },
      body: JSON.stringify({ sharingTier: 'LOAD_ONLY' }),
    });
    expect(downgradeRes.status).toBe(200);
    const downgradeJson = await downgradeRes.json();
    expect(downgradeJson.ok).toBe(true);
    const mineDowngraded = downgradeJson.team.memberships.find(
      (m: { membershipId: string }) => m.membershipId === downgradeJson.team.myMembershipId
    );
    expect(mineDowngraded.sharingTier).toBe('LOAD_ONLY');
    expect(mineDowngraded.liveSnapshot.activities).toEqual([]);

    // Persisted upgrade to SUMMARY_ONLY
    const upgradeRes = await fetch(`${baseUrl}/api/teams/${teamId}/members/me/sharing-tier`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${athleteCookie}`,
      },
      body: JSON.stringify({ sharingTier: 'SUMMARY_ONLY' }),
    });
    expect(upgradeRes.status).toBe(200);
    const listed = await listTeamsForUser(athleteSid, originUrl);
    const persistedMine = listed[0]?.memberships.find(
      (m) => m.membershipId === listed[0]?.myMembershipId
    );
    expect(persistedMine?.sharingTier).toBe('SUMMARY_ONLY');
  });

  it('RT-14 & RT-08: blocks minors with PENDING guardian consent from raising sharingTier above LOAD_ONLY and rejects non-members', async () => {
    const unique = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const coachSid = deriveUserSessionSid(`usr_coach_${unique}`);
    const hsTeam = await createTeamForCoach({
      callerSid: coachSid,
      originUrl,
      name: `Minor Guard HS ${unique}`,
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
      coachDisplayName: 'Coach Guard',
    });

    const minorYear = new Date().getFullYear() - 15;
    const minorSid = deriveUserSessionSid(`usr_minor_${unique}`);
    await claimTeamJoinInvite({
      callerSid: minorSid,
      originUrl,
      codeOrSlug: hsTeam.brand.joinCode,
      athleteName: 'Maya U18',
      birthMonthYear: `${minorYear}-02`,
      parentGuardianEmail: `parent.${unique}@example.com`,
      sharingTier: 'FULL_STREAMS',
    });

    const blockedUpgrade = await updateMyTeamSharingTier({
      callerSid: minorSid,
      teamId: hsTeam.brand.teamId,
      sharingTier: 'SUMMARY_ONLY',
      originUrl,
    });
    expect(blockedUpgrade.ok).toBe(false);
    expect(blockedUpgrade.error).toMatch(/parent\/guardian consent/i);

    const stayLoadOnly = await updateMyTeamSharingTier({
      callerSid: minorSid,
      teamId: hsTeam.brand.teamId,
      sharingTier: 'LOAD_ONLY',
      originUrl,
    });
    expect(stayLoadOnly.ok).toBe(true);

    const nonMemberRes = await updateMyTeamSharingTier({
      callerSid: deriveUserSessionSid(`usr_stranger_${unique}`),
      teamId: hsTeam.brand.teamId,
      sharingTier: 'LOAD_ONLY',
      originUrl,
    });
    expect(nonMemberRes.ok).toBe(false);
  });

  it('RT-24 & RT-25: translates plain-language labels, ships 4x800 stopwatch preset, and preserves device preferences across sign-out wipe', () => {
    expect(formatVerdictLabel('Polarization Deficit', true)).toBe('Too Much Medium-Hard Effort');
    expect(formatVerdictLabel('Polarization Deficit', false)).toBe('Polarization Deficit');
    expect(formatOptimalTunnelLabel(true)).toBe('Healthy Weekly Range');
    expect(formatOrthoChannelLabel(2, true)).toContain('Leg & Joint Impact · Running');
    expect(formatMorphRunLabel(70, true)).toContain('Swap Run to Easy 70m Bike / Cross-Train');
    expect(formatOneHzHint(true)).toContain('second-by-second pace');

    const fourByEight = WORKOUT_STOPWATCH_PRESETS.find((p) => p.id === '4x800');
    expect(fourByEight).toBeTruthy();
    expect(fourByEight?.repCount).toBe(4);
    expect(fourByEight?.repDistanceMeters).toBe(800);

    expect(DEVICE_PREFERENCE_KEYS.has(STORAGE_KEYS.PLAIN_LANGUAGE)).toBe(true);
    expect(DEVICE_PREFERENCE_KEYS.has(STORAGE_KEYS.STOPWATCH_SHORTCUTS)).toBe(true);

    const store = new Map<string, string>([
      [STORAGE_KEYS.PLAIN_LANGUAGE, '1'],
      [STORAGE_KEYS.STOPWATCH_SHORTCUTS, '0'],
      [STORAGE_KEYS.SESSION_TOKEN, 'secret-token'],
    ]);
    const mockStorage = {
      get length() {
        return store.size;
      },
      key(i: number) {
        return Array.from(store.keys())[i] ?? null;
      },
      getItem(k: string) {
        return store.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        store.set(k, v);
      },
      removeItem(k: string) {
        store.delete(k);
      },
      clear() {
        store.clear();
      },
    };
    const prevLocal = (globalThis as { localStorage?: Storage }).localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockStorage,
      configurable: true,
    });
    try {
      clearAllUserBrowserStorage();
      expect(store.get(STORAGE_KEYS.PLAIN_LANGUAGE)).toBe('1');
      expect(store.get(STORAGE_KEYS.STOPWATCH_SHORTCUTS)).toBe('0');
      expect(store.has(STORAGE_KEYS.SESSION_TOKEN)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        value: prevLocal,
        configurable: true,
      });
    }

    // Ensure Stopwatch suppresses MobileDock & Footer and separates Progress from Today
    const dockSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/MobileDock.tsx'),
      'utf8'
    );
    expect(dockSrc).toContain("activeTab === 'stopwatch'");
    const headerSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/CockpitHeader.tsx'),
      'utf8'
    );
    expect(headerSrc).toContain('hidden xl:inline-flex items-center gap-1 rounded-xl liquid-capsule-track');
    expect(headerSrc).not.toContain('>1:1<');
  });
});
