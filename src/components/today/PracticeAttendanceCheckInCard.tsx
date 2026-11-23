import React, { useMemo, useState } from 'react';
import { CheckCircle2, MapPin } from '../icons/PhosphorIcons';
import { selfCheckInPracticeAttendanceApi } from '../../utils/teamLifecycleApi';
import type {
  PracticeVenueGeofence,
  TeamAttendanceRecord,
  TeamSummaryWithRole,
} from '../../types';

export interface PracticeAttendanceCheckInCardProps {
  activeTeam: TeamSummaryWithRole;
  myTeams?: TeamSummaryWithRole[];
  todayIso: string;
  isSampleDemoMode?: boolean;
  onTeamsUpdated?: (teams: TeamSummaryWithRole[], activeId?: string) => void;
}

export function computeClientHaversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusMeters = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOneShotPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Location services are unavailable in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

export const PracticeAttendanceCheckInCard: React.FC<PracticeAttendanceCheckInCardProps> = ({
  activeTeam,
  myTeams = [],
  todayIso,
  isSampleDemoMode = false,
  onTeamsUpdated,
}) => {
  const enabledVenues = useMemo<PracticeVenueGeofence[]>(
    () => (activeTeam.brand.practiceVenues || []).filter((v) => v.enabled),
    [activeTeam.brand.practiceVenues]
  );

  const [selectedVenueId, setSelectedVenueId] = useState<string>(
    () => enabledVenues[0]?.id || ''
  );
  const [checkingIn, setCheckingIn] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (enabledVenues.length === 0 || activeTeam.myRole === 'PARENT_FOLLOWER') {
    return null;
  }

  const targetVenue =
    enabledVenues.find((v) => v.id === selectedVenueId) || enabledVenues[0];
  const todayRecord = activeTeam.attendanceByDate?.[todayIso]?.[activeTeam.myMembershipId];
  const isVerifiedToday = Boolean(
    todayRecord &&
      todayRecord.verifiedOnSite &&
      (todayRecord.status === 'PRESENT' || todayRecord.status === 'LATE')
  );

  const applyLocalDemoCheckIn = (venue: PracticeVenueGeofence, distanceMeters: number) => {
    const nowIso = new Date().toISOString();
    const record: TeamAttendanceRecord = {
      date: todayIso,
      membershipId: activeTeam.myMembershipId,
      status: 'PRESENT',
      checkedInAt: nowIso,
      verifiedOnSite: true,
      distanceMeters,
      venueId: venue.id,
      venueName: venue.name,
      method: 'GPS_GEOFENCE',
      updatedAt: nowIso,
    };
    const existing = activeTeam.attendanceByDate || {};
    const updatedTeam: TeamSummaryWithRole = {
      ...activeTeam,
      attendanceByDate: {
        ...existing,
        [todayIso]: {
          ...(existing[todayIso] || {}),
          [activeTeam.myMembershipId]: record,
        },
      },
    };
    const nextTeams =
      myTeams.length > 0
        ? myTeams.map((t) => (t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t))
        : [updatedTeam];
    onTeamsUpdated?.(nextTeams, updatedTeam.brand.teamId);
  };

  const handleCheckIn = async () => {
    if (!targetVenue || checkingIn) return;
    setCheckingIn(true);
    setErrorMsg(null);
    const isDemo = isSampleDemoMode || activeTeam.brand.teamId.startsWith('demo_team_');

    try {
      let coords: { latitude: number; longitude: number; accuracy?: number } | null = null;
      try {
        const pos = await getOneShotPosition();
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
      } catch (geoErr) {
        if (!isDemo) {
          const message =
            geoErr instanceof Error
              ? geoErr.message
              : 'Location permission is required for a one-time on-site check-in.';
          setErrorMsg(message);
          return;
        }
      }

      if (isDemo) {
        const distanceMeters = coords
          ? Math.round(
              computeClientHaversineDistanceMeters(
                coords.latitude,
                coords.longitude,
                targetVenue.latitude,
                targetVenue.longitude
              )
            )
          : 12;
        if (distanceMeters > targetVenue.radiusMeters) {
          setErrorMsg(
            `Outside ${targetVenue.name} geofence (${distanceMeters}m away; max ${targetVenue.radiusMeters}m).`
          );
          return;
        }
        applyLocalDemoCheckIn(targetVenue, distanceMeters);
        return;
      }

      if (!coords) return;
      const resp = await selfCheckInPracticeAttendanceApi({
        teamId: activeTeam.brand.teamId,
        date: todayIso,
        venueId: targetVenue.id,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      });
      if (resp.teams && resp.teams.length > 0) {
        onTeamsUpdated?.(resp.teams, activeTeam.brand.teamId);
      } else if (resp.team) {
        const nextTeams =
          myTeams.length > 0
            ? myTeams.map((t) => (t.brand.teamId === resp.team!.brand.teamId ? resp.team! : t))
            : [resp.team];
        onTeamsUpdated?.(nextTeams, resp.team.brand.teamId);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to verify practice check-in.'
      );
    } finally {
      setCheckingIn(false);
    }
  };

  return (
    <section
      data-testid="practice-attendance-checkin-card"
      className="rounded-2xl liquid-glass px-3.5 py-3 sm:px-4 space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-ap-ink dark:text-ap-chalk">
            <MapPin className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
            <span className="truncate">
              {activeTeam.brand.shortName || activeTeam.brand.name} · Practice Check-In
            </span>
          </div>
          <p className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
            {targetVenue.name} · {targetVenue.radiusMeters}m on-site radius
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {enabledVenues.length > 1 && !isVerifiedToday && (
            <select
              aria-label="Select practice venue"
              value={targetVenue.id}
              onChange={(e) => setSelectedVenueId(e.target.value)}
              className="min-h-[44px] sm:min-h-[36px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-semibold text-ap-ink dark:text-ap-chalk"
            >
              {enabledVenues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.radiusMeters}m)
                </option>
              ))}
            </select>
          )}

          {isVerifiedToday && todayRecord ? (
            <div
              data-testid="gps-practice-checkin-receipt"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl ap-status-prime text-xs font-mono font-bold"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" weight="fill" />
              <span>
                On-Site ✓ · {todayRecord.venueName || targetVenue.name} ·{' '}
                {todayRecord.distanceMeters ?? 0}m
              </span>
            </div>
          ) : (
            <button
              type="button"
              data-testid="gps-practice-checkin-btn"
              disabled={checkingIn}
              onClick={() => void handleCheckIn()}
              className="ap-btn-primary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <MapPin className="w-3.5 h-3.5" weight="bold" />
              <span>{checkingIn ? 'Checking Location…' : '1-Tap Practice Check-In'}</span>
            </button>
          )}
        </div>
      </div>

      <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
        One-time on-site distance check only — your GPS coordinates are never saved or tracked
      </p>

      {errorMsg && (
        <div
          role="alert"
          data-testid="gps-practice-checkin-error"
          className="rounded-xl ap-status-strained px-3 py-2 text-xs font-semibold"
        >
          {errorMsg}
        </div>
      )}
    </section>
  );
};
