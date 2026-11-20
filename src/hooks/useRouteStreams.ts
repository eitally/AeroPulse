import React, { useState, useCallback } from 'react';
import type { ConnectionStatus, UnifiedActivity } from '../types';
import { upsampleAndAnalyzeActivityInWorker } from '../workers/activityWorkerClient';
import {
  getActivityStreamFromDexie,
  saveActivityStreamToDexie,
} from '../db/workoutStore';
import {
  applyStopwatchStreamFusionToActivity,
  getSavedIntervalsHeaders,
  saveRotatedStravaTokensToStorage,
} from '../utils/telemetryStorage';
import type { ActivityInterval, ActivityStreamSet, StravaSegmentEffort } from '../types';

function mergeHydratedStreamsIntoActivity(
  target: UnifiedActivity,
  sourceActivity: UnifiedActivity,
  streams: ActivityStreamSet | undefined,
  options?: {
    intervals?: ActivityInterval[];
    segmentEfforts?: StravaSegmentEffort[];
  }
): UnifiedActivity {
  const hasRealStreams = Boolean(streams && Array.isArray(streams.time) && streams.time.length > 0);
  const nextStreams = hasRealStreams ? streams! : target.streams;
  const fusionMeta = target.stopwatchFusionMeta || sourceActivity.stopwatchFusionMeta;
  const matchedStopwatchId =
    target.matchedStopwatchId ?? sourceActivity.matchedStopwatchId;

  const base: UnifiedActivity = {
    ...target,
    streams: nextStreams,
    routeLatLngs:
      hasRealStreams && Array.isArray(streams?.latlng) && streams.latlng.length > 2
        ? streams.latlng
        : target.routeLatLngs,
    intervals: fusionMeta
      ? target.intervals
      : options?.intervals || target.intervals,
    segmentEfforts:
      options?.segmentEfforts && options.segmentEfforts.length > 0
        ? options.segmentEfforts
        : target.segmentEfforts,
    ...(matchedStopwatchId ? { matchedStopwatchId } : {}),
    ...(fusionMeta ? { stopwatchFusionMeta: fusionMeta } : {}),
  };

  if (
    fusionMeta &&
    nextStreams &&
    Array.isArray(nextStreams.time) &&
    nextStreams.time.length >= 10
  ) {
    return applyStopwatchStreamFusionToActivity(base, nextStreams, fusionMeta);
  }
  return base;
}

interface UseRouteStreamsParams {
  activitiesRef: React.MutableRefObject<UnifiedActivity[]>;
  setActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  setSampleDemoActivities: React.Dispatch<React.SetStateAction<UnifiedActivity[]>>;
  setSelectedActivity: React.Dispatch<React.SetStateAction<UnifiedActivity | null>>;
  connectionStatus: ConnectionStatus;
  isSampleDemoMode: boolean;
  reRankActivitiesSegments: (acts: UnifiedActivity[]) => UnifiedActivity[];
}

export function useRouteStreams({
  activitiesRef,
  setActivities,
  setSampleDemoActivities,
  setSelectedActivity,
  connectionStatus,
  isSampleDemoMode,
  reRankActivitiesSegments,
}: UseRouteStreamsParams) {
  const [isScanningSegments, setIsScanningSegments] = useState(false);
  const [isHydratingRoutes, setIsHydratingRoutes] = useState(false);

  const handleScanMoreSegments = useCallback(async () => {
    setIsScanningSegments(true);
    try {
      const resp = await fetch('/api/segments/scan-more', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
      });
      if (resp.ok) {
        const data = await resp.json();
        const segMap = (data.segmentsByActivity || {}) as Record<string, StravaSegmentEffort[]>;
        const routesMap = (data.routesByActivity || {}) as Record<string, [number, number][]>;
        setActivities((prev) => {
          const merged = prev.map((act) => {
            const key = act.intervalsId || act.id;
            const foundSegs = segMap[key] || segMap[act.id];
            const foundRoute = routesMap[key] || routesMap[act.id];
            return {
              ...act,
              segmentEfforts:
                Array.isArray(foundSegs) && foundSegs.length > 0 ? foundSegs : act.segmentEfforts,
              routeLatLngs:
                Array.isArray(foundRoute) && foundRoute.length > 2
                  ? foundRoute
                  : act.routeLatLngs,
            };
          });
          return reRankActivitiesSegments(merged);
        });
      }
    } catch {
      // ignore error
    } finally {
      setIsScanningSegments(false);
    }
  }, [reRankActivitiesSegments, setActivities]);

  const handleHydrateMoreRoutes = useCallback(async () => {
    setIsHydratingRoutes(true);
    try {
      const uncachedOutdoorIds = activitiesRef.current
        .filter(
          (a) =>
            a.environment === 'OUTDOOR' &&
            a.distanceMeters > 500 &&
            (!Array.isArray(a.routeLatLngs) || a.routeLatLngs.length < 2) &&
            (!a.streams?.latlng || a.streams.latlng.length < 2) &&
            Boolean(a.intervalsId || a.id)
        )
        .slice(0, 32)
        .map((a) => String(a.intervalsId || a.id));

      const resp = await fetch('/api/activities/hydrate-routes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({ activityIds: uncachedOutdoorIds }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const routesMap = (data.routesByActivity || {}) as Record<string, [number, number][]>;
        setActivities((prev) =>
          prev.map((act) => {
            const key = act.intervalsId || act.id;
            const foundRoute = routesMap[key] || routesMap[act.id];
            if (Array.isArray(foundRoute) && foundRoute.length > 2) {
              return {
                ...act,
                routeLatLngs: foundRoute,
                startLatLng: foundRoute[0],
                endLatLng: foundRoute[foundRoute.length - 1],
              };
            }
            return act;
          })
        );
      }
    } catch {
      // ignore
    } finally {
      setIsHydratingRoutes(false);
    }
  }, [activitiesRef, setActivities]);

  const handleToggleActivityKudos = useCallback(
    async (activity: UnifiedActivity) => {
      if (isSampleDemoMode) {
        setSampleDemoActivities((prev) =>
          prev.map((a) => {
            if (a.id !== activity.id) return a;
            const nextKudoed = !a.hasKudoed;
            const updated: UnifiedActivity = {
              ...a,
              hasKudoed: nextKudoed,
              kudosCount: Math.max(0, (a.kudosCount || 0) + (nextKudoed ? 1 : -1)),
            };
            setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
            return updated;
          })
        );
        return;
      }
      const key = activity.stravaId || activity.intervalsId || activity.id;
      try {
        const resp = await fetch(`/api/activities/${encodeURIComponent(key)}/kudos`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
          body: JSON.stringify({ action: 'toggle_kudos' }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setActivities((prev) =>
            prev.map((a) => {
              if (a.id !== activity.id) return a;
              const updated: UnifiedActivity = {
                ...a,
                hasKudoed: Boolean(data.hasKudoed),
                kudosCount: typeof data.kudosCount === 'number' ? data.kudosCount : a.kudosCount,
                kudoers: Array.isArray(data.kudoers) ? data.kudoers : a.kudoers,
              };
              setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
              return updated;
            })
          );
        }
      } catch {
        // ignore
      }
    },
    [isSampleDemoMode, setActivities, setSampleDemoActivities, setSelectedActivity]
  );

  const handleAddActivityComment = useCallback(
    async (activity: UnifiedActivity, commentText: string, authorName?: string) => {
      if (!commentText.trim()) return;
      if (isSampleDemoMode) {
        const demoComment = {
          id: `demo-c-${Date.now()}`,
          authorName: authorName || 'Sample Athlete (Demo)',
          text: commentText.trim(),
          createdAt: new Date().toISOString(),
        };
        setSampleDemoActivities((prev) =>
          prev.map((a) => {
            if (a.id !== activity.id) return a;
            const nextComments = [...(a.comments || []), demoComment];
            const updated: UnifiedActivity = {
              ...a,
              comments: nextComments,
              commentCount: nextComments.length,
            };
            setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
            return updated;
          })
        );
        return;
      }
      const key = activity.stravaId || activity.intervalsId || activity.id;
      try {
        const resp = await fetch(`/api/activities/${encodeURIComponent(key)}/kudos`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
          body: JSON.stringify({
            action: 'add_comment',
            commentText: commentText.trim(),
            authorName: authorName || connectionStatus.stravaAthleteName || 'Athlete',
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          setActivities((prev) =>
            prev.map((a) => {
              if (a.id !== activity.id) return a;
              const updated: UnifiedActivity = {
                ...a,
                comments: Array.isArray(data.comments) ? data.comments : a.comments,
                commentCount: Array.isArray(data.comments)
                  ? data.comments.length
                  : (a.commentCount || 0) + 1,
              };
              setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
              return updated;
            })
          );
        }
      } catch {
        // ignore
      }
    },
    [
      isSampleDemoMode,
      connectionStatus.stravaAthleteName,
      setActivities,
      setSampleDemoActivities,
      setSelectedActivity,
    ]
  );

  // Load real streams + auto-detected intervals + Strava segment efforts + GPS route for any activity
  const loadStreamsForActivity = useCallback(
    async (activity: UnifiedActivity) => {
      if (isSampleDemoMode) {
        if (!activity.streams || activity.streams.time.length < 60) {
          try {
            const { streams: workerStreams, analytics } =
              await upsampleAndAnalyzeActivityInWorker(activity);
            setSampleDemoActivities((prev) =>
              prev.map((a) =>
                a.id === activity.id
                  ? {
                      ...a,
                      streams: workerStreams,
                      intervals:
                        a.intervals && a.intervals.length > 0 ? a.intervals : analytics.intervals,
                    }
                  : a
              )
            );
            setSelectedActivity((curr) =>
              curr && curr.id === activity.id
                ? {
                    ...curr,
                    streams: workerStreams,
                    intervals:
                      curr.intervals && curr.intervals.length > 0
                        ? curr.intervals
                        : analytics.intervals,
                  }
                : curr
            );
          } catch {
            // ignore worker fallback error
          }
        }
        return;
      }

      const needsStopwatchFusion = Boolean(
        activity.stopwatchFusionMeta && !activity.stopwatchFusionMeta.fusedWithWearableStreams
      );

      if (
        needsStopwatchFusion &&
        activity.streams &&
        Array.isArray(activity.streams.time) &&
        activity.streams.time.length >= 10
      ) {
        const fusedInMemory = applyStopwatchStreamFusionToActivity(
          activity,
          activity.streams,
          activity.stopwatchFusionMeta
        );
        setActivities((prev) =>
          prev.map((a) => (a.id === activity.id ? mergeHydratedStreamsIntoActivity(a, activity, fusedInMemory.streams) : a))
        );
        setSelectedActivity((curr) =>
          curr && curr.id === activity.id ? fusedInMemory : curr
        );
      }

      // 1. Check Dexie.js activityStreams table first for high-frequency 1Hz stream cache
      const cachedDexieRecord = await getActivityStreamFromDexie(activity.id);
      const cachedDexieStream = cachedDexieRecord?.streams;
      if (
        cachedDexieStream &&
        Array.isArray(cachedDexieStream.time) &&
        cachedDexieStream.time.length >= 60 &&
        (needsStopwatchFusion ||
          !activity.streams ||
          activity.streams.time.length < cachedDexieStream.time.length)
      ) {
        setActivities((prev) =>
          prev.map((a) =>
            a.id === activity.id
              ? mergeHydratedStreamsIntoActivity(a, activity, cachedDexieStream)
              : a
          )
        );
        setSelectedActivity((curr) =>
          curr && curr.id === activity.id
            ? mergeHydratedStreamsIntoActivity(curr, activity, cachedDexieStream)
            : curr
        );
      }

      const activeStreams =
        cachedDexieStream && cachedDexieStream.time.length >= 60
          ? cachedDexieStream
          : activity.streams;
      if (
        activeStreams &&
        activeStreams.time.length >= 60 &&
        activity.segmentEfforts &&
        activity.segmentEfforts.length > 0 &&
        (activity.environment === 'INDOOR' ||
          (activeStreams.latlng && activeStreams.latlng.length > 2))
      ) {
        return;
      }
      const headers = getSavedIntervalsHeaders();
      try {
        if (connectionStatus.intervalsConnected && activity.intervalsId) {
          const resp = await fetch(
            `/api/intervals/activities/${encodeURIComponent(activity.intervalsId)}/streams`,
            { headers }
          );
          if (resp.ok) {
            const payload = await resp.json();
            const streams = payload.streams || payload;
            const intervals = Array.isArray(payload.intervals) ? payload.intervals : undefined;
            const segmentEfforts = Array.isArray(payload.segmentEfforts)
              ? payload.segmentEfforts
              : undefined;
            if (
              (streams && Array.isArray(streams.time) && streams.time.length > 0) ||
              (segmentEfforts && segmentEfforts.length > 0)
            ) {
              if (streams && Array.isArray(streams.time) && streams.time.length > 0) {
                void saveActivityStreamToDexie(activity.id, streams);
              }
              setActivities((prev) => {
                const updated = prev.map((a) =>
                  a.id === activity.id
                    ? mergeHydratedStreamsIntoActivity(a, activity, streams, {
                        intervals,
                        segmentEfforts,
                      })
                    : a
                );
                const ranked = reRankActivitiesSegments(updated);
                const latestAct = ranked.find((a) => a.id === activity.id);
                if (latestAct) {
                  setSelectedActivity((curr) =>
                    curr && curr.id === activity.id
                      ? mergeHydratedStreamsIntoActivity(curr, activity, streams, {
                          intervals,
                          segmentEfforts,
                        })
                      : curr
                  );
                }
                return ranked;
              });
              return;
            }
          }
        }

        if (connectionStatus.stravaConnected && activity.stravaId) {
          const resp = await fetch(
            `/api/strava/activities/${encodeURIComponent(activity.stravaId)}/streams`,
            { credentials: 'include', headers }
          );
          if (resp.ok) {
            const payload = await resp.json();
            if (payload.stravaTokens) {
              saveRotatedStravaTokensToStorage(payload.stravaTokens);
            }
            const streams = payload.streams || payload;
            const segmentEfforts = Array.isArray(payload.segmentEfforts)
              ? payload.segmentEfforts
              : undefined;
            if (
              (streams && Array.isArray(streams.time) && streams.time.length > 0) ||
              (segmentEfforts && segmentEfforts.length > 0)
            ) {
              if (streams && Array.isArray(streams.time) && streams.time.length > 0) {
                void saveActivityStreamToDexie(activity.id, streams);
              }
              setActivities((prev) => {
                const updated = prev.map((a) =>
                  a.id === activity.id
                    ? mergeHydratedStreamsIntoActivity(a, activity, streams, {
                        segmentEfforts,
                      })
                    : a
                );
                const ranked = reRankActivitiesSegments(updated);
                const latestAct = ranked.find((a) => a.id === activity.id);
                if (latestAct) {
                  setSelectedActivity((curr) =>
                    curr && curr.id === activity.id
                      ? mergeHydratedStreamsIntoActivity(curr, activity, streams, {
                          segmentEfforts,
                        })
                      : curr
                  );
                }
                return ranked;
              });
              return;
            }
          }
        }

        // 2. Offline / Sandbox fallback: upsample & compute 1Hz telemetry stream on the Web Worker thread
        if (!activity.streams || activity.streams.time.length < 60) {
          const { streams: workerStreams, analytics } =
            await upsampleAndAnalyzeActivityInWorker(activity);
          setActivities((prev) =>
            prev.map((a) =>
              a.id === activity.id
                ? {
                    ...a,
                    streams: workerStreams,
                    intervals:
                      a.intervals && a.intervals.length > 0 ? a.intervals : analytics.intervals,
                  }
                : a
            )
          );
          setSelectedActivity((curr) =>
            curr && curr.id === activity.id
              ? {
                  ...curr,
                  streams: workerStreams,
                  intervals:
                    curr.intervals && curr.intervals.length > 0
                      ? curr.intervals
                      : analytics.intervals,
                }
              : curr
          );
        }
      } catch {
        // Fallback handled in view if stream endpoint unavailable
      }
    },
    [
      isSampleDemoMode,
      connectionStatus.intervalsConnected,
      connectionStatus.stravaConnected,
      reRankActivitiesSegments,
      setActivities,
      setSampleDemoActivities,
      setSelectedActivity,
    ]
  );

  const handleSelectActivity = useCallback(
    async (activity: UnifiedActivity | null) => {
      setSelectedActivity(activity);
      if (activity) {
        await loadStreamsForActivity(activity);
        if (!isSampleDemoMode && activity.stravaId) {
          try {
            const resp = await fetch(
              `/api/strava/activities/${encodeURIComponent(activity.stravaId)}/kudos`,
              { headers: getSavedIntervalsHeaders() }
            );
            if (resp.ok) {
              const kData = await resp.json();
              setActivities((prev) =>
                prev.map((a) => {
                  if (a.id !== activity.id) return a;
                  const updated: UnifiedActivity = {
                    ...a,
                    hasKudoed: kData.hasKudoed ?? a.hasKudoed,
                    kudosCount: Math.max(a.kudosCount || 0, (kData.kudoers || []).length),
                    kudoers:
                      Array.isArray(kData.kudoers) && kData.kudoers.length > 0
                        ? kData.kudoers
                        : a.kudoers,
                    comments:
                      Array.isArray(kData.comments) && kData.comments.length > 0
                        ? kData.comments
                        : a.comments,
                  };
                  setSelectedActivity((curr) => (curr && curr.id === activity.id ? updated : curr));
                  return updated;
                })
              );
            }
          } catch {
            // ignore
          }
        }
      }
    },
    [isSampleDemoMode, loadStreamsForActivity, setActivities, setSelectedActivity]
  );

  return {
    isScanningSegments,
    isHydratingRoutes,
    handleScanMoreSegments,
    handleHydrateMoreRoutes,
    handleToggleActivityKudos,
    handleAddActivityComment,
    loadStreamsForActivity,
    handleSelectActivity,
  };
}
