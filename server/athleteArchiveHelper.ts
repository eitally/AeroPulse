import type { AthleteCloudStateEnvelope, UnifiedActivity } from '../src/types.ts';
import { getUserByEmail } from './authService.ts';
import { sanitizeAthleteCloudState } from './routers/athleteStateRouter.ts';
import { loadTenantVaultAsync, saveTenantVaultAsync, withVaultLock } from './tokenVault.ts';

/**
 * Mirrors coach-recorded Trackside Stopwatch splits & official FAT meet marks into
 * an athlete's own AES-256-GCM personal cloud vault (`athlete_state_*`) so transferring,
 * graduating seniors, or athletes leaving a team always retain their career marks.
 */
export async function archiveCoachActivitiesForMember(
  member: {
    userSid?: string;
    stravaAthleteId?: string;
    invitedEmail?: string;
    userId?: string;
  },
  activities: UnifiedActivity[]
): Promise<void> {
  if (!Array.isArray(activities) || activities.length === 0) return;

  const targetVaultKeys = new Set<string>();
  let resolvedUserId = member.userId?.trim();
  if (!resolvedUserId && member.invitedEmail) {
    const matchedUser = await getUserByEmail(member.invitedEmail).catch(() => null);
    if (matchedUser?.id) resolvedUserId = matchedUser.id;
  }
  if (resolvedUserId?.startsWith('usr_')) {
    const cleanUsr = resolvedUserId.replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanUsr) targetVaultKeys.add(`athlete_state_user_${cleanUsr}`);
  }
  if (member.stravaAthleteId) {
    const cleanStrava = String(member.stravaAthleteId).trim().replace(/[^0-9a-zA-Z_-]/g, '');
    if (cleanStrava) targetVaultKeys.add(`athlete_state_strava_${cleanStrava}`);
  }
  if (member.userSid) {
    const cleanSid = String(member.userSid).trim().replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 32);
    if (cleanSid) targetVaultKeys.add(`athlete_state_sid_${cleanSid}`);
  }

  if (targetVaultKeys.size === 0) return;

  const compactIncoming: UnifiedActivity[] = activities.map((act) => ({
    ...act,
    streams: undefined,
  }));

  for (const vaultKey of targetVaultKeys) {
    await withVaultLock(vaultKey, async () => {
      const existing = await loadTenantVaultAsync<AthleteCloudStateEnvelope | null>(
        vaultKey,
        null
      );
      const prevArchived = Array.isArray(existing?.coachArchivedActivities)
        ? existing.coachArchivedActivities
        : [];
      const mergedMap = new Map<string, UnifiedActivity>();
      for (const item of [...compactIncoming, ...prevArchived]) {
        if (item?.id && !mergedMap.has(item.id)) {
          mergedMap.set(item.id, item);
        }
      }
      const nextArchived = Array.from(mergedMap.values())
        .sort((a, b) => String(b.startDateLocal || '').localeCompare(String(a.startDateLocal || '')))
        .slice(0, 150);
      const sanitized = sanitizeAthleteCloudState(
        { coachArchivedActivities: nextArchived },
        existing
      );
      await saveTenantVaultAsync(vaultKey, sanitized);
    });
  }
}
