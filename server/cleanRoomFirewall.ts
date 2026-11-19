/**
 * Strava API Legal Clean-Room Firewall (Strava API Agreement Sec 5.3):
 * Strips any Strava-originated activity, segment, polyline, or social metadata
 * before passing athlete telemetry into any LLM / generative AI context window
 * or cross-athlete analytics pipeline.
 */
const FIRST_PARTY_HARDWARE_TOKENS = [
  'garmin',
  'fit',
  'wahoo',
  'coros',
  'suunto',
  'polar',
  'apple_watch',
  'apple watch',
  'intervals',
];

const ALLOWED_CLEAN_ROOM_PROVENANCE_TOKENS = [
  ...FIRST_PARTY_HARDWARE_TOKENS,
  'apple',
  'thresh_stopwatch',
  'thresh stopwatch',
  'stopwatch',
  'manual',
  'official_race',
  'official race',
  'official fat',
];

export function isStravaOriginRecord(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const obj = item as Record<string, unknown>;
  const src = String(
    obj.source || obj.ingestionSource || obj.externalSource || obj.id || ''
  ).toLowerCase();
  const badges = Array.isArray(obj.sourceBadges)
    ? obj.sourceBadges.map((b: unknown) => String(b).toLowerCase())
    : [];
  const hasFirstPartyHardware = badges.some((b) =>
    FIRST_PARTY_HARDWARE_TOKENS.some((tok) => b.includes(tok))
  );
  if (Boolean(obj.stravaId) && !hasFirstPartyHardware) return true;
  if (src.includes('strava') && !hasFirstPartyHardware) return true;
  if (badges.includes('strava') && !hasFirstPartyHardware) return true;
  return false;
}

export function hasVerifiedCleanRoomProvenance(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  if (isStravaOriginRecord(item)) return false;
  const obj = item as Record<string, unknown>;
  const badges = Array.isArray(obj.sourceBadges)
    ? obj.sourceBadges.map((b: unknown) => String(b).toLowerCase())
    : [];
  if (
    badges.some((b) =>
      ALLOWED_CLEAN_ROOM_PROVENANCE_TOKENS.some((tok) => b.includes(tok))
    )
  ) {
    return true;
  }
  const src = String(
    obj.source || obj.ingestionSource || obj.externalSource || obj.id || ''
  ).toLowerCase();
  return ALLOWED_CLEAN_ROOM_PROVENANCE_TOKENS.some((tok) => src.includes(tok));
}

const SAFESPORT_WEIGHT_AND_BODY_COMP_KEYS = new Set([
  'weightkg',
  'weightlbs',
  'weight',
  'bmi',
  'bodymassindex',
  'bodyfatpct',
  'bodyfat',
  'leanbodymass',
  'wattsperkg',
  'avgwattsperkg',
  'targetwkg',
  'wkg',
  'wperkg',
]);

/**
 * Recursively strips all body-weight, BMI, body-composition, and W/kg properties
 * from telemetry payloads under U18 Safe-Sport / Zero-Weight enforcement.
 */
export function stripSafeSportWeightAndBodyCompFields<T>(
  input: T,
  options?: { maskWellnessWeightKgZero?: boolean }
): T {
  if (input === null || input === undefined || typeof input !== 'object') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) =>
      stripSafeSportWeightAndBodyCompFields(item, options)
    ) as unknown as T;
  }
  const record = input as Record<string, unknown>;
  const isWellnessDayRecord = 'hrvRMSSD' in record || 'restingHR' in record;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    const lowerKey = k.toLowerCase();
    if (lowerKey === 'weightkg' && options?.maskWellnessWeightKgZero && isWellnessDayRecord) {
      out[k] = 0;
      continue;
    }
    if (SAFESPORT_WEIGHT_AND_BODY_COMP_KEYS.has(lowerKey)) {
      continue;
    }
    out[k] = stripSafeSportWeightAndBodyCompFields(v, options);
  }
  return out as T;
}

export function sanitizeTelemetryForCleanRoom(
  rawSummary: unknown,
  options?: { forceZeroWeight?: boolean; requireFirstPartyProvenance?: boolean }
): Record<string, any> {
  if (!rawSummary || typeof rawSummary !== 'object') return {};
  let clone: Record<string, any> = { ...(rawSummary as Record<string, any>) };

  let strippedCount = 0;
  for (const key of [
    'recentWorkouts',
    'recentActivities',
    'activities',
    'workouts',
    'completedActivities',
  ]) {
    if (Array.isArray(clone[key])) {
      const before = clone[key].length;
      const requirePositive = Boolean(
        options?.requireFirstPartyProvenance || key === 'recentWorkouts'
      );
      clone[key] = clone[key].filter((item: unknown) =>
        requirePositive ? hasVerifiedCleanRoomProvenance(item) : !isStravaOriginRecord(item)
      );
      strippedCount += before - clone[key].length;
    }
  }

  delete clone.stravaSegments;
  delete clone.stravaKudos;
  delete clone.stravaAthleteId;
  delete clone.segmentEfforts;

  if (
    options?.forceZeroWeight ||
    clone.safeSportHideWeight ||
    clone.isMinorU18 ||
    clone.enforceZeroWeight
  ) {
    clone = stripSafeSportWeightAndBodyCompFields(clone);
    clone.safeSportHideWeight = true;
    clone.zeroWeightEnforced = true;
  }

  clone.cleanRoomPolicy = 'FIRST_PARTY_GARMIN_FIT_WELLNESS_ONLY';
  clone.stravaRecordsFiltered = strippedCount;
  return clone;
}
