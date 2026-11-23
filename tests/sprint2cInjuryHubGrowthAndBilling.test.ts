import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiRouter } from '../server/apiRouter.ts';
import { teamBillingRouter } from '../server/routers/teamBillingRouter.ts';
import { teamInjuryRouter } from '../server/routers/teamInjuryRouter.ts';
import {
  parentEmailSubsVaultKey,
  type ParentHubEmailSubscriptionRecord,
} from '../server/athleticSyncService.ts';
import {
  acknowledgeParentConsent,
} from '../server/teamService.ts';
import {
  issueOrResendParentConsentLink,
  removeTeamFromDirectoryAndVault,
} from '../server/teamLifecycleService.ts';
import {
  SESSION_COOKIE_NAME,
  issueSessionToken,
} from '../server/securityUtils.ts';
import {
  deleteTenantVault,
  listTeamAuditLogAsync,
  loadTenantVaultAsync,
} from '../server/tokenVault.ts';
import {
  buildDemoSeedInjuryCases,
  computePainTrendHeatmap,
} from '../src/physiology/injuryHubEngine.ts';
import { buildPresetExternalTeamSummary } from '../src/utils/athleticNetAndTfrrsEngine.ts';
import { buildCleanRoomPublicHubFromTeamSummary } from '../src/utils/publicTeamHubRoute.ts';
import { generateQrMatrix } from '../src/utils/qrCodeSvg.ts';
import {
  SHARE_CARD_QR_FALLBACK_URL,
  renderShareCardPngBlob,
  resolveShareCardQrTarget,
  sanitizeSharedWorkoutPayload,
} from '../src/utils/shareWorkoutEngine.ts';
import { PublicTeamHubPage } from '../src/components/PublicTeamHubPage.tsx';
import type { TeamSummaryWithRole } from '../src/types.ts';

const ROOT = process.cwd();

function signStripePayload(
  rawBody: string,
  secret: string,
  timestampSecs = Math.floor(Date.now() / 1000)
): string {
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${timestampSecs}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestampSecs},v1=${sig}`;
}

describe('Sprint 2C: Athletic Trainer Injury Hub, Parent Growth, Share PNG QR, School PO & Stripe Billing', () => {
  const createdTeamIds: string[] = [];
  const origEnv = { ...process.env };
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.use(
      express.json({
        limit: '2mb',
        verify: (req, _res, buf) => {
          (req as { rawBody?: Buffer }).rawBody = buf;
        },
      })
    );
    app.use(apiRouter);
    app.use(teamInjuryRouter);
    app.use(teamBillingRouter);

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
    vi.unstubAllGlobals();
    process.env = { ...origEnv };
    while (createdTeamIds.length > 0) {
      const id = createdTeamIds.pop();
      if (id) {
        deleteTenantVault(parentEmailSubsVaultKey(id));
        await removeTeamFromDirectoryAndVault(id).catch(() => undefined);
      }
    }
    deleteTenantVault('stripe_webhook_state_v1');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it('1. Injury Hub: widens 13 painArea values, enforces AT clinical note isolation, syncs roster status & logs audit trail', async () => {
    const hexSid = () => crypto.randomBytes(12).toString('hex');
    const coachSid = hexSid();
    const trainerSid = hexSid();
    const athSid = hexSid();
    const parentSid = hexSid();

    const cookieFor = (uid: string, sid: string) =>
      `${SESSION_COOKIE_NAME}=${issueSessionToken(uid, sid, 'verified')}`;

    const coachCookie = cookieFor('usr_coach_inj', coachSid);
    const trainerCookie = cookieFor('usr_at_inj', trainerSid);
    const athCookie = cookieFor('usr_ath_inj', athSid);
    const parentCookie = cookieFor('usr_par_inj', parentSid);

    // Create HS team
    const createRes = await fetch(`${baseUrl}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
      body: JSON.stringify({
        name: 'Oak Creek Injury Test XC',
        shortName: 'OCXC',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach Ortiz',
        externalSync: { enablePublicParentHub: true },
      }),
    });
    const created = await createRes.json();
    expect(createRes.status).toBe(200);
    const teamId: string = created.team.brand.teamId;
    const joinCode: string = created.team.brand.joinCode;
    createdTeamIds.push(teamId);

    // Athlete + Trainer + Parent join
    const athJoinRes = await fetch(`${baseUrl}/api/teams/join-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: athCookie },
      body: JSON.stringify({
        codeOrSlug: joinCode,
        athleteName: 'Lucas Meyer',
        athleteEmail: 'lucas@oakcreek.edu',
        squadGroup: 'Varsity',
        birthMonthYear: '2009-04',
        parentGuardianEmail: 'parent.meyer@example.com',
      }),
    });
    const athJoinData = await athJoinRes.json();
    const athMemId: string = athJoinData.team.memberships.find(
      (m: { invitedName: string }) => m.invitedName === 'Lucas Meyer'
    ).membershipId;

    const consentLink = await issueOrResendParentConsentLink({
      callerSid: coachSid,
      teamId,
      membershipId: athMemId,
      originUrl: baseUrl,
    });
    expect(consentLink.ok).toBe(true);
    const consentToken = new URL(consentLink.consentUrl!).searchParams.get('token')!;
    const ackConsent = await acknowledgeParentConsent(consentToken);
    expect(ackConsent.ok).toBe(true);

    const trainerJoinRes = await fetch(`${baseUrl}/api/teams/join-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: trainerCookie },
      body: JSON.stringify({
        codeOrSlug: joinCode,
        athleteName: 'Taylor ATC',
        athleteEmail: 'taylor.atc@oakcreek.edu',
        squadGroup: 'Medical',
        birthMonthYear: '1991-03',
      }),
    });
    const trainerJoinData = await trainerJoinRes.json();
    const trainerMemId: string = trainerJoinData.team.memberships.find(
      (m: { invitedName: string }) => m.invitedName === 'Taylor ATC'
    ).membershipId;

    await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(
        trainerMemId
      )}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({ role: 'ATHLETIC_TRAINER' }),
      }
    );

    await fetch(`${baseUrl}/api/teams/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
      body: JSON.stringify({ codeOrSlug: created.team.brand.slug, followerName: 'Meyer Parent' }),
    });

    // Verify all 13 painArea values survive athlete telemetry snapshot sync (including GROIN, QUAD, ANKLE, SHOULDER, ELBOW)
    const todayIso = new Date().toISOString().slice(0, 10);
    const checkInSnapRes = await fetch(
      `${baseUrl}/api/teams/sync-snapshot`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: athCookie },
        body: JSON.stringify({
          snapshot: {
            hasConnectedWatch: false,
            verdictLabel: 'Active',
            readinessScore: 72,
            ctl: 40,
            atl: 45,
            tsb: -5,
            acuteLoad7d: 260,
            lowAerobicPct: 75,
            highAerobicPct: 20,
            neuromuscularPct: 5,
            caraHours7d: 6,
            sessionCheckIns: [
              {
                id: 'chk-groin',
                date: todayIso,
                rpe: 7,
                painFlag: true,
                painArea: 'GROIN',
                sorenessNote: 'Adductor tightness on hurdles',
                createdAt: new Date().toISOString(),
              },
              {
                id: 'chk-ankle',
                date: todayIso,
                rpe: 6,
                painFlag: true,
                painArea: 'ANKLE',
                createdAt: new Date().toISOString(),
              },
              {
                id: 'chk-quad',
                date: todayIso,
                rpe: 6,
                painFlag: true,
                painArea: 'QUAD',
                createdAt: new Date().toISOString(),
              },
              {
                id: 'chk-shoulder',
                date: todayIso,
                rpe: 5,
                painFlag: true,
                painArea: 'SHOULDER',
                createdAt: new Date().toISOString(),
              },
              {
                id: 'chk-elbow',
                date: todayIso,
                rpe: 5,
                painFlag: true,
                painArea: 'ELBOW',
                createdAt: new Date().toISOString(),
              },
            ],
          },
        }),
      }
    );
    expect(checkInSnapRes.status).toBe(200);
    const snapTeamData = await checkInSnapRes.json();
    const syncedTeam = (snapTeamData.teams as TeamSummaryWithRole[]).find(
      (t) => t.brand.teamId === teamId
    )!;
    const syncedCheckIns = syncedTeam.memberships.find(
      (m) => m.membershipId === athMemId
    )!.liveSnapshot!.sessionCheckIns!;
    expect(syncedCheckIns.map((c: { painArea?: string }) => c.painArea)).toEqual([
      'GROIN',
      'ANKLE',
      'QUAD',
      'SHOULDER',
      'ELBOW',
    ]);

    // Athlete & Parent are forbidden from /injuries
    const athDenied = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries`, {
      headers: { Cookie: athCookie },
    });
    expect(athDenied.status).toBe(403);
    const parDenied = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
      body: JSON.stringify({
        membershipId: athMemId,
        bodyRegion: 'SHIN',
        severity: 'MODERATE',
        rtpStage: 'OUT',
      }),
    });
    expect(parDenied.status).toBe(403);

    // ATHLETIC_TRAINER creates an OUT case with privateClinicalNotes -> syncs roster to INJURED
    const createCaseRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: trainerCookie },
        body: JSON.stringify({
          membershipId: athMemId,
          bodyRegion: 'ANKLE',
          severity: 'HIGH',
          rtpStage: 'OUT',
          restrictions: 'No running or jumps; walking boot.',
          coachGuidance: 'Upper-body strength & seated erg only.',
          privateClinicalNotes: 'AT ONLY: Grade 2 ATFL sprain; Ottawa rules negative.',
          targetReturnDate: '2026-12-05',
        }),
      }
    );
    expect(createCaseRes.status).toBe(200);
    const createCaseData = await createCaseRes.json();
    const caseId: string = createCaseData.case.id;
    expect(createCaseData.case.privateClinicalNotes).toBe(
      'AT ONLY: Grade 2 ATFL sprain; Ottawa rules negative.'
    );
    expect(
      createCaseData.team.memberships.find(
        (m: { membershipId: string }) => m.membershipId === athMemId
      ).status
    ).toBe('INJURED');

    // HEAD_COACH reads injuries -> clinical notes MUST be stripped!
    const coachListRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries`,
      { headers: { Cookie: coachCookie } }
    );
    expect(coachListRes.status).toBe(200);
    const coachListData = await coachListRes.json();
    expect(coachListData.cases).toHaveLength(1);
    expect(coachListData.cases[0].rtpStage).toBe('OUT');
    expect(coachListData.cases[0].restrictions).toContain('walking boot');
    expect(coachListData.cases[0].privateClinicalNotes).toBeUndefined();

    // HEAD_COACH updates RTP stage to MODIFIED & attempts to pass privateClinicalNotes -> ignored/preserved!
    const coachUpdateRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          id: caseId,
          membershipId: athMemId,
          bodyRegion: 'ANKLE',
          severity: 'MODERATE',
          rtpStage: 'MODIFIED',
          restrictions: 'Pool running and bike flush only.',
          coachGuidance: 'Swap track tempo for 30m pool run.',
          privateClinicalNotes: 'Coach should not overwrite AT notes',
        }),
      }
    );
    expect(coachUpdateRes.status).toBe(200);
    const coachUpdateData = await coachUpdateRes.json();
    expect(coachUpdateData.case.privateClinicalNotes).toBeUndefined();

    // Verify AT still sees original privateClinicalNotes intact!
    const atVerifyRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries`,
      { headers: { Cookie: trainerCookie } }
    );
    const atVerifyData = await atVerifyRes.json();
    expect(atVerifyData.cases[0].privateClinicalNotes).toBe(
      'AT ONLY: Grade 2 ATFL sprain; Ottawa rules negative.'
    );
    expect(atVerifyData.cases[0].rtpStage).toBe('MODIFIED');

    // Moving RTP stage to CLEARED restores membership.status back to ACTIVE
    const clearRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: trainerCookie },
        body: JSON.stringify({
          id: caseId,
          membershipId: athMemId,
          bodyRegion: 'ANKLE',
          severity: 'LOW',
          rtpStage: 'CLEARED',
          restrictions: 'Taped for uneven XC trails.',
          coachGuidance: 'Full practice cleared.',
        }),
      }
    );
    expect(clearRes.status).toBe(200);
    const clearData = await clearRes.json();
    expect(
      clearData.team.memberships.find(
        (m: { membershipId: string }) => m.membershipId === athMemId
      ).status
    ).toBe('ACTIVE');

    // Audit log recorded INJURY_CASE_UPDATED without clinical notes
    const auditLogs = await listTeamAuditLogAsync(teamId, 20);
    const injAudit = auditLogs.find((a) => a.action === 'INJURY_CASE_UPDATED');
    expect(injAudit).toBeTruthy();
    expect(JSON.stringify(injAudit)).not.toContain('ATFL sprain');

    // Heatmap engine covers all 13 regions cleanly
    const heatmap = computePainTrendHeatmap({
      memberships: clearData.team.memberships,
      injuryCases: clearData.cases,
      windowDays: 7,
      referenceDateIso: todayIso,
    });
    expect(heatmap.regions).toHaveLength(13);
    expect(heatmap.totalPainFlags7d).toBe(5);
    expect(heatmap.regions.find((r) => r.region === 'GROIN')?.checkInCount).toBe(1);

    // Demo seed strips clinical notes for non-AT roles
    const demoSummary = buildPresetExternalTeamSummary('WILLOW_GLEN', 'Coach Morales');
    expect(buildDemoSeedInjuryCases(demoSummary).every((c) => !c.privateClinicalNotes)).toBe(true);
    expect(
      buildDemoSeedInjuryCases({ ...demoSummary, myRole: 'ATHLETIC_TRAINER' }).some((c) =>
        Boolean(c.privateClinicalNotes)
      )
    ).toBe(true);

    // Delete injury case
    const delRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/injuries/${encodeURIComponent(caseId)}`,
      { method: 'DELETE', headers: { Cookie: trainerCookie } }
    );
    expect(delRes.status).toBe(200);
    const delData = await delRes.json();
    expect(delData.cases).toHaveLength(0);

    // ATHLETIC_TRAINER still gets 403 on audit-log and workout broadcasts
    const trainerAuditDenied = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/audit-log`,
      { headers: { Cookie: trainerCookie } }
    );
    expect(trainerAuditDenied.status).toBe(403);
    const trainerBroadcastDenied = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/workouts/broadcast`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: trainerCookie },
        body: JSON.stringify({
          targetSquadGroup: 'ALL',
          date: todayIso,
          name: 'Blocked Trainer Session',
          sportCategory: 'Running',
          plannedDurationSecs: 1800,
          plannedLoad: 40,
          workoutSyntax: '- 30m Easy',
          description: 'Easy',
        }),
      }
    );
    expect(trainerBroadcastDenied.status).toBe(403);
  });

  it('2. Parent Hub: serves RFC 5545 live .ics feed, stores SHA-256 subscription tokens, handles Resend fanout & unsubscribes cleanly', async () => {
    const coachSid = crypto.randomBytes(12).toString('hex');
    const coachCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_hub_coach', coachSid, 'verified')}`;

    const createRes = await fetch(`${baseUrl}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
      body: JSON.stringify({
        name: 'Willow Glen Public Feed XC',
        shortName: 'WGXC',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach Morales',
        externalSync: { enablePublicParentHub: false },
      }),
    });
    const created = await createRes.json();
    const teamId: string = created.team.brand.teamId;
    const slug: string = created.team.brand.slug;
    createdTeamIds.push(teamId);

    // Gate on enablePublicParentHub === true
    const blockedIcs = await fetch(
      `${baseUrl}/api/teams/public/${encodeURIComponent(slug)}/calendar.ics`
    );
    expect(blockedIcs.status).toBe(404);

    // Enable Public Parent Hub & sync a meet
    await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/external-sync/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
      body: JSON.stringify({ config: { enablePublicParentHub: true } }),
    });
    await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/external-sync/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
      body: JSON.stringify({
        meets: [
          {
            name: 'Crystal Springs Invitational',
            date: '2026-12-05',
            scheduledTime: '09:30',
            locationName: 'Crystal Springs Course, Belmont CA',
            externalSource: 'ATHLETIC_NET',
          },
        ],
      }),
    });

    const icsRes = await fetch(
      `${baseUrl}/api/teams/public/${encodeURIComponent(slug)}/calendar.ics`
    );
    expect(icsRes.status).toBe(200);
    expect(icsRes.headers.get('content-type')).toContain('text/calendar');
    const icsText = await icsRes.text();
    expect(icsText).toContain('\r\n');
    expect(icsText).toContain('X-WR-CALNAME:Willow Glen Public Feed XC Meet Schedule');
    expect(icsText).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT6H');
    expect(icsText).toContain('DTSTAMP:');
    expect(icsText).toContain('DTSTART;VALUE=DATE:20261205');
    expect(icsText).toContain('DTEND;VALUE=DATE:20261206');
    expect(icsText).toContain('Crystal Springs Invitational');

    // Graceful fallback when RESEND_API_KEY is unconfigured
    delete process.env.RESEND_API_KEY;
    const fallbackSub = await fetch(
      `${baseUrl}/api/teams/public/${encodeURIComponent(slug)}/subscribe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'parent1@example.com' }),
      }
    );
    expect(fallbackSub.status).toBe(200);
    const fallbackData = await fallbackSub.json();
    expect(fallbackData.ok).toBe(true);
    expect(fallbackData.emailConfigured).toBe(false);
    expect(fallbackData.message).toMatch(/Calendar Subscribe/i);

    // With RESEND_API_KEY configured, mock Resend API to capture confirm/unsubscribe links
    process.env.RESEND_API_KEY = 're_test_parent_hub_key';
    const sentEmails: Array<{ to: string[]; subject: string; html: string; text: string }> = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.resend.com/emails') {
        const body = JSON.parse(String(init?.body || '{}')) as {
          to: string[];
          subject: string;
          html: string;
          text: string;
        };
        sentEmails.push(body);
        return new Response(JSON.stringify({ id: `msg_${sentEmails.length}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(input, init);
    });

    const subRes = await realFetch(
      `${baseUrl}/api/teams/public/${encodeURIComponent(slug)}/subscribe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'parent.verified@family.org' }),
      }
    );
    expect(subRes.status).toBe(200);
    const subJson = await subRes.json();
    expect(subJson.emailSent).toBe(true);
    expect(sentEmails).toHaveLength(1);

    const confirmMatch = sentEmails[0].text.match(/subscribe\/confirm\?token=([^\s]+)/);
    expect(confirmMatch?.[1]).toBeTruthy();
    const rawConfirmToken = decodeURIComponent(confirmMatch![1]);

    // Verify vault stored SHA-256 hash, NOT raw token
    const storedVault = await loadTenantVaultAsync<ParentHubEmailSubscriptionRecord[]>(
      parentEmailSubsVaultKey(teamId),
      []
    );
    const storedRec = storedVault.find((r) => r.email === 'parent.verified@family.org')!;
    expect(storedRec.confirmTokenHash).toBe(
      crypto.createHash('sha256').update(rawConfirmToken).digest('hex')
    );
    expect(JSON.stringify(storedVault)).not.toContain(rawConfirmToken);

    // Confirm subscription
    const confirmRes = await realFetch(
      `${baseUrl}/api/teams/public/${encodeURIComponent(
        slug
      )}/subscribe/confirm?token=${encodeURIComponent(rawConfirmToken)}`,
      { headers: { Accept: 'application/json' } }
    );
    expect(confirmRes.status).toBe(200);
    const confirmData = await confirmRes.json();
    expect(confirmData.ok).toBe(true);

    // Posting announcement with publishToParentHub: true fans out email outside lock
    const annRes = await realFetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/announcements`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          title: 'Bus Departs 2:15 PM',
          body: 'North Gate bus leaves promptly for Crystal Springs.',
          category: 'MEET_LOGISTICS',
          publishToParentHub: true,
        }),
      }
    );
    expect(annRes.status).toBe(200);
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[1].to).toEqual(['parent.verified@family.org']);
    expect(sentEmails[1].subject).toContain('Bus Departs 2:15 PM');

    const unsubMatch = sentEmails[1].text.match(/unsubscribe\?token=([^\s]+)/);
    expect(unsubMatch?.[1]).toBeTruthy();
    const rawUnsubToken = decodeURIComponent(unsubMatch![1]);

    const unsubRes = await realFetch(
      `${baseUrl}/api/teams/public/${encodeURIComponent(
        slug
      )}/unsubscribe?token=${encodeURIComponent(rawUnsubToken)}`,
      { headers: { Accept: 'application/json' } }
    );
    expect(unsubRes.status).toBe(200);

    // Posting another announcement after unsubscribe does not email the unsubscribed parent
    await realFetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/announcements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
      body: JSON.stringify({
        title: 'Warmup Update',
        body: 'Report to tent 45m early.',
        category: 'GENERAL',
        publishToParentHub: true,
      }),
    });
    expect(sentEmails).toHaveLength(2);

    // Verify SSR rendering of PublicTeamHubPage includes Calendar Subscribe + Email Updates card without Coach Coach
    const presetHub = buildCleanRoomPublicHubFromTeamSummary(
      buildPresetExternalTeamSummary('WILLOW_GLEN', 'Coach Morales')
    );
    const ssrHtml = renderToStaticMarkup(
      React.createElement(PublicTeamHubPage, {
        slugOrCode: 'willow-glen-high-school-xc',
        isDark: false,
        onToggleDark: () => {},
        initialPayloadForTest: presetHub,
        onExitHub: () => {},
      })
    );
    expect(ssrHtml).toContain('Calendar Subscribe');
    expect(ssrHtml).toContain('Parent Email Updates');
    expect(ssrHtml).not.toContain('Coach Coach');
  });

  it('3. Workout Share PNG QR Stamp: enforces 106-byte UTF-8 QR cap, prevents 3-line title footer collisions, and stamps 132x132 QR tile', async () => {
    const shortUrl = 'https://meetready.app/share/workout?w=abc123';
    expect(Buffer.byteLength(shortUrl, 'utf8')).toBeLessThanOrEqual(106);
    expect(resolveShareCardQrTarget(shortUrl)).toBe(shortUrl);

    const longUrl = `https://meetready.app/share/workout?w=${'x'.repeat(120)}`;
    expect(Buffer.byteLength(longUrl, 'utf8')).toBeGreaterThan(106);
    expect(resolveShareCardQrTarget(longUrl)).toBe(SHARE_CARD_QR_FALLBACK_URL);
    expect(resolveShareCardQrTarget('')).toBe(SHARE_CARD_QR_FALLBACK_URL);

    // Multi-byte UTF-8 check: 40 emojis > 106 bytes even though length === 40
    const utf8Over = `https://meetready.app/${'🏃'.repeat(25)}`;
    expect(resolveShareCardQrTarget(utf8Over)).toBe(SHARE_CARD_QR_FALLBACK_URL);

    const qrMatrix = generateQrMatrix(resolveShareCardQrTarget(longUrl));
    expect(qrMatrix.length).toBeGreaterThanOrEqual(21);

    // Mock 2D Canvas to verify exact pixel bounds & zero collision on 3-line title
    const fillRectCalls: Array<{ x: number; y: number; w: number; h: number; fillStyle: string }> =
      [];
    const fillTextCalls: Array<{ text: string; x: number; y: number }> = [];
    const roundedRectDraws: Array<{ x: number; y: number; w: number; h: number; fillStyle: string }> =
      [];

    let lastMoveTo = { x: 0, y: 0 };
    let currentRectCandidate: { x: number; y: number; w: number; h: number } | null = null;
    const mockCtx = {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      font: '16px sans-serif',
      textBaseline: 'top',
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
      measureText: (t: string) => ({ width: t.length * 28 }),
      beginPath: () => {
        currentRectCandidate = null;
      },
      moveTo: (x: number, y: number) => {
        lastMoveTo = { x, y };
      },
      lineTo: (x: number, y: number) => {
        if (lastMoveTo.x > 0 && x > lastMoveTo.x) {
          currentRectCandidate = {
            x: Math.round(lastMoveTo.x - 10),
            y: Math.round(lastMoveTo.y),
            w: Math.round(x - lastMoveTo.x + 20),
            h: 0,
          };
        }
      },
      quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => {
        if (currentRectCandidate && y > currentRectCandidate.y) {
          currentRectCandidate.h = Math.max(currentRectCandidate.h, Math.round(y - currentRectCandidate.y));
        }
        void x;
      },
      closePath: () => {},
      fill: () => {
        if (currentRectCandidate && currentRectCandidate.h > 0) {
          roundedRectDraws.push({
            ...currentRectCandidate,
            fillStyle: String(mockCtx.fillStyle),
          });
        }
      },
      stroke: () => {},
      fillRect: (x: number, y: number, w: number, h: number) => {
        fillRectCalls.push({ x, y, w, h, fillStyle: String(mockCtx.fillStyle) });
      },
      fillText: (text: string, x: number, y: number) => {
        fillTextCalls.push({ text, x, y });
      },
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => mockCtx,
      toBlob: (cb: (blob: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
    };

    vi.stubGlobal('document', {
      createElement: () => mockCanvas,
    });

    const threeLinePayload = sanitizeSharedWorkoutPayload({
      kind: 'WORKOUT',
      version: 1,
      title:
        'Varsity Invitational Championship Aerobic Threshold Progression Session With Long Title Wrap',
      sport: 'Running',
      date: '2026-11-22',
      workoutSyntax: [
        '- 10m 65% Effort Warmup',
        '- 400m 95% Effort Threshold Rep 1',
        '- 400m 95% Effort Threshold Rep 2',
        '- 400m 95% Effort Threshold Rep 3',
        '- 400m 95% Effort Threshold Rep 4',
        '- 400m 95% Effort Threshold Rep 5',
        '- 10m 60% Effort Cooldown',
      ].join('\n'),
    })!;

    const blob = await renderShareCardPngBlob({
      payload: threeLinePayload,
      ftpWatts: 280,
      thresholdPaceSecsPerKm: 230,
      unit: 'mi',
      shareUrl: longUrl,
    });
    expect(blob).not.toBeNull();
    expect(mockCanvas.width).toBe(1080);
    expect(mockCanvas.height).toBe(1350);

    // Footer divider moved to y = 1140
    expect(fillRectCalls.some((c) => c.x === 84 && c.y === 1140 && c.w === 912 && c.h === 2)).toBe(
      true
    );

    // All content step rows strictly <= 1124 bottom edge (exclude inner frame & footer QR tile)
    const contentRows = roundedRectDraws.filter(
      (r) =>
        r.y >= 600 &&
        r.y < 1140 &&
        (r.fillStyle === '#1A1D1B' || r.fillStyle === '#151816') &&
        r.h <= 60
    );
    expect(contentRows.length).toBeGreaterThan(0);
    for (const row of contentRows) {
      expect(row.y + row.h).toBeLessThanOrEqual(1124);
    }

    // QR dark modules stamped inside the 132x132 tile at (860, 1156) with quiet zone >= 8px
    const qrModules = fillRectCalls.filter(
      (c) =>
        c.fillStyle === '#121413' &&
        c.x >= 868 &&
        c.y >= 1164 &&
        c.x + c.w <= 984 &&
        c.y + c.h <= 1280
    );
    expect(qrModules.length).toBeGreaterThan(80);
    expect(fillTextCalls.some((t) => t.text === 'SCAN FOR SPLITS · meetready.app/share')).toBe(
      true
    );
  });

  it('4. School PO & Stripe Billing: enforces HEAD_COACH|ORG_ADMIN RBAC, issues MR-PO Net-30 invoices, verifies HMAC-SHA256 webhooks & 300s replay guard', async () => {
    const hexSid = () => crypto.randomBytes(12).toString('hex');
    const coachSid = hexSid();
    const assistantSid = hexSid();
    const athSid = hexSid();

    const coachCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_bill_hc', coachSid, 'verified')}`;
    const assistantCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_bill_asst', assistantSid, 'verified')}`;
    const athCookie = `${SESSION_COOKIE_NAME}=${issueSessionToken('usr_bill_ath', athSid, 'verified')}`;

    const createRes = await fetch(`${baseUrl}/api/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
      body: JSON.stringify({
        name: 'Bellarmine Track Billing Test',
        shortName: 'BCP',
        orgType: 'HIGH_SCHOOL',
        primarySport: 'Running',
        coachDisplayName: 'Coach Grant',
      }),
    });
    const created = await createRes.json();
    const teamId: string = created.team.brand.teamId;
    const joinCode: string = created.team.brand.joinCode;
    createdTeamIds.push(teamId);

    const asstJoin = await fetch(`${baseUrl}/api/teams/join-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: assistantCookie },
      body: JSON.stringify({
        codeOrSlug: joinCode,
        athleteName: 'Assistant Lee',
        athleteEmail: 'lee@bcp.edu',
        squadGroup: 'Sprints',
        birthMonthYear: '1990-02',
      }),
    });
    const asstMemId: string = (await asstJoin.json()).team.memberships.find(
      (m: { invitedName: string }) => m.invitedName === 'Assistant Lee'
    ).membershipId;

    await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(
        asstMemId
      )}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({ role: 'ASSISTANT_COACH' }),
      }
    );

    await fetch(`${baseUrl}/api/teams/join-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: athCookie },
      body: JSON.stringify({
        codeOrSlug: joinCode,
        athleteName: 'Student Runner',
        athleteEmail: 'student@bcp.edu',
        squadGroup: 'Varsity',
        birthMonthYear: '2009-09',
        parentGuardianEmail: 'parent.student@bcp.edu',
      }),
    });

    // ASSISTANT_COACH & ATHLETE get 403 on billing endpoints
    const asstDenied = await fetch(`${baseUrl}/api/teams/${encodeURIComponent(teamId)}/billing`, {
      headers: { Cookie: assistantCookie },
    });
    expect(asstDenied.status).toBe(403);
    const athDenied = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/billing/po-invoice`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: athCookie },
        body: JSON.stringify({
          planCode: 'HS_250',
          schoolOrDistrictName: 'BCP',
          billingContactEmail: 'ap@bcp.edu',
        }),
      }
    );
    expect(athDenied.status).toBe(403);

    // HEAD_COACH issues HS_250 Net-30 School PO Invoice
    const poRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/billing/po-invoice`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          planCode: 'HS_250',
          schoolOrDistrictName: 'Bellarmine College Prep',
          billingContactEmail: 'business@bcp.edu',
          poNumber: 'PO-2026-901',
        }),
      }
    );
    expect(poRes.status).toBe(200);
    const poData = await poRes.json();
    expect(poData.invoice.invoiceNumber).toMatch(/^MR-PO-\d{4}-\d{4}$/);
    expect(poData.invoice.amountUsd).toBe(250);
    expect(poData.billing.status).toBe('PO_ISSUED');

    // Audit log includes BILLING_PO_ISSUED
    const auditLogs = await listTeamAuditLogAsync(teamId, 20);
    expect(auditLogs.some((a) => a.action === 'BILLING_PO_ISSUED')).toBe(true);

    // Checkout falls back cleanly to SCHOOL_PO when STRIPE_SECRET_KEY is absent
    delete process.env.STRIPE_SECRET_KEY;
    const noStripeRes = await fetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/billing/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({ planCode: 'HS_250' }),
      }
    );
    expect(noStripeRes.status).toBe(200);
    const noStripeData = await noStripeRes.json();
    expect(noStripeData.stripeConfigured).toBe(false);
    expect(noStripeData.fallback).toBe('SCHOOL_PO');

    // With STRIPE_SECRET_KEY configured, checkout calls Stripe REST API
    process.env.STRIPE_SECRET_KEY = 'sk_test_meetready_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_meetready_secret_123';
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.stripe.com/v1/checkout/sessions') {
        const params = new URLSearchParams(String(init?.body || ''));
        expect(params.get('line_items[0][price_data][unit_amount]')).toBe('120000');
        return new Response(
          JSON.stringify({
            id: 'cs_test_coll_123',
            url: 'https://checkout.stripe.com/c/pay/cs_test_coll_123',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return realFetch(input, init);
    });

    const checkoutRes = await realFetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/billing/checkout`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: coachCookie },
        body: JSON.stringify({
          planCode: 'COLLEGIATE_1200',
          billingContactEmail: 'business@bcp.edu',
        }),
      }
    );
    expect(checkoutRes.status).toBe(200);
    const checkoutData = await checkoutRes.json();
    expect(checkoutData.stripeConfigured).toBe(true);
    expect(checkoutData.sessionId).toBe('cs_test_coll_123');

    // Stripe Webhook: reject bad signature & stale timestamp (> 300s)
    const eventPayload = JSON.stringify({
      id: 'evt_checkout_1001',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          customer: 'cus_test_1',
          subscription: 'sub_test_1',
          client_reference_id: teamId,
          metadata: { teamId, planCode: 'HS_250' },
        },
      },
    });

    const badSigRes = await realFetch(`${baseUrl}/api/billing/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1700000000,v1=0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: eventPayload,
    });
    expect(badSigRes.status).toBe(400);

    const staleEpoch = Math.floor(Date.now() / 1000) - 600;
    const staleSigRes = await realFetch(`${baseUrl}/api/billing/stripe/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signStripePayload(
          eventPayload,
          process.env.STRIPE_WEBHOOK_SECRET!,
          staleEpoch
        ),
      },
      body: eventPayload,
    });
    expect(staleSigRes.status).toBe(400);

    // Valid webhook activates team billing & marks matching PO invoice PAID
    const validSig = signStripePayload(eventPayload, process.env.STRIPE_WEBHOOK_SECRET!);
    const validRes = await realFetch(`${baseUrl}/api/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': validSig },
      body: eventPayload,
    });
    expect(validRes.status).toBe(200);
    const validJson = await validRes.json();
    expect(validJson.received).toBe(true);
    expect(validJson.duplicate).toBe(false);

    // Idempotent duplicate delivery
    const dupRes = await realFetch(`${baseUrl}/api/billing/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': validSig },
      body: eventPayload,
    });
    expect(dupRes.status).toBe(200);
    expect((await dupRes.json()).duplicate).toBe(true);

    // Billing projection shows ACTIVE_PAID & paid PO invoice, while stripping stripeCustomerId/stripeSubscriptionId
    const billingRes = await realFetch(
      `${baseUrl}/api/teams/${encodeURIComponent(teamId)}/billing`,
      { headers: { Cookie: coachCookie } }
    );
    const billingJson = await billingRes.json();
    expect(billingJson.billing.status).toBe('ACTIVE_PAID');
    expect(billingJson.billing.poInvoices[0].status).toBe('PAID');
    expect(billingJson.billing.stripeCustomerId).toBeUndefined();
    expect(billingJson.billing.stripeSubscriptionId).toBeUndefined();
  });

  it('5. Static Guardrails: vite.config.ts PWA exclusions, TeamManagementPanel <= 2,465 lines & 4 CoachWorkspaceSubTab invariants', () => {
    const viteCfg = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
    for (const pattern of [
      '**/assets/ActivitiesView-*',
      '**/assets/SegmentEffortOverTimeChart-*',
      '**/assets/QuickRunLoggerCard-*',
      '**/assets/teamQrHelper-*',
      '**/assets/vendor-zip-*',
      '**/assets/teamOnboardingEngine-*',
      '**/assets/trackProgressionAndKalmanEngine-*',
      '**/assets/archiveImporter-*',
      '**/assets/AthleticTrainerInjuryHub-*',
      '**/assets/TeamBillingAndPoModal-*',
      '**/assets/schoolPoInvoiceHelper-*',
      '**/legal/**',
      'for-athletic-directors',
      '#121413',
      '|tee|go',
    ]) {
      expect(viteCfg).toContain(pattern);
    }

    const panelLines = fs
      .readFileSync(path.join(ROOT, 'src/components/TeamManagementPanel.tsx'), 'utf8')
      .split('\n').length;
    expect(panelLines).toBeLessThanOrEqual(2465);

    const dailyOpsSrc = fs.readFileSync(
      path.join(ROOT, 'src/components/coach/CoachDailyOpsPanel.tsx'),
      'utf8'
    );
    expect(dailyOpsSrc).toContain('INJURED_MODIFIED');

    const typesSrc = fs.readFileSync(path.join(ROOT, 'src/types.ts'), 'utf8');
    expect(typesSrc).toContain(
      "export type CoachWorkspaceSubTab = 'CLIPBOARD' | 'TEAM_PLAN' | 'STOPWATCH' | 'ROSTER';"
    );
  });
});
