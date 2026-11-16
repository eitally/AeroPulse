import {
  deriveObservedPhysiologyMetrics,
  type ObservedPhysiologyMetrics,
} from '../src/physiology/stravaLoadCalibration.ts';

export const SERVER_ZONE_COLORS = [
  '#94A3B8', // Z1 Cool Mist
  '#0D9488', // Z2 Aerobic Teal
  '#D97706', // Z3 Ochre Tempo
  '#EA580C', // Z4 Thresh Vermilion
  '#DC2626', // Z5 VO2 Crimson
  '#7C3AED', // Z6 Anaerobic Violet
  '#A21CAF', // Z7 Neuromuscular
];

export function isGenericName(name?: string | null): boolean {
  if (!name) return true;
  const t = name.trim();
  return (
    !t ||
    /^athlete$/i.test(t) ||
    /^primary\s+athlete$/i.test(t) ||
    /^strava\s+(user|athlete)$/i.test(t)
  );
}

export function deriveObservedPhysiologyFromActivities(
  activities?: Record<string, any>[] | null,
  weightKg = 70
): ObservedPhysiologyMetrics {
  return deriveObservedPhysiologyMetrics(activities, weightKg);
}

export function buildServerAthleteProfile(
  rawProfile?: Record<string, any> | null,
  latestWellness?: Record<string, any> | null,
  activities?: Record<string, any>[] | null
) {
  const prev: Record<string, any> = {};
  const sportSettingsList: Record<string, any>[] = Array.isArray(rawProfile?.sportSettings)
    ? rawProfile!.sportSettings
    : rawProfile?.sportSettings && typeof rawProfile.sportSettings === 'object'
      ? Object.values(rawProfile.sportSettings)
      : [];

  const bikeSetting = sportSettingsList.find(
    (s: any) =>
      (Array.isArray(s?.types) &&
        (s.types.includes('Ride') ||
          s.types.includes('VirtualRide') ||
          s.types.includes('GravelRide') ||
          s.types.includes('MountainBikeRide'))) ||
      /ride|bike|cycling/i.test(String(s?.type || ''))
  );
  const runSetting = sportSettingsList.find(
    (s: any) =>
      (Array.isArray(s?.types) &&
        (s.types.includes('Run') ||
          s.types.includes('VirtualRun') ||
          s.types.includes('TrailRun'))) ||
      /run/i.test(String(s?.type || ''))
  );

  // Extract Strava /api/v3/athlete/zones if present
  const stravaHrZonesRaw = Array.isArray(rawProfile?.stravaZones?.heart_rate?.zones)
    ? rawProfile!.stravaZones.heart_rate.zones
    : [];
  const stravaPowerZonesRaw = Array.isArray(rawProfile?.stravaZones?.power?.zones)
    ? rawProfile!.stravaZones.power.zones
    : [];

  let stravaDerivedMaxHr = 0;
  let stravaDerivedLthr = 0;
  if (stravaHrZonesRaw.length >= 4) {
    const z4Max = Number(stravaHrZonesRaw[3]?.max || 0);
    const z3Max = Number(stravaHrZonesRaw[2]?.max || 0);
    const z5Min = Number(stravaHrZonesRaw[4]?.min || z4Max);
    if (z4Max >= 135 && z4Max <= 215) {
      stravaDerivedLthr = z4Max;
      stravaDerivedMaxHr = Math.round(z4Max / 0.91);
    } else if (z3Max >= 125 && z3Max <= 200) {
      stravaDerivedLthr = Math.round(z3Max * 1.07);
      stravaDerivedMaxHr = Math.round(stravaDerivedLthr / 0.91);
    }
    if (z5Min > stravaDerivedLthr) {
      stravaDerivedLthr = z5Min;
    }
  }

  let stravaDerivedFtp = 0;
  if (stravaPowerZonesRaw.length >= 4) {
    const pZ4Max = Number(stravaPowerZonesRaw[3]?.max || 0);
    if (pZ4Max >= 90 && pZ4Max <= 600) {
      stravaDerivedFtp = Math.round(pZ4Max / 1.05);
    }
  }

  const explicitWeight = Number(
    rawProfile?.icu_weight ||
      rawProfile?.weight ||
      rawProfile?.weightKg ||
      (latestWellness?.weightKg && Number(latestWellness.weightKg) !== 70
        ? latestWellness.weightKg
        : 0) ||
      latestWellness?.weightKg ||
      prev.weightKg ||
      70.0
  );
  const weightKg = explicitWeight > 30 ? explicitWeight : 70.0;

  const obs = deriveObservedPhysiologyFromActivities(activities, weightKg);

  const ftp = Number(
    bikeSetting?.ftp ||
      rawProfile?.ftp ||
      latestWellness?.rideEftp ||
      stravaDerivedFtp ||
      obs.obsFtp ||
      prev.ftp ||
      250
  );
  const indoorFtp = Number(
    bikeSetting?.indoor_ftp ||
      rawProfile?.indoorFtp ||
      prev.indoorFtp ||
      ftp
  );
  const eFtp = Number(
    latestWellness?.rideEftp ||
      bikeSetting?.eftp ||
      bikeSetting?.eFtp ||
      rawProfile?.eFtp ||
      obs.obsFtp ||
      prev.eFtp ||
      ftp
  );
  const wPrime = Number(
    bikeSetting?.w_prime ||
      latestWellness?.rideWPrime ||
      rawProfile?.wPrime ||
      obs.obsWPrime ||
      prev.wPrime ||
      Math.round(ftp * 75)
  );
  const pMax = Number(
    bikeSetting?.p_max ||
      latestWellness?.ridePMax ||
      rawProfile?.pMax ||
      obs.obsPMax ||
      prev.pMax ||
      Math.round(ftp * 3.6)
  );
  const lthr = Number(
    bikeSetting?.lthr ||
      rawProfile?.lthr ||
      stravaDerivedLthr ||
      obs.obsBikeLthr ||
      prev.lthr ||
      163
  );
  const maxHr = Number(
    bikeSetting?.max_hr ||
      rawProfile?.maxHr ||
      stravaDerivedMaxHr ||
      obs.obsBikeMaxHr ||
      prev.maxHr ||
      Math.max(lthr + 15, 182)
  );
  const sweetSpotMinPct = Number(
    bikeSetting?.sweet_spot_min || rawProfile?.sweetSpotMinPct || prev.sweetSpotMinPct || 84
  );
  const sweetSpotMaxPct = Number(
    bikeSetting?.sweet_spot_max || rawProfile?.sweetSpotMaxPct || prev.sweetSpotMaxPct || 97
  );

  const restingHr = Number(
    (latestWellness?.restingHR && Number(latestWellness.restingHR) > 25
      ? latestWellness.restingHR
      : 0) ||
      rawProfile?.icu_resting_hr ||
      rawProfile?.restingHr ||
      prev.restingHr ||
      50
  );
  const vo2MaxCycling = Number(
    (latestWellness?.vo2MaxCycling && Number(latestWellness.vo2MaxCycling) !== 50
      ? latestWellness.vo2MaxCycling
      : 0) ||
      rawProfile?.vo2MaxCycling ||
      obs.obsVo2Bike ||
      prev.vo2MaxCycling ||
      Math.max(35, Math.min(85, Math.round(10.8 * (ftp / weightKg) + 7)))
  );
  const vo2MaxRunning = Number(
    (latestWellness?.vo2MaxRunning && Number(latestWellness.vo2MaxRunning) !== 50
      ? latestWellness.vo2MaxRunning
      : 0) ||
      rawProfile?.vo2MaxRunning ||
      obs.obsVo2Run ||
      prev.vo2MaxRunning ||
      vo2MaxCycling
  );

  // threshold_pace in Intervals.icu is m/s; convert to secs/km if < 15
  let thresholdPaceSecsPerKm = Number(
    rawProfile?.thresholdPaceSecsPerKm ||
      obs.obsThresholdPace ||
      prev.thresholdPaceSecsPerKm ||
      255
  );
  if (runSetting?.threshold_pace && Number(runSetting.threshold_pace) > 0) {
    const rawTp = Number(runSetting.threshold_pace);
    thresholdPaceSecsPerKm = rawTp < 15 ? Math.round(1000 / rawTp) : Math.round(rawTp);
  }

  const runFtp = Number(
    runSetting?.ftp ||
      rawProfile?.runFtp ||
      latestWellness?.runEftp ||
      obs.obsRunFtp ||
      prev.runFtp ||
      Math.round(weightKg * (1000 / Math.max(130, thresholdPaceSecsPerKm)) * 0.98)
  );
  const runEFtp = Number(
    latestWellness?.runEftp ||
      runSetting?.eftp ||
      rawProfile?.runEFtp ||
      prev.runEFtp ||
      runFtp
  );
  const runLthr = Number(
    runSetting?.lthr ||
      rawProfile?.runLthr ||
      obs.obsRunLthr ||
      prev.runLthr ||
      Math.min(maxHr - 4, lthr + 4)
  );
  const runMaxHr = Number(
    runSetting?.max_hr ||
      rawProfile?.runMaxHr ||
      obs.obsRunMaxHr ||
      prev.runMaxHr ||
      Math.max(runLthr + 12, maxHr)
  );

  // Power Zones (Z1..Z7)
  const rawPowerCeilings: number[] =
    Array.isArray(bikeSetting?.power_zones) && bikeSetting.power_zones.length >= 5
      ? bikeSetting.power_zones.map((v: any) => Number(v))
      : Array.isArray(rawProfile?.powerZones) && rawProfile.powerZones.length >= 5
        ? rawProfile.powerZones.map((z: any) => Number(z.maxPct))
        : Array.isArray(prev.powerZones) && prev.powerZones.length >= 5
          ? prev.powerZones.map((z: any) => Number(z.maxPct))
          : [55, 75, 90, 105, 120, 150, 999];
  const rawPowerNames: string[] =
    Array.isArray(bikeSetting?.power_zone_names) && bikeSetting.power_zone_names.length >= 5
      ? bikeSetting.power_zone_names
      : Array.isArray(rawProfile?.powerZones) && rawProfile.powerZones.length >= 5
        ? rawProfile.powerZones.map((z: any) => String(z.name || ''))
        : [
            'Active Recovery',
            'Endurance',
            'Tempo',
            'Lactate Threshold',
            'VO2 Max',
            'Anaerobic Capacity',
            'Neuromuscular Power',
          ];

  const powerZones = rawPowerCeilings.slice(0, 7).map((ceilPct, i) => {
    const minPct = i === 0 ? 0 : rawPowerCeilings[i - 1] + 1;
    const maxPct = ceilPct >= 900 ? 250 : ceilPct;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawPowerNames[i] || `Zone ${i + 1}`,
      minPct,
      maxPct,
      minWatts: i === 0 ? 0 : Math.round((rawPowerCeilings[i - 1] / 100) * ftp) + 1,
      maxWatts: Math.round((maxPct / 100) * ftp),
      minIndoorWatts:
        i === 0 ? 0 : Math.round((rawPowerCeilings[i - 1] / 100) * indoorFtp) + 1,
      maxIndoorWatts: Math.round((maxPct / 100) * indoorFtp),
      color: SERVER_ZONE_COLORS[i] || '#9333EA',
    };
  });

  const garmin5ZoneNames = [
    'Z1 Warm Up',
    'Z2 Easy',
    'Z3 Aerobic',
    'Z4 Threshold',
    'Z5 Maximum',
  ];
  const friel7ZoneNames = [
    'Z1 Recovery',
    'Z2 Aerobic Base',
    'Z3 Tempo',
    'Z4 Sub-Threshold',
    'Z5a Super-Threshold',
    'Z5b Aerobic Capacity',
    'Z5c Anaerobic',
  ];

  // Cycling HR Zones (Supports Garmin 5-Zone with exact floors OR Intervals.icu 7-Zone)
  const defaultBikeHrCeilings = [
    Math.round(lthr * 0.85),
    Math.round(lthr * 0.98),
    Math.round(lthr * 1.05),
    Math.round(lthr * 1.09),
    maxHr,
  ];
  const defaultBikeHrFloors = [
    Math.round(lthr * 0.71),
    defaultBikeHrCeilings[0] + 1,
    defaultBikeHrCeilings[1] + 1,
    defaultBikeHrCeilings[2] + 1,
    defaultBikeHrCeilings[3] + 1,
  ];
  const rawHrCeilings: number[] =
    Array.isArray(bikeSetting?.hr_zones) && bikeSetting.hr_zones.length >= 5
      ? bikeSetting.hr_zones.map((v: any) => Number(v))
      : Array.isArray(rawProfile?.hrZones) && rawProfile.hrZones.length >= 5
        ? rawProfile.hrZones.map((z: any) => Number(z.maxBpm))
        : Array.isArray(prev.hrZones) && prev.hrZones.length >= 5
          ? prev.hrZones.map((z: any) => Number(z.maxBpm))
          : defaultBikeHrCeilings;
  const rawHrFloors: number[] =
    Array.isArray(bikeSetting?.hr_zone_floors) &&
    bikeSetting.hr_zone_floors.length === rawHrCeilings.length
      ? bikeSetting.hr_zone_floors.map((v: any) => Number(v))
      : Array.isArray(rawProfile?.hrZones) &&
          rawProfile.hrZones.length === rawHrCeilings.length
        ? rawProfile.hrZones.map((z: any) => Number(z.minBpm))
        : rawHrCeilings.length === 5
          ? defaultBikeHrFloors
          : [];
  const rawHrNames: string[] =
    Array.isArray(bikeSetting?.hr_zone_names) && bikeSetting.hr_zone_names.length >= 5
      ? bikeSetting.hr_zone_names
      : Array.isArray(rawProfile?.hrZones) &&
          rawProfile.hrZones.length === rawHrCeilings.length
        ? rawProfile.hrZones.map((z: any) => String(z.name || ''))
        : rawHrCeilings.length === 5
          ? garmin5ZoneNames
          : friel7ZoneNames;

  const hrZones = rawHrCeilings.slice(0, 7).map((ceilBpm, i) => {
    const minBpm =
      rawHrFloors[i] && rawHrFloors[i] > 40
        ? rawHrFloors[i]
        : i === 0
          ? rawHrCeilings.length === 5
            ? Math.round(lthr * 0.71)
            : 60
          : rawHrCeilings[i - 1] + 1;
    const maxBpm = i === rawHrCeilings.length - 1 ? Math.max(ceilBpm, maxHr) : ceilBpm;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawHrNames[i] || `HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr: Math.round((minBpm / Math.max(100, lthr)) * 100),
      maxPctLthr: Math.round((maxBpm / Math.max(100, lthr)) * 100),
      color: SERVER_ZONE_COLORS[i] || '#EF4444',
    };
  });

  // Running HR Zones (Supports Garmin 5-Zone with exact floors OR Intervals.icu 7-Zone)
  const defaultRunHrCeilings = [
    Math.round(runLthr * 0.87),
    Math.round(runLthr * 0.97),
    Math.round(runLthr * 1.03),
    Math.round(runLthr * 1.1),
    runMaxHr,
  ];
  const defaultRunHrFloors = [
    Math.round(runLthr * 0.71),
    defaultRunHrCeilings[0] + 1,
    defaultRunHrCeilings[1] + 1,
    defaultRunHrCeilings[2] + 1,
    defaultRunHrCeilings[3] + 1,
  ];
  const rawRunHrCeilings: number[] =
    Array.isArray(runSetting?.hr_zones) && runSetting.hr_zones.length >= 5
      ? runSetting.hr_zones.map((v: any) => Number(v))
      : Array.isArray(rawProfile?.runHrZones) && rawProfile.runHrZones.length >= 5
        ? rawProfile.runHrZones.map((z: any) => Number(z.maxBpm))
        : defaultRunHrCeilings;
  const rawRunHrFloors: number[] =
    Array.isArray(runSetting?.hr_zone_floors) &&
    runSetting.hr_zone_floors.length === rawRunHrCeilings.length
      ? runSetting.hr_zone_floors.map((v: any) => Number(v))
      : Array.isArray(rawProfile?.runHrZones) &&
          rawProfile.runHrZones.length === rawRunHrCeilings.length
        ? rawProfile.runHrZones.map((z: any) => Number(z.minBpm))
        : rawRunHrCeilings.length === 5
          ? defaultRunHrFloors
          : [];
  const rawRunHrNames: string[] =
    Array.isArray(runSetting?.hr_zone_names) && runSetting.hr_zone_names.length >= 5
      ? runSetting.hr_zone_names
      : Array.isArray(rawProfile?.runHrZones) &&
          rawProfile.runHrZones.length === rawRunHrCeilings.length
        ? rawProfile.runHrZones.map((z: any) => String(z.name || ''))
        : rawRunHrCeilings.length === 5
          ? garmin5ZoneNames
          : friel7ZoneNames;

  const runHrZones = rawRunHrCeilings.slice(0, 7).map((ceilBpm, i) => {
    const minBpm =
      rawRunHrFloors[i] && rawRunHrFloors[i] > 40
        ? rawRunHrFloors[i]
        : i === 0
          ? rawRunHrCeilings.length === 5
            ? Math.round(runLthr * 0.71)
            : 60
          : rawRunHrCeilings[i - 1] + 1;
    const maxBpm = i === rawRunHrCeilings.length - 1 ? Math.max(ceilBpm, runMaxHr) : ceilBpm;
    return {
      zone: i + 1,
      code: `Z${i + 1}`,
      name: rawRunHrNames[i] || `Run HR Zone ${i + 1}`,
      minBpm,
      maxBpm,
      minPctLthr: Math.round((minBpm / Math.max(100, runLthr)) * 100),
      maxPctLthr: Math.round((maxBpm / Math.max(100, runLthr)) * 100),
      color: SERVER_ZONE_COLORS[i] || '#EF4444',
    };
  });

  const candidateName =
    rawProfile?.name ||
    [rawProfile?.firstname, rawProfile?.lastname].filter(Boolean).join(' ') ||
    rawProfile?.username ||
    prev.name ||
    '';

  return {
    athleteId: String(rawProfile?.id || prev.athleteId || '0'),
    name: !isGenericName(candidateName) ? String(candidateName).trim() : 'Athlete',
    weightKg: Number(weightKg.toFixed(1)),
    restingHr: Math.round(restingHr),
    vo2MaxCycling: Math.round(vo2MaxCycling),
    vo2MaxRunning: Math.round(vo2MaxRunning),
    ftp: Math.round(ftp),
    indoorFtp: Math.round(indoorFtp),
    eFtp: Math.round(eFtp),
    wPrime: Math.round(wPrime),
    pMax: Math.round(pMax),
    lthr: Math.round(lthr),
    maxHr: Math.round(maxHr),
    sweetSpotMinPct,
    sweetSpotMaxPct,
    runFtp: Math.round(runFtp),
    runEFtp: Math.round(runEFtp),
    runLthr: Math.round(runLthr),
    runMaxHr: Math.round(runMaxHr),
    thresholdPaceSecsPerKm: Math.round(thresholdPaceSecsPerKm),
    powerZones,
    hrZones,
    runHrZones,
    lastSyncedAt: new Date().toISOString(),
    source: rawProfile?.source || 'INTERVALS_GARMIN',
  };
}

export function parseWorkoutSyntaxToSteps(syntax: string, fallbackDurationSecs = 3600) {
  const lines = (syntax || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'));
  if (lines.length === 0) {
    return [
      {
        label: 'Warmup',
        durationSecs: Math.round(fallbackDurationSecs * 0.2),
        duration: `${Math.round((fallbackDurationSecs * 0.2) / 60)}m`,
        targetPctFtp: 60,
        targetZoneOrOutput: '60% FTP · Z1-Z2',
      },
      {
        label: 'Main Set',
        durationSecs: Math.round(fallbackDurationSecs * 0.65),
        duration: `${Math.round((fallbackDurationSecs * 0.65) / 60)}m`,
        targetPctFtp: 88,
        targetZoneOrOutput: '85–92% FTP · Z3/Z4',
      },
      {
        label: 'Cooldown',
        durationSecs: Math.round(fallbackDurationSecs * 0.15),
        duration: `${Math.round((fallbackDurationSecs * 0.15) / 60)}m`,
        targetPctFtp: 55,
        targetZoneOrOutput: '55% FTP · Z1',
      },
    ];
  }

  return lines.map((line, idx) => {
    const clean = line.replace(/^-+\s*/, '');
    const minMatch = clean.match(/(\d+)\s*m/i);
    const secMatch = clean.match(/(\d+)\s*s/i);
    const pctMatch = clean.match(/(\d+)\s*%/);
    const wattsMatch = clean.match(/(\d+)\s*w/i);
    const mins = minMatch ? Number(minMatch[1]) : secMatch ? Math.max(1, Math.round(Number(secMatch[1]) / 60)) : 10;
    const secs = secMatch && !minMatch ? Number(secMatch[1]) : mins * 60;
    const pct = pctMatch ? Number(pctMatch[1]) : wattsMatch ? Math.round((Number(wattsMatch[1]) / 300) * 100) : 75;
    return {
      label: clean.split(/\d+[ms]/i)[0]?.trim() || `Step ${idx + 1}`,
      durationSecs: secs,
      duration: minMatch ? `${mins}m` : `${secs}s`,
      targetPctFtp: pct,
      targetZoneOrOutput: clean,
    };
  });
}

