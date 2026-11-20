import { Router, type Request, type Response } from 'express';
import {
  loadJsonFile,
  resolveSessionScopeKey,
  saveJsonFile,
} from '../sessionContext.ts';
import {
  getVerifiedSessionClaims,
  isCanonicalAuthenticatedClaims,
} from '../securityUtils.ts';
import {
  getEffectiveIntervalsConfig,
  getIntervalsAuthHeader,
} from './intervalsRouter.ts';

export const activitiesRouter = Router();

export function decodeGooglePolyline(encoded: string): [number, number][] {
  if (!encoded || typeof encoded !== 'string') return [];
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < len);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([Number((lat / 1e5).toFixed(5)), Number((lng / 1e5).toFixed(5))]);
  }
  return points;
}

export interface RawIntervalsSegment {
  id?: string | number;
  segment_id?: string | number;
  name?: string;
  starred?: boolean;
  start_index?: number;
  end_index?: number;
}

export interface ComputedIntervalsSegmentEffort {
  id: string;
  segmentId: string;
  name: string;
  sportCategory: 'Cycling' | 'Running';
  distanceMeters: number;
  averageGradePct: number;
  elapsedTimeSecs: number;
  movingTimeSecs: number;
  avgWatts?: number;
  avgPaceSecsPerKm?: number;
  avgHr?: number;
  prRank: 1 | 2 | 3 | null;
  komRank: number | null;
  starred: boolean;
  startDateLocal: string;
  activityId: string;
  activityName: string;
  startTimeSecs: number;
  endTimeSecs: number;
  startIndex: number;
  endIndex: number;
  startLatLng?: [number, number];
  endLatLng?: [number, number];
  pathLatLngs?: [number, number][];
}

export function computeIntervalsSegmentEfforts(
  rawSegments: RawIntervalsSegment[],
  rawStreams: { type: string; data: number[]; data2?: number[] }[],
  act: {
    id: string;
    name: string;
    startDateLocal: string;
    sportCategory: string;
    avgHr?: number;
  }
): ComputedIntervalsSegmentEffort[] {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return [];
  const fullStreamMap: Record<string, number[]> = {};
  let latArr: number[] = [];
  let lngArr: number[] = [];
  if (Array.isArray(rawStreams)) {
    for (const s of rawStreams) {
      if (s && s.type && Array.isArray(s.data)) {
        fullStreamMap[s.type] = s.data;
        if (s.type === 'latlng' && Array.isArray(s.data2)) {
          latArr = s.data;
          lngArr = s.data2;
        }
      }
    }
  }
  const timeArr = fullStreamMap.time || [];
  const distArr = fullStreamMap.distance || [];
  const wattsArr = fullStreamMap.watts || [];
  const hrArr = fullStreamMap.heartrate || [];
  const altArr = fullStreamMap.altitude || [];

  const efforts: ComputedIntervalsSegmentEffort[] = [];
  for (let idx = 0; idx < rawSegments.length; idx++) {
    const seg = rawSegments[idx];
    if (!seg || (!seg.segment_id && !seg.id)) continue;
    const sIdx = Math.max(0, Number(seg.start_index ?? 0));
    const eIdx = Math.max(sIdx, Number(seg.end_index ?? sIdx));

    const startTimeSecs =
      timeArr.length > sIdx && timeArr[sIdx] != null ? Math.round(timeArr[sIdx]) : sIdx;
    const endTimeSecs =
      timeArr.length > eIdx && timeArr[eIdx] != null ? Math.round(timeArr[eIdx]) : eIdx;

    const elapsedTimeSecs =
      timeArr.length > eIdx && timeArr[eIdx] != null && timeArr[sIdx] != null
        ? Math.max(1, Math.round(timeArr[eIdx] - timeArr[sIdx]))
        : Math.max(1, eIdx - sIdx);

    if (elapsedTimeSecs < 5) continue;

    let distanceMeters = 0;
    if (distArr.length > eIdx && distArr[eIdx] != null && distArr[sIdx] != null) {
      distanceMeters = Math.max(0, Math.round(distArr[eIdx] - distArr[sIdx]));
    }
    if (distanceMeters < 20) continue;

    let averageGradePct = 0;
    if (
      altArr.length > eIdx &&
      altArr[eIdx] != null &&
      altArr[sIdx] != null &&
      distanceMeters > 25
    ) {
      averageGradePct = Number(
        (((altArr[eIdx] - altArr[sIdx]) / distanceMeters) * 100).toFixed(1)
      );
    }

    let avgWatts: number | undefined;
    if (wattsArr.length > sIdx) {
      const sliceW = wattsArr
        .slice(sIdx, Math.min(wattsArr.length, eIdx + 1))
        .filter((v) => v != null && !Number.isNaN(v) && v >= 0);
      if (sliceW.length > 0) {
        const meanW = Math.round(sliceW.reduce((a, b) => a + b, 0) / sliceW.length);
        if (meanW > 0) avgWatts = meanW;
      }
    }

    let avgHr: number | undefined = act.avgHr && act.avgHr > 0 ? act.avgHr : undefined;
    if (hrArr.length > sIdx) {
      const sliceHr = hrArr
        .slice(sIdx, Math.min(hrArr.length, eIdx + 1))
        .filter((v) => v != null && !Number.isNaN(v) && v > 40);
      if (sliceHr.length > 0) {
        avgHr = Math.round(sliceHr.reduce((a, b) => a + b, 0) / sliceHr.length);
      }
    }

    let startLatLng: [number, number] | undefined;
    let endLatLng: [number, number] | undefined;
    let pathLatLngs: [number, number][] | undefined;
    if (latArr.length > eIdx && lngArr.length > eIdx) {
      const segStep = Math.max(1, Math.floor((eIdx - sIdx + 1) / 36));
      const pts: [number, number][] = [];
      for (let k = sIdx; k <= eIdx; k += segStep) {
        if (latArr[k] != null && lngArr[k] != null && Math.abs(latArr[k]) > 0.01) {
          pts.push([Number(latArr[k].toFixed(5)), Number(lngArr[k].toFixed(5))]);
        }
      }
      if (
        latArr[eIdx] != null &&
        lngArr[eIdx] != null &&
        Math.abs(latArr[eIdx]) > 0.01 &&
        pts.length > 0
      ) {
        pts.push([Number(latArr[eIdx].toFixed(5)), Number(lngArr[eIdx].toFixed(5))]);
      }
      if (pts.length >= 2) {
        pathLatLngs = pts;
        startLatLng = pts[0];
        endLatLng = pts[pts.length - 1];
      }
    }

    const sportCategory: 'Cycling' | 'Running' =
      act.sportCategory === 'Running' ? 'Running' : 'Cycling';
    const avgPaceSecsPerKm =
      sportCategory === 'Running' && distanceMeters > 0
        ? Math.round(elapsedTimeSecs / (distanceMeters / 1000))
        : undefined;

    efforts.push({
      id: `${act.id}-seg-${seg.id || seg.segment_id}-${idx}`,
      segmentId: String(seg.segment_id || seg.id),
      name: String(seg.name || 'Strava Segment').trim(),
      sportCategory,
      distanceMeters,
      averageGradePct,
      elapsedTimeSecs,
      movingTimeSecs: elapsedTimeSecs,
      avgWatts,
      avgPaceSecsPerKm,
      avgHr,
      prRank: null as 1 | 2 | 3 | null,
      komRank: null,
      starred: Boolean(seg.starred),
      startDateLocal: String(act.startDateLocal),
      activityId: String(act.id),
      activityName: String(act.name),
      startTimeSecs,
      endTimeSecs,
      startIndex: sIdx,
      endIndex: eIdx,
      startLatLng,
      endLatLng,
      pathLatLngs,
    });
  }
  return efforts;
}

activitiesRouter.post('/api/segments/scan-more', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const scopedSegmentsFile = `/tmp/thresh-segments-${scopeKey}.json`;
    const scopedRoutesFile = `/tmp/thresh-routes-${scopeKey}.json`;
    const config = getEffectiveIntervalsConfig(req);
    const authHeader = getIntervalsAuthHeader(config);
    if (!authHeader) {
      res
        .status(401)
        .json({ error: 'Intervals.icu is not connected (OAuth access token or API Key required).' });
      return;
    }
    const resolvedId = config.athleteId || '0';
    const newestStr = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
    const activitiesUrl = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2015-01-01&newest=${newestStr}`;
    const actResp = await fetch(activitiesUrl, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!actResp.ok) {
      res.status(actResp.status).json({ error: 'Unable to fetch Intervals.icu activities list' });
      return;
    }
    const rawActivities = (await actResp.json()) as Record<string, unknown>[];
    const segmentsCache = loadJsonFile<
      Record<string, ReturnType<typeof computeIntervalsSegmentEfforts>>
    >(scopedSegmentsFile, {});
    const routesCache = loadJsonFile<Record<string, [number, number][]>>(
      scopedRoutesFile,
      {}
    );

    const candidates = rawActivities
      .filter((a) => a && a.id && a.has_segments && !Array.isArray(segmentsCache[String(a.id)]))
      .slice(0, 30);

    let scannedCount = 0;
    for (let i = 0; i < candidates.length; i += 10) {
      const slice = candidates.slice(i, i + 10);
      await Promise.all(
        slice.map(async (rawAct) => {
          const actId = String(rawAct.id);
          const rawType = String(rawAct.type || '');
          const sportCategory = /run|trailrun|virtualrun|treadmill/i.test(rawType)
            ? 'Running'
            : 'Cycling';
          try {
            const [segResp, stResp] = await Promise.all([
              fetch(`https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/segments`, {
                headers: { Authorization: authHeader, Accept: 'application/json' },
              }),
              fetch(
                `https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/streams?types=time,distance,latlng,watts,heartrate,velocity_smooth,altitude`,
                { headers: { Authorization: authHeader, Accept: 'application/json' } }
              ),
            ]);
            if (segResp.ok && stResp.ok) {
              const rawSegs = (await segResp.json()) as RawIntervalsSegment[];
              const rawStreams = (await stResp.json()) as {
                type: string;
                data: number[];
                data2?: number[];
              }[];
              segmentsCache[actId] = computeIntervalsSegmentEfforts(rawSegs, rawStreams, {
                id: actId,
                name: String(rawAct.name || rawType || sportCategory),
                startDateLocal: String(rawAct.start_date_local || ''),
                sportCategory,
                avgHr: rawAct.average_heartrate
                  ? Math.round(Number(rawAct.average_heartrate))
                  : undefined,
              });
              const latlngEntry = Array.isArray(rawStreams)
                ? rawStreams.find((s) => s && s.type === 'latlng')
                : undefined;
              if (
                latlngEntry &&
                Array.isArray(latlngEntry.data) &&
                Array.isArray(latlngEntry.data2) &&
                latlngEntry.data.length > 2
              ) {
                const step = Math.max(1, Math.floor(latlngEntry.data.length / 160));
                const compactPts: [number, number][] = [];
                for (let k = 0; k < latlngEntry.data.length; k += step) {
                  const lat = latlngEntry.data[k];
                  const lng = latlngEntry.data2[k];
                  if (lat != null && lng != null && Math.abs(lat) > 0.01) {
                    compactPts.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
                  }
                }
                if (compactPts.length > 2) routesCache[actId] = compactPts;
              }
              scannedCount += 1;
            } else {
              segmentsCache[actId] = [];
            }
          } catch {
            // ignore error on single activity
          }
        })
      );
    }
    saveJsonFile(scopedSegmentsFile, segmentsCache);
    saveJsonFile(scopedRoutesFile, routesCache);

    const ownedIds = new Set(rawActivities.map((a) => String(a?.id || '')).filter(Boolean));
    const scopedSegments: Record<string, ReturnType<typeof computeIntervalsSegmentEfforts>> = {};
    const scopedRoutes: Record<string, [number, number][]> = {};
    for (const id of ownedIds) {
      if (Array.isArray(segmentsCache[id])) scopedSegments[id] = segmentsCache[id];
      if (Array.isArray(routesCache[id])) scopedRoutes[id] = routesCache[id];
    }

    res.json({
      scannedCount,
      remainingUnscannedCount: Math.max(
        0,
        rawActivities.filter(
          (a) => a && a.has_segments && !Array.isArray(segmentsCache[String(a.id)])
        ).length
      ),
      totalCachedActivities: Object.keys(scopedSegments).length,
      segmentsByActivity: scopedSegments,
      routesByActivity: scopedRoutes,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to scan additional segments',
    });
  }
});

activitiesRouter.post('/api/activities/hydrate-routes', async (req: Request, res: Response) => {
  try {
    const claims = getVerifiedSessionClaims(req);
    const scopeKey = resolveSessionScopeKey(req);
    if (!isCanonicalAuthenticatedClaims(claims) || !scopeKey) {
      res.status(401).json({
        error: 'Authentication required.',
        routesByActivity: {},
      });
      return;
    }
    const scopedRoutesFile = `/tmp/thresh-routes-${scopeKey}.json`;
    const intervalsConfig = getEffectiveIntervalsConfig(req);
    const intervalsAuth = getIntervalsAuthHeader(intervalsConfig);
    if (!intervalsAuth) {
      res.status(401).json({
        error: 'Intervals.icu connection (OAuth or API Key) is required to hydrate GPS routes.',
        routesByActivity: {},
      });
      return;
    }
    const routesCache = loadJsonFile<Record<string, [number, number][]>>(
      scopedRoutesFile,
      {}
    );
    const authHeader = intervalsAuth;
    let activityIds: string[] = Array.isArray(req.body?.activityIds)
      ? req.body.activityIds.map(String).slice(0, 32)
      : [];

    if (activityIds.length === 0) {
      const resolvedId = intervalsConfig.athleteId || '0';
      const newestStr = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
      const actResp = await fetch(
        `https://intervals.icu/api/v1/athlete/${encodeURIComponent(resolvedId)}/activities?oldest=2018-01-01&newest=${newestStr}`,
        { headers: { Authorization: authHeader, Accept: 'application/json' } }
      );
      if (actResp.ok) {
        const rawActs = (await actResp.json()) as Record<string, unknown>[];
        activityIds = rawActs
          .filter(
            (a) =>
              a &&
              a.id &&
              !a.trainer &&
              Number(a.distance || 0) > 1000 &&
              !Array.isArray(routesCache[String(a.id)])
          )
          .slice(0, 32)
          .map((a) => String(a.id));
      }
    }

    const toFetch = activityIds.filter((id) => id && !Array.isArray(routesCache[id]));
    for (let i = 0; i < toFetch.length; i += 8) {
      const slice = toFetch.slice(i, i + 8);
      await Promise.all(
        slice.map(async (actId) => {
          try {
            const mapResp = await fetch(
              `https://intervals.icu/api/v1/activity/${encodeURIComponent(actId)}/map`,
              { headers: { Authorization: authHeader, Accept: 'application/json' } }
            );
            if (mapResp.ok) {
              const mapJson = (await mapResp.json()) as { latlngs?: [number, number][] };
              if (Array.isArray(mapJson.latlngs) && mapJson.latlngs.length > 2) {
                const rawPts = mapJson.latlngs.filter(
                  (p) =>
                    Array.isArray(p) &&
                    p.length === 2 &&
                    p[0] != null &&
                    p[1] != null &&
                    Math.abs(p[0]) > 0.01
                );
                const step = Math.max(1, Math.floor(rawPts.length / 180));
                const compactPts = rawPts
                  .filter((_, idx) => idx % step === 0)
                  .map((p): [number, number] => [
                    Number(Number(p[0]).toFixed(5)),
                    Number(Number(p[1]).toFixed(5)),
                  ]);
                if (compactPts.length >= 2) {
                  routesCache[actId] = compactPts;
                }
              }
            }
          } catch {
            // ignore single map error
          }
        })
      );
    }
    saveJsonFile(scopedRoutesFile, routesCache);
    const scopedRoutes: Record<string, [number, number][]> = {};
    for (const id of activityIds) {
      if (Array.isArray(routesCache[id])) {
        scopedRoutes[id] = routesCache[id];
      }
    }
    res.json({ routesByActivity: scopedRoutes });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to hydrate GPS routes',
    });
  }
});
