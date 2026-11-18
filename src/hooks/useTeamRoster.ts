import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ConnectedAthleteRecord,
  PlannedWorkoutEvent,
  TeamSummaryWithRole,
  UnifiedWellnessDay,
} from '../types';
import { applyTeamBrandToDocument } from '../utils/teamBrandDom';
import {
  getSavedIntervalsHeaders,
  buildCompleteAthleteProfile,
  mergeActivitiesNonDestructive,
} from '../utils/telemetryStorage';

interface UseTeamRosterParams {
  isSampleDemoMode: boolean;
  hasEnteredWorkspace: boolean;
  isSessionLoggedOut: boolean;
}

export function useTeamRoster({
  isSampleDemoMode,
  hasEnteredWorkspace,
  isSessionLoggedOut,
}: UseTeamRosterParams) {
  const [myTeams, setMyTeams] = useState<TeamSummaryWithRole[]>(() => {
    try {
      const raw = localStorage.getItem('thresh_my_teams_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [activeTeamId, setActiveTeamId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('thresh_active_team_id_v1') || null;
    } catch {
      return null;
    }
  });

  const [resendConfigured, setResendConfigured] = useState<boolean>(false);
  const [pendingUrlJoinOffer, setPendingUrlJoinOffer] = useState<{
    token?: string;
    teamName: string;
    shortName: string;
    codeOrSlug: string;
  } | null>(null);

  const activeTeam = useMemo(
    () =>
      (activeTeamId && myTeams.find((t) => t.brand.teamId === activeTeamId)) || null,
    [myTeams, activeTeamId]
  );

  const handleSelectActiveTeam = useCallback(
    (nextId: string | null) => {
      setActiveTeamId(nextId);
      if (isSampleDemoMode) return;
      try {
        if (nextId) localStorage.setItem('thresh_active_team_id_v1', nextId);
        else localStorage.removeItem('thresh_active_team_id_v1');
      } catch {
        // ignore
      }
    },
    [isSampleDemoMode]
  );

  const handleTeamsUpdated = useCallback(
    (nextTeams: TeamSummaryWithRole[], nextActiveId?: string | null) => {
      if (isSampleDemoMode) return;
      setMyTeams(nextTeams);
      try {
        localStorage.setItem('thresh_my_teams_v1', JSON.stringify(nextTeams));
      } catch {
        // ignore
      }
      if (nextActiveId !== undefined) {
        handleSelectActiveTeam(nextActiveId);
      } else if (!activeTeamId && nextTeams.length > 0) {
        handleSelectActiveTeam(nextTeams[0].brand.teamId);
      }
    },
    [isSampleDemoMode, activeTeamId, handleSelectActiveTeam]
  );

  useEffect(() => {
    if (!hasEnteredWorkspace || isSessionLoggedOut) return;
    applyTeamBrandToDocument(activeTeam?.brand || null);
  }, [activeTeam, hasEnteredWorkspace, isSessionLoggedOut]);

  // Hydrate Multi-Team memberships from server & detect `/join/<slug>` for already-logged-in athletes
  useEffect(() => {
    if (isSampleDemoMode || !hasEnteredWorkspace || isSessionLoggedOut) return;
    let cancelled = false;
    (async () => {
      try {
        const origin = encodeURIComponent(window.location.origin);
        const resp = await fetch(`/api/teams/mine?origin=${origin}`, {
          credentials: 'include',
          headers: getSavedIntervalsHeaders(),
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (typeof data.resendConfigured === 'boolean') {
          setResendConfigured(data.resendConfigured);
        }
        if (Array.isArray(data.teams)) {
          setMyTeams(data.teams);
          try {
            localStorage.setItem('thresh_my_teams_v1', JSON.stringify(data.teams));
          } catch {
            // ignore
          }
          if (!activeTeamId && data.teams.length > 0) {
            handleSelectActiveTeam(data.teams[0].brand.teamId);
          }
        }
      } catch {
        // offline fallback uses cached thresh_my_teams_v1
      }
    })();

    // Check if an already-signed-in user opened a second team's Magic Join URL
    const pathMatch = window.location.pathname.match(/^\/join\/([^/?#]+)/i);
    const qs = new URLSearchParams(window.location.search);
    const codeOrSlug = pathMatch
      ? decodeURIComponent(pathMatch[1])
      : (qs.get('join') || '').trim();
    const token = qs.get('t') || qs.get('token') || undefined;
    if (codeOrSlug) {
      const previewQs = new URLSearchParams({ codeOrSlug });
      if (token) previewQs.set('t', token);
      fetch(`/api/teams/join-preview?${previewQs.toString()}`, { credentials: 'include' })
        .then((r) => r.json())
        .then((prev) => {
          if (!cancelled && prev?.found && prev?.brand) {
            setPendingUrlJoinOffer({
              codeOrSlug,
              token,
              teamName: prev.brand.name,
              shortName: prev.brand.shortName || prev.brand.name,
            });
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [hasEnteredWorkspace, isSessionLoggedOut, isSampleDemoMode, activeTeamId, handleSelectActiveTeam]);

  const handleAcceptJoinOffer = useCallback(async () => {
    if (!pendingUrlJoinOffer) return;
    try {
      const resp = await fetch('/api/teams/join', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({
          codeOrSlug: pendingUrlJoinOffer.codeOrSlug,
          token: pendingUrlJoinOffer.token,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.teams)) {
          handleTeamsUpdated(data.teams, data.team?.teamId);
        }
      }
    } catch {
      // ignore
    } finally {
      setPendingUrlJoinOffer(null);
    }
  }, [pendingUrlJoinOffer, handleTeamsUpdated]);

  const handleDismissJoinOffer = useCallback(() => {
    setPendingUrlJoinOffer(null);
  }, []);

  const cloudTeamRosterAthletes = useMemo<ConnectedAthleteRecord[]>(() => {
    if (!activeTeam) return [];
    const isCoach =
      activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ASSISTANT_COACH';
    const todayIso = new Date().toISOString().slice(0, 10);

    return activeTeam.memberships
      .filter(
        (m) => m.status === 'ACTIVE' && m.membershipId !== activeTeam.myMembershipId
      )
      .map((m) => {
        const snap = m.liveSnapshot;
        const hideWeight = Boolean(
          activeTeam.brand.defaultSafeSportShield ||
            m.isMinorU18 ||
            snap?.safeSportHideWeight
        );
        const initials = m.invitedName
          .split(/\s+/)
          .filter(Boolean)
          .map((p) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase() || 'TM';
        const hasRealSummaryLoad = Boolean(
          snap && (snap.ctl > 0 || snap.atl > 0 || snap.acuteLoad7d > 0)
        );
        const fallbackWellness: UnifiedWellnessDay[] =
          snap?.wellnessDays && snap.wellnessDays.length > 0
            ? snap.wellnessDays
            : hasRealSummaryLoad && snap
              ? [
                  {
                    date: todayIso,
                    ctl: snap.ctl,
                    atl: snap.atl,
                    tsb: snap.tsb,
                    rampRate: 0,
                    dailyLoad: Math.round((snap.acuteLoad7d || 0) / 7),
                    restingHR: 0,
                    hrvRMSSD: 0,
                    hrvBaseline7d: 0,
                    hrvStatus: 'Balanced',
                    sleepSecs: 0,
                    sleepScore: 0,
                    weightKg: 0,
                    readinessStatus:
                      snap.readinessScore < 60
                        ? 'Strain'
                        : snap.readinessScore < 75
                          ? 'Caution'
                          : 'Optimal',
                  },
                ]
              : [];
        const prof = buildCompleteAthleteProfile({
          name: m.invitedName,
          ftp: snap?.ftpWatts || 250,
          thresholdPaceSecsPerKm: snap?.thresholdPaceSecsPerKm || 255,
          safeSportHideWeight: hideWeight,
        });

        const squadBroadcasts: PlannedWorkoutEvent[] = (
          activeTeam.broadcastWorkouts || []
        )
          .filter((bw) => {
            if (bw.athleteOverrides?.[m.membershipId]) return true;
            if (Array.isArray(bw.targetMembershipIds) && bw.targetMembershipIds.length > 0) {
              return bw.targetMembershipIds.includes(m.membershipId);
            }
            const squadMatch = bw.targetSquadGroup === 'ALL' || bw.targetSquadGroup === m.squadGroup;
            if (!squadMatch) return false;
            if (Array.isArray(bw.targetEventGroups) && bw.targetEventGroups.length > 0) {
              return Boolean(m.eventGroup) && bw.targetEventGroups.includes(m.eventGroup!);
            }
            return true;
          })
          .map((bw) => {
            const ov = bw.athleteOverrides?.[m.membershipId];
            return {
              id: bw.broadcastId,
              date: bw.date,
              name: ov?.name || bw.name,
              sportCategory: bw.sportCategory,
              environmentPreference: 'FLEXIBLE',
              description: ov?.description || bw.description,
              plannedLoad: ov?.plannedLoad ?? bw.plannedLoad,
              plannedDurationSecs: ov?.plannedDurationSecs ?? bw.plannedDurationSecs,
              targetZoneSummary: `${activeTeam.brand.shortName} Squad Session`,
              workoutSyntax: ov?.workoutSyntax || bw.workoutSyntax,
              ...(ov?.trackSpec || bw.trackSpec ? { trackSpec: ov?.trackSpec || bw.trackSpec } : {}),
              ...(bw.planBlockId ? { planBlockId: bw.planBlockId } : {}),
              ...(bw.planBlockName ? { planBlockName: bw.planBlockName } : {}),
              ...(typeof bw.planWeekNum === 'number' ? { planWeekNum: bw.planWeekNum } : {}),
              source: 'USER',
            };
          });

        return {
          id: `team-mem-${m.membershipId}`,
          stravaAthleteId: m.stravaAthleteId || m.squadGroup.toUpperCase().slice(0, 8),
          inviteCode: activeTeam.brand.joinCode,
          name: m.invitedName,
          avatarInitials: initials,
          location: `${activeTeam.brand.shortName} · ${m.squadGroup}`,
          primarySport:
            activeTeam.brand.primarySport === 'Cycling' ? 'Cycling' : 'Running',
          ...(m.eventGroup ? { eventGroup: m.eventGroup } : {}),
          role: isCoach ? 'COACH_EDIT' : 'FRIEND_VIEW',
          status: 'CONNECTED',
          connectedSince: (m.joinedAt || m.invitedAt).slice(0, 10),
          primaryGoalSummary: snap?.verdictLabel || `${m.squadGroup} Roster`,
          caraHours7d: snap?.caraHours7d,
          privacySettings: {
            sharePmcAndZones: m.sharingTier === 'LOAD_ONLY' ? 'COACHES_ONLY' : 'ALL_CONNECTIONS',
            shareWellnessAndHrv:
              m.sharingTier === 'LOAD_ONLY'
                ? 'PRIVATE'
                : isCoach
                  ? 'ALL_CONNECTIONS'
                  : 'COACHES_ONLY',
            shareGpsRoutes: m.sharingTier === 'FULL_STREAMS' ? 'COACHES_ONLY' : 'PRIVATE',
            stravaComplianceShield: m.sharingTier !== 'FULL_STREAMS',
            allowCoachCalendarEdits: true,
          },
          athleteProfile: prof,
          wellnessDays: fallbackWellness,
          activities: mergeActivitiesNonDestructive(
            m.coachRecordedActivities || [],
            snap?.activities || []
          ),
          plannedEvents: squadBroadcasts,
          targetGoals: [],
          sessionCheckIns: snap?.sessionCheckIns || [],
        };
      });
  }, [activeTeam]);

  const myTeamRecordedActivities = useMemo(() => {
    if (!activeTeam) return [];
    const mine = activeTeam.memberships.find(
      (m) => m.membershipId === activeTeam.myMembershipId
    );
    return Array.isArray(mine?.coachRecordedActivities) ? mine.coachRecordedActivities : [];
  }, [activeTeam]);

  return {
    myTeams,
    setMyTeams,
    activeTeamId,
    setActiveTeamId,
    activeTeam,
    resendConfigured,
    pendingUrlJoinOffer,
    handleSelectActiveTeam,
    handleTeamsUpdated,
    handleAcceptJoinOffer,
    handleDismissJoinOffer,
    cloudTeamRosterAthletes,
    myTeamRecordedActivities,
  };
}
