import type {
  OfficialRacePlatform,
  RubberBandedSplit,
  VerifiedRacePassport,
} from '../types.ts';
import { estimateVdotFromRace } from './powerPaceMetrics.ts';

export interface RubberBanderInput {
  athleteName: string;
  meetOrRaceName: string;
  eventLabel: string;
  platform: OfficialRacePlatform;
  raceDate: string;
  certifiedDistanceMeters: number;
  rawGpsDistanceMeters: number;
  officialChipOrFatSecs: number;
  officialSplitsSecs?: number[];
}

function formatOfficialClock(secs: number): string {
  const whole = Math.floor(secs);
  const hundredths = Math.round((secs - whole) * 100);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const dec = hundredths > 0 ? `.${String(hundredths).padStart(2, '0')}` : '';
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${dec}`;
  }
  return `${m}:${String(s).padStart(2, '0')}${dec}`;
}

function computeDeterministicHash(payload: string): string {
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `THV-${hex1.slice(0, 4).toUpperCase()}-${hex2.slice(0, 4).toUpperCase()}`;
}

/**
 * 10x Differentiator #6: Automated Official Chip & FAT Race Rubber-Banding
 *
 * Reconciles GPS watch distance drift (urban canyons, tight track oval turns, tree canopy)
 * against certified USATF/World Athletics course distances or `0.01s` FAT track mats,
 * rubber-banding split times proportionally to the certified course markers and generating
 * a shareable `VerifiedRacePassport`.
 */
export function generateVerifiedRacePassport(
  input: RubberBanderInput
): VerifiedRacePassport {
  const certDist = Math.max(200, input.certifiedDistanceMeters);
  const rawGpsDist = Math.max(200, input.rawGpsDistanceMeters || certDist);
  const officialSecs = Math.max(25, input.officialChipOrFatSecs);

  const gpsDriftPct =
    Math.round(((rawGpsDist - certDist) / certDist) * 10000) / 100;
  const certifiedPaceSecsPerKm =
    Math.round((officialSecs / (certDist / 1000)) * 10) / 10;

  const vdotScore = estimateVdotFromRace(certDist, officialSecs);
  // Riegel/Daniels marathon equivalence from VDOT/certified performance
  const equivalentMarathonSecs = Math.round(
    officialSecs * Math.pow(42195 / certDist, 1.06)
  );

  // Determine canonical split interval (400m for track <=3200m, 1km for 5K/10K, 5km for Half/Marathon)
  const splitUnitM =
    certDist <= 3200 ? 400 : certDist <= 10000 ? 1000 : 5000;
  const numSplits = Math.max(1, Math.min(10, Math.round(certDist / splitUnitM)));
  const perSplitCertM = Math.round(certDist / numSplits);
  const perSplitRawM = Math.round((rawGpsDist / numSplits) * 10) / 10;

  const providedSplits =
    input.officialSplitsSecs && input.officialSplitsSecs.length === numSplits
      ? input.officialSplitsSecs
      : null;

  const driftRatio = certDist / rawGpsDist;
  const splits: RubberBandedSplit[] = [];

  for (let i = 0; i < numSplits; i++) {
    const rubberBandedSplitSecs = providedSplits
      ? Math.round(providedSplits[i] * 100) / 100
      : Math.round((officialSecs / numSplits) * 100) / 100;
    // Raw GPS watch split pace appears artificially faster when GPS over-measures distance
    const rawGpsSplitSecs =
      Math.round(rubberBandedSplitSecs * driftRatio * 100) / 100;
    const deltaSecs =
      Math.round((rubberBandedSplitSecs - rawGpsSplitSecs) * 100) / 100;
    const splitPaceSecsKm =
      Math.round((rubberBandedSplitSecs / (perSplitCertM / 1000)) * 10) / 10;

    splits.push({
      splitIndex: i + 1,
      splitLabel:
        certDist <= 3200
          ? `Lap ${i + 1} (${(i + 1) * perSplitCertM}m)`
          : `Split ${i + 1} (${((i + 1) * (perSplitCertM / 1000)).toFixed(1)} km)`,
      certifiedDistanceMeters: perSplitCertM,
      rawGpsDistanceMeters: perSplitRawM,
      rawGpsSplitSecs,
      rubberBandedSplitSecs,
      certifiedPaceSecsPerKm: splitPaceSecsKm,
      deltaSecs,
    });
  }

  const verificationHash = computeDeterministicHash(
    `${input.athleteName}|${input.meetOrRaceName}|${certDist}|${officialSecs.toFixed(2)}|${input.raceDate}`
  );

  return {
    passportId: `passport-${Date.now()}`,
    verificationHash,
    athleteName: input.athleteName || 'THRESH Athlete',
    meetOrRaceName: input.meetOrRaceName || 'Certified Championship Event',
    eventLabel: input.eventLabel || `${certDist}m`,
    platform: input.platform,
    raceDate: input.raceDate || new Date().toISOString().slice(0, 10),
    certifiedDistanceMeters: certDist,
    rawGpsDistanceMeters: rawGpsDist,
    gpsDriftPct,
    officialChipOrFatSecs: officialSecs,
    displayOfficialTime: formatOfficialClock(officialSecs),
    certifiedPaceSecsPerKm,
    vdotScore,
    equivalentMarathonSecs,
    splits,
  };
}
