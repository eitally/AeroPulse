import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeParentConsent,
  claimTeamJoinInvite,
  createTeamForCoach,
  previewTeamJoinInvite,
} from '../server/teamService';

describe('[AUTH-02] Coach-invited, parent-acknowledged sign-up for minor athletes (COPPA & youth privacy)', () => {
  const originalFetch = globalThis.fetch;
  let sentEmails: Array<{ to: string; subject: string; html: string }> = [];

  beforeEach(() => {
    sentEmails = [];
    process.env.RESEND_API_KEY = 're_test_dummy_key_12345';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.resend.com/emails')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        sentEmails.push({
          to: body.to,
          subject: body.subject,
          html: body.html,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: `email_${crypto.randomBytes(6).toString('hex')}` }),
        } as Response;
      }
      return originalFetch(input, init);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
    vi.restoreAllMocks();
  });

  it('detects minor athlete (<18) by birth year, enforces Safe-Sport weight shield, and initiates parent consent loop', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const athleteSid = `athlete_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';
    const currentYear = new Date().getFullYear();
    const minorBirthYear = currentYear - 16; // 16-year-old high school sophomore

    // Create a scholastic club team
    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Cascadia Youth Distance Club',
      orgType: 'RUNNING_CLUB',
      primarySport: 'Running',
    });

    const parentEmail = 'm.chen.parent@example.com';
    const athleteEmail = 'kai.chen@example.org';

    // Claim join invite as minor athlete
    const claimRes = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Kai Chen',
      athleteEmail,
      birthYear: minorBirthYear,
      parentGuardianEmail: parentEmail,
      distanceUnit: 'mi',
      sharingTier: 'SUMMARY_ONLY',
    });

    expect(claimRes.ok).toBe(true);
    expect(claimRes.safeSportShieldEnforced).toBe(true);

    const membership = claimRes.summary?.memberships.find((m) => m.userSid === athleteSid);
    expect(membership).toBeDefined();
    expect(membership?.isMinorU18).toBe(true);
    expect(membership?.birthYear).toBe(minorBirthYear);
    expect(membership?.parentGuardianEmail).toBe(parentEmail);
    expect(membership?.parentConsentStatus).toBe('PENDING');
    expect(membership?.parentConsentToken).toBeDefined();
    expect(typeof membership?.parentConsentToken).toBe('string');
    expect(membership?.parentConsentToken?.length).toBeGreaterThan(16);

    // Verify Resend parent consent email was dispatched
    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0];
    expect(email.to).toEqual([parentEmail]);
    expect(email.subject).toContain('Scholastic Safeguards Active');
    expect(email.subject).toContain('Kai Chen');
    expect(email.html).toContain('Cascadia Youth Distance Club');
    expect(email.html).toContain('Safe-Sport Weight Shield');
    expect(email.html).toContain('COPPA');
    expect(email.html).toContain(`/api/teams/parent-consent?token=${membership?.parentConsentToken}`);

    // Verify preview endpoint exposes parentConsentStatus and minor flags
    const preview = await previewTeamJoinInvite(team.brand.joinCode, undefined, athleteEmail);
    expect(preview.found).toBe(true);
    expect(preview.membership?.isMinorU18).toBe(true);
    expect(preview.membership?.parentConsentStatus).toBe('PENDING');
  });

  it('completes parent consent loop via acknowledgeParentConsent token verification', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const athleteSid = `athlete_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';
    const currentYear = new Date().getFullYear();
    const minorBirthYear = currentYear - 15;

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'West Valley Track & Field',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });

    const parentEmail = 'guardian.rodriguez@family.org';

    const claimRes = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Mateo Rodriguez',
      athleteEmail: 'mateo.r@valley.edu',
      birthYear: minorBirthYear,
      parentGuardianEmail: parentEmail,
    });

    expect(claimRes.ok).toBe(true);
    const token = claimRes.summary?.memberships.find((m) => m.userSid === athleteSid)?.parentConsentToken;
    expect(token).toBeDefined();

    // Verify parent consent via token
    const ackRes = await acknowledgeParentConsent(token!);
    expect(ackRes.ok).toBe(true);
    expect(ackRes.athleteName).toBe('Mateo Rodriguez');
    expect(ackRes.teamName).toBe('West Valley Track & Field');
    expect(ackRes.parentEmail).toBe(parentEmail);
    expect(ackRes.acknowledgedAt).toBeDefined();

    // Verify idempotency / subsequent call acknowledges without error
    const ackAgain = await acknowledgeParentConsent(token!);
    expect(ackAgain.ok).toBe(true);
    expect(ackAgain.alreadyAcknowledged).toBe(true);

    // Verify rejection of fraudulent / non-existent tokens
    const invalidAck = await acknowledgeParentConsent('fraudulent_hex_token_99999');
    expect(invalidAck.ok).toBe(false);
    expect(invalidAck.error).toContain('Invalid or expired parent consent link');
  });

  it('does NOT enforce parent consent loop or weight shield lock for adult athletes (>= 18)', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const athleteSid = `athlete_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';
    const currentYear = new Date().getFullYear();
    const adultBirthYear = currentYear - 25; // 25 years old collegiate / master athlete

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'Metro Elite Racing',
      orgType: 'CYCLING_CLUB',
      primarySport: 'Cycling',
    });

    const claimRes = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Soren Lindqvist',
      athleteEmail: 'soren@metro-racing.cc',
      birthYear: adultBirthYear,
      parentGuardianEmail: 'should.not.be.used@example.com',
    });

    expect(claimRes.ok).toBe(true);
    expect(claimRes.safeSportShieldEnforced).toBe(false);

    const membership = claimRes.summary?.memberships.find((m) => m.userSid === athleteSid);
    expect(membership?.isMinorU18).toBe(false);
    expect(membership?.parentConsentStatus).toBe('NOT_REQUIRED');
    expect(membership?.parentConsentToken).toBeUndefined();

    // Resend was not invoked because parent consent is not required for adults
    expect(sentEmails).toHaveLength(0);
  });

  it('treats HIGH_SCHOOL team members as minors even if birth year is omitted', async () => {
    const coachSid = `coach_${crypto.randomBytes(8).toString('hex')}`;
    const athleteSid = `athlete_${crypto.randomBytes(8).toString('hex')}`;
    const origin = 'https://thresh.app';

    const team = await createTeamForCoach({
      callerSid: coachSid,
      originUrl: origin,
      name: 'St. Teresa High School Cross Country',
      orgType: 'HIGH_SCHOOL',
      primarySport: 'Running',
    });

    const parentEmail = 'parent.patel@family.com';

    const claimRes = await claimTeamJoinInvite({
      callerSid: athleteSid,
      originUrl: origin,
      codeOrSlug: team.brand.joinCode,
      athleteName: 'Aarav Patel',
      parentGuardianEmail: parentEmail,
    });

    expect(claimRes.ok).toBe(true);
    expect(claimRes.safeSportShieldEnforced).toBe(true);

    const membership = claimRes.summary?.memberships.find((m) => m.userSid === athleteSid);
    expect(membership?.isMinorU18).toBe(true);
    expect(membership?.parentConsentStatus).toBe('PENDING');
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual([parentEmail]);
  });
});
