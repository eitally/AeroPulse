import React, { useEffect, useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachComplexityTier,
  CoachEventGroup,
  ConnectedAthleteRecord,
  PracticeVenueCategory,
  SportCategory,
  TeamBroadcastWorkout,
  TeamSummaryWithRole,
  TeamWorkoutLibraryCategory,
  TeamWorkoutLibraryTemplate,
  TrackRepDistanceMeters,
  TrackSetSpec,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  VdotPodIntensity,
  WorkoutSessionSlot,
} from '../types';
import {
  DEFAULT_PRACTICE_VENUE_PRESETS,
  formatPracticeTime12h,
  formatSessionLogisticsLine,
  loadSavedTeamLocations,
  saveTeamLocation,
  sanitizeScheduledTime,
  type SavedPracticeVenue,
} from '../utils/workoutScheduleUtils';
import {
  computeMultiSetPodSplits,
  formatMultiSetPrintableSplitSheet,
  type MultiSetPodSetInput,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import { parseStructuredTrackWorkout } from '../utils/workoutParser';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration';
import {
  exportWorkoutAsErg,
  exportWorkoutAsFit,
  exportWorkoutAsZwo,
} from '../utils/workoutExportActions';
import { openShareWorkoutRoute } from '../utils/shareWorkoutEngine';
import { stageWorkoutInTracksideStopwatch } from '../hooks/useTracksideStopwatch';
import { openPrintablePodClipboardWindow } from '../utils/teamQrHelper';
import {
  buildThreshSessionHeaders,
  deleteWorkoutLibraryTemplateApi,
  saveWorkoutLibraryTemplateApi,
} from '../utils/teamLifecycleApi';
import {
  DEFAULT_SWIM_CSS_SECS_PER_100M,
  SWIM_TRI_CLIPBOARD_TEMPLATES,
  buildSwimClipboardWorkout,
  buildTriBrickClipboardWorkout,
} from '../physiology/swimZones';
import { ALL_TF_PRACTICE_TEMPLATES } from '../physiology/fieldEventsEngine';
import {
  COACH_EVENT_GROUP_OPTIONS,
  normalizeCoachEventGroup,
} from '../physiology/teamOnboardingEngine';
import { resolveWorkspaceSportAndRoleScope } from '../utils/workspaceScope';
import {
  Bike,
  Check,
  ChevronDown,
  ClipboardText,
  Clock,
  Copy,
  Download,
  Dumbbell,
  Footprints,
  Layers,
  MapPin,
  Plus,
  Send,
  ShareNetwork,
  Timer,
  Trash,
  Waves,
} from './icons/PhosphorIcons';

export interface CoachClipboardWorkoutBuilderProps {
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  connectedAthletes: ConnectedAthleteRecord[];
  primaryAthleteDisplayName: string;
  selfProfile: AthleteProfile;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  onCreatePlannedEvent: (event: {
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    scheduledTime?: string;
    sessionSlot?: WorkoutSessionSlot;
    locationName?: string;
    locationCategory?: PracticeVenueCategory;
    meetingNotes?: string;
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onOpenStopwatchSubTab: () => void;
  complexityTier?: CoachComplexityTier;
  defaultEventGroup?: CoachEventGroup;
}

type AudienceMode = 'ALL' | CoachEventGroup | 'INDIVIDUAL';

interface BuilderSetRow {
  id: string;
  repCount: number;
  repDistanceMeters: number;
  measureMode?: 'DISTANCE_M' | 'TIME_MINS';
  durationMins?: number;
  targetPctFtp?: number;
  intensity: VdotPodIntensity;
  restLabel: string;
  setRestAfterSecs: number;
}

const VALID_REP_DISTS: TrackRepDistanceMeters[] = [
  10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1600,
];

const SWIM_REP_DISTS: number[] = [50, 100, 150, 200, 300, 400, 500, 800];

const BUILTIN_WORKOUT_LIBRARY: Array<TeamWorkoutLibraryTemplate & { isBuiltin?: boolean }> = [
  {
    id: 'builtin-cv-5x800',
    name: '5×800m CV + 4×200m R',
    category: 'TRACK',
    sportCategory: 'Running',
    workoutSyntax:
      'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 5x800m at CV pace (90s jog)\n\nMain Set 2\n- 4x200m at mile pace (200m jog)\n\nCooldown\n- 1.5mi Z1 Cooldown',
    description: 'Critical Velocity aerobic power with fast closing 200m mechanics.',
    plannedDurationSecs: 3300,
    plannedLoad: 76,
    createdByName: 'MeetReady Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-xc-threshold',
    name: '6×1000m Sub-T Track Ladder',
    category: 'XC_TEMPO',
    sportCategory: 'Running',
    workoutSyntax:
      'Warmup\n- 2mi Z1 Warmup\n\nMain Set 1\n- 6x1000m at Sub-T pace (60s jog)\n\nCooldown\n- 1.5mi Z1 Cooldown',
    description: 'High-control Sub-Threshold reps for midseason XC & 5000m strength.',
    plannedDurationSecs: 3600,
    plannedLoad: 78,
    createdByName: 'MeetReady Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-road-prog',
    name: '30m Aerobic Progression',
    category: 'ROAD',
    sportCategory: 'Running',
    workoutSyntax: 'Warmup\n- 10m 68% Pace\n\nMain Set 1\n- 30m 84% Pace\n\nCooldown\n- 10m 65% Pace',
    description: 'Progressive aerobic steady block ending near Marathon effort.',
    plannedDurationSecs: 3000,
    plannedLoad: 64,
    createdByName: 'MeetReady Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-cyc-ss',
    name: '3×10m Sweet Spot Trainer',
    category: 'CYCLING',
    sportCategory: 'Cycling',
    workoutSyntax:
      'Warmup\n- 15m 58% FTP Warmup\n\nMain Set 1\n- 3x 10m 88% FTP (3m recovery)\n\nCooldown\n- 10m 54% FTP Cooldown',
    description: 'Zero-impact aerobic engine support at 88% FTP.',
    plannedDurationSecs: 3600,
    plannedLoad: 72,
    createdByName: 'MeetReady Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  {
    id: 'builtin-rec-strides',
    name: 'Pre-Meet Shakeout + Strides',
    category: 'RECOVERY',
    sportCategory: 'Running',
    workoutSyntax:
      'Warmup\n- 1.5mi Z1 Warmup\n\nMain Set 1\n- 4x150m at mile pace (90s walk)\n\nCooldown\n- 1mi Z1 Cooldown',
    description: 'Low-strain neuromuscular opener 24 hours before competition.',
    plannedDurationSecs: 1800,
    plannedLoad: 32,
    createdByName: 'MeetReady Library',
    createdAt: '2026-01-01T00:00:00Z',
    isBuiltin: true,
  },
  ...SWIM_TRI_CLIPBOARD_TEMPLATES,
  ...ALL_TF_PRACTICE_TEMPLATES,
];

const LIBRARY_CATEGORY_CHIPS: Array<{ id: 'ALL' | TeamWorkoutLibraryCategory; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'TRACK', label: 'Track' },
  { id: 'XC_TEMPO', label: 'XC / Tempo' },
  { id: 'ROAD', label: 'Road' },
  { id: 'CYCLING', label: 'Cycling' },
  { id: 'SWIMMING', label: 'Swimming' },
  { id: 'TRIATHLON', label: 'Triathlon' },
  { id: 'RECOVERY', label: 'Recovery' },
];

const WARMUP_COOLDOWN_PRESETS = [
  { meters: 1609, label: '1 mi', syntax: '1mi' },
  { meters: 2414, label: '1.5 mi', syntax: '1.5mi' },
  { meters: 3219, label: '2 mi', syntax: '2mi' },
  { meters: 2000, label: '2 km', syntax: '2km' },
  { meters: 3000, label: '3 km', syntax: '3km' },
];

const INTENSITY_TO_ZONE: Record<VdotPodIntensity, TrackTrainingZoneCode> = {
  EASY: 'E',
  MARATHON: 'SUB_T',
  SUB_THRESHOLD: 'SUB_T',
  THRESHOLD_CV: 'CV',
  INTERVAL_VO2: 'I',
  RACE_3200M: 'I',
  REPETITION: 'R',
  RACE_1600M: 'R',
  RACE_800M: 'FR',
  RACE_400M: 'FR',
};

const INTENSITY_SHORT_LABEL: Record<VdotPodIntensity, string> = {
  EASY: 'Easy pace',
  MARATHON: 'Marathon pace',
  SUB_THRESHOLD: 'Sub-T pace',
  THRESHOLD_CV: 'CV pace',
  INTERVAL_VO2: '5K pace',
  RACE_3200M: '3200m pace',
  REPETITION: 'Repetition',
  RACE_1600M: 'mile pace',
  RACE_800M: '800m pace',
  RACE_400M: '400m pace',
};

function snapRepDist(meters: number): TrackRepDistanceMeters {
  return VALID_REP_DISTS.reduce((best, cur) =>
    Math.abs(cur - meters) < Math.abs(best - meters) ? cur : best
  );
}

function snapWuCdMeters(meters: number): number {
  return WARMUP_COOLDOWN_PRESETS.reduce((best, cur) =>
    Math.abs(cur.meters - meters) < Math.abs(best.meters - meters) ? cur : best
  ).meters;
}

function parseRestLabelSecs(label: string): number {
  const m = label.match(/(\d+(?:\.\d+)?)\s*:\s*(\d{2})/);
  if (m) return Math.round(Number(m[1]) * 60 + Number(m[2]));
  const minMatch = label.match(/(\d+(?:\.\d+)?)\s*(?:m|min)/i);
  if (minMatch) return Math.round(Number(minMatch[1]) * 60);
  const secMatch = label.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (secMatch) return Math.round(Number(secMatch[1]));
  return 60;
}

function mapStepToPodIntensity(label: string, intensityPct: number): VdotPodIntensity {
  if (/\b400\s*m?\s*(?:race\s*)?(?:pace|effort)\b/i.test(label) || intensityPct >= 134) {
    return 'RACE_400M';
  }
  if (/\b800\s*m?\s*(?:race\s*)?(?:pace|effort)\b|\bFR\b/i.test(label) || intensityPct >= 126) {
    return 'RACE_800M';
  }
  if (/\b(?:1600|1500|1\s*mile|mile)\s*(?:race\s*)?(?:pace|effort)\b/i.test(label)) {
    return 'RACE_1600M';
  }
  if (/\b(?:3200|3000|2\s*mile)\s*(?:race\s*)?(?:pace|effort)\b/i.test(label)) {
    return 'RACE_3200M';
  }
  if (/\b(?:5k|5000|vo2|\bI\b)\b/i.test(label)) return 'INTERVAL_VO2';
  if (/\bsub-?t\b/i.test(label)) return 'SUB_THRESHOLD';
  if (/\b(?:cv|threshold|10k|tempo)\b/i.test(label)) return 'THRESHOLD_CV';
  if (intensityPct >= 114) return 'RACE_1600M';
  if (intensityPct >= 106) return 'INTERVAL_VO2';
  if (intensityPct >= 97) return 'THRESHOLD_CV';
  return 'SUB_THRESHOLD';
}

export const CoachClipboardWorkoutBuilder: React.FC<CoachClipboardWorkoutBuilderProps> = ({
  activeTeam,
  myTeams,
  connectedAthletes,
  primaryAthleteDisplayName,
  selfProfile,
  onTeamsUpdated,
  onCreatePlannedEvent,
  onOpenStopwatchSubTab,
  complexityTier = 'ESSENTIALS',
  defaultEventGroup,
}) => {
  const [clipboardSport, setClipboardSport] = useState<SportCategory>('Running');
  const [audienceMode, setAudienceMode] = useState<AudienceMode>(defaultEventGroup || 'ALL');
  useEffect(() => {
    setAudienceMode(defaultEventGroup || 'ALL');
  }, [defaultEventGroup]);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [workoutDate, setWorkoutDate] = useState(() => getLocalDateIso());
  const [sessionSlot, setSessionSlot] = useState<WorkoutSessionSlot>('SINGLE');
  const [scheduledTime, setScheduledTime] = useState<string>('15:45');
  const [locationCategory, setLocationCategory] = useState<PracticeVenueCategory>('TRACK');
  const [locationName, setLocationName] = useState<string>('School Track');
  const [savedVenues, setSavedVenues] = useState<SavedPracticeVenue[]>(() =>
    loadSavedTeamLocations(activeTeam?.brand.teamId)
  );
  const [workoutTitle, setWorkoutTitle] = useState('Track Multi-Set');
  const [shorthandInput, setShorthandInput] = useState('');
  const [includeWarmup, setIncludeWarmup] = useState(true);
  const [warmupDistanceMeters, setWarmupDistanceMeters] = useState(3219);
  const [includeCooldown, setIncludeCooldown] = useState(true);
  const [cooldownDistanceMeters, setCooldownDistanceMeters] = useState(3219);
  const [sets, setSets] = useState<BuilderSetRow[]>([
    {
      id: 'set-1',
      repCount: 5,
      repDistanceMeters: 800,
      intensity: 'THRESHOLD_CV',
      restLabel: '90s jog',
      setRestAfterSecs: 0,
    },
  ]);
  const [overrideAthleteId, setOverrideAthleteId] = useState('');
  const [overrideSyntax, setOverrideSyntax] = useState('');
  const [athleteOverrides, setAthleteOverrides] = useState<
    NonNullable<TeamBroadcastWorkout['athleteOverrides']>
  >({});
  const [copiedSheet, setCopiedSheet] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showMetaDetailsMobile, setShowMetaDetailsMobile] = useState<boolean>(false);
  const [showManualSetRows, setShowManualSetRows] = useState<boolean>(false);
  const [stopwatchWaveMode, setStopwatchWaveMode] = useState<'MASS' | 'POD_10S' | 'PURSUIT'>('POD_10S');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null);
  const [showWorkoutLibrary, setShowWorkoutLibrary] = useState(true);
  const [libraryFilter, setLibraryFilter] = useState<'ALL' | TeamWorkoutLibraryCategory>('ALL');
  const [isSavingLibrary, setIsSavingLibrary] = useState(false);
  const [deletingLibraryId, setDeletingLibraryId] = useState<string | null>(null);

  const workspaceScope = useMemo(
    () =>
      resolveWorkspaceSportAndRoleScope({
        athleteProfile: selfProfile,
        activeTeam,
      }),
    [selfProfile, activeTeam]
  );

  const audienceChips: Array<{ id: AudienceMode; label: string }> = useMemo(() => {
    const base: Array<{ id: AudienceMode; label: string }> = [
      { id: 'ALL', label: 'Whole Team' },
      ...COACH_EVENT_GROUP_OPTIONS.map((opt) => ({
        id: opt.id as AudienceMode,
        label: opt.shortLabel,
      })),
      { id: 'INDIVIDUAL', label: 'Individuals' },
    ];
    return workspaceScope.showTrackEventGroupChips(clipboardSport)
      ? base
      : base.filter((c) => c.id === 'ALL' || c.id === 'INDIVIDUAL');
  }, [workspaceScope, clipboardSport]);

  const scopedAthletes = useMemo(() => {
    if (connectedAthletes.length === 0) return [];
    if (audienceMode === 'INDIVIDUAL') {
      return selectedAthleteIds.length > 0
        ? connectedAthletes.filter((a) => selectedAthleteIds.includes(a.id))
        : connectedAthletes;
    }
    const selectedGroup = normalizeCoachEventGroup(audienceMode);
    if (selectedGroup) {
      const matched = connectedAthletes.filter((a) => a.eventGroup === selectedGroup);
      return matched.length > 0 ? matched : connectedAthletes;
    }
    return connectedAthletes;
  }, [connectedAthletes, audienceMode, selectedAthleteIds]);

  const podRoster = useMemo<VdotPodRosterInput[]>(() => {
    if (scopedAthletes.length === 0) {
      return [
        {
          id: 'SELF',
          name: primaryAthleteDisplayName || 'Lead Runner',
          thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
        },
      ];
    }
    return scopedAthletes.map((a) => ({
      id: a.id,
      name: a.name,
      thresholdPaceSecsPerKm: a.athleteProfile.thresholdPaceSecsPerKm || 250,
    }));
  }, [scopedAthletes, primaryAthleteDisplayName, selfProfile.thresholdPaceSecsPerKm]);

  const multiSetPreview = useMemo(() => {
    const inputs: MultiSetPodSetInput[] = sets.map((s) => ({
      repCount: s.repCount,
      repDistanceMeters: snapRepDist(s.repDistanceMeters),
      intensity: s.intensity,
      restLabel: s.restLabel,
      ...(s.setRestAfterSecs > 0 ? { setRestAfterSecs: s.setRestAfterSecs } : {}),
    }));
    return computeMultiSetPodSplits({ roster: podRoster, sets: inputs });
  }, [podRoster, sets]);

  const wuPreset =
    WARMUP_COOLDOWN_PRESETS.find((p) => p.meters === warmupDistanceMeters) ||
    WARMUP_COOLDOWN_PRESETS[2];
  const cdPreset =
    WARMUP_COOLDOWN_PRESETS.find((p) => p.meters === cooldownDistanceMeters) ||
    WARMUP_COOLDOWN_PRESETS[2];

  const builtWorkout = useMemo(() => {
    if (clipboardSport === 'Swimming') {
      const swimRes = buildSwimClipboardWorkout({
        sets,
        cssSecsPer100m: selfProfile.swimCssSecsPer100m || DEFAULT_SWIM_CSS_SECS_PER_100M,
        includeWarmup,
        includeCooldown,
      });
      const firstRep = sets[0];
      const swimTrackSpec: TrackWorkoutSpec = {
        repCount: firstRep?.repCount || 10,
        repDistanceMeters: snapRepDist(firstRep?.repDistanceMeters || 150),
        zoneCode: 'CV',
        podIntensity: 'THRESHOLD_CV',
        restDurationSecs: parseRestLabelSecs(firstRep?.restLabel || '15s'),
        waveMode: stopwatchWaveMode,
        sets: [],
      };
      return {
        workoutSyntax: swimRes.workoutSyntax,
        plannedDurationSecs: swimRes.plannedDurationSecs,
        plannedLoad: swimRes.plannedLoad,
        trackSpec: swimTrackSpec,
        setsSummary: swimRes.summaryLine,
      };
    }

    if (clipboardSport === 'Multisport') {
      const brickRes = buildTriBrickClipboardWorkout({
        bikeMins: sets[0]?.durationMins || 45,
        runMins: sets[1]?.durationMins || 20,
        ftpWatts: selfProfile.ftp,
        thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm,
        includeWarmup,
        includeCooldown,
      });
      const brickTrackSpec: TrackWorkoutSpec = {
        repCount: 1,
        repDistanceMeters: 800,
        zoneCode: 'SUB_T',
        podIntensity: 'SUB_THRESHOLD',
        restDurationSecs: 120,
        waveMode: stopwatchWaveMode,
        sets: [],
      };
      return {
        workoutSyntax: brickRes.workoutSyntax,
        plannedDurationSecs: brickRes.plannedDurationSecs,
        plannedLoad: brickRes.plannedLoad,
        trackSpec: brickTrackSpec,
        setsSummary: brickRes.summaryLine,
      };
    }

    const isCycling = clipboardSport === 'Cycling';
    const isStrength = clipboardSport === 'Strength';
    const lines: string[] = [];
    if (includeWarmup) {
      lines.push(
        isCycling
          ? `Warmup\n- 15m 58% FTP Warmup`
          : isStrength
            ? `Warmup\n- 10m 55% Effort Dynamic Mobility & Band Activation`
            : `Warmup\n- ${wuPreset.syntax} Z1 Warmup`
      );
    }
    sets.forEach((s, idx) => {
      const isTime = isCycling || isStrength || s.measureMode === 'TIME_MINS';
      if (isTime) {
        const mins = Math.max(1, s.durationMins || (isStrength ? 10 : 6));
        const pct = s.targetPctFtp || (isCycling ? 90 : isStrength ? 78 : 98);
        const targetUnit = isCycling ? 'FTP' : isStrength ? 'Effort' : 'Pace';
        const restSecs = parseRestLabelSecs(s.restLabel);
        const restTok =
          restSecs >= 120 && restSecs % 60 === 0 ? `${restSecs / 60}m` : `${restSecs}s`;
        lines.push(
          `Main Set ${idx + 1}\n- ${s.repCount}x ${mins}m ${pct}% ${targetUnit} (${restTok} recovery)`
        );
      } else {
        const paceLabel = INTENSITY_SHORT_LABEL[s.intensity] || 'CV pace';
        lines.push(
          `Main Set ${idx + 1}\n- ${s.repCount}x${s.repDistanceMeters}m at ${paceLabel} (${s.restLabel})`
        );
      }
      if (s.setRestAfterSecs > 0 && idx < sets.length - 1) {
        lines.push(`- ${Math.round(s.setRestAfterSecs / 60)}m set rest`);
      }
    });
    if (includeCooldown) {
      lines.push(
        isCycling
          ? `Cooldown\n- 10m 54% FTP Cooldown`
          : isStrength
            ? `Cooldown\n- 8m 50% Effort Post-Lift Stretch & Core`
            : `Cooldown\n- ${cdPreset.syntax} Z1 Cooldown`
      );
    }
    const workoutSyntax = lines.join('\n\n');

    const totalWorkMeters = sets.reduce(
      (acc, s) => acc + s.repCount * s.repDistanceMeters,
      0
    );
    const wuSecs = isCycling
      ? includeWarmup
        ? 900
        : 0
      : isStrength
        ? includeWarmup
          ? 600
          : 0
        : includeWarmup
          ? Math.round((wuPreset.meters / 1000) * 305)
          : 0;
    const cdSecs = isCycling
      ? includeCooldown
        ? 600
        : 0
      : isStrength
        ? includeCooldown
          ? 480
          : 0
        : includeCooldown
          ? Math.round((cdPreset.meters / 1000) * 310)
          : 0;
    const workRestSecs = sets.reduce((acc, s) => {
      const restS = parseRestLabelSecs(s.restLabel);
      const isTime = isCycling || isStrength || s.measureMode === 'TIME_MINS';
      const repSecs = isTime
        ? Math.max(1, s.durationMins || (isStrength ? 10 : 6)) * 60
        : Math.round((s.repDistanceMeters / 1000) * 215);
      return acc + s.repCount * (repSecs + restS) + (s.setRestAfterSecs || 0);
    }, 0);
    const plannedDurationSecs = Math.max(900, wuSecs + workRestSecs + cdSecs);
    const hasOnlyDistance =
      !isCycling && !isStrength && sets.every((s) => s.measureMode !== 'TIME_MINS');
    const plannedLoad = hasOnlyDistance
      ? Math.max(
          20,
          Math.min(130, Math.round((totalWorkMeters / 1000) * 11 + (wuSecs + cdSecs) / 90))
        )
      : Math.max(
          20,
          Math.min(160, Math.round((plannedDurationSecs / 3600) * (isStrength ? 58 : 78)))
        );

    const trackSets: TrackSetSpec[] = sets.map((s, idx) => ({
      repCount: s.repCount,
      repDistanceMeters: snapRepDist(s.repDistanceMeters),
      zoneCode: INTENSITY_TO_ZONE[s.intensity],
      podIntensity: s.intensity,
      targetSplitSecs: multiSetPreview[0]?.setSplits[idx]?.targetSplitSecs,
      restDurationSecs: parseRestLabelSecs(s.restLabel),
      ...(s.setRestAfterSecs > 0 ? { setRestAfterSecs: s.setRestAfterSecs } : {}),
      recoveryCue: s.restLabel,
    }));

    const firstSet = trackSets[0];
    const trackSpec: TrackWorkoutSpec = {
      repCount: trackSets.reduce((acc, s) => acc + s.repCount, 0),
      repDistanceMeters: snapRepDist(firstSet?.repDistanceMeters || 800),
      zoneCode: firstSet?.zoneCode || 'CV',
      podIntensity: firstSet?.podIntensity || 'THRESHOLD_CV',
      targetSplitSecs: firstSet?.targetSplitSecs,
      restDurationSecs: firstSet?.restDurationSecs ?? 60,
      waveMode: stopwatchWaveMode,
      ...(includeWarmup ? { warmupDistanceMeters: wuPreset.meters } : {}),
      ...(includeCooldown ? { cooldownDistanceMeters: cdPreset.meters } : {}),
      sets: trackSets,
    };

    const setsSummary = sets
      .map((s) =>
        isCycling || isStrength || s.measureMode === 'TIME_MINS'
          ? `${s.repCount}×${s.durationMins || (isStrength ? 10 : 6)}m @ ${s.targetPctFtp || (isCycling ? 90 : isStrength ? 78 : 98)}% ${isCycling ? 'FTP' : isStrength ? 'Effort' : 'Pace'}`
          : `${s.repCount}×${s.repDistanceMeters}m @ ${INTENSITY_SHORT_LABEL[s.intensity]}`
      )
      .join(' + ');

    return { workoutSyntax, plannedDurationSecs, plannedLoad, trackSpec, setsSummary };
  }, [
    clipboardSport,
    includeWarmup,
    includeCooldown,
    wuPreset,
    cdPreset,
    sets,
    multiSetPreview,
    stopwatchWaveMode,
    selfProfile.swimCssSecsPer100m,
    selfProfile.ftp,
    selfProfile.thresholdPaceSecsPerKm,
  ]);

  const applyShorthandText = (rawText: string) => {
    const clean = rawText.trim();
    if (!clean) return;
    const ast = parseStructuredTrackWorkout(
      clean,
      selfProfile.thresholdPaceSecsPerKm || 245
    );
    const parsedSets: BuilderSetRow[] = [];
    let foundWarmup: number | null = null;
    let foundCooldown: number | null = null;

    for (const node of ast) {
      if (node.type === 'step') {
        if (node.step.stepKind === 'warmup' && node.step.distanceMeters) {
          foundWarmup = snapWuCdMeters(node.step.distanceMeters);
        } else if (node.step.stepKind === 'cooldown' && node.step.distanceMeters) {
          foundCooldown = snapWuCdMeters(node.step.distanceMeters);
        } else if (
          node.step.stepKind === 'rest' &&
          parsedSets.length > 0 &&
          node.step.durationSecs >= 90
        ) {
          parsedSets[parsedSets.length - 1].setRestAfterSecs = Math.round(
            node.step.durationSecs / 60
          ) * 60;
        }
        continue;
      }

      const workStep = node.steps.find(
        (s) => s.stepKind !== 'rest' && (s.distanceMeters ?? 0) >= 10
      );
      if (workStep && workStep.distanceMeters) {
        const restStep = node.steps.find((s) => s.stepKind === 'rest');
        parsedSets.push({
          id: `set-${parsedSets.length + 1}-${Date.now()}`,
          repCount: Math.max(1, node.repeatCount),
          repDistanceMeters: snapRepDist(workStep.distanceMeters),
          intensity: mapStepToPodIntensity(workStep.label, workStep.intensityPct),
          restLabel: restStep
            ? restStep.label
            : '60s jog',
          setRestAfterSecs: 0,
        });
      }
    }

    if (foundWarmup !== null) {
      setIncludeWarmup(true);
      setWarmupDistanceMeters(foundWarmup);
    } else if (!/warm/i.test(clean)) {
      setIncludeWarmup(false);
    }

    if (foundCooldown !== null) {
      setIncludeCooldown(true);
      setCooldownDistanceMeters(foundCooldown);
    } else if (!/cool/i.test(clean)) {
      setIncludeCooldown(false);
    }

    if (parsedSets.length > 0) {
      setSets(parsedSets);
      setShowManualSetRows(true);
      setWorkoutTitle(
        parsedSets.map((s) => `${s.repCount}×${s.repDistanceMeters}m`).join(' + ')
      );
      setAssignFeedback(`Loaded ${parsedSets.length} set${parsedSets.length === 1 ? '' : 's'} into builder.`);
    }
  };

  const handleAddSet = () => {
    setShowManualSetRows(true);
    setSets((prev) => [
      ...prev,
      {
        id: `set-${Date.now()}-${prev.length + 1}`,
        repCount: 4,
        repDistanceMeters: 400,
        intensity: 'RACE_1600M',
        restLabel: '90s jog',
        setRestAfterSecs: 0,
      },
    ]);
  };

  const handleAssignWorkout = async () => {
    setIsAssigning(true);
    setAssignFeedback(null);
    const title = workoutTitle.trim() || builtWorkout.setsSummary || 'Track Session';
    const wuLabel = includeWarmup ? `${wuPreset.label} WU` : '';
    const cdLabel = includeCooldown ? `${cdPreset.label} CD` : '';
    const cleanTime = sanitizeScheduledTime(scheduledTime);
    const cleanLoc = locationName.trim().slice(0, 120) || undefined;
    const logisticsBadge = formatSessionLogisticsLine({
      sessionSlot,
      scheduledTime: cleanTime,
      locationName: cleanLoc,
    });
    const description = [wuLabel, builtWorkout.setsSummary, cdLabel, logisticsBadge]
      .filter(Boolean)
      .join(' · ');

    if (cleanLoc) {
      setSavedVenues(
        saveTeamLocation(activeTeam?.brand.teamId, {
          name: cleanLoc,
          category: locationCategory,
          defaultTime: cleanTime,
        })
      );
    }

    try {
      const audienceLabel =
        audienceChips.find((c) => c.id === audienceMode)?.label || 'Whole Team';
      if (activeTeam) {
        const selectedGroup = normalizeCoachEventGroup(audienceMode);
        const targetEventGroups: CoachEventGroup[] | undefined = selectedGroup
          ? [selectedGroup]
          : undefined;
        const targetMembershipIds =
          audienceMode === 'INDIVIDUAL' && selectedAthleteIds.length > 0
            ? selectedAthleteIds.map((id) => id.replace(/^team-mem-/, ''))
            : undefined;

        if (activeTeam.brand.teamId.startsWith('demo_team_')) {
          const newBroadcast: TeamBroadcastWorkout = {
            broadcastId: `bw_demo_${Date.now()}`,
            teamId: activeTeam.brand.teamId,
            targetSquadGroup: 'ALL',
            ...(targetEventGroups ? { targetEventGroups } : {}),
            ...(targetMembershipIds ? { targetMembershipIds } : {}),
            date: workoutDate,
            name: title,
            sportCategory: clipboardSport,
            plannedDurationSecs: builtWorkout.plannedDurationSecs,
            plannedLoad: builtWorkout.plannedLoad,
            workoutSyntax: builtWorkout.workoutSyntax,
            description,
            ...(cleanTime ? { scheduledTime: cleanTime } : {}),
            sessionSlot,
            ...(cleanLoc ? { locationName: cleanLoc, locationCategory } : {}),
            ...(clipboardSport === 'Running' ? { trackSpec: builtWorkout.trackSpec } : {}),
            ...(Object.keys(athleteOverrides).length > 0 ? { athleteOverrides } : {}),
            pushedByCoachName: activeTeam.brand.coachDisplayName || 'Coach',
            createdAt: new Date().toISOString(),
          };
          const updatedTeam: TeamSummaryWithRole = {
            ...activeTeam,
            broadcastWorkouts: [
              ...(activeTeam.broadcastWorkouts || []).filter(
                (bw) =>
                  !(
                    sessionSlot === 'SINGLE' &&
                    bw.date === workoutDate &&
                    !bw.isOfficialMeet
                  )
              ),
              newBroadcast,
            ],
          };
          onTeamsUpdated(
            myTeams.map((t) =>
              t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
            ),
            updatedTeam.brand.teamId
          );
          setAssignFeedback(
            `Assigned "${title}" to ${audienceLabel} for ${workoutDate}${logisticsBadge ? ` (${logisticsBadge})` : ''}.`
          );
          return;
        }

        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
          {
            method: 'POST',
            credentials: 'include',
            headers: buildThreshSessionHeaders(),
            body: JSON.stringify({
              origin: typeof window !== 'undefined' ? window.location.origin : '',
              targetSquadGroup: 'ALL',
              targetEventGroups,
              targetMembershipIds,
              date: workoutDate,
              name: title,
              sportCategory: clipboardSport,
              plannedDurationSecs: builtWorkout.plannedDurationSecs,
              plannedLoad: builtWorkout.plannedLoad,
              workoutSyntax: builtWorkout.workoutSyntax,
              description,
              ...(cleanTime ? { scheduledTime: cleanTime } : {}),
              sessionSlot,
              ...(cleanLoc ? { locationName: cleanLoc, locationCategory } : {}),
              trackSpec: clipboardSport === 'Running' ? builtWorkout.trackSpec : undefined,
              athleteOverrides:
                Object.keys(athleteOverrides).length > 0 ? athleteOverrides : undefined,
              replaceSameDateTarget: sessionSlot === 'SINGLE',
            }),
          }
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.team) {
          const updatedTeam = data.team as TeamSummaryWithRole;
          onTeamsUpdated(
            myTeams.map((t) =>
              t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
            ),
            updatedTeam.brand.teamId
          );
          setAssignFeedback(
            `Assigned "${title}" to ${audienceLabel} for ${workoutDate}${logisticsBadge ? ` (${logisticsBadge})` : ''}.`
          );
          return;
        }
        if (!resp.ok) {
          setAssignFeedback(
            data?.error || 'Could not publish workout to the team cloud roster. Please try again.'
          );
          return;
        }
      }

      await onCreatePlannedEvent({
        date: workoutDate,
        name: title,
        sportCategory: clipboardSport,
        environmentPreference:
          clipboardSport === 'Strength' || clipboardSport === 'Swimming'
            ? 'INDOOR'
            : clipboardSport === 'Cycling'
              ? 'FLEXIBLE'
              : 'OUTDOOR',
        plannedDurationSecs: builtWorkout.plannedDurationSecs,
        plannedLoad: builtWorkout.plannedLoad,
        workoutSyntax: builtWorkout.workoutSyntax,
        description: `${audienceLabel}: ${description}`,
        ...(cleanTime ? { scheduledTime: cleanTime } : {}),
        sessionSlot,
        ...(cleanLoc ? { locationName: cleanLoc, locationCategory } : {}),
        ...(clipboardSport === 'Running' ? { trackSpec: builtWorkout.trackSpec } : {}),
        replaceExistingDate: false,
      });

      setAssignFeedback(
        `Assigned "${title}" to ${audienceLabel} for ${workoutDate}${logisticsBadge ? ` (${logisticsBadge})` : ''}.`
      );
    } finally {
      setIsAssigning(false);
    }
  };

  const handleLaunchStopwatch = () => {
    stageWorkoutInTracksideStopwatch({
      title: workoutTitle.trim() || builtWorkout.setsSummary || 'Track Session',
      spec: builtWorkout.trackSpec,
      pods: multiSetPreview.map((p) => p.basePod),
    });
    onOpenStopwatchSubTab();
  };

  const handleExportFit = () => {
    exportWorkoutAsFit({
      name: workoutTitle.trim() || (clipboardSport === 'Cycling' ? 'Coach Cycling Workout' : 'Coach Track Workout'),
      sport: clipboardSport,
      workoutSyntax: builtWorkout.workoutSyntax,
      ftpWatts: selfProfile.ftp || 250,
      lthrBpm: selfProfile.runLthr || selfProfile.lthr || 172,
      thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
      dateIso: workoutDate,
    });
  };

  const handleExportZwo = () => {
    exportWorkoutAsZwo({
      name: workoutTitle.trim() || 'Coach Workout',
      sport: clipboardSport,
      workoutSyntax: builtWorkout.workoutSyntax,
      description: builtWorkout.setsSummary,
      ftpWatts: selfProfile.ftp || 250,
      thresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
      dateIso: workoutDate,
    });
  };

  const handleExportErg = () => {
    exportWorkoutAsErg({
      name: workoutTitle.trim() || 'Coach Cycling Workout',
      sport: 'Cycling',
      workoutSyntax: builtWorkout.workoutSyntax,
      ftpWatts: selfProfile.ftp || 250,
      dateIso: workoutDate,
    });
  };

  const handleShareWorkout = () => {
    openShareWorkoutRoute({
      kind: 'WORKOUT',
      version: 1,
      title: workoutTitle.trim() || builtWorkout.setsSummary || 'Coach Session',
      sport: clipboardSport,
      date: workoutDate,
      workoutSyntax: builtWorkout.workoutSyntax,
      plannedDurationSecs: builtWorkout.plannedDurationSecs,
      plannedLoad: builtWorkout.plannedLoad,
      description: builtWorkout.setsSummary,
      teamName: activeTeam?.brand.name,
      authorLabel: activeTeam?.brand.coachDisplayName || 'Coach',
      referenceFtpWatts: selfProfile.ftp || 260,
      referenceThresholdPaceSecsPerKm: selfProfile.thresholdPaceSecsPerKm || 245,
    });
  };

  const handleCopySheet = () => {
    const sheet = formatMultiSetPrintableSplitSheet(
      workoutTitle.trim() || builtWorkout.setsSummary,
      workoutDate,
      includeWarmup ? `${wuPreset.label} easy warm-up` : null,
      builtWorkout.setsSummary,
      includeCooldown ? `${cdPreset.label} easy cooldown` : null,
      multiSetPreview
    );
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(sheet);
    }
    setCopiedSheet(true);
    window.setTimeout(() => setCopiedSheet(false), 2500);
  };

  const libraryTemplates = useMemo<Array<TeamWorkoutLibraryTemplate & { isBuiltin?: boolean }>>(() => {
    const saved = (activeTeam?.workoutLibrary || []).map((t) => ({ ...t, isBuiltin: false }));
    const savedNames = new Set(saved.map((t) => t.name.toLowerCase()));
    const starters = BUILTIN_WORKOUT_LIBRARY.filter((b) => !savedNames.has(b.name.toLowerCase()));
    return [...saved, ...starters];
  }, [activeTeam?.workoutLibrary]);

  const filteredLibraryTemplates = useMemo(
    () =>
      libraryFilter === 'ALL'
        ? libraryTemplates
        : libraryTemplates.filter((t) => t.category === libraryFilter),
    [libraryTemplates, libraryFilter]
  );

  const handleLoadLibraryTemplate = (tpl: TeamWorkoutLibraryTemplate) => {
    const nextSport: SportCategory =
      tpl.sportCategory === 'Cycling' ||
      tpl.sportCategory === 'Strength' ||
      tpl.sportCategory === 'Swimming' ||
      tpl.sportCategory === 'Multisport'
        ? tpl.sportCategory
        : 'Running';
    setClipboardSport(nextSport);
    setWorkoutTitle(tpl.name);
    if (nextSport === 'Running') {
      applyShorthandText(tpl.workoutSyntax);
      setWorkoutTitle(tpl.name);
    } else if (nextSport === 'Swimming') {
      const swimMatch = tpl.workoutSyntax.match(/(\d+)\s*x\s*(\d+)\s*m/i);
      const reps = swimMatch ? Math.max(1, Number(swimMatch[1])) : 10;
      const dist = swimMatch ? Math.max(50, Number(swimMatch[2])) : 100;
      setLocationCategory('POOL_CROSS');
      setLocationName('Competition Pool');
      setSets([
        {
          id: `lib-set-${Date.now()}`,
          repCount: reps,
          repDistanceMeters: dist,
          measureMode: 'DISTANCE_M',
          intensity: 'THRESHOLD_CV',
          restLabel: '15s rest',
          setRestAfterSecs: 0,
        },
      ]);
      setShowManualSetRows(true);
    } else if (nextSport === 'Multisport') {
      setLocationCategory('ROAD_CAMPUS');
      setLocationName('Transition / Loop');
      setSets([
        {
          id: `lib-brick-bike-${Date.now()}`,
          repCount: 1,
          repDistanceMeters: 800,
          measureMode: 'TIME_MINS',
          durationMins: 45,
          targetPctFtp: 88,
          intensity: 'SUB_THRESHOLD',
          restLabel: '2m T2',
          setRestAfterSecs: 0,
        },
        {
          id: `lib-brick-run-${Date.now()}`,
          repCount: 1,
          repDistanceMeters: 800,
          measureMode: 'TIME_MINS',
          durationMins: 20,
          targetPctFtp: 90,
          intensity: 'THRESHOLD_CV',
          restLabel: 'cooldown',
          setRestAfterSecs: 0,
        },
      ]);
      setShowManualSetRows(true);
    } else {
      const durMatch = tpl.workoutSyntax.match(/(\d+)\s*x\s*(\d+)m\s*(\d+)%/i);
      const mins = durMatch ? Number(durMatch[2]) : Math.max(10, Math.round(tpl.plannedDurationSecs / 120));
      const pct = durMatch ? Number(durMatch[3]) : nextSport === 'Cycling' ? 88 : 78;
      const reps = durMatch ? Math.max(1, Number(durMatch[1])) : 3;
      setSets([
        {
          id: `lib-set-${Date.now()}`,
          repCount: reps,
          repDistanceMeters: 800,
          measureMode: 'TIME_MINS',
          durationMins: mins,
          targetPctFtp: pct,
          intensity: 'THRESHOLD_CV',
          restLabel: '3m easy',
          setRestAfterSecs: 0,
        },
      ]);
      setShowManualSetRows(true);
    }
    setAssignFeedback(`Loaded template "${tpl.name}" from Workout Library.`);
  };

  const handleSaveToLibrary = async () => {
    const name = (workoutTitle.trim() || builtWorkout.setsSummary || 'Custom Session').slice(0, 100);
    const category: TeamWorkoutLibraryCategory =
      clipboardSport === 'Swimming'
        ? 'SWIMMING'
        : clipboardSport === 'Multisport'
          ? 'TRIATHLON'
          : clipboardSport === 'Cycling'
            ? 'CYCLING'
            : builtWorkout.plannedLoad < 45
              ? 'RECOVERY'
              : /tempo|sub-t|xc|hill/i.test(`${name} ${builtWorkout.setsSummary}`)
                ? 'XC_TEMPO'
                : builtWorkout.trackSpec
                  ? 'TRACK'
                  : 'ROAD';
    const payload = {
      name,
      category,
      sportCategory: clipboardSport,
      workoutSyntax: builtWorkout.workoutSyntax,
      description: builtWorkout.setsSummary || name,
      plannedDurationSecs: builtWorkout.plannedDurationSecs,
      plannedLoad: builtWorkout.plannedLoad,
      ...(clipboardSport === 'Running' ? { trackSpec: builtWorkout.trackSpec } : {}),
    };

    if (!activeTeam || activeTeam.brand.teamId.startsWith('demo_team_')) {
      if (activeTeam) {
        const localTemplate: TeamWorkoutLibraryTemplate = {
          id: `lib_${Date.now()}`,
          ...payload,
          createdByName: activeTeam.brand.coachDisplayName || primaryAthleteDisplayName || 'Coach',
          createdAt: new Date().toISOString(),
        };
        const updatedTeam: TeamSummaryWithRole = {
          ...activeTeam,
          workoutLibrary: [localTemplate, ...(activeTeam.workoutLibrary || [])],
        };
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          ),
          updatedTeam.brand.teamId
        );
      }
      setAssignFeedback(`Saved "${name}" to Team Workout Library.`);
      return;
    }

    setIsSavingLibrary(true);
    try {
      const res = await saveWorkoutLibraryTemplateApi(activeTeam.brand.teamId, payload);
      if (Array.isArray(res.teams)) {
        onTeamsUpdated(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === res.team!.brand.teamId ? res.team! : t
          ),
          res.team.brand.teamId
        );
      }
      setAssignFeedback(`Saved "${name}" to Team Workout Library.`);
    } catch (err) {
      setAssignFeedback(err instanceof Error ? err.message : 'Could not save template.');
    } finally {
      setIsSavingLibrary(false);
    }
  };

  const handleDeleteLibraryTemplate = async (tplId: string) => {
    if (!activeTeam) return;
    if (activeTeam.brand.teamId.startsWith('demo_team_')) {
      const updatedTeam: TeamSummaryWithRole = {
        ...activeTeam,
        workoutLibrary: (activeTeam.workoutLibrary || []).filter((t) => t.id !== tplId),
      };
      onTeamsUpdated(
        myTeams.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        ),
        updatedTeam.brand.teamId
      );
      return;
    }
    setDeletingLibraryId(tplId);
    try {
      const res = await deleteWorkoutLibraryTemplateApi(activeTeam.brand.teamId, tplId);
      if (Array.isArray(res.teams)) {
        onTeamsUpdated(res.teams, activeTeam.brand.teamId);
      } else if (res.team) {
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === res.team!.brand.teamId ? res.team! : t
          ),
          res.team.brand.teamId
        );
      }
    } catch (err) {
      setAssignFeedback(err instanceof Error ? err.message : 'Could not remove template.');
    } finally {
      setDeletingLibraryId(null);
    }
  };

  return (
    <section
      data-testid="coach-clipboard-builder"
      className="rounded-2xl liquid-glass p-3 sm:p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm sm:text-base font-bold text-ap-ink dark:text-ap-chalk">
            Clipboard Builder &amp; Pods
          </h2>
          <div className="inline-flex flex-wrap items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs font-semibold">
            <button
              type="button"
              aria-pressed={clipboardSport === 'Running'}
              onClick={() => setClipboardSport('Running')}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 cursor-pointer ${
                clipboardSport === 'Running'
                  ? 'ap-nav-volt-active'
                  : 'text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <Footprints className="w-3 h-3" />
              <span>Track / Run</span>
            </button>
            <button
              type="button"
              aria-pressed={clipboardSport === 'Cycling'}
              onClick={() => {
                setClipboardSport('Cycling');
                if (audienceMode !== 'ALL' && audienceMode !== 'INDIVIDUAL') {
                  setAudienceMode('ALL');
                }
              }}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 cursor-pointer ${
                clipboardSport === 'Cycling'
                  ? 'ap-nav-volt-active'
                  : 'text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <Bike className="w-3 h-3" />
              <span>Cycling</span>
            </button>
            <button
              type="button"
              data-testid="clipboard-sport-swimming"
              aria-pressed={clipboardSport === 'Swimming'}
              onClick={() => {
                setClipboardSport('Swimming');
                if (audienceMode !== 'ALL' && audienceMode !== 'INDIVIDUAL') {
                  setAudienceMode('ALL');
                }
                setLocationCategory('POOL_CROSS');
                setLocationName('Competition Pool');
                if (workoutTitle === 'Track Multi-Set' || workoutTitle === 'Triathlon T2 Brick') {
                  setWorkoutTitle('Pool CSS Set');
                }
                setSets([
                  {
                    id: `swim-set-${Date.now()}`,
                    repCount: 10,
                    repDistanceMeters: 100,
                    measureMode: 'DISTANCE_M',
                    intensity: 'THRESHOLD_CV',
                    restLabel: '15s rest',
                    setRestAfterSecs: 0,
                  },
                ]);
                setShowManualSetRows(true);
              }}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 cursor-pointer ${
                clipboardSport === 'Swimming'
                  ? 'ap-nav-volt-active'
                  : 'text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <Waves className="w-3 h-3" />
              <span>Swim</span>
            </button>
            <button
              type="button"
              data-testid="clipboard-sport-multisport"
              aria-pressed={clipboardSport === 'Multisport'}
              onClick={() => {
                setClipboardSport('Multisport');
                if (audienceMode !== 'ALL' && audienceMode !== 'INDIVIDUAL') {
                  setAudienceMode('ALL');
                }
                setLocationCategory('ROAD_CAMPUS');
                setLocationName('Transition / Loop');
                if (workoutTitle === 'Track Multi-Set' || workoutTitle === 'Pool CSS Set') {
                  setWorkoutTitle('Triathlon T2 Brick');
                }
                setSets([
                  {
                    id: `brick-bike-${Date.now()}`,
                    repCount: 1,
                    repDistanceMeters: 800,
                    measureMode: 'TIME_MINS',
                    durationMins: 45,
                    targetPctFtp: 88,
                    intensity: 'SUB_THRESHOLD',
                    restLabel: '2m T2',
                    setRestAfterSecs: 0,
                  },
                  {
                    id: `brick-run-${Date.now() + 1}`,
                    repCount: 1,
                    repDistanceMeters: 800,
                    measureMode: 'TIME_MINS',
                    durationMins: 20,
                    targetPctFtp: 90,
                    intensity: 'THRESHOLD_CV',
                    restLabel: 'cooldown',
                    setRestAfterSecs: 0,
                  },
                ]);
                setShowManualSetRows(true);
              }}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 cursor-pointer ${
                clipboardSport === 'Multisport'
                  ? 'ap-nav-volt-active'
                  : 'text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Tri Brick</span>
            </button>
            <button
              type="button"
              data-testid="clipboard-sport-strength"
              aria-pressed={clipboardSport === 'Strength'}
              onClick={() => {
                setClipboardSport('Strength');
                if (audienceMode !== 'ALL' && audienceMode !== 'INDIVIDUAL') {
                  setAudienceMode('ALL');
                }
                setLocationCategory('GYM_WEIGHTS');
                setLocationName('Weight Room');
                if (workoutTitle === 'Track Multi-Set') {
                  setWorkoutTitle('Weight Room + Mobility');
                }
                setSets((prev) =>
                  prev.map((s) => ({
                    ...s,
                    measureMode: 'TIME_MINS',
                    durationMins: s.durationMins || 10,
                    targetPctFtp: 78,
                  }))
                );
              }}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 cursor-pointer ${
                clipboardSport === 'Strength'
                  ? 'ap-nav-volt-active'
                  : 'text-ap-muted dark:text-ap-muted-dark'
              }`}
            >
              <Dumbbell className="w-3 h-3" />
              <span>Gym / Lift</span>
            </button>
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            aria-expanded={showExportMenu}
            onClick={() => setShowExportMenu((prev) => !prev)}
            className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 ap-text-brand" />
            <span>{copiedSheet ? 'Copied Sheet' : 'Export / Print'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
          </button>

          {showExportMenu && (
            <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-white dark:bg-ap-carbon border border-ap-frame/25 dark:border-ap-edge-dark shadow-xl p-1.5 z-30 space-y-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  handleCopySheet();
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-ap-turf text-left font-semibold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-2 cursor-pointer"
              >
                {copiedSheet ? (
                  <Check className="w-3.5 h-3.5 text-[#059669]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>Copy Split Sheet</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  openPrintablePodClipboardWindow({
                    workoutTitle: workoutTitle.trim() || builtWorkout.setsSummary,
                    dateStr: workoutDate,
                    repDistanceMeters: builtWorkout.trackSpec.repDistanceMeters,
                    repCount: builtWorkout.trackSpec.repCount,
                    recoveryLabel: sets[0]?.restLabel || '60s jog',
                    pods: multiSetPreview.map((p) => p.basePod),
                    teamName: activeTeam?.brand.name || 'MeetReady Squad',
                  });
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-ap-turf text-left font-semibold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-2 cursor-pointer"
              >
                <ClipboardText className="w-3.5 h-3.5" />
                <span>Print 4-Up Pod Sheet</span>
              </button>
              <button
                type="button"
                data-testid="clipboard-share-btn"
                onClick={() => {
                  handleShareWorkout();
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-ap-turf text-left font-semibold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-2 cursor-pointer"
              >
                <ShareNetwork className="w-3.5 h-3.5" />
                <span>Share Link / PNG</span>
              </button>
              {(() => {
                const watchExportItems = [
                  { id: 'fit', label: 'Download .FIT', onClick: handleExportFit, show: true },
                  { id: 'zwo', label: 'Download .ZWO', onClick: handleExportZwo, show: true },
                  { id: 'erg', label: 'Download .ERG', onClick: handleExportErg, show: clipboardSport === 'Cycling' },
                ].filter((item) => item.show);
                const buttons = watchExportItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      item.onClick();
                      setShowExportMenu(false);
                    }}
                    className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-ap-turf text-left font-semibold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </button>
                ));
                if (complexityTier === 'ESSENTIALS') {
                  return (
                    <details
                      data-testid="clipboard-watch-exports-details"
                      className="pt-1 border-t border-ap-frame/15 dark:border-ap-edge-dark"
                    >
                      <summary className="px-2 py-1 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark cursor-pointer">
                        Watch Exports (.FIT/.ZWO)
                      </summary>
                      <div className="space-y-1 pt-1">{buttons}</div>
                    </details>
                  );
                }
                return buttons;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Audience & Event Group Chips */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Target event group">
          {audienceChips.map((chip) => {
            const active = audienceMode === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                data-testid={`clipboard-group-${chip.id}`}
                aria-pressed={active}
                onClick={() => setAudienceMode(chip.id)}
                className={`min-h-[44px] sm:!min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                  active
                    ? 'liquid-capsule-active text-ap-ink dark:text-white'
                    : 'liquid-capsule-track text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {audienceMode === 'INDIVIDUAL' && connectedAthletes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {connectedAthletes.map((ath) => {
              const selected = selectedAthleteIds.includes(ath.id);
              return (
                <button
                  key={ath.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setSelectedAthleteIds((prev) =>
                      prev.includes(ath.id) ? prev.filter((x) => x !== ath.id) : [...prev, ath.id]
                    )
                  }
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg text-2xs font-medium border cursor-pointer ${
                    selected
                      ? 'border-ap-cobalt bg-[#E3ECE5] text-ap-cobalt dark:border-ap-volt dark:bg-ap-turf dark:text-ap-volt'
                      : 'border-ap-frame/25 dark:border-ap-edge text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {ath.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Shorthand Parser Row */}
      <div className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/75 dark:bg-ap-carbon/75 p-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            data-testid="clipboard-shorthand-input"
            aria-label="Workout shorthand input"
            value={shorthandInput}
            onChange={(e) => setShorthandInput(e.target.value)}
            placeholder="e.g. 2mi WU, 5×800m @ CV (90s jog), 2mi CD"
            className="flex-1 min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 text-xs text-ap-ink dark:text-ap-chalk"
          />
          <button
            type="button"
            data-testid="clipboard-parse-shorthand-btn"
            onClick={() => applyShorthandText(shorthandInput)}
            className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold shrink-0 cursor-pointer"
          >
            Apply Shorthand
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-2xs">
          <span className="font-mono text-ap-muted dark:text-ap-muted-dark">Presets:</span>
          {[
            {
              label: '800/Mile Combo',
              text: '2mi warm-up, 2x200m at 800m pace, 4x800m at mile pace, 2x200m at 400m pace, 2mi cooldown',
            },
            {
              label: '3200m CV + 200s',
              text: '2mi warm-up, 5x1000m at CV pace (60s jog), 4x200m at 800m pace (200m jog), 2mi cooldown',
            },
            {
              label: '8×400m Repeats',
              text: '1.5mi warm-up, 8x400m at mile pace (90s jog), 1.5mi cooldown',
            },
            {
              label: '6×30m Flys',
              text: '6x30m flys (4m rest)',
            },
            {
              label: '4×60m Blocks',
              text: '4x60m blocks (4m rest)',
            },
          ].map((tpl) => (
            <button
              key={tpl.label}
              type="button"
              onClick={() => {
                setShorthandInput(tpl.text);
                applyShorthandText(tpl.text);
              }}
              className="min-h-[44px] sm:min-h-[32px] px-2.5 py-0.5 rounded-md liquid-capsule-track text-[#1F3528] dark:text-[#C8D8CE] hover:underline cursor-pointer"
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </div>

      {/* Title, Date, Time, Practice Location & Warm-up / Cooldown */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowMetaDetailsMobile((prev) => !prev)}
          className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl ap-card-inset px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-ap-ink dark:text-ap-chalk cursor-pointer"
        >
          <span className="truncate font-mono text-2xs">
            {workoutTitle} · {workoutDate}
            {formatPracticeTime12h(scheduledTime) ? ` · ${formatPracticeTime12h(scheduledTime)}` : ''}
            {locationName ? ` · ${locationName}` : ''}
          </span>
          <span className="inline-flex items-center gap-1 text-2xs text-ap-cobalt dark:text-ap-volt shrink-0">
            <span>{showMetaDetailsMobile ? 'Hide Details' : 'Schedule, Time & Venue'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showMetaDetailsMobile ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        {showMetaDetailsMobile && (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <label className="sm:col-span-5 flex flex-col gap-1 font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                <span>Session Name</span>
                <input
                  type="text"
                  value={workoutTitle}
                  onChange={(e) => setWorkoutTitle(e.target.value)}
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-sans font-semibold text-ap-ink dark:text-ap-chalk"
                />
              </label>

              <label className="sm:col-span-3 flex flex-col gap-1 font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                <span>Date</span>
                <input
                  type="date"
                  aria-label="Workout Date"
                  value={workoutDate}
                  onChange={(e) => setWorkoutDate(e.target.value)}
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                />
              </label>

              <div className="sm:col-span-2 flex flex-col gap-1 font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeWarmup}
                    onChange={(e) => setIncludeWarmup(e.target.checked)}
                    className="rounded border-ap-frame/40"
                  />
                  <span>Warm-up</span>
                </label>
                <select
                  aria-label="Warm-up distance"
                  disabled={!includeWarmup}
                  value={warmupDistanceMeters}
                  onChange={(e) => setWarmupDistanceMeters(Number(e.target.value))}
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-xs disabled:opacity-50"
                >
                  {WARMUP_COOLDOWN_PRESETS.map((p) => (
                    <option key={`wu-${p.meters}`} value={p.meters}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 flex flex-col gap-1 font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCooldown}
                    onChange={(e) => setIncludeCooldown(e.target.checked)}
                    className="rounded border-ap-frame/40"
                  />
                  <span>Cooldown</span>
                </label>
                <select
                  aria-label="Cooldown distance"
                  disabled={!includeCooldown}
                  value={cooldownDistanceMeters}
                  onChange={(e) => setCooldownDistanceMeters(Number(e.target.value))}
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 font-mono text-xs disabled:opacity-50"
                >
                  {WARMUP_COOLDOWN_PRESETS.map((p) => (
                    <option key={`cd-${p.meters}`} value={p.meters}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Practice Slot (Doubles), Call Time & Track / XC Venue */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
              <div className="sm:col-span-4 flex flex-col gap-1 font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                <span>Session Slot (Doubles)</span>
                <div
                  role="group"
                  aria-label="Daily session slot"
                  className="inline-flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs font-semibold"
                >
                  {(
                    [
                      { id: 'SINGLE', label: 'Single' },
                      { id: 'AM', label: 'AM Double' },
                      { id: 'PM', label: 'PM Double' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`clipboard-slot-${opt.id}`}
                      aria-pressed={sessionSlot === opt.id}
                      onClick={() => {
                        setSessionSlot(opt.id);
                        if (opt.id === 'AM' && (!scheduledTime || scheduledTime === '15:45')) {
                          setScheduledTime('06:30');
                        } else if (
                          opt.id === 'PM' &&
                          (!scheduledTime || scheduledTime === '06:30')
                        ) {
                          setScheduledTime('15:45');
                        }
                      }}
                      className={`flex-1 min-h-[44px] sm:min-h-[32px] px-2 py-1 rounded-md cursor-pointer ${
                        sessionSlot === opt.id
                          ? 'liquid-capsule-active text-ap-ink dark:text-white'
                          : 'text-ap-muted dark:text-ap-muted-dark'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="sm:col-span-3 flex flex-col gap-1 font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>Practice Time</span>
                </span>
                <input
                  type="time"
                  data-testid="clipboard-time-input"
                  aria-label="Practice Time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                />
              </label>

              <label className="sm:col-span-5 flex flex-col gap-1 font-mono text-2xs text-ap-muted dark:text-ap-muted-dark">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  <span>Practice Location (Track / XC Park / Gym)</span>
                </span>
                <input
                  type="text"
                  data-testid="clipboard-location-input"
                  aria-label="Practice Location"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="e.g. School Track, Foothills XC Park, Weight Room"
                  className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs font-sans text-ap-ink dark:text-ap-chalk"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-2xs">
              <span className="font-mono text-ap-muted dark:text-ap-muted-dark">Venues:</span>
              {[...DEFAULT_PRACTICE_VENUE_PRESETS, ...savedVenues].map((venue) => {
                const active = locationName.trim().toLowerCase() === venue.name.toLowerCase();
                return (
                  <button
                    key={`${venue.category}-${venue.name}`}
                    type="button"
                    onClick={() => {
                      setLocationName(venue.name);
                      setLocationCategory(venue.category);
                      if (!scheduledTime && venue.defaultTime) {
                        setScheduledTime(venue.defaultTime);
                      }
                    }}
                    className={`min-h-[44px] sm:min-h-[30px] px-2.5 py-0.5 rounded-md cursor-pointer ${
                      active
                        ? 'liquid-capsule-active text-ap-ink dark:text-white'
                        : 'liquid-capsule-track text-[#1F3528] dark:text-[#C8D8CE]'
                    }`}
                  >
                    {venue.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Structured Working Sets (Collapsible summary bar; auto-expands on shorthand parse or Add Set) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark font-semibold shrink-0">
              Working Sets ({sets.length})
            </span>
            <span className="text-xs font-mono font-semibold text-ap-ink dark:text-ap-chalk truncate">
              {builtWorkout.setsSummary}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              aria-expanded={showManualSetRows}
              onClick={() => setShowManualSetRows((prev) => !prev)}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg ap-card-inset text-xs font-semibold text-ap-ink dark:text-ap-chalk inline-flex items-center gap-1 cursor-pointer"
            >
              <span>{showManualSetRows ? 'Hide Sets' : 'Edit Sets'}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${showManualSetRows ? 'rotate-180' : ''}`}
              />
            </button>
            <button
              type="button"
              data-testid="clipboard-add-set-btn"
              onClick={handleAddSet}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-[#E3ECE5] dark:bg-ap-turf text-ap-cobalt dark:text-ap-volt text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Set</span>
            </button>
          </div>
        </div>

        {showManualSetRows && (
        <div className="space-y-2">
          {sets.map((row, idx) => (
            <div
              key={row.id}
              data-testid={`clipboard-set-row-${idx}`}
              className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/80 dark:bg-ap-carbon p-2.5 grid grid-cols-2 sm:grid-cols-12 gap-2 items-center text-xs"
            >
              <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-slate-500">
                <span>Reps</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  aria-label={`Set ${idx + 1} Reps`}
                  value={row.repCount}
                  onChange={(e) => {
                    const v = Math.max(1, Number(e.target.value) || 1);
                    setSets((prev) => prev.map((s) => (s.id === row.id ? { ...s, repCount: v } : s)));
                  }}
                  className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                />
              </label>

              <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                <div className="flex items-center justify-between gap-1">
                  <span>
                    {clipboardSport === 'Multisport'
                      ? idx === 0
                        ? 'Bike Mins'
                        : 'Run Mins'
                      : clipboardSport === 'Cycling' ||
                          clipboardSport === 'Strength' ||
                          row.measureMode === 'TIME_MINS'
                        ? 'Minutes'
                        : 'Distance'}
                  </span>
                  {clipboardSport === 'Running' && (
                    <button
                      type="button"
                      onClick={() =>
                        setSets((prev) =>
                          prev.map((s) =>
                            s.id === row.id
                              ? {
                                  ...s,
                                  measureMode: s.measureMode === 'TIME_MINS' ? 'DISTANCE_M' : 'TIME_MINS',
                                  durationMins: s.durationMins || 6,
                                }
                              : s
                          )
                        )
                      }
                      className="text-2xs underline text-ap-cobalt dark:text-ap-volt cursor-pointer"
                    >
                      {row.measureMode === 'TIME_MINS' ? 'Use m' : 'Use min'}
                    </button>
                  )}
                </div>
                {clipboardSport === 'Cycling' ||
                clipboardSport === 'Strength' ||
                clipboardSport === 'Multisport' ||
                row.measureMode === 'TIME_MINS' ? (
                  <input
                    type="number"
                    min={1}
                    max={180}
                    aria-label={`Set ${idx + 1} Minutes`}
                    value={row.durationMins || 6}
                    onChange={(e) => {
                      const v = Math.max(1, Number(e.target.value) || 1);
                      setSets((prev) =>
                        prev.map((s) => (s.id === row.id ? { ...s, durationMins: v } : s))
                      );
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                  />
                ) : (
                  <select
                    aria-label={`Set ${idx + 1} Distance`}
                    value={row.repDistanceMeters}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSets((prev) =>
                        prev.map((s) => (s.id === row.id ? { ...s, repDistanceMeters: v } : s))
                      );
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                  >
                    {(clipboardSport === 'Swimming' ? SWIM_REP_DISTS : VALID_REP_DISTS).map((dist) => (
                      <option key={`set-${idx}-d-${dist}`} value={dist}>
                        {dist}m
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label className="col-span-2 sm:col-span-3 flex flex-col gap-0.5 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                <span>
                  {clipboardSport === 'Cycling'
                    ? 'Target % FTP'
                    : clipboardSport === 'Swimming'
                      ? 'Swim Effort'
                      : clipboardSport === 'Multisport'
                        ? 'Brick Leg'
                        : 'Target Pace'}
                </span>
                {clipboardSport === 'Swimming' ? (
                  <div className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white/70 dark:bg-ap-turf px-2 flex items-center font-mono text-xs text-teal-700 dark:text-teal-400">
                    Z3 CSS Threshold
                  </div>
                ) : clipboardSport === 'Multisport' ? (
                  <div className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white/70 dark:bg-ap-turf px-2 flex items-center font-mono text-xs text-ap-ink dark:text-ap-chalk">
                    {idx === 0 ? 'Aero Bike (88% FTP)' : 'T2 Run Off-Bike (90%)'}
                  </div>
                ) : clipboardSport === 'Cycling' ? (
                  <select
                    aria-label={`Set ${idx + 1} Cycling Intensity`}
                    value={row.targetPctFtp || 90}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSets((prev) => prev.map((s) => (s.id === row.id ? { ...s, targetPctFtp: v } : s)));
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                  >
                    <option value={70}>Z2 Endurance (70% FTP)</option>
                    <option value={88}>Z3 Sweet Spot (88% FTP)</option>
                    <option value={98}>Z4 Threshold (98% FTP)</option>
                    <option value={112}>Z5 VO2max (112% FTP)</option>
                    <option value={125}>Z6 Anaerobic (125% FTP)</option>
                  </select>
                ) : (
                  <select
                    aria-label={`Set ${idx + 1} Pace`}
                    value={row.intensity}
                    onChange={(e) => {
                      const v = e.target.value as VdotPodIntensity;
                      setSets((prev) => prev.map((s) => (s.id === row.id ? { ...s, intensity: v } : s)));
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                  >
                    <option value="RACE_400M">400m Pace</option>
                    <option value="RACE_800M">800m Pace</option>
                    <option value="RACE_1600M">Mile / 1600m Pace</option>
                    <option value="RACE_3200M">3200m / 2-Mile Pace</option>
                    <option value="INTERVAL_VO2">5K Pace (VO2)</option>
                    <option value="THRESHOLD_CV">Threshold / CV</option>
                    <option value="SUB_THRESHOLD">Sub-Threshold</option>
                    <option value="EASY">Easy / Stride</option>
                  </select>
                )}
              </label>

              <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                <span>Rep Rest</span>
                <select
                  aria-label={`Set ${idx + 1} Rep Rest`}
                  value={row.restLabel}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSets((prev) => prev.map((s) => (s.id === row.id ? { ...s, restLabel: v } : s)));
                  }}
                  className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                >
                  <option value="60s jog">60s jog</option>
                  <option value="90s jog">90s jog</option>
                  <option value="2m jog">2:00 jog</option>
                  <option value="150s jog">2:30 jog</option>
                  <option value="3m walk">3:00 walk</option>
                </select>
              </label>

              {idx < sets.length - 1 && (
                <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
                  <span>Set Rest After</span>
                  <select
                    aria-label={`Set ${idx + 1} Rest After`}
                    value={row.setRestAfterSecs}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSets((prev) =>
                        prev.map((s) => (s.id === row.id ? { ...s, setRestAfterSecs: v } : s))
                      );
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-turf px-2 font-mono text-xs text-ap-ink dark:text-ap-chalk"
                  >
                    <option value={0}>None</option>
                    <option value={120}>2:00 rest</option>
                    <option value={180}>3:00 rest</option>
                    <option value={240}>4:00 rest</option>
                  </select>
                </label>
              )}

              <div className="sm:col-span-1 flex items-end justify-end h-full">
                {sets.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove Set ${idx + 1}`}
                    onClick={() => setSets((prev) => prev.filter((s) => s.id !== row.id))}
                    className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] inline-flex items-center justify-center rounded-lg text-ap-muted hover:text-[#DC2626] cursor-pointer"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Optional Athlete Tweak Disclosure */}
      {activeTeam && activeTeam.memberships.some((m) => m.role === 'ATHLETE') && (
        <details className="rounded-xl border border-stone-200 dark:border-ap-edge px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200 select-none">
            Individual Tweaks ({Object.keys(athleteOverrides).length} customized)
          </summary>
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-12 gap-2">
            <select
              aria-label="Select athlete to customize"
              value={overrideAthleteId}
              onChange={(e) => setOverrideAthleteId(e.target.value)}
              className="sm:col-span-4 min-h-[38px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2 text-xs"
            >
              <option value="">Choose athlete…</option>
              {activeTeam.memberships
                .filter((m) => m.role === 'ATHLETE')
                .map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.invitedName}
                  </option>
                ))}
            </select>
            <input
              type="text"
              aria-label="Custom shorthand for selected athlete"
              value={overrideSyntax}
              onChange={(e) => setOverrideSyntax(e.target.value)}
              placeholder="e.g. 1mi warm-up, 3x800m at mile pace, 1mi cooldown"
              className="sm:col-span-6 min-h-[38px] rounded-lg border border-stone-300 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2.5 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (!overrideAthleteId || !overrideSyntax.trim()) return;
                setAthleteOverrides((prev) => ({
                  ...prev,
                  [overrideAthleteId]: { workoutSyntax: overrideSyntax.trim() },
                }));
                setOverrideSyntax('');
              }}
              className="sm:col-span-2 min-h-[38px] rounded-lg bg-[#E3ECE5] dark:bg-ap-turf text-ap-cobalt dark:text-ap-volt font-semibold cursor-pointer"
            >
              Save Tweak
            </button>
          </div>
        </details>
      )}

      {/* Wave Start Selector + Live Multi-Set Pace Pod Split Preview (Track & XC Running) */}
      {clipboardSport === 'Running' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted dark:text-ap-muted-dark font-semibold">
              Pod Splits &amp; Stopwatch Wave
            </span>
            <div
              role="group"
              aria-label="Stopwatch Wave Mode"
              className="inline-flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs font-semibold"
            >
              {(
                [
                  { id: 'MASS', label: 'Mass Gun' },
                  { id: 'POD_10S', label: 'Pod +10s' },
                  { id: 'PURSUIT', label: 'Pursuit' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={stopwatchWaveMode === opt.id}
                  onClick={() => setStopwatchWaveMode(opt.id)}
                  className={`min-h-[44px] sm:min-h-[30px] px-2 rounded-md cursor-pointer ${
                    stopwatchWaveMode === opt.id
                      ? 'ap-nav-volt-active'
                      : 'text-ap-muted dark:text-ap-muted-dark'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div
            data-testid="clipboard-pod-preview"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2"
          >
            {multiSetPreview.map((pod) => (
              <div
                key={pod.podId}
                className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/80 dark:bg-ap-carbon p-3 space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-white truncate">
                    {pod.podName} · {pod.athletes.length} runners
                  </span>
                </div>
                <div className="text-2xs text-slate-600 dark:text-slate-300 truncate">
                  {pod.athletes.map((a) => a.name).join(', ')}
                </div>
                <div className="pt-1 border-t border-stone-200/70 dark:border-ap-edge space-y-0.5 font-mono text-2xs">
                  {pod.setSplits.map((sp) => (
                    <div key={`${pod.podId}-s-${sp.setIndex}`} className="flex justify-between gap-2">
                      <span className="text-slate-600 dark:text-slate-300 truncate">{sp.summaryLabel}</span>
                      <span className="font-bold text-ap-cobalt dark:text-ap-volt shrink-0">
                        {sp.formattedSplit}/rep
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Primary Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="clipboard-assign-workout-btn"
            disabled={isAssigning}
            onClick={() => void handleAssignWorkout()}
            className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" weight="bold" />
            <span>{isAssigning ? 'Assigning…' : 'Assign Workout'}</span>
          </button>

          {clipboardSport === 'Running' && (
            <button
              type="button"
              data-testid="clipboard-launch-stopwatch-btn"
              onClick={handleLaunchStopwatch}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Timer className="w-3.5 h-3.5 ap-text-brand" />
              <span>Launch in Stopwatch</span>
            </button>
          )}

          <button
            type="button"
            data-testid="clipboard-save-library-btn"
            disabled={isSavingLibrary}
            onClick={() => void handleSaveToLibrary()}
            className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 ap-text-brand" />
            <span>{isSavingLibrary ? 'Saving…' : 'Save to Library'}</span>
          </button>
        </div>

        {assignFeedback && (
          <span className="text-2xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
            {assignFeedback}
          </span>
        )}
      </div>

      {/* Reusable Team Workout Library */}
      <div
        data-testid="coach-workout-library"
        className="pt-2 border-t border-stone-200/80 dark:border-ap-edge space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardText className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
            <h3 className="text-xs sm:text-sm font-bold text-ap-ink dark:text-ap-chalk">
              Team Workout Library ({libraryTemplates.length})
            </h3>
          </div>
          <button
            type="button"
            data-testid="toggle-workout-library-btn"
            aria-expanded={showWorkoutLibrary}
            onClick={() => setShowWorkoutLibrary((v) => !v)}
            className="ap-touch min-h-[44px] sm:min-h-[32px] px-2.5 py-1 rounded-lg bg-stone-100 dark:bg-ap-carbon text-2xs font-mono font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
          >
            <span>{showWorkoutLibrary ? 'Hide Library' : 'Show Library'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showWorkoutLibrary ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {showWorkoutLibrary && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter workout library">
              {LIBRARY_CATEGORY_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={libraryFilter === chip.id}
                  onClick={() => setLibraryFilter(chip.id)}
                  className={`ap-touch min-h-[44px] sm:min-h-[30px] px-2.5 py-1 rounded-full text-2xs font-mono font-semibold cursor-pointer ${
                    libraryFilter === chip.id
                      ? 'ap-nav-volt-active'
                      : 'bg-white/80 dark:bg-ap-carbon border border-stone-200 dark:border-ap-edge text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredLibraryTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-xl border border-stone-200 dark:border-ap-edge bg-white/85 dark:bg-ap-carbon p-3 flex flex-col justify-between gap-2 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-slate-900 dark:text-white leading-snug">
                        {tpl.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-ap-turf text-2xs font-mono uppercase text-slate-600 dark:text-slate-300 shrink-0">
                        {tpl.category.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-2xs text-slate-600 dark:text-slate-400 line-clamp-2">
                      {tpl.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-stone-200/70 dark:border-ap-edge">
                    <span className="text-2xs font-mono text-slate-500">
                      {Math.round(tpl.plannedDurationSecs / 60)}m · ~{Math.round(tpl.plannedLoad)} TSS
                    </span>
                    <div className="flex items-center gap-1.5">
                      {!tpl.isBuiltin && (
                        <button
                          type="button"
                          data-testid="library-delete-template-btn"
                          aria-label={`Delete ${tpl.name}`}
                          disabled={deletingLibraryId === tpl.id}
                          onClick={() => void handleDeleteLibraryTemplate(tpl.id)}
                          className="ap-touch min-h-[44px] sm:min-h-[30px] px-2 rounded-lg text-slate-500 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="library-load-template-btn"
                        onClick={() => handleLoadLibraryTemplate(tpl)}
                        className="ap-touch min-h-[44px] sm:min-h-[30px] px-2.5 py-1 rounded-lg bg-[#E3ECE5] dark:bg-ap-turf text-ap-cobalt dark:text-ap-volt text-2xs font-semibold cursor-pointer"
                      >
                        Load
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
