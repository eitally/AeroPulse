import type { TrackLaneNumber } from '../types.ts';
import { computeWorldAthleticsOvalLaneGeometry } from './trackEnvironmentPhysics.ts';

export interface OvalGpsSnapResult {
  lane: TrackLaneNumber;
  lapLengthMeters: number;
  snappedLatLng: [number, number][];
  distanceTrackMeters: number[];
  lateralResidualsMeters: number[];
  rmsResidualMeters: number;
  rawGpsDistanceMeters: number;
  calibratedTrackDistanceMeters: number;
  driftEliminatedPct: number;
  fittedCenterLatLng: [number, number];
  fittedAzimuthDeg: number;
}

const METERS_PER_DEG_LAT = 111132.92;

function huberLoss(residual: number, delta: number): number {
  const absR = Math.abs(residual);
  return absR <= delta ? 0.5 * absR * absR : delta * (absR - 0.5 * delta);
}

function huberWeight(residual: number, delta: number): number {
  const absR = Math.abs(residual);
  return absR <= delta || absR < 1e-9 ? 1 : delta / absR;
}

function solveLinear3x3(A: number[][], b: number[]): number[] | null {
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const d = det3(A);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;

  const replaceCol = (col: number): number[][] =>
    A.map((row, rIdx) => row.map((val, cIdx) => (cIdx === col ? b[rIdx] : val)));

  return [
    det3(replaceCol(0)) / d,
    det3(replaceCol(1)) / d,
    det3(replaceCol(2)) / d,
  ];
}

function capsuleLocalCoords(
  east: number,
  north: number,
  cx: number,
  cy: number,
  theta: number,
  halfS: number
): { u: number; v: number; uc: number; du: number; rad: number } {
  const dx = east - cx;
  const dy = north - cy;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const u = dx * cosT + dy * sinT;
  const v = -dx * sinT + dy * cosT;
  const uc = Math.max(-halfS, Math.min(halfS, u));
  const du = u - uc;
  const rad = Math.hypot(du, v);
  return { u, v, uc, du, rad };
}

function capsulePerimeterArcMeters(
  u: number,
  v: number,
  du: number,
  halfS: number,
  straightMeters: number,
  radiusMeters: number
): number {
  const halfCircleLen = Math.PI * radiusMeters;
  if (Math.abs(du) < 1e-6) {
    if (v <= 0) {
      return u + halfS;
    }
    return straightMeters + halfCircleLen + (halfS - u);
  }
  if (du > 0) {
    const phi = Math.atan2(v, du);
    return straightMeters + (phi + Math.PI / 2) * radiusMeters;
  }
  const phi = Math.atan2(v, du);
  const alpha = phi >= 0 ? phi - Math.PI / 2 : phi + 1.5 * Math.PI;
  return 2 * straightMeters + halfCircleLen + alpha * radiusMeters;
}

/**
 * Fits a World Athletics 400m stadium capsule (`S = 84.39m` straights, calibrated Lane 1-8 radius)
 * to noisy 1Hz GPS coordinates via robust Huber-loss Gauss-Newton IRLS, eliminating GPS corner-cutting
 * and multipath overshoot on track workouts/races.
 */
export function snapGpsStreamToStandardTrackOval(
  latlng: [number, number][],
  options?: { lane?: TrackLaneNumber; huberDeltaMeters?: number }
): OvalGpsSnapResult | null {
  if (!Array.isArray(latlng) || latlng.length < 12) return null;

  const validPairs = latlng.filter(
    (pt): pt is [number, number] =>
      Array.isArray(pt) &&
      pt.length >= 2 &&
      Number.isFinite(pt[0]) &&
      Number.isFinite(pt[1])
  );
  if (validPairs.length < 12) return null;

  const lane: TrackLaneNumber = options?.lane ?? 1;
  const delta = Math.max(0.5, options?.huberDeltaMeters ?? 2.5);
  const geom = computeWorldAthleticsOvalLaneGeometry(lane);
  const straightMeters = geom.straightMeters;
  const halfS = straightMeters / 2;
  const radius = geom.effectiveRadiusMeters;
  const lapLen = geom.circumferenceMeters;

  const lat0 = validPairs.reduce((s, p) => s + p[0], 0) / validPairs.length;
  const lng0 = validPairs.reduce((s, p) => s + p[1], 0) / validPairs.length;
  const cosLat = Math.max(0.15, Math.cos((lat0 * Math.PI) / 180));
  const metersPerDegLng = 111319.49 * cosLat;

  const localPts: Array<[number, number]> = latlng.map((pt) => {
    const lat = Number.isFinite(pt?.[0]) ? pt[0] : lat0;
    const lng = Number.isFinite(pt?.[1]) ? pt[1] : lng0;
    return [(lng - lng0) * metersPerDegLng, (lat - lat0) * METERS_PER_DEG_LAT];
  });

  // Compute raw GPS Euclidean cumulative distance
  let rawGpsDist = 0;
  for (let i = 1; i < localPts.length; i++) {
    rawGpsDist += Math.hypot(
      localPts[i][0] - localPts[i - 1][0],
      localPts[i][1] - localPts[i - 1][1]
    );
  }

  const evalHuberObj = (cx: number, cy: number, theta: number): number => {
    let sum = 0;
    for (let i = 0; i < localPts.length; i++) {
      const r =
        capsuleLocalCoords(localPts[i][0], localPts[i][1], cx, cy, theta, halfS).rad -
        radius;
      sum += huberLoss(r, delta);
    }
    return sum;
  };

  // Subsample uniformly for fast center/azimuth grid initialization
  const stride = Math.max(1, Math.floor(localPts.length / 240));
  const sampleIdx: number[] = [];
  for (let i = 0; i < localPts.length; i += stride) sampleIdx.push(i);

  let bestCx = 0;
  let bestCy = 0;
  let bestTheta = 0;
  let bestObj = Infinity;

  for (let k = 0; k < 18; k++) {
    const theta = (k * Math.PI) / 18;
    const obj = evalHuberObj(0, 0, theta);
    if (obj < bestObj) {
      bestObj = obj;
      bestTheta = theta;
    }
  }

  // Huber-weighted Levenberg-Marquardt Gauss-Newton refinement
  let damping = 1e-2;
  const epsPos = 0.02;
  const epsTheta = 2e-4;

  for (let iter = 0; iter < 32; iter++) {
    const H: number[][] = [
      [damping, 0, 0],
      [0, damping, 0],
      [0, 0, damping * 100],
    ];
    const g = [0, 0, 0];

    for (const idx of sampleIdx) {
      const [ex, ny] = localPts[idx];
      const r0 = capsuleLocalCoords(ex, ny, bestCx, bestCy, bestTheta, halfS).rad - radius;
      const w = huberWeight(r0, delta);

      const j0 =
        (capsuleLocalCoords(ex, ny, bestCx + epsPos, bestCy, bestTheta, halfS).rad -
          capsuleLocalCoords(ex, ny, bestCx - epsPos, bestCy, bestTheta, halfS).rad) /
        (2 * epsPos);
      const j1 =
        (capsuleLocalCoords(ex, ny, bestCx, bestCy + epsPos, bestTheta, halfS).rad -
          capsuleLocalCoords(ex, ny, bestCx, bestCy - epsPos, bestTheta, halfS).rad) /
        (2 * epsPos);
      const j2 =
        (capsuleLocalCoords(ex, ny, bestCx, bestCy, bestTheta + epsTheta, halfS).rad -
          capsuleLocalCoords(ex, ny, bestCx, bestCy, bestTheta - epsTheta, halfS).rad) /
        (2 * epsTheta);

      const j = [j0, j1, j2];
      for (let a = 0; a < 3; a++) {
        g[a] += w * j[a] * r0;
        for (let b = 0; b < 3; b++) {
          H[a][b] += w * j[a] * j[b];
        }
      }
    }

    const negG = [-g[0], -g[1], -g[2]];
    const step = solveLinear3x3(H, negG);
    if (!step) {
      damping *= 4;
      continue;
    }

    const candCx = bestCx + Math.max(-15, Math.min(15, step[0]));
    const candCy = bestCy + Math.max(-15, Math.min(15, step[1]));
    const candTheta = bestTheta + Math.max(-0.25, Math.min(0.25, step[2]));
    const candObj = evalHuberObj(candCx, candCy, candTheta);

    if (candObj <= bestObj + 1e-6) {
      const improvement = bestObj - candObj;
      bestCx = candCx;
      bestCy = candCy;
      bestTheta = candTheta;
      bestObj = candObj;
      damping = Math.max(1e-4, damping * 0.5);
      if (improvement < 1e-4 && iter >= 6) break;
    } else {
      damping *= 4;
    }
  }

  // Project onto snapped capsule boundary and unwrap continuous distance along the fitted oval
  const cosT = Math.cos(bestTheta);
  const sinT = Math.sin(bestTheta);
  const snappedLatLng: [number, number][] = [];
  const rawArcs: number[] = [];
  const lateralResidualsMeters: number[] = [];

  for (let i = 0; i < localPts.length; i++) {
    const [ex, ny] = localPts[i];
    const loc = capsuleLocalCoords(ex, ny, bestCx, bestCy, bestTheta, halfS);
    const residual = loc.rad - radius;
    lateralResidualsMeters.push(Number(residual.toFixed(2)));

    const denom = Math.max(1e-6, loc.rad);
    const uSnap = loc.uc + (loc.du / denom) * radius;
    const vSnap = loc.rad < 1e-6 ? radius : (loc.v / denom) * radius;

    const eastSnap = bestCx + uSnap * cosT - vSnap * sinT;
    const northSnap = bestCy + uSnap * sinT + vSnap * cosT;
    snappedLatLng.push([
      Number((lat0 + northSnap / METERS_PER_DEG_LAT).toFixed(7)),
      Number((lng0 + eastSnap / metersPerDegLng).toFixed(7)),
    ]);

    const arc = capsulePerimeterArcMeters(
      uSnap,
      vSnap,
      uSnap - Math.max(-halfS, Math.min(halfS, uSnap)),
      halfS,
      straightMeters,
      radius
    );
    rawArcs.push(arc);
  }

  const signedUnwrapped: number[] = [0];
  for (let i = 1; i < rawArcs.length; i++) {
    let deltaArc = rawArcs[i] - rawArcs[i - 1];
    if (deltaArc > lapLen / 2) deltaArc -= lapLen;
    if (deltaArc < -lapLen / 2) deltaArc += lapLen;
    signedUnwrapped.push(signedUnwrapped[i - 1] + deltaArc);
  }

  const directionSign = signedUnwrapped[signedUnwrapped.length - 1] >= 0 ? 1 : -1;
  const distanceTrackMeters: number[] = [];
  let maxTrackPos = 0;
  for (let i = 0; i < signedUnwrapped.length; i++) {
    const oriented = signedUnwrapped[i] * directionSign;
    maxTrackPos = Math.max(maxTrackPos, oriented);
    distanceTrackMeters.push(Number(maxTrackPos.toFixed(2)));
  }

  const rmsResidual = Math.sqrt(
    lateralResidualsMeters.reduce((acc, r) => acc + r * r, 0) /
      Math.max(1, lateralResidualsMeters.length)
  );
  const calibratedTrackDistanceMeters =
    distanceTrackMeters[distanceTrackMeters.length - 1] ?? 0;
  const driftEliminatedPct =
    rawGpsDist > 0
      ? Number(
          (
            (Math.abs(rawGpsDist - calibratedTrackDistanceMeters) / rawGpsDist) *
            100
          ).toFixed(2)
        )
      : 0;

  let azimuthDeg = ((bestTheta * 180) / Math.PI) % 180;
  if (azimuthDeg < 0) azimuthDeg += 180;

  return {
    lane,
    lapLengthMeters: geom.lapLengthMeters,
    snappedLatLng,
    distanceTrackMeters,
    lateralResidualsMeters,
    rmsResidualMeters: Number(rmsResidual.toFixed(2)),
    rawGpsDistanceMeters: Number(rawGpsDist.toFixed(1)),
    calibratedTrackDistanceMeters: Number(calibratedTrackDistanceMeters.toFixed(1)),
    driftEliminatedPct,
    fittedCenterLatLng: [
      Number((lat0 + bestCy / METERS_PER_DEG_LAT).toFixed(6)),
      Number((lng0 + bestCx / metersPerDegLng).toFixed(6)),
    ],
    fittedAzimuthDeg: Number(azimuthDeg.toFixed(1)),
  };
}
