import { useCallback, useEffect, useState } from 'react';
import type {
  PublicTeamHubPayload,
  PublicTeamHubUnofficialSplitItem,
  TeamSummaryWithRole,
} from '../types';
import {
  buildPublicFieldLeaderboardFromLogs,
  formatPublicSafeSportDisplayName,
} from '../physiology/fieldEventsEngine';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration';
import { isHandTimedRaceData } from './raceTimingBadge';

/**
 * Matches `/team/<slugOrCode>`, `/team/<slugOrCode>/`, `#team/<slugOrCode>`, or `#team/<slugOrCode>/`.
 */
export function extractPublicTeamSlug(pathname: string, hash: string): string | null {
  const pathMatch = (pathname || '').trim().match(/^\/team\/([^/?#]+)\/?$/i);
  if (pathMatch?.[1]) {
    return decodeURIComponent(pathMatch[1]).trim();
  }
  const cleanHash = (hash || '').trim().replace(/^#/, '');
  const hashMatch = cleanHash.match(/^team\/([^/?#]+)\/?$/i);
  if (hashMatch?.[1]) {
    return decodeURIComponent(hashMatch[1]).trim();
  }
  return null;
}

export function openPublicTeamHubRoute(slugOrCode: string): void {
  if (typeof window === 'undefined') return;
  const cleanSlug = encodeURIComponent(slugOrCode.trim());
  const nextPath = `/team/${cleanSlug}`;
  if (window.location.pathname !== nextPath) {
    const preservedSearch = window.location.search || '';
    window.history.pushState({}, '', `${nextPath}${preservedSearch}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function exitPublicTeamHubRoute(targetHash?: string): void {
  if (typeof window === 'undefined') return;
  const cleanHash = targetHash ? targetHash.replace(/^#/, '').trim() : '';
  const search = window.location.search || '';
  const nextUrl = cleanHash ? `/${search}#${cleanHash}` : `/${search}`;
  window.history.pushState({}, '', nextUrl);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (cleanHash && typeof HashChangeEvent !== 'undefined') {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function usePublicTeamHubRoute(): {
  publicTeamSlug: string | null;
  openPublicTeamHub: (slugOrCode: string) => void;
  closePublicTeamHub: (targetHash?: string) => void;
} {
  const [publicTeamSlug, setPublicTeamSlug] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return extractPublicTeamSlug(window.location.pathname, window.location.hash);
  });

  useEffect(() => {
    const sync = () => {
      setPublicTeamSlug(extractPublicTeamSlug(window.location.pathname, window.location.hash));
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  const openPublicTeamHub = useCallback((slugOrCode: string) => {
    openPublicTeamHubRoute(slugOrCode);
    setPublicTeamSlug(slugOrCode.trim());
  }, []);

  const closePublicTeamHub = useCallback((targetHash?: string) => {
    exitPublicTeamHubRoute(targetHash);
    setPublicTeamSlug(null);
  }, []);

  return { publicTeamSlug, openPublicTeamHub, closePublicTeamHub };
}

/**
 * Projects an in-memory TeamSummaryWithRole into a zero-PII Clean-Room PublicTeamHubPayload
 * for offline/demo previews where the team hasn't been committed to remote Postgres yet.
 */
export function buildCleanRoomPublicHubFromTeamSummary(
  team: TeamSummaryWithRole
): PublicTeamHubPayload {
  const todayIso = getLocalDateIso();
  const meets = (team.broadcastWorkouts || [])
    .filter((bw) => bw.isOfficialMeet || /meet|invitational|finals|dual|champ|xc/i.test(bw.name))
    .map((bw) => {
      const safeLive =
        bw.liveResultsUrl && /^https:\/\//i.test(bw.liveResultsUrl.trim())
          ? bw.liveResultsUrl.trim()
          : undefined;
      const safeAlbums = (bw.curatedAlbumLinks || []).filter(
        (a) => a.visibility === 'PUBLIC_HUB' && /^https:\/\//i.test(a.url.trim())
      );
      return {
        id: bw.broadcastId,
        date: bw.date,
        name: bw.name,
        eventType: 'MEET' as const,
        ...(bw.scheduledTime ? { scheduledTime: bw.scheduledTime } : {}),
        ...(bw.locationName ? { locationName: bw.locationName } : {}),
        ...(bw.locationCategory ? { locationCategory: bw.locationCategory } : {}),
        ...(bw.description ? { description: bw.description } : {}),
        ...(bw.externalSource ? { externalSource: bw.externalSource } : {}),
        ...(safeLive ? { liveResultsUrl: safeLive } : {}),
        ...(bw.liveResultsLabel ? { liveResultsLabel: bw.liveResultsLabel } : {}),
        ...(safeAlbums.length > 0 ? { curatedAlbumLinks: safeAlbums } : {}),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const { fieldPrsByMembershipId, fieldLeaderboard } =
    buildPublicFieldLeaderboardFromLogs({
      orgType: team.brand.orgType,
      memberships: team.memberships || [],
      fieldLogs: team.fieldMarkLogs || [],
    });

  const publishUnofficialSplits = Boolean(team.brand.externalSync?.publishUnofficialSplits);
  const unofficialStopwatchSplits: PublicTeamHubUnofficialSplitItem[] = [];

  let officialResultCount = 0;
  const rosterLeaderboard = (team.memberships || [])
    .filter((m) => m.status !== 'REVOKED' && m.role === 'ATHLETE')
    .map((m) => {
      const displayName = formatPublicSafeSportDisplayName({
        invitedName: m.invitedName,
        externalSource: m.externalSource,
        isMinorU18: m.isMinorU18,
        parentConsentStatus: m.parentConsentStatus,
        orgType: team.brand.orgType,
      });
      const recorded = m.coachRecordedActivities || [];
      const officialResults = recorded
        .filter((a) => Boolean(a.officialRaceData) && !isHandTimedRaceData(a.officialRaceData, a))
        .map((a) => {
          const r = a.officialRaceData!;
          return {
            date: a.startDateLocal.slice(0, 10),
            meetName: r.meetName,
            eventLabel: r.eventLabel,
            eventDistanceMeters: r.eventDistanceMeters,
            displayFatTime: r.displayFatTime,
            fatTimeSecs: r.fatTimeSecs,
            ...(r.placeFinish ? { placeFinish: r.placeFinish } : {}),
            vdotScore: r.vdotScore,
            platform: r.platform,
            trackType: r.trackType,
            ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}),
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date));

      if (publishUnofficialSplits) {
        for (const a of recorded) {
          if (!a.officialRaceData || !isHandTimedRaceData(a.officialRaceData, a)) continue;
          const r = a.officialRaceData;
          unofficialStopwatchSplits.push({
            id: a.id,
            date: a.startDateLocal.slice(0, 10),
            meetName: r.meetName,
            eventLabel: r.eventLabel,
            athleteDisplayName: displayName,
            displayTime: r.displayFatTime,
            lapSplitsSecs: Array.isArray(r.lapSplitsSecs) ? r.lapSplitsSecs : [],
            ...(r.lapSplitDistanceMeters
              ? { lapSplitDistanceMeters: r.lapSplitDistanceMeters }
              : {}),
            timingLabel: 'Hand-Timed',
            ...(r.capturedByName ? { capturedByName: r.capturedByName } : {}),
          });
        }
      }

      officialResultCount += officialResults.length;
      const memberFieldPrs = fieldPrsByMembershipId.get(m.membershipId);
      return {
        membershipId: m.membershipId,
        name: displayName,
        squadGroup: m.squadGroup,
        ...(m.eventGroup ? { eventGroup: m.eventGroup } : {}),
        ...(m.graduationYear ? { graduationYear: m.graduationYear } : {}),
        ...(m.genderDivision ? { genderDivision: m.genderDivision } : {}),
        ...(m.seedMarkOrFtp ? { seedMarkOrFtp: m.seedMarkOrFtp } : {}),
        ...(m.externalSource ? { externalSource: m.externalSource } : {}),
        ...(m.externalAthleteId ? { externalAthleteId: m.externalAthleteId } : {}),
        ...(m.externalProfileUrl ? { externalProfileUrl: m.externalProfileUrl } : {}),
        officialResults,
        ...(memberFieldPrs && memberFieldPrs.length > 0 ? { fieldPrs: memberFieldPrs } : {}),
      };
    });

  return {
    found: true,
    brand: {
      teamId: team.brand.teamId,
      slug: team.brand.slug,
      joinCode: team.brand.joinCode,
      name: team.brand.name,
      shortName: team.brand.shortName,
      ...(team.brand.mascotOrMotto ? { mascotOrMotto: team.brand.mascotOrMotto } : {}),
      orgType: team.brand.orgType,
      primarySport: team.brand.primarySport,
      ...(team.brand.logoDataUrl ? { logoDataUrl: team.brand.logoDataUrl } : {}),
      primaryHex: team.brand.primaryHex,
      secondaryHex: team.brand.secondaryHex,
      defaultSafeSportShield: team.brand.defaultSafeSportShield,
      coachDisplayName: team.brand.coachDisplayName,
      ...(team.brand.timezone ? { timezone: team.brand.timezone } : {}),
      ...(team.brand.externalSync ? { externalSync: team.brand.externalSync } : {}),
    },
    upcomingMeets: meets.filter((m) => m.date >= todayIso),
    recentSchedule: meets.filter((m) => m.date < todayIso).reverse(),
    rosterLeaderboard,
    fieldLeaderboard,
    ...(publishUnofficialSplits && unofficialStopwatchSplits.length > 0
      ? {
          unofficialStopwatchSplits: unofficialStopwatchSplits
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 25),
        }
      : {}),
    stats: {
      athleteCount: rosterLeaderboard.length,
      meetCount: meets.length,
      officialResultCount,
      fieldPrCount: fieldLeaderboard.length,
    },
  };
}
