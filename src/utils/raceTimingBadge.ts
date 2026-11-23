import type { OfficialRaceMetadata, UnifiedActivity } from '../types';

export function isHandTimedRaceData(
  meta?: OfficialRaceMetadata | null,
  act?: Pick<UnifiedActivity, 'id' | 'sourceBadges'> | null
): boolean {
  if (!meta) return false;
  if (meta.timingMethod === 'HAND') return true;
  if (meta.platform === 'MeetReady Stopwatch') return true;
  if (meta.splitContext === 'HAND_CONVERTED' && meta.timingMethod !== 'FAT') {
    return true;
  }
  if (act?.id?.startsWith('stopwatch-race-') && meta.timingMethod !== 'FAT') {
    return true;
  }
  if (
    meta.timingMethod !== 'FAT' &&
    Array.isArray(act?.sourceBadges) &&
    act.sourceBadges.some(
      (b) => b === 'Hand-Timed' || b === 'Delegated Hand-Timed' || b === 'MeetReady Stopwatch'
    )
  ) {
    return true;
  }
  return false;
}

export function isHandTimedRaceActivity(
  act?: UnifiedActivity | null
): boolean {
  if (!act?.officialRaceData) return false;
  return isHandTimedRaceData(act.officialRaceData, act);
}

export function getRaceTimingKindLabel(
  meta?: OfficialRaceMetadata | null,
  act?: Pick<UnifiedActivity, 'id' | 'sourceBadges'> | null
): 'Hand-Timed' | 'Official FAT' {
  return isHandTimedRaceData(meta, act) ? 'Hand-Timed' : 'Official FAT';
}

export function formatRaceTimingBadgeLabel(
  meta: OfficialRaceMetadata,
  act?: Pick<UnifiedActivity, 'id' | 'sourceBadges'> | null
): string {
  const handTimed = isHandTimedRaceData(meta, act);
  if (handTimed) {
    const suffix = meta.capturedByName
      ? `Timer: ${meta.capturedByName}`
      : meta.placeFinish || 'Unofficial';
    return `${meta.platform} · ${meta.displayFatTime} Hand-Timed · ${suffix}`;
  }
  return `${meta.platform} · ${meta.displayFatTime} FAT · ${meta.placeFinish || 'Official'}`;
}
