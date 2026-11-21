import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COACH_EVENT_GROUP_OPTIONS,
  inferEventGroupFromSeedMark,
  normalizeCoachEventGroup,
  parseBulkRosterCsvOrText,
  sanitizeTargetEventGroups,
} from '../src/physiology/teamOnboardingEngine.ts';
import { parseExternalTeamRoster } from '../src/utils/athleticNetAndTfrrsEngine.ts';
import {
  acknowledgeParentConsent,
  bulkCreateAndSendInvites,
  claimTeamJoinInvite,
  createTeamForCoach,
} from '../server/teamService.ts';
import {
  issueOrResendParentConsentLink,
  removeTeamFromDirectoryAndVault,
  updateMemberRole,
  updateMemberRosterLifecycleStatus,
} from '../server/teamLifecycleService.ts';
import { readPersistedTracksideStopwatch } from '../src/hooks/useTracksideStopwatch.ts';
import { readInitialDaytimePalette } from '../src/utils/sundownThemeEngine.ts';

const ROOT = process.cwd();

describe('Spring Track Coach Pivot Wave 1', () => {
  const createdTeamIds: string[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
    }
  });

  it('orders CoachEventGroup with DISTANCE first, covers all 8 event groups, and infers hurdles before sprints', () => {
    expect(COACH_EVENT_GROUP_OPTIONS[0].id).toBe('DISTANCE');
    expect(COACH_EVENT_GROUP_OPTIONS.map((o) => o.id)).toEqual([
      'DISTANCE',
      'MID_DISTANCE',
      'SPRINTS',
      'HURDLES',
      'JUMPS',
      'POLE_VAULT',
      'THROWS',
      'MULTI',
    ]);

    expect(normalizeCoachEventGroup('xc')).toBe('DISTANCE');
    expect(normalizeCoachEventGroup('pv')).toBe('POLE_VAULT');
    expect(normalizeCoachEventGroup('Hurdles')).toBe('HURDLES');
    expect(normalizeCoachEventGroup('unknown-group')).toBeNull();
    expect(sanitizeTargetEventGroups(['dist', 'invalid', 'throws'])).toEqual([
      'DISTANCE',
      'THROWS',
    ]);

    expect(inferEventGroupFromSeedMark('15:42 5K')).toBe('DISTANCE');
    expect(inferEventGroupFromSeedMark('2:01 800m')).toBe('MID_DISTANCE');
    expect(inferEventGroupFromSeedMark('14.25 110mH')).toBe('HURDLES');
    expect(inferEventGroupFromSeedMark('400H 54.8')).toBe('HURDLES');
    expect(inferEventGroupFromSeedMark('21.9 200m')).toBe('SPRINTS');
    expect(inferEventGroupFromSeedMark("Pole Vault 15'6")).toBe('POLE_VAULT');
    expect(inferEventGroupFromSeedMark('Long Jump 22-4')).toBe('JUMPS');
    expect(inferEventGroupFromSeedMark('Discus 165-0')).toBe('THROWS');
    expect(inferEventGroupFromSeedMark('Decathlon 6420')).toBe('MULTI');
    expect(inferEventGroupFromSeedMark('')).toBeUndefined();
  });

  it('parses EventGroup & Gender columns in CSV import and avoids dumping untagged external imports into DISTANCE', () => {
    const csv = [
      'Name,Email,Squad,EventGroup,Gender,GradYear,Seed',
      'Maya Lin,maya@school.edu,Varsity,Distance,F,2027,18:12 5K',
      'Devon Brooks,devon@school.edu,Varsity,Hurdles,M,2026,39.4 300mH',
      'Avery Park,avery@school.edu,JV,Pole Vault,F,2028,',
    ].join('\n');

    const rows = parseBulkRosterCsvOrText(csv, 'HIGH_SCHOOL', 'Varsity');
    expect(rows).toHaveLength(3);
    expect(rows[0].eventGroup).toBe('DISTANCE');
    expect(rows[0].genderDivision).toBe('F');
    expect(rows[1].eventGroup).toBe('HURDLES');
    expect(rows[1].genderDivision).toBe('M');
    expect(rows[2].eventGroup).toBe('POLE_VAULT');
    expect(rows[2].genderDivision).toBe('F');

    const externalTabular = [
      'Name,Gender,Grade,Seed',
      'Jordan Taylor,M,11,',
      'Elena Cruz,F,12,17:55 5K',
    ].join('\n');
    const extParsed = parseExternalTeamRoster(externalTabular, {
      orgType: 'HIGH_SCHOOL',
      defaultSquad: 'Varsity',
    });
    expect(extParsed).toHaveLength(2);
    expect(extParsed[0].eventGroup).toBeUndefined();
    expect(extParsed[1].eventGroup).toBe('DISTANCE');
  });

  it('supports deferred parent email on minor HS join, coach consent-link issuance, and ATHLETIC_TRAINER status RBAC', async () => {
    const coachSid = `coach_${crypto.randomBytes(6).toString('hex')}`;
    const athleteSid = `ath_${crypto.randomBytes(6).toString('hex')}`;
    const trainerSid = `at_${crypto.randomBytes(6).toString('hex')}`;
    const currentYear = new Date().getFullYear();

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: 'https://thresh.fit',
      name: 'Willow Glen Track & Field',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });
    createdTeamIds.push(team.brand.teamId);

    const blockedJoin = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Sam Rivera',
      birthYear: currentYear - 16,
      deferParentEmail: false,
    });
    expect(blockedJoin.ok).toBe(false);
    expect(blockedJoin.error).toMatch(/Parent or guardian email/i);

    const deferredJoin = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Sam Rivera',
      birthYear: currentYear - 16,
      sharingTier: 'FULL_STREAMS',
      deferParentEmail: true,
    });
    expect(deferredJoin.ok).toBe(true);
    const athleteMem = deferredJoin.summary?.memberships.find((m) => m.invitedName === 'Sam Rivera');
    expect(athleteMem?.isMinorU18).toBe(true);
    expect(athleteMem?.parentConsentStatus).toBe('PENDING');
    expect(athleteMem?.sharingTier).toBe('LOAD_ONLY');
    expect(athleteMem?.liveSnapshot?.safeSportHideWeight).toBe(true);

    const linkRes = await issueOrResendParentConsentLink({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      membershipId: athleteMem!.membershipId,
      originUrl: 'https://thresh.fit',
    });
    expect(linkRes.ok).toBe(true);
    expect(linkRes.consentUrl).toContain('https://thresh.fit/api/teams/parent-consent?token=');

    const token = new URL(linkRes.consentUrl!).searchParams.get('token')!;
    const ackRes = await acknowledgeParentConsent(token);
    expect(ackRes.ok).toBe(true);

    // Promote an active member to ATHLETIC_TRAINER and verify ACTIVE/INJURED works while REVOKED/ALUMNI blocks
    const inviteTrainer = await bulkCreateAndSendInvites({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      originUrl: 'https://thresh.fit',
      rows: [
        {
          invitedName: 'Alex Morgan AT',
          invitedEmail: 'alex.at@school.edu',
          squadGroup: 'Medical',
          isMinorU18: false,
        },
      ],
    });
    expect(inviteTrainer.addedCount).toBe(1);

    const trainerJoin = await claimTeamJoinInvite({
      callerSid: trainerSid,
      originUrl: 'https://thresh.fit',
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Alex Morgan AT',
      athleteEmail: 'alex.at@school.edu',
      birthYear: currentYear - 28,
    });
    expect(trainerJoin.ok).toBe(true);
    const trainerMem = trainerJoin.summary!.memberships.find(
      (m) => m.invitedName === 'Alex Morgan AT'
    )!;

    const promoted = await updateMemberRole({
      callerSid: coachSid,
      teamId: team.brand.teamId,
      membershipId: trainerMem.membershipId,
      role: 'ATHLETIC_TRAINER',
      originUrl: 'https://thresh.fit',
    });
    expect(promoted.ok).toBe(true);

    const injuredByTrainer = await updateMemberRosterLifecycleStatus({
      callerSid: trainerSid,
      teamId: team.brand.teamId,
      membershipId: athleteMem!.membershipId,
      status: 'INJURED',
      originUrl: 'https://thresh.fit',
    });
    expect(injuredByTrainer.ok).toBe(true);

    const activeByTrainer = await updateMemberRosterLifecycleStatus({
      callerSid: trainerSid,
      teamId: team.brand.teamId,
      membershipId: athleteMem!.membershipId,
      status: 'ACTIVE',
      originUrl: 'https://thresh.fit',
    });
    expect(activeByTrainer.ok).toBe(true);

    const revokedByTrainer = await updateMemberRosterLifecycleStatus({
      callerSid: trainerSid,
      teamId: team.brand.teamId,
      membershipId: athleteMem!.membershipId,
      status: 'REVOKED',
      originUrl: 'https://thresh.fit',
    });
    expect(revokedByTrainer.ok).toBe(false);

    const alumniByTrainer = await updateMemberRosterLifecycleStatus({
      callerSid: trainerSid,
      teamId: team.brand.teamId,
      membershipId: athleteMem!.membershipId,
      status: 'ALUMNI',
      originUrl: 'https://thresh.fit',
    });
    expect(alumniByTrainer.ok).toBe(false);
  });

  it('ships standalone /for-athletic-directors page, vercel + workbox wiring, and sunlit stopwatch + daylight defaults', () => {
    const adHtml = fs.readFileSync(
      path.join(ROOT, 'public', 'for-athletic-directors.html'),
      'utf8'
    );
    expect(adHtml).toContain('$0 / Season');
    expect(adHtml).toContain('$250');
    expect(adHtml).toContain('procurement@thresh.fit');
    expect(adHtml).not.toMatch(/\bThresh\b/);

    const vercelJson = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
    expect(vercelJson).toContain('/for-athletic-directors');
    const viteConfig = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('for-athletic-directors');

    const memStore = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => memStore.set(k, v),
      removeItem: (k: string) => memStore.delete(k),
    });
    vi.stubGlobal('window', {
      localStorage,
      matchMedia: () => ({ matches: true }),
    });

    expect(readInitialDaytimePalette()).toBe('DAYLIGHT');
    expect(readPersistedTracksideStopwatch().soundEnabled).toBe(true);
  });
});
