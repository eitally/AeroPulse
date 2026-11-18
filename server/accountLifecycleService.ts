import fs from 'fs';
import type { Request, Response } from 'express';
import {
  clearGarminSessionAsync,
} from './garminConnectService.ts';
import {
  getUserById,
  getUserByProvider,
  hashAuthLookupKey,
  type ThreshUser,
} from './authService.ts';
import {
  GARMIN_SESSION_DIR,
  bindRequestScopeKey,
  getScopedRuntimeStore,
  runtimeStore,
  type RuntimeSessionStore,
} from './sessionContext.ts';
import {
  clearSessionCookie,
  deriveStravaSessionSid,
  deriveUserSessionSid,
  getVerifiedSessionClaims,
  resolveSafeOrigin,
} from './securityUtils.ts';
import {
  deleteTenantVault,
  loadTenantVaultAsync,
  saveTenantVaultAsync,
  withVaultLock,
} from './tokenVault.ts';
import {
  EMAIL_DIRECTORY_KEY,
  TEAMS_DIRECTORY_KEY,
  type EmailAccountDirectory,
  type StoredTeamDocument,
  type UserTeamsIndex,
  loadDirectory,
  loadTeamDocRaw,
  removeTeamFromUserIndex,
  saveTeamDocRaw,
  teamDocVaultKey,
  userTeamsVaultKey,
} from './teamService.ts';

async function bestEffortRevokeUpstreamTokens(
  stravaAccessToken?: string,
  polarAccessToken?: string,
  polarUserId?: string
): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (stravaAccessToken) {
    tasks.push(
      fetch(
        `https://www.strava.com/oauth/deauthorize?access_token=${encodeURIComponent(stravaAccessToken)}`,
        { method: 'POST', signal: AbortSignal.timeout(4000) }
      ).catch(() => undefined)
    );
  }
  if (polarAccessToken && polarUserId) {
    tasks.push(
      fetch(`https://polarremote.com/v2/users/${encodeURIComponent(polarUserId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${polarAccessToken}` },
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined)
    );
  }
  await Promise.allSettled(tasks);
}

/**
 * Full GDPR / CCPA / App Store / Strava API Agreement account & PII erasure.
 * Revokes external OAuth tokens, scrubs all active team memberships and snapshots,
 * deletes personal cloud vaults/indices/sessions, and clears all cookies.
 */
export async function deleteThreshAccountPermanently(
  req: Request,
  res: Response
): Promise<void> {
  const claims = getVerifiedSessionClaims(req);
  if (!claims?.sid) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }

  let user: ThreshUser | null = null;
  if (claims.sub?.startsWith('usr_')) {
    user = await getUserById(claims.sub);
  } else if (claims.sub) {
    user = await getUserByProvider('strava', claims.sub);
  }

  const activeStore = getScopedRuntimeStore(req);
  const candidateSids = new Set<string>([claims.sid]);
  if (user?.id) {
    candidateSids.add(deriveUserSessionSid(user.id));
  }
  const stravaIds = new Set<string>();
  if (activeStore?.stravaAthleteId) stravaIds.add(String(activeStore.stravaAthleteId));
  for (const p of user?.authProviders || []) {
    if (p.provider === 'strava' && p.providerId) stravaIds.add(p.providerId);
  }
  for (const s of user?.connectedServices || []) {
    if (s.service === 'strava' && s.athleteId) stravaIds.add(s.athleteId);
  }
  for (const sidVal of stravaIds) {
    candidateSids.add(deriveStravaSessionSid(sidVal));
  }

  // Gather upstream tokens before deleting session vaults
  let stravaAccessToken = activeStore?.stravaAccessToken || '';
  let polarAccessToken = activeStore?.polarAccessToken || '';
  let polarUserId = activeStore?.polarUserId || '';
  for (const sid of candidateSids) {
    const scopeKey = sid.slice(0, 24);
    const sDoc = await loadTenantVaultAsync<Partial<RuntimeSessionStore> | null>(
      `session_${scopeKey}`,
      null
    );
    if (sDoc?.stravaAccessToken && !stravaAccessToken) stravaAccessToken = sDoc.stravaAccessToken;
    if (sDoc?.polarAccessToken && !polarAccessToken) polarAccessToken = sDoc.polarAccessToken;
    if (sDoc?.polarUserId && !polarUserId) polarUserId = sDoc.polarUserId;
  }
  await bestEffortRevokeUpstreamTokens(stravaAccessToken, polarAccessToken, polarUserId);

  // Scrub team memberships across all linked sids (delete sole-member coach teams)
  const deletedTeamIds: string[] = [];
  for (const sid of candidateSids) {
    const idx = await loadTenantVaultAsync<UserTeamsIndex>(userTeamsVaultKey(sid), {
      teamIds: [],
      updatedAt: '',
    });
    for (const teamId of idx.teamIds) {
      await withVaultLock(teamDocVaultKey(teamId), async () => {
        const doc = await loadTeamDocRaw(teamId);
        if (!doc) return;
        const myMems = doc.memberships.filter((m) => candidateSids.has(m.userSid || ''));
        const otherActive = doc.memberships.filter(
          (m) => !candidateSids.has(m.userSid || '') && m.status !== 'REVOKED'
        );
        if (myMems.some((m) => m.role === 'HEAD_COACH') && otherActive.length === 0) {
          await deleteTenantVault(teamDocVaultKey(teamId));
          deletedTeamIds.push(teamId);
          return;
        }
        const nowIso = new Date().toISOString();
        for (const m of doc.memberships) {
          if (candidateSids.has(m.userSid || '')) {
            m.status = 'REVOKED';
            m.leftAt = nowIso;
            m.invitedName = 'Deleted Athlete';
            m.userSid = undefined;
            m.stravaAthleteId = undefined;
            m.invitedEmail = undefined;
            m.invitedPhone = undefined;
            m.parentGuardianEmail = undefined;
            m.parentConsentToken = undefined;
            m.liveSnapshot = undefined;
            m.coachRecordedActivities = undefined;
            m.rawInviteToken = undefined;
            m.inviteTokenHash = undefined;
          }
        }
        doc.updatedAt = nowIso;
        await saveTeamDocRaw(teamId, doc);
      });
      await removeTeamFromUserIndex(sid, teamId).catch(() => undefined);
    }
    await deleteTenantVault(userTeamsVaultKey(sid));
  }

  if (deletedTeamIds.length > 0) {
    await withVaultLock(TEAMS_DIRECTORY_KEY, async () => {
      const dir = await loadDirectory();
      const deletedSet = new Set(deletedTeamIds);
      for (const [slug, tId] of Object.entries(dir.bySlug)) {
        if (deletedSet.has(tId)) delete dir.bySlug[slug];
      }
      for (const [code, tId] of Object.entries(dir.byJoinCode)) {
        if (deletedSet.has(tId)) delete dir.byJoinCode[code];
      }
      dir.allTeamIds = dir.allTeamIds.filter((id) => !deletedSet.has(id));
      await saveTenantVaultAsync(TEAMS_DIRECTORY_KEY, dir);
    });
  }

  // Scrub Email OTP directory, user auth lookup indices, and user doc
  if (user?.email) {
    const cleanEmail = user.email.trim().toLowerCase();
    await deleteTenantVault(`auth_email_${hashAuthLookupKey(cleanEmail)}`);
    await withVaultLock(EMAIL_DIRECTORY_KEY, async () => {
      const emailDir = await loadTenantVaultAsync<EmailAccountDirectory>(EMAIL_DIRECTORY_KEY, {
        byEmail: {},
      });
      if (emailDir.byEmail[cleanEmail]) {
        delete emailDir.byEmail[cleanEmail];
        await saveTenantVaultAsync(EMAIL_DIRECTORY_KEY, emailDir);
      }
    });
  }
  if (user) {
    for (const p of user.authProviders || []) {
      await deleteTenantVault(`auth_prov_${p.provider}_${hashAuthLookupKey(p.providerId)}`);
    }
    await deleteTenantVault(`user_${user.id}`);
    await deleteTenantVault(`athlete_state_user_${user.id}`);
  }

  // Delete session, garmin, sid/strava athlete_state vaults, and /tmp raw Strava archives
  for (const sid of candidateSids) {
    const scopeKey = sid.slice(0, 24);
    await deleteTenantVault(`session_${scopeKey}`);
    await deleteTenantVault(`session_${sid}`);
    await clearGarminSessionAsync(GARMIN_SESSION_DIR, scopeKey);
    await deleteTenantVault(`athlete_state_sid_${sid.slice(0, 32)}`);
    await deleteTenantVault(`athlete_state_sid_${scopeKey}`);
  }
  for (const stravaId of stravaIds) {
    const cleanStravaId = String(stravaId).replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanStravaId) {
      await deleteTenantVault(`athlete_state_strava_${cleanStravaId}`);
      try {
        const archivePath = `/tmp/aeropulse-strava-archive-${cleanStravaId}.json`;
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
      } catch {
        // ignore
      }
    }
  }

  runtimeStore.stravaAccessToken = '';
  runtimeStore.stravaRefreshToken = '';
  runtimeStore.stravaAthleteId = undefined;
  bindRequestScopeKey(req, '');
  clearSessionCookie(res);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, deleted: true, origin: resolveSafeOrigin(req.headers.origin as string) });
}
