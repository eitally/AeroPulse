import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import {
  dispatchParentHubAnnouncementEmails,
  parentEmailSubsVaultKey,
  type ParentHubEmailSubscriptionRecord,
} from '../server/athleticSyncService.ts';
import { findOrCreateUser, getUserById, updateUserBirthMonthYear } from '../server/authService.ts';
import { getFunnelSummaryAsync } from '../server/funnelAnalyticsService.ts';
import { resetRateLimitsForTesting } from '../server/rateLimiter.ts';
import {
  SESSION_COOKIE_NAME,
  deriveUserSessionSid,
  issueSessionToken,
  securityHeadersMiddleware,
} from '../server/securityUtils.ts';
import { processStripeWebhookEvent } from '../server/teamBillingService.ts';
import { buildDistrictOverviewFromDocs, getDistrictAdOverview } from '../server/teamDistrictService.ts';
import {
  recordTeamAttendanceBatch,
  recordTeamFieldMarks,
  selfCheckInTeamAttendance,
  teamFieldLogsVaultKey,
} from '../server/teamFieldAndDailyOpsService.ts';
import { deleteTeamInjuryCase, upsertTeamInjuryCase } from '../server/teamInjuryService.ts';
import { removeTeamFromDirectoryAndVault, revokeAthleteGuardianConsentForTeam } from '../server/teamLifecycleService.ts';
import {
  claimTeamJoinInvite,
  createTeamForCoach,
  listTeamsForUser,
  loadTeamDocRaw,
  saveTeamDocRaw,
  teamDocVaultKey,
  updateTeamBranding,
  type StoredTeamDocument,
} from '../server/teamService.ts';
import {
  DELETED_USERS_TOMBSTONES_KEY,
  appendAuditLogAsync,
  buildEncryptedUserCookieHeader,
  deleteTenantVault,
  listTeamAuditLogAsync,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  setPostgresPoolForTesting,
  withTeamRowLock,
} from '../server/tokenVault.ts';
import { pushWorkoutToWahooCloud } from '../server/wahooConnectService.ts';
import { resolveAthleteAgeTier } from '../src/physiology/ageAndComplianceEngine.ts';
import type { AthleteCloudStateEnvelope } from '../src/types.ts';

const ROOT = process.cwd();

function signStripeBody(rawBody: string, secret: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${ts},v1=${sig}`;
}

describe('Launch-Readiness P0/P1 Security, Compliance & Scalability Remediation', () => {
  const origFetch = globalThis.fetch;
  const origEnv = { ...process.env };
  const createdTeamIds: string[] = [];
  const tempVaultKeys: string[] = [];
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(securityHeadersMiddleware);
    app.use(
      express.json({
        limit: '2mb',
        verify: (req, _res, buf) => {
          (req as { rawBody?: Buffer }).rawBody = buf;
        },
      })
    );
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

  afterEach(async () => {
    globalThis.fetch = origFetch;
    process.env = { ...origEnv };
    setPostgresPoolForTesting(null);
    resetRateLimitsForTesting();
    for (const key of tempVaultKeys.splice(0, tempVaultKeys.length)) {
      await deleteTenantVault(key).catch(() => undefined);
    }
  });

  afterAll(async () => {
    globalThis.fetch = origFetch;
    process.env = { ...origEnv };
    setPostgresPoolForTesting(null);
    for (const teamId of createdTeamIds) {
      await removeTeamFromDirectoryAndVault(teamId).catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('1. Security Headers, Scoped Public HTML CSP & Vanity Redirects', () => {
    it('allows self geolocation in vercel.json and securityUtils.ts, scopes unsafe-inline style-src ONLY to /api/teams/public/* HTML responses, and aligns redirects', async () => {
      const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
        headers: Array<{ headers: Array<{ key: string; value: string }> }>;
        redirects: Array<{ source: string; destination: string }>;
      };
      const serverTs = fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

      const permHeader = vercel.headers[0]?.headers.find((h) => h.key === 'Permissions-Policy');
      expect(permHeader?.value).toBe('camera=(), microphone=(), geolocation=(self)');
      expect(vercel.redirects.find((r) => r.source === '/go/clipboard')?.destination).toContain(
        'utm_medium=clipboard_qr'
      );
      expect(vercel.redirects.find((r) => r.source === '/tee')?.destination).toContain(
        'utm_campaign=meet_day_tee'
      );
      expect(vercel.redirects.find((r) => r.source === '/share')?.destination).toBe(
        '/share/workout?preset=8x400&utm_source=share&utm_medium=card&utm_campaign=share_card'
      );
      expect(serverTs).toContain('utm_campaign=meet_day_tee');
      expect(serverTs).toContain('utm_medium=clipboard_qr');
      expect(serverTs).toContain(
        '/share/workout?preset=8x400&utm_source=share&utm_medium=card&utm_campaign=share_card'
      );

      const healthRes = await origFetch(`${baseUrl}/api/health`);
      expect(healthRes.headers.get('permissions-policy')).toBe(
        'camera=(), microphone=(), geolocation=(self)'
      );
      const jsonCsp = healthRes.headers.get('content-security-policy') || '';
      expect(jsonCsp).toContain("default-src 'none'");
      expect(jsonCsp).not.toContain("'unsafe-inline'");

      const publicConfirmHtmlRes = await origFetch(
        `${baseUrl}/api/teams/public/nonexistent-hub/subscribe/confirm?token=missing`
      );
      expect(publicConfirmHtmlRes.headers.get('content-type')).toContain('text/html');
      const publicHtmlCsp = publicConfirmHtmlRes.headers.get('content-security-policy') || '';
      expect(publicHtmlCsp).toContain("style-src 'self' 'unsafe-inline'");
      expect(publicHtmlCsp).toContain("form-action 'self'");

      const publicJsonRes = await origFetch(`${baseUrl}/api/teams/public/nonexistent-hub`);
      const publicJsonCsp = publicJsonRes.headers.get('content-security-policy') || '';
      expect(publicJsonCsp).toContain("default-src 'none'");
      expect(publicJsonCsp).not.toContain("'unsafe-inline'");
    });
  });

  describe('2. COPPA <13 Conservative Year-Only BirthYear, Minor DOB Tamper & SVG Logo Block', () => {
    it('normalizes year-only birthYear conservatively to YYYY-12, rejects invalid/under-13 claim DOBs, blocks minor-to-adult DOB tampering, and rejects SVG logos', async () => {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;
      const borderYear = currentYear - 13;
      const tier = resolveAthleteAgeTier({ birthYear: borderYear });
      expect(tier.birthMonthYear).toBe(`${borderYear}-12`);
      if (currentMonth < 12) {
        expect(tier.isUnder13).toBe(true);
        expect(tier.ageTier).toBe('U13_COPPA');
      }

      const tag = crypto.randomBytes(4).toString('hex');
      const coachSid = `p0_coppa_coach_${tag}`;
      const svgReject = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: `SVG Reject ${tag}`,
        orgType: 'HIGH_SCHOOL',
        logoDataUrl: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+',
      });
      createdTeamIds.push(svgReject.brand.teamId);
      expect(svgReject.brand.logoDataUrl).toBeUndefined();

      const pngRes = await updateTeamBranding({
        callerSid: coachSid,
        teamId: svgReject.brand.teamId,
        originUrl: 'https://meetready.app',
        updates: {
          logoDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        },
      });
      expect(pngRes?.brand.logoDataUrl).toMatch(/^data:image\/png;base64,/);

      const svgUpdateRes = await updateTeamBranding({
        callerSid: coachSid,
        teamId: svgReject.brand.teamId,
        originUrl: 'https://meetready.app',
        updates: {
          logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        },
      });
      expect(svgUpdateRes?.brand.logoDataUrl).toMatch(/^data:image\/png;base64,/);

      const invalidDobClaim = await claimTeamJoinInvite({
        callerSid: `bad_dob_${tag}`,
        originUrl: 'https://meetready.app',
        codeOrSlug: svgReject.brand.joinCode,
        athleteName: 'Bad Year',
        birthYear: 1234,
      });
      expect(invalidDobClaim.ok).toBe(false);
      expect(invalidDobClaim.statusCode).toBe(400);

      const minorSid = `minor_claim_${tag}`;
      const minorDob = `${currentYear - 15}-06`;
      const adultDob = `${currentYear - 20}-01`;
      const minorJoin = await claimTeamJoinInvite({
        callerSid: minorSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: svgReject.brand.joinCode,
        athleteName: 'Minor Athlete',
        birthMonthYear: minorDob,
        parentGuardianEmail: `mom.${tag}@family.org`,
      });
      expect(minorJoin.ok).toBe(true);

      // Re-claiming with adult birthMonthYear must NOT override minor DOB or wipe guardian email
      await claimTeamJoinInvite({
        callerSid: minorSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: svgReject.brand.joinCode,
        athleteName: 'Minor Athlete',
        birthMonthYear: adultDob,
      });
      const afterTamperDoc = await loadTeamDocRaw(svgReject.brand.teamId);
      const mem = afterTamperDoc!.memberships.find((m) => m.userSid === minorSid)!;
      expect(mem.isMinorU18).toBe(true);
      expect(mem.birthYear).toBe(currentYear - 15);
      expect(mem.parentGuardianEmail).toBe(`mom.${tag}@family.org`);

      // Guardian consent revocation must fail for minor DOB tampered to adult
      const revokeTamper = await revokeAthleteGuardianConsentForTeam({
        callerSid: minorSid,
        teamId: svgReject.brand.teamId,
        originUrl: 'https://meetready.app',
        birthMonthYear: adultDob,
      });
      expect(revokeTamper.ok).toBe(false);

      // /api/auth/birth-month checks athlete_state_* vaults even when user.birthMonthYear is absent
      const authMinor = await findOrCreateUser('magic_link', `state_minor_${tag}@hs.edu`, {
        name: 'State Minor',
      });
      const authSid = deriveUserSessionSid(authMinor.id);
      const stateKey = `athlete_state_sid_${authSid.slice(0, 32)}`;
      tempVaultKeys.push(stateKey, `user_${authMinor.id}`, `athlete_state_user_${authMinor.id}`);
      const minorStateEnv: AthleteCloudStateEnvelope = {
        version: 1,
        updatedAt: new Date().toISOString(),
        athleteProfile: {
          name: 'State Minor',
          birthMonthYear: minorDob,
        },
        plannedEvents: [],
        gearItems: [],
        sessionCheckIns: [],
        targetGoals: [],
        annualMileageGoals: [],
      };
      await saveTenantVaultAsync(stateKey, minorStateEnv);

      const authCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(authMinor.id, authSid, 'verified')}`;
      const tamperBirthMonthRes = await origFetch(`${baseUrl}/api/auth/birth-month`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ birthMonthYear: adultDob }),
      });
      expect(tamperBirthMonthRes.status).toBe(403);
    });
  });

  describe('3. FERPA Tombstone, Medical Audit Scrubbing, PG Rollback Cache & Batch Scalability', () => {
    it('prevents erased user cookie resurrection via tombstones & Postgres guard, and redacts injuryCase audit logs', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const executedSql: Array<{ sql: string; params: unknown[] }> = [];
      const vaultRows = new Map<string, string>();
      let targetTeamId = '';
      const handleSql = (sql: string, params: unknown[] = []) => {
        const trimmed = sql.trim();
        executedSql.push({ sql: trimmed, params });
        if (trimmed.startsWith('SELECT pg_advisory_xact_lock')) {
          return { rows: [{ pg_advisory_xact_lock: '' }] };
        }
        if (trimmed.startsWith('SELECT DISTINCT team_id FROM thresh_team_members')) {
          return { rows: targetTeamId ? [{ team_id: targetTeamId }] : [] };
        }
        if (trimmed.startsWith('SELECT tenant_id, encrypted_envelope FROM thresh_tenant_vault')) {
          const keys = Array.isArray(params[0]) ? params[0].map((k) => String(k)) : [];
          return {
            rows: keys
              .map((k) => {
                const env = vaultRows.get(k);
                return env ? { tenant_id: k, encrypted_envelope: env } : null;
              })
              .filter(Boolean),
          };
        }
        if (trimmed.startsWith('SELECT encrypted_envelope FROM thresh_tenant_vault')) {
          const env = vaultRows.get(String(params[0] || ''));
          return { rows: env ? [{ encrypted_envelope: env }] : [] };
        }
        if (trimmed.startsWith('INSERT INTO thresh_tenant_vault')) {
          vaultRows.set(String(params[0] || ''), String(params[1] || ''));
          return { rows: [] };
        }
        if (trimmed.startsWith('DELETE FROM thresh_tenant_vault')) {
          vaultRows.delete(String(params[0] || ''));
          return { rows: [] };
        }
        return { rows: [] };
      };
      const mockPool = {
        query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
        connect: vi.fn(async () => ({
          query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
          release: vi.fn(),
        })),
        on: vi.fn(),
        end: vi.fn(async () => undefined),
      };
      setPostgresPoolForTesting(mockPool as unknown as Parameters<typeof setPostgresPoolForTesting>[0]);

      const coachUser = await findOrCreateUser('magic_link', `hc_audit_${tag}@hs.edu`, {
        name: 'Coach Audit',
      });
      const coachSid = deriveUserSessionSid(coachUser.id);
      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: `Audit Redact ${tag}`,
        orgType: 'HIGH_SCHOOL',
      });
      targetTeamId = team.brand.teamId;
      createdTeamIds.push(team.brand.teamId);

      const athleteUser = await findOrCreateUser('magic_link', `ath_erase_${tag}@hs.edu`, {
        name: 'Athlete Erased',
      });
      const athleteSid = deriveUserSessionSid(athleteUser.id);
      await updateUserBirthMonthYear(athleteUser.id, `${new Date().getUTCFullYear() - 20}-01`);

      const claimRes = await claimTeamJoinInvite({
        callerSid: athleteSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Athlete Erased',
        birthMonthYear: `${new Date().getUTCFullYear() - 20}-01`,
      });
      const athMemId = claimRes.summary!.memberships.find((m) => m.userSid === athleteSid)!.membershipId;

      const injRes = await upsertTeamInjuryCase({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        input: {
          membershipId: athMemId,
          bodyRegion: 'ACHILLES',
          severity: 'MODERATE',
          rtpStage: 'MODIFIED',
          restrictions: 'No spikes',
          coachGuidance: 'Flat turf only',
        },
      });
      expect(injRes.ok).toBe(true);
      const injuryCaseId = injRes.injuryCase!.id;

      // Extra audit entry where targetId is opaque/unrelated and metadata embeds membershipId
      await appendAuditLogAsync({
        teamId: team.brand.teamId,
        actorSid: coachSid,
        action: 'MEDICAL_NOTE_CHECK',
        targetId: 'note_custom_1',
        metadata: { relatedMembershipId: athMemId, athleteName: 'Athlete Erased' },
      });

      const athJwt = issueSessionToken(athleteUser.id, athleteSid, 'verified');
      const userCookieHeader = buildEncryptedUserCookieHeader(athleteUser, false)!;
      const userCookiePair = userCookieHeader.split(';')[0];
      const staleCookies = `${SESSION_COOKIE_NAME}=${athJwt}; ${userCookiePair}`;

      const delRes = await origFetch(`${baseUrl}/api/auth/account?confirm=DELETE`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Cookie: staleCookies },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      expect(delRes.status).toBe(200);

      // Verify injuryCaseId & metadata membershipId matched in audit_log_<teamId> and thresh_audit_log SQL
      const auditAfter = await listTeamAuditLogAsync(team.brand.teamId, 50);
      const injAudit = auditAfter.find((a) => a.targetId === injuryCaseId);
      expect(injAudit?.metadata).toEqual({ redacted: true });
      const metaAudit = auditAfter.find((a) => a.targetId === 'note_custom_1');
      expect(metaAudit?.metadata).toEqual({ redacted: true });

      const sqlUpdateAudit = executedSql.find(
        (q) => q.sql.includes('UPDATE thresh_audit_log') && JSON.stringify(q.params).includes(injuryCaseId)
      );
      expect(sqlUpdateAudit).toBeDefined();

      // Attempt cookie resurrection via stale thresh_user + JWT in PG mode
      const mePgRes = await origFetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: staleCookies },
      });
      const mePgJson = (await mePgRes.json()) as { authenticated: boolean; user: unknown };
      expect(mePgJson.authenticated).toBe(false);
      expect(mePgJson.user).toBeNull();
      expect(await getUserById(athleteUser.id)).toBeNull();

      // Attempt cookie resurrection in non-PG mode -> stopped by persisted tombstone!
      setPostgresPoolForTesting(null);
      const tombstone = await loadTenantVaultAsync<{ ids?: Record<string, string> } | null>(
        DELETED_USERS_TOMBSTONES_KEY,
        null
      );
      // Persist tombstone in vault mode as well to simulate non-PG mode tombstone persistence
      if (!tombstone?.ids?.[athleteUser.id]) {
        await saveTenantVaultAsync(DELETED_USERS_TOMBSTONES_KEY, {
          ids: { ...(tombstone?.ids || {}), [athleteUser.id]: new Date().toISOString() },
        });
      }
      const meVaultRes = await origFetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: staleCookies },
      });
      const meVaultJson = (await meVaultRes.json()) as { authenticated: boolean; user: unknown };
      expect(meVaultJson.authenticated).toBe(false);
      expect(meVaultJson.user).toBeNull();
      expect(await getUserById(athleteUser.id)).toBeNull();

      // Batch listTeamsForUser & getDistrictAdOverview verify ANY($1) batch query
      vaultRows.clear();
      // Switch back to vault mode for cleanup of remaining coach team
      await removeTeamFromDirectoryAndVault(team.brand.teamId).catch(() => undefined);
    });

    it('invalidates memoryVaultCache & /tmp cache when a Postgres transaction rolls back, and batch-loads listTeamsForUser / getDistrictAdOverview via ANY($1)', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const vaultKey = `tx_rollback_test_${tag}`;
      tempVaultKeys.push(vaultKey);
      const vaultRows = new Map<string, string>();
      const singleSelectCounts = new Map<string, number>();
      let batchSelectCount = 0;

      const handleSql = (sql: string, params: unknown[] = []) => {
        const trimmed = sql.trim();
        if (trimmed.startsWith('SELECT pg_advisory_xact_lock')) {
          return { rows: [{ pg_advisory_xact_lock: '' }] };
        }
        if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
          return { rows: [] };
        }
        if (trimmed.startsWith('SELECT DISTINCT team_id FROM thresh_team_members')) {
          return { rows: [{ team_id: `tm_batch_${tag}` }] };
        }
        if (trimmed.startsWith('SELECT tenant_id, encrypted_envelope FROM thresh_tenant_vault')) {
          batchSelectCount += 1;
          const keys = Array.isArray(params[0]) ? params[0].map((k) => String(k)) : [];
          return {
            rows: keys
              .map((k) => {
                const env = vaultRows.get(k);
                return env ? { tenant_id: k, encrypted_envelope: env } : null;
              })
              .filter(Boolean),
          };
        }
        if (trimmed.startsWith('SELECT encrypted_envelope FROM thresh_tenant_vault')) {
          const k = String(params[0] || '');
          singleSelectCounts.set(k, (singleSelectCounts.get(k) || 0) + 1);
          const env = vaultRows.get(k);
          return { rows: env ? [{ encrypted_envelope: env }] : [] };
        }
        if (trimmed.startsWith('INSERT INTO thresh_tenant_vault')) {
          vaultRows.set(String(params[0] || ''), String(params[1] || ''));
          return { rows: [] };
        }
        if (trimmed.startsWith('DELETE FROM thresh_tenant_vault')) {
          vaultRows.delete(String(params[0] || ''));
          return { rows: [] };
        }
        return { rows: [] };
      };

      const mockPool = {
        query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
        connect: vi.fn(async () => ({
          query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
          release: vi.fn(),
        })),
        on: vi.fn(),
        end: vi.fn(async () => undefined),
      };
      setPostgresPoolForTesting(mockPool as unknown as Parameters<typeof setPostgresPoolForTesting>[0]);

      // Seed baseline committed value
      await saveTenantVaultAsync(vaultKey, { version: 'committed_v1' });
      const committedEnv = vaultRows.get(vaultKey)!;

      // Aborted TX saves uncommitted value, then throws before COMMIT -> ROLLBACK runs
      await expect(
        withTeamRowLock(`lock_${tag}`, async () => {
          await saveTenantVaultAsync(vaultKey, { version: 'uncommitted_poison' });
          throw new Error('simulated_tx_abort');
        })
      ).rejects.toThrow('simulated_tx_abort');

      // Simulate Postgres restoring DB row after ROLLBACK while testing local memory/tmp caches
      vaultRows.set(vaultKey, committedEnv);
      const afterRollback = await loadTenantVaultAsync<{ version: string } | null>(vaultKey, null);
      expect(afterRollback).toEqual({ version: 'committed_v1' });

      // Seed team for batch listTeamsForUser + getDistrictAdOverview check
      const coachSid = `batch_coach_${tag}`;
      const sampleDoc: StoredTeamDocument = {
        brand: {
          teamId: `tm_batch_${tag}`,
          slug: `batch-hs-${tag}`,
          joinCode: 'BTCH',
          name: 'Batch High',
          shortName: 'BTCH',
          districtName: 'Batch USD',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          primaryHex: '#121413',
          secondaryHex: '#D8FF2A',
          defaultSafeSportShield: true,
          enableParentGuardianCc: true,
          coachDisplayName: 'Coach Batch',
          createdAt: '2026-09-01T00:00:00Z',
        },
        memberships: [
          {
            membershipId: `mem_${tag}`,
            teamId: `tm_batch_${tag}`,
            userSid: coachSid,
            role: 'HEAD_COACH',
            squadGroup: 'Varsity',
            invitedName: 'Coach Batch',
            isMinorU18: false,
            status: 'ACTIVE',
            invitedAt: '2026-09-01T00:00:00Z',
          },
        ],
        broadcastWorkouts: [],
        updatedAt: '2026-11-22T00:00:00Z',
      };
      await saveTenantVaultAsync(teamDocVaultKey(`tm_batch_${tag}`), sampleDoc);
      tempVaultKeys.push(teamDocVaultKey(`tm_batch_${tag}`));
      singleSelectCounts.clear();
      batchSelectCount = 0;

      const listRes = await listTeamsForUser(coachSid, 'https://meetready.app');
      expect(listRes).toHaveLength(1);
      expect(batchSelectCount).toBe(1);
      expect(singleSelectCounts.get(teamDocVaultKey(`tm_batch_${tag}`)) || 0).toBe(0);

      const adRes = await getDistrictAdOverview({ callerSid: coachSid });
      expect(adRes.totals.schoolCount).toBe(1);
      expect(batchSelectCount).toBe(2);
    });
  });

  describe('4. Raw SessionToken Removal, Rate Limits, SafeLinks & 500-Subscriber Chunks', () => {
    it('omits sessionToken from /api/intervals/connect JSON, rate limits /api/auth/change-email and public /subscribe, enforces SafeLinks POST forms, and chunks 60+ subscriber fanout', async () => {
      const tag = crypto.randomBytes(4).toString('hex');

      // 1. /api/intervals/connect hides raw sessionToken from JSON while setting HttpOnly cookie
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('intervals.icu/api/v1/athlete/')) {
          return new Response(
            JSON.stringify({ id: 'i_9988', name: 'Intervals Athlete' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return origFetch(input, init);
      }) as typeof fetch;

      const ivRes = await origFetch(`${baseUrl}/api/intervals/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'iv_test_api_key_123456', athleteId: 'i_9988' }),
      });
      expect(ivRes.status).toBe(200);
      const ivJson = (await ivRes.json()) as Record<string, unknown>;
      expect(ivJson.connected).toBe(true);
      expect(ivJson.sessionToken).toBeUndefined();
      expect(ivRes.headers.get('set-cookie')).toContain(SESSION_COOKIE_NAME);

      // 2. /api/auth/change-email rate limits (2/15m per email hash, 3/15m per user)
      const u = await findOrCreateUser('magic_link', `chg_rl_${tag}@hs.edu`, { name: 'Email RL' });
      const uSid = deriveUserSessionSid(u.id);
      tempVaultKeys.push(`user_${u.id}`);
      const uCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(u.id, uSid, 'verified')}`;

      const targetSameEmail = `same_new_${tag}@hs.edu`;
      const ce1 = await origFetch(`${baseUrl}/api/auth/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: uCookie },
        body: JSON.stringify({ email: targetSameEmail }),
      });
      expect(ce1.status).toBe(200);
      const ce2 = await origFetch(`${baseUrl}/api/auth/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: uCookie },
        body: JSON.stringify({ email: targetSameEmail }),
      });
      expect(ce2.status).toBe(200);
      const ce3SameEmail = await origFetch(`${baseUrl}/api/auth/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: uCookie },
        body: JSON.stringify({ email: targetSameEmail }),
      });
      expect(ce3SameEmail.status).toBe(429);
      expect(Number(ce3SameEmail.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

      // Fresh user hits 3/15m per-user limit on 4th distinct email request
      const u2 = await findOrCreateUser('magic_link', `chg_rl2_${tag}@hs.edu`, { name: 'Email RL2' });
      const u2Sid = deriveUserSessionSid(u2.id);
      tempVaultKeys.push(`user_${u2.id}`);
      const u2Cookie = `${SESSION_COOKIE_NAME}=${issueSessionToken(u2.id, u2Sid, 'verified')}`;
      for (let idx = 1; idx <= 3; idx += 1) {
        const res = await origFetch(`${baseUrl}/api/auth/change-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: u2Cookie },
          body: JSON.stringify({ email: `diff${idx}_${tag}@hs.edu` }),
        });
        expect(res.status).toBe(200);
      }
      const ce4Diff = await origFetch(`${baseUrl}/api/auth/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: u2Cookie },
        body: JSON.stringify({ email: `diff4_${tag}@hs.edu` }),
      });
      expect(ce4Diff.status).toBe(429);

      // 3. Public subscribe rate limit & 60+ subscriber batching in chunks of 25
      const coachSid = `hub_coach_${tag}`;
      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: `Parent Sub ${tag}`,
        orgType: 'HIGH_SCHOOL',
      });
      createdTeamIds.push(team.brand.teamId);
      const doc = (await loadTeamDocRaw(team.brand.teamId))!;
      doc.brand.externalSync = {
        platform: 'ATHLETIC_NET',
        enablePublicParentHub: true,
      };
      await saveTeamDocRaw(team.brand.teamId, doc);

      const subUrl = `${baseUrl}/api/teams/public/${encodeURIComponent(team.brand.slug)}/subscribe`;
      const s1 = await origFetch(subUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
        body: JSON.stringify({ email: `p1_${tag}@family.org` }),
      });
      expect(s1.status).toBe(200);
      const s2 = await origFetch(subUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
        body: JSON.stringify({ email: `p1_${tag}@family.org` }),
      });
      expect(s2.status).toBe(200);
      // 3rd request for same email hash -> 429 (2/15m per email hash)
      const s3Same = await origFetch(subUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.10' },
        body: JSON.stringify({ email: `p1_${tag}@family.org` }),
      });
      expect(s3Same.status).toBe(429);
      expect(Number(s3Same.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);

      // Separate IP tests 5/15m per-IP limit cleanly (requests 1..5 -> 200, request 6 -> 429)
      for (let idx = 1; idx <= 5; idx += 1) {
        const sr = await origFetch(subUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.20' },
          body: JSON.stringify({ email: `ip2_p${idx}_${tag}@family.org` }),
        });
        expect(sr.status).toBe(200);
      }
      const s6Ip = await origFetch(subUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.20' },
        body: JSON.stringify({ email: `ip2_p6_${tag}@family.org` }),
      });
      expect(s6Ip.status).toBe(429);

      // SafeLinks GET preview preserves token without confirming, POST confirms
      const subsKey = parentEmailSubsVaultKey(team.brand.teamId);
      const rawConfirmTok = `tok_confirm_${tag}`;
      const subs: ParentHubEmailSubscriptionRecord[] = [
        {
          id: `sub_pending_${tag}`,
          teamId: team.brand.teamId,
          email: `safelink_${tag}@family.org`,
          status: 'PENDING',
          confirmTokenHash: crypto.createHash('sha256').update(rawConfirmTok).digest('hex'),
          unsubscribeTokenHashes: [],
          createdAt: new Date().toISOString(),
        },
        ...Array.from({ length: 60 }, (_, idx) => ({
          id: `sub_conf_${idx}`,
          teamId: team.brand.teamId,
          email: `parent_${idx}_${tag}@family.org`,
          status: 'CONFIRMED' as const,
          unsubscribeTokenHashes: [],
          createdAt: new Date().toISOString(),
        })),
      ];
      await saveTenantVaultAsync(subsKey, subs);

      const getPreviewRes = await origFetch(
        `${baseUrl}/api/teams/public/${encodeURIComponent(team.brand.slug)}/subscribe/confirm?token=${encodeURIComponent(rawConfirmTok)}`
      );
      expect(getPreviewRes.status).toBe(200);
      const previewHtml = await getPreviewRes.text();
      expect(previewHtml).toContain('<form method="POST"');

      // Still PENDING before POST!
      const afterGetSubs = await loadTenantVaultAsync<ParentHubEmailSubscriptionRecord[]>(subsKey, []);
      expect(afterGetSubs[0].status).toBe('PENDING');

      const postConfirmRes = await origFetch(
        `${baseUrl}/api/teams/public/${encodeURIComponent(team.brand.slug)}/subscribe/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ token: rawConfirmTok }),
        }
      );
      expect(postConfirmRes.status).toBe(200);
      const afterPostSubs = await loadTenantVaultAsync<ParentHubEmailSubscriptionRecord[]>(subsKey, []);
      expect(afterPostSubs[0].status).toBe('CONFIRMED');

      // 61 confirmed subscribers dispatched in chunks of 25 (past old 50 cap!)
      process.env.RESEND_API_KEY = 're_test_chunks';
      let resendCalls = 0;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('api.resend.com/emails')) {
          resendCalls += 1;
          return new Response(JSON.stringify({ id: `em_${resendCalls}` }), { status: 200 });
        }
        return origFetch(input, init);
      }) as typeof fetch;

      const dispatchRes = await dispatchParentHubAnnouncementEmails({
        teamId: team.brand.teamId,
        teamName: team.brand.name,
        teamSlug: team.brand.slug,
        category: 'MEET',
        title: 'Bus Update',
        body: 'Report at 2 PM',
        originUrl: 'https://meetready.app',
      });
      expect(dispatchRes.sentCount).toBe(61);
      expect(resendCalls).toBe(61);
    });
  });

  describe('5. GPS Attendance Guards, Injury Guards, Stripe Retry/PG Idempotency, District Dedup, Wahoo & Funnel/Pre-Warm', () => {
    it('enforces GPS attendance date, accuracy cushion, coach ABSENT/EXCUSED 409, INJURED_MODIFIED preservation, 10/10m rate limit, and 2500 field log cap', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const coachSid = `gps_hc_${tag}`;
      const athSid = `gps_ath_${tag}`;
      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: `GPS Guard ${tag}`,
        orgType: 'HIGH_SCHOOL',
      });
      createdTeamIds.push(team.brand.teamId);

      await updateTeamBranding({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        updates: {
          practiceVenues: [
            {
              id: 'track_1',
              name: 'Home Track',
              category: 'TRACK',
              latitude: 37.4,
              longitude: -122.1,
              radiusMeters: 100,
              enabled: true,
            },
          ],
        },
      });
      const claim = await claimTeamJoinInvite({
        callerSid: athSid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Track Runner',
        birthYear: new Date().getUTCFullYear() - 20,
      });
      const memId = claim.summary!.memberships.find((m) => m.userSid === athSid)!.membershipId;

      const todayIso = new Date().toISOString().slice(0, 10);
      const staleIso = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);

      // Rejects date > +/- 1 day UTC
      const staleRes = await selfCheckInTeamAttendance({
        callerSid: athSid,
        teamId: team.brand.teamId,
        date: staleIso,
        latitude: 37.4,
        longitude: -122.1,
      });
      expect(staleRes.ok).toBe(false);
      expect(staleRes.statusCode).toBe(400);

      // ~130m north (~0.00117 deg): fails without cushion, passes with accuracyMeters=35 (100+35 >= 130)
      const nearLat = 37.40117;
      const strictFail = await selfCheckInTeamAttendance({
        callerSid: athSid,
        teamId: team.brand.teamId,
        date: todayIso,
        latitude: nearLat,
        longitude: -122.1,
      });
      expect(strictFail.ok).toBe(false);

      // Excessive accuracyMeters=500 is capped at 50m cushion (~180m north > 150m fails)
      const spoofedAccFail = await selfCheckInTeamAttendance({
        callerSid: athSid,
        teamId: team.brand.teamId,
        date: todayIso,
        latitude: 37.40165,
        longitude: -122.1,
        accuracyMeters: 500,
      });
      expect(spoofedAccFail.ok).toBe(false);

      const cushionedPass = await selfCheckInTeamAttendance({
        callerSid: athSid,
        teamId: team.brand.teamId,
        date: todayIso,
        latitude: nearLat,
        longitude: -122.1,
        accuracyMeters: 40,
      });
      expect(cushionedPass.ok).toBe(true);
      expect(cushionedPass.record?.status).toBe('PRESENT');

      // INJURED athlete preserves INJURED_MODIFIED on self check-in
      const docForInj = (await loadTeamDocRaw(team.brand.teamId))!;
      docForInj.memberships.find((m) => m.membershipId === memId)!.status = 'INJURED';
      await saveTeamDocRaw(team.brand.teamId, docForInj);
      const injuredCheckin = await selfCheckInTeamAttendance({
        callerSid: athSid,
        teamId: team.brand.teamId,
        date: todayIso,
        latitude: 37.4,
        longitude: -122.1,
      });
      expect(injuredCheckin.ok).toBe(true);
      expect(injuredCheckin.record?.status).toBe('INJURED_MODIFIED');

      // Coach marks ABSENT -> self check-in returns 409
      await recordTeamAttendanceBatch({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        date: todayIso,
        entries: [{ membershipId: memId, status: 'ABSENT' }],
        originUrl: 'https://meetready.app',
      });
      const conflictCheckin = await selfCheckInTeamAttendance({
        callerSid: athSid,
        teamId: team.brand.teamId,
        date: todayIso,
        latitude: 37.4,
        longitude: -122.1,
      });
      expect(conflictCheckin.ok).toBe(false);
      expect(conflictCheckin.statusCode).toBe(409);

      // Rate limit 10/10m per user on /attendance/self-checkin
      const athCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_gps_rl', athSid, 'verified')}`;
      const rlUrl = `${baseUrl}/api/teams/${encodeURIComponent(team.brand.teamId)}/attendance/self-checkin`;
      for (let i = 0; i < 10; i += 1) {
        const res = await origFetch(rlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: athCookie },
          body: JSON.stringify({ date: todayIso, latitude: 37.4, longitude: -122.1 }),
        });
        expect(res.status).not.toBe(429);
      }
      const res11 = await origFetch(rlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: athCookie },
        body: JSON.stringify({ date: todayIso, latitude: 37.4, longitude: -122.1 }),
      });
      expect(res11.status).toBe(429);

      // Field mark logs cap at 2,500
      const seedLogs = Array.from({ length: 2520 }, (_, i) => ({
        id: `fm_seed_${i}`,
        teamId: team.brand.teamId,
        membershipId: memId,
        athleteName: 'Track Runner',
        date: todayIso,
        eventCode: 'LJ' as const,
        isCompetition: false,
        attempts: [{ attemptNumber: 1, outcome: 'MARK' as const, markMeters: 5.5 }],
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        recordedBySid: coachSid,
      }));
      await saveTenantVaultAsync(teamFieldLogsVaultKey(team.brand.teamId), seedLogs);
      await recordTeamFieldMarks({
        callerSid: coachSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        entries: [
          {
            membershipId: memId,
            athleteName: 'Track Runner',
            date: todayIso,
            eventCode: 'LJ',
            isCompetition: false,
            attempts: [{ attemptNumber: 1, outcome: 'MARK', markMeters: 5.8 }],
          },
        ],
      });
      const cappedArchive = await loadTenantVaultAsync<unknown[]>(
        teamFieldLogsVaultKey(team.brand.teamId),
        []
      );
      expect(cappedArchive).toHaveLength(2500);
    });

    it('restricts deleteTeamInjuryCase to AT for privateClinicalNotes, blocks ASSISTANT_COACH, and rejects cross-athlete injury ID upserts', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const hcSid = `inj_hc_${tag}`;
      const atSid = `inj_at_${tag}`;
      const acSid = `inj_ac_${tag}`;
      const a1Sid = `inj_a1_${tag}`;
      const a2Sid = `inj_a2_${tag}`;

      const team = await createTeamForCoach({
        callerSid: hcSid,
        originUrl: 'https://meetready.app',
        name: `Injury RBAC ${tag}`,
        orgType: 'HIGH_SCHOOL',
      });
      createdTeamIds.push(team.brand.teamId);

      const c1 = await claimTeamJoinInvite({
        callerSid: a1Sid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Athlete One',
        birthYear: new Date().getUTCFullYear() - 20,
      });
      const c2 = await claimTeamJoinInvite({
        callerSid: a2Sid,
        originUrl: 'https://meetready.app',
        codeOrSlug: team.brand.joinCode,
        athleteName: 'Athlete Two',
        birthYear: new Date().getUTCFullYear() - 20,
      });
      const mem1Id = c1.summary!.memberships.find((m) => m.userSid === a1Sid)!.membershipId;
      const mem2Id = c2.summary!.memberships.find((m) => m.userSid === a2Sid)!.membershipId;

      const doc = (await loadTeamDocRaw(team.brand.teamId))!;
      doc.memberships.push(
        {
          membershipId: `mem_at_${tag}`,
          teamId: team.brand.teamId,
          userSid: atSid,
          role: 'ATHLETIC_TRAINER',
          squadGroup: 'Medical',
          invitedName: 'Head AT',
          isMinorU18: false,
          status: 'ACTIVE',
          invitedAt: new Date().toISOString(),
        },
        {
          membershipId: `mem_ac_${tag}`,
          teamId: team.brand.teamId,
          userSid: acSid,
          role: 'ASSISTANT_COACH',
          squadGroup: 'Sprints',
          invitedName: 'Asst Coach',
          isMinorU18: false,
          status: 'ACTIVE',
          invitedAt: new Date().toISOString(),
        }
      );
      await saveTeamDocRaw(team.brand.teamId, doc);

      const created = await upsertTeamInjuryCase({
        callerSid: atSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        input: {
          membershipId: mem1Id,
          bodyRegion: 'HAMSTRING',
          severity: 'MODERATE',
          rtpStage: 'MODIFIED',
          restrictions: 'No sprints',
          coachGuidance: 'Bike only',
          privateClinicalNotes: 'Grade 1 distal biceps femoris tenderness',
        },
      });
      expect(created.ok).toBe(true);
      const caseId = created.injuryCase!.id;

      // Cross-athlete case ID rejected (400)
      const crossAttempt = await upsertTeamInjuryCase({
        callerSid: hcSid,
        teamId: team.brand.teamId,
        originUrl: 'https://meetready.app',
        input: {
          id: caseId,
          membershipId: mem2Id,
          bodyRegion: 'HAMSTRING',
          severity: 'LOW',
          rtpStage: 'FULL_CLEAR',
          restrictions: 'None',
          coachGuidance: 'All clear',
        },
      });
      expect(crossAttempt.ok).toBe(false);
      expect(crossAttempt.status).toBe(400);

      // ASSISTANT_COACH rejected (403)
      const acDel = await deleteTeamInjuryCase({
        callerSid: acSid,
        teamId: team.brand.teamId,
        caseId,
        originUrl: 'https://meetready.app',
      });
      expect(acDel.ok).toBe(false);
      expect(acDel.status).toBe(403);

      // HEAD_COACH blocked from deleting AT case with privateClinicalNotes (403)
      const hcDel = await deleteTeamInjuryCase({
        callerSid: hcSid,
        teamId: team.brand.teamId,
        caseId,
        originUrl: 'https://meetready.app',
      });
      expect(hcDel.ok).toBe(false);
      expect(hcDel.status).toBe(403);

      // ATHLETIC_TRAINER succeeds (200)
      const atDel = await deleteTeamInjuryCase({
        callerSid: atSid,
        teamId: team.brand.teamId,
        caseId,
        originUrl: 'https://meetready.app',
      });
      expect(atDel.ok).toBe(true);
    });

    it('keeps Stripe webhooks retryable on 500 failure before persisting thresh_stripe_events idempotency', async () => {
      const tag = crypto.randomBytes(4).toString('hex');
      const secret = `whsec_retry_${tag}`;
      process.env.STRIPE_WEBHOOK_SECRET = secret;

      const vaultRows = new Map<string, string>();
      const stripeEvents = new Set<string>();
      const executedSql: string[] = [];
      let failTeamSaveOnce = false;

      const coachSid = `stripe_hc_${tag}`;
      const handleSql = (sql: string, params: unknown[] = []) => {
        const trimmed = sql.trim();
        executedSql.push(trimmed);
        if (trimmed.startsWith('SELECT pg_advisory_xact_lock')) {
          return { rows: [{ pg_advisory_xact_lock: '' }] };
        }
        if (trimmed.startsWith('SELECT event_id FROM thresh_stripe_events')) {
          const eid = String(params[0] || '');
          return { rows: stripeEvents.has(eid) ? [{ event_id: eid }] : [] };
        }
        if (trimmed.startsWith('INSERT INTO thresh_stripe_events')) {
          const eid = String(params[0] || '');
          if (stripeEvents.has(eid)) return { rows: [] };
          stripeEvents.add(eid);
          return { rows: [{ event_id: eid }] };
        }
        if (trimmed.startsWith('SELECT encrypted_envelope FROM thresh_tenant_vault')) {
          const env = vaultRows.get(String(params[0] || ''));
          return { rows: env ? [{ encrypted_envelope: env }] : [] };
        }
        if (trimmed.startsWith('INSERT INTO thresh_tenant_vault')) {
          const key = String(params[0] || '');
          if (failTeamSaveOnce && key.startsWith('team_doc_')) {
            failTeamSaveOnce = false;
            throw new Error('transient_pg_write_error');
          }
          vaultRows.set(key, String(params[1] || ''));
          return { rows: [] };
        }
        return { rows: [] };
      };
      const mockPool = {
        query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
        connect: vi.fn(async () => ({
          query: vi.fn(async (sql: string, params: unknown[] = []) => handleSql(sql, params)),
          release: vi.fn(),
        })),
        on: vi.fn(),
        end: vi.fn(async () => undefined),
      };
      setPostgresPoolForTesting(mockPool as unknown as Parameters<typeof setPostgresPoolForTesting>[0]);

      const team = await createTeamForCoach({
        callerSid: coachSid,
        originUrl: 'https://meetready.app',
        name: `Stripe Retry ${tag}`,
        orgType: 'HIGH_SCHOOL',
      });
      createdTeamIds.push(team.brand.teamId);

      const eventPayload = JSON.stringify({
        id: `evt_retry_${tag}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: `cus_${tag}`,
            subscription: `sub_${tag}`,
            metadata: {
              teamId: team.brand.teamId,
              planCode: 'HIGH_SCHOOL_250',
            },
          },
        },
      });

      // 1. Simulated PG write error -> returns 500 AND does NOT mark eventId processed
      failTeamSaveOnce = true;
      const resFail = await processStripeWebhookEvent({
        rawBody: eventPayload,
        signatureHeader: signStripeBody(eventPayload, secret),
      });
      expect(resFail.ok).toBe(false);
      expect(resFail.status).toBe(500);
      expect(stripeEvents.has(`evt_retry_${tag}`)).toBe(false);

      // 2. Stripe retry of the exact same eventId succeeds and marks idempotency
      const resRetry = await processStripeWebhookEvent({
        rawBody: eventPayload,
        signatureHeader: signStripeBody(eventPayload, secret),
      });
      expect(resRetry.ok).toBe(true);
      expect(resRetry.status).toBe(200);
      expect(resRetry.duplicate).toBeUndefined();
      expect(stripeEvents.has(`evt_retry_${tag}`)).toBe(true);

      // 3. Duplicate delivery returns duplicate: true without mutating again
      const resDup = await processStripeWebhookEvent({
        rawBody: eventPayload,
        signatureHeader: signStripeBody(eventPayload, secret),
      });
      expect(resDup.ok).toBe(true);
      expect(resDup.duplicate).toBe(true);
    });

    it('deduplicates DISTRICT_2000 annual commitment per shared districtName, fixes Wahoo workout_type_id/sync/timeout, skips Postgres pre-warm on light paths, and weights funnel GROUP BY rows', async () => {
      const adSid = 'district_dedup_ad';
      const todayIso = new Date().toISOString().slice(0, 10);
      const makeDistrictSchool = (id: string, name: string): StoredTeamDocument => ({
        brand: {
          teamId: id,
          slug: id,
          joinCode: 'DIST',
          name,
          shortName: id,
          districtName: 'Metro Unified School District',
          orgType: 'HIGH_SCHOOL',
          primarySport: 'Running',
          primaryHex: '#121413',
          secondaryHex: '#D8FF2A',
          defaultSafeSportShield: true,
          enableParentGuardianCc: true,
          coachDisplayName: 'Coach',
          createdAt: '2026-09-01T00:00:00Z',
        },
        billing: {
          planCode: 'DISTRICT_2000',
          status: 'ACTIVE_PAID',
          billingCycleEndIso: '2027-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        },
        memberships: [
          {
            membershipId: `mem_${id}`,
            teamId: id,
            userSid: adSid,
            role: 'ORG_ADMIN',
            squadGroup: 'Varsity',
            invitedName: 'AD',
            isMinorU18: false,
            status: 'ACTIVE',
            invitedAt: '2026-09-01T00:00:00Z',
          },
        ],
        broadcastWorkouts: [],
        updatedAt: '2026-11-22T00:00:00Z',
      });

      const overview = buildDistrictOverviewFromDocs(
        [
          makeDistrictSchool('tm_d1', 'North High'),
          makeDistrictSchool('tm_d2', 'South High'),
        ],
        adSid,
        { todayIso }
      );
      expect(overview.totals.schoolCount).toBe(2);
      expect(overview.totals.totalAnnualCommittedUsd).toBe(2000);

      // Wahoo push workout_type_id: Running -> 1, Cycling -> 0, with AbortSignal timeout
      const pushedPayloads: Array<{ workout?: { workout_type_id?: number }; hasSignal?: boolean }> = [];
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        if (urlStr === 'https://api.wahooligan.com/v1/plans') {
          return new Response(JSON.stringify({ id: 101 }), { status: 200 });
        }
        if (urlStr === 'https://api.wahooligan.com/v1/workouts') {
          const parsed = JSON.parse(String(init?.body || '{}')) as {
            workout?: { workout_type_id?: number };
          };
          pushedPayloads.push({
            workout: parsed.workout,
            hasSignal: Boolean(init?.signal),
          });
          return new Response(JSON.stringify({ id: 202 }), { status: 200 });
        }
        if (urlStr.startsWith('https://api.wahooligan.com/v1/workouts?')) {
          return new Response(
            JSON.stringify({
              workouts: [
                { id: 1, name: 'Track Tempo', workout_type_id: 1, starts: `${todayIso}T09:00:00Z` },
                { id: 2, name: 'Treadmill Run', workout_type_id: 5, starts: `${todayIso}T10:00:00Z` },
                { id: 3, name: 'Recovery Spin', workout_type_id: 0, starts: `${todayIso}T11:00:00Z` },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return origFetch(input, init);
      }) as typeof fetch;

      await pushWorkoutToWahooCloud({
        accessToken: 'w_tok',
        input: {
          name: '8x400',
          date: todayIso,
          sportCategory: 'Running',
          steps: [],
        },
      });
      await pushWorkoutToWahooCloud({
        accessToken: 'w_tok',
        input: {
          name: 'Threshold Ride',
          date: todayIso,
          sportCategory: 'Cycling',
          steps: [],
        },
      });
      expect(pushedPayloads[0].workout?.workout_type_id).toBe(1);
      expect(pushedPayloads[0].hasSignal).toBe(true);
      expect(pushedPayloads[1].workout?.workout_type_id).toBe(0);

      const syncRes = await origFetch(`${baseUrl}/api/wahoo/sync`, {
        headers: { 'x-wahoo-access-token': 'w_tok' },
      });
      expect(syncRes.status).toBe(200);
      const syncJson = (await syncRes.json()) as {
        activities: Array<{ name: string; sportCategory: string }>;
      };
      expect(syncJson.activities.find((a) => a.name === 'Track Tempo')?.sportCategory).toBe('Running');
      expect(syncJson.activities.find((a) => a.name === 'Treadmill Run')?.sportCategory).toBe('Running');
      expect(syncJson.activities.find((a) => a.name === 'Recovery Spin')?.sportCategory).toBe('Cycling');

      // apiRouter skips session_*/garmin_* PG pre-warm on /api/health, /api/analytics/event, and /api/teams/public/*
      const seenVaultSql: Array<{ sql: string; params: unknown[] }> = [];
      const lightPool = {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
          const trimmed = sql.trim();
          seenVaultSql.push({ sql: trimmed, params });
          if (trimmed.includes('FROM thresh_funnel_events')) {
            return {
              rows: [
                {
                  event_name: 'landing_view',
                  utm_source: 'print',
                  utm_medium: 'qr',
                  utm_campaign: 'demo',
                  referrer_host: null,
                  role: 'COACH',
                  tier: 'HS',
                  created_at: `${todayIso}T00:00:00.000Z`,
                  event_count: 15,
                },
              ],
            };
          }
          if (trimmed.startsWith('SELECT 1')) {
            return { rows: [{ '?column?': 1 }] };
          }
          return { rows: [] };
        }),
        connect: vi.fn(async () => ({
          query: vi.fn(async () => ({ rows: [] })),
          release: vi.fn(),
        })),
        on: vi.fn(),
        end: vi.fn(async () => undefined),
      };
      setPostgresPoolForTesting(lightPool as unknown as Parameters<typeof setPostgresPoolForTesting>[0]);

      const sid = 'prewarm_skip_sid_12345';
      const cookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_prewarm', sid, 'verified')}`;
      seenVaultSql.length = 0;
      await origFetch(`${baseUrl}/api/health`, { headers: { Cookie: cookie } });
      await origFetch(`${baseUrl}/api/analytics/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ eventName: 'landing_view' }),
      });
      await origFetch(`${baseUrl}/api/teams/public/nonexistent`, { headers: { Cookie: cookie } });
      const prewarmQueries = seenVaultSql.filter((q) => {
        const key = String(q.params?.[0] || '');
        return key.startsWith('session_') || key.startsWith('garmin_');
      });
      expect(prewarmQueries).toHaveLength(0);

      // Funnel summary aggregates SQL GROUP BY event_count weights accurately
      const funnel = await getFunnelSummaryAsync({ windowDays: 30 });
      expect(funnel.storageBackend).toBe('POSTGRES');
      expect(funnel.totalEvents).toBe(15);
      expect(funnel.byEvent.landing_view).toBe(15);
      expect(funnel.byUtmSource.print).toBe(15);
      expect(funnel.dailyCounts.find((d) => d.date === todayIso)?.total).toBe(15);
    });
  });
});
