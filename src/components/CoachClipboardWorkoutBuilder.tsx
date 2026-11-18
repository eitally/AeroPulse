import React, { useMemo, useState } from 'react';
import type {
  AthleteProfile,
  CoachEventGroup,
  ConnectedAthleteRecord,
  SportCategory,
  TeamBroadcastWorkout,
  TeamSummaryWithRole,
  TrackRepDistanceMeters,
  TrackSetSpec,
  TrackTrainingZoneCode,
  TrackWorkoutSpec,
  VdotPodIntensity,
} from '../types';
import {
  computeMultiSetPodSplits,
  formatMultiSetPrintableSplitSheet,
  type MultiSetPodSetInput,
  type VdotPodRosterInput,
} from '../physiology/scholasticEngine';
import { parseStructuredTrackWorkout } from '../utils/workoutParser';
import {
  exportWorkoutAsErg,
  exportWorkoutAsFit,
  exportWorkoutAsZwo,
} from '../utils/workoutExportActions';
import { openShareWorkoutRoute } from '../utils/shareWorkoutEngine';
import { stageWorkoutInTracksideStopwatch } from '../hooks/useTracksideStopwatch';
import { openPrintablePodClipboardWindow } from '../utils/teamQrHelper';
import {
  Bike,
  Check,
  ChevronDown,
  ClipboardText,
  Copy,
  Download,
  Footprints,
  Plus,
  Send,
  ShareNetwork,
  Timer,
  Trash,
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
    trackSpec?: TrackWorkoutSpec;
    replaceExistingDate?: boolean;
  }) => Promise<void>;
  onOpenStopwatchSubTab: () => void;
}

type AudienceMode = 'ALL' | CoachEventGroup | 'INDIVIDUAL';

interface BuilderSetRow {
  id: string;
  repCount: number;
  repDistanceMeters: TrackRepDistanceMeters;
  measureMode?: 'DISTANCE_M' | 'TIME_MINS';
  durationMins?: number;
  targetPctFtp?: number;
  intensity: VdotPodIntensity;
  restLabel: string;
  setRestAfterSecs: number;
}

const VALID_REP_DISTS: TrackRepDistanceMeters[] = [
  150, 200, 300, 400, 500, 600, 800, 1000, 1200, 1600,
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
}) => {
  const [clipboardSport, setClipboardSport] = useState<'Running' | 'Cycling'>('Running');
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('ALL');
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [workoutDate, setWorkoutDate] = useState(() => new Date().toISOString().slice(0, 10));
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
  const [showMetaDetailsMobile, setShowMetaDetailsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true
  );
  const [showManualSetRows, setShowManualSetRows] = useState<boolean>(false);
  const [stopwatchWaveMode, setStopwatchWaveMode] = useState<'MASS' | 'POD_10S' | 'PURSUIT'>('POD_10S');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null);

  const audienceChips: Array<{ id: AudienceMode; label: string }> = [
    { id: 'ALL', label: 'Whole Team' },
    { id: 'SPRINTS', label: 'Sprints' },
    { id: 'MID_DISTANCE', label: '800m / Mile' },
    { id: 'DISTANCE', label: '3000m / 3200m+' },
    { id: 'INDIVIDUAL', label: 'Individuals' },
  ];

  const scopedAthletes = useMemo(() => {
    if (connectedAthletes.length === 0) return [];
    if (audienceMode === 'INDIVIDUAL') {
      return selectedAthleteIds.length > 0
        ? connectedAthletes.filter((a) => selectedAthleteIds.includes(a.id))
        : connectedAthletes;
    }
    if (audienceMode === 'SPRINTS' || audienceMode === 'MID_DISTANCE' || audienceMode === 'DISTANCE') {
      const matched = connectedAthletes.filter((a) => a.eventGroup === audienceMode);
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
      repDistanceMeters: s.repDistanceMeters,
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
    const isCycling = clipboardSport === 'Cycling';
    const lines: string[] = [];
    if (includeWarmup) {
      lines.push(
        isCycling
          ? `Warmup\n- 15m 58% FTP Warmup`
          : `Warmup\n- ${wuPreset.syntax} Z1 Warmup`
      );
    }
    sets.forEach((s, idx) => {
      const isTime = isCycling || s.measureMode === 'TIME_MINS';
      if (isTime) {
        const mins = Math.max(1, s.durationMins || 6);
        const pct = s.targetPctFtp || (isCycling ? 90 : 98);
        const targetUnit = isCycling ? 'FTP' : 'Pace';
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
      : includeWarmup
        ? Math.round((wuPreset.meters / 1000) * 305)
        : 0;
    const cdSecs = isCycling
      ? includeCooldown
        ? 600
        : 0
      : includeCooldown
        ? Math.round((cdPreset.meters / 1000) * 310)
        : 0;
    const workRestSecs = sets.reduce((acc, s) => {
      const restS = parseRestLabelSecs(s.restLabel);
      const isTime = isCycling || s.measureMode === 'TIME_MINS';
      const repSecs = isTime
        ? Math.max(1, s.durationMins || 6) * 60
        : Math.round((s.repDistanceMeters / 1000) * 215);
      return acc + s.repCount * (repSecs + restS) + (s.setRestAfterSecs || 0);
    }, 0);
    const plannedDurationSecs = Math.max(900, wuSecs + workRestSecs + cdSecs);
    const hasOnlyDistance = !isCycling && sets.every((s) => s.measureMode !== 'TIME_MINS');
    const plannedLoad = hasOnlyDistance
      ? Math.max(
          20,
          Math.min(130, Math.round((totalWorkMeters / 1000) * 11 + (wuSecs + cdSecs) / 90))
        )
      : Math.max(25, Math.min(160, Math.round((plannedDurationSecs / 3600) * 78)));

    const trackSets: TrackSetSpec[] = sets.map((s, idx) => ({
      repCount: s.repCount,
      repDistanceMeters: s.repDistanceMeters,
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
      repDistanceMeters: firstSet?.repDistanceMeters || 800,
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
        isCycling || s.measureMode === 'TIME_MINS'
          ? `${s.repCount}×${s.durationMins || 6}m @ ${s.targetPctFtp || (isCycling ? 90 : 98)}% ${isCycling ? 'FTP' : 'Pace'}`
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
        (s) => s.stepKind !== 'rest' && (s.distanceMeters ?? 0) >= 100
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
    const description = [wuLabel, builtWorkout.setsSummary, cdLabel].filter(Boolean).join(' · ');

    try {
      const audienceLabel =
        audienceChips.find((c) => c.id === audienceMode)?.label || 'Whole Team';
      if (activeTeam) {
        const targetEventGroups: CoachEventGroup[] | undefined =
          audienceMode === 'SPRINTS' || audienceMode === 'MID_DISTANCE' || audienceMode === 'DISTANCE'
            ? [audienceMode]
            : undefined;
        const targetMembershipIds =
          audienceMode === 'INDIVIDUAL' && selectedAthleteIds.length > 0
            ? selectedAthleteIds.map((id) => id.replace(/^team-mem-/, ''))
            : undefined;

        const token =
          typeof localStorage !== 'undefined'
            ? localStorage.getItem('aeropulse_session_token') || ''
            : '';
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'x-thresh-session': token } : {}),
            },
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
              trackSpec: clipboardSport === 'Running' ? builtWorkout.trackSpec : undefined,
              athleteOverrides:
                Object.keys(athleteOverrides).length > 0 ? athleteOverrides : undefined,
              replaceSameDateTarget: true,
            }),
          }
        );
        const data = await resp.json();
        if (resp.ok && data.team) {
          const updatedTeam = data.team as TeamSummaryWithRole;
          onTeamsUpdated(
            myTeams.map((t) =>
              t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
            ),
            updatedTeam.brand.teamId
          );
        }
      }

      await onCreatePlannedEvent({
        date: workoutDate,
        name: title,
        sportCategory: clipboardSport,
        environmentPreference: clipboardSport === 'Cycling' ? 'FLEXIBLE' : 'OUTDOOR',
        plannedDurationSecs: builtWorkout.plannedDurationSecs,
        plannedLoad: builtWorkout.plannedLoad,
        workoutSyntax: builtWorkout.workoutSyntax,
        description: `${audienceLabel}: ${description}`,
        ...(clipboardSport === 'Running' ? { trackSpec: builtWorkout.trackSpec } : {}),
        replaceExistingDate: false,
      });

      setAssignFeedback(`Assigned "${title}" to ${audienceLabel} for ${workoutDate}.`);
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

  return (
    <section
      data-testid="coach-clipboard-builder"
      className="rounded-2xl liquid-glass p-3 sm:p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm sm:text-base font-bold text-[#101411] dark:text-[#F4F7F4]">
            Clipboard Builder &amp; Pods
          </h2>
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg liquid-capsule-track text-2xs font-semibold">
            <button
              type="button"
              aria-pressed={clipboardSport === 'Running'}
              onClick={() => setClipboardSport('Running')}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 cursor-pointer ${
                clipboardSport === 'Running'
                  ? 'ap-nav-volt-active'
                  : 'text-[#43584B] dark:text-[#93A39A]'
              }`}
            >
              <Footprints className="w-3 h-3" />
              <span>Track / Run</span>
            </button>
            <button
              type="button"
              aria-pressed={clipboardSport === 'Cycling'}
              onClick={() => setClipboardSport('Cycling')}
              className={`min-h-[44px] sm:min-h-[34px] px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 cursor-pointer ${
                clipboardSport === 'Cycling'
                  ? 'ap-nav-volt-active'
                  : 'text-[#43584B] dark:text-[#93A39A]'
              }`}
            >
              <Bike className="w-3 h-3" />
              <span>Cycling</span>
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
            <div className="absolute right-0 mt-1.5 w-48 rounded-xl bg-white dark:bg-[#101B15] border border-[#2B5B3F]/25 dark:border-[#2B543B] shadow-xl p-1.5 z-30 space-y-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  handleCopySheet();
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-[#15231B] text-left font-semibold text-[#101411] dark:text-[#F4F7F4] inline-flex items-center gap-2 cursor-pointer"
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
                    teamName: activeTeam?.brand.name || 'THRESH Squad',
                  });
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-[#15231B] text-left font-semibold text-[#101411] dark:text-[#F4F7F4] inline-flex items-center gap-2 cursor-pointer"
              >
                <ClipboardText className="w-3.5 h-3.5" />
                <span>Print 4-Up Pod Sheet</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleExportFit();
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-[#15231B] text-left font-semibold text-[#101411] dark:text-[#F4F7F4] inline-flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .FIT</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleExportZwo();
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-[#15231B] text-left font-semibold text-[#101411] dark:text-[#F4F7F4] inline-flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .ZWO</span>
              </button>
              {clipboardSport === 'Cycling' && (
                <button
                  type="button"
                  onClick={() => {
                    handleExportErg();
                    setShowExportMenu(false);
                  }}
                  className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-[#15231B] text-left font-semibold text-[#101411] dark:text-[#F4F7F4] inline-flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .ERG</span>
                </button>
              )}
              <button
                type="button"
                data-testid="clipboard-share-btn"
                onClick={() => {
                  handleShareWorkout();
                  setShowExportMenu(false);
                }}
                className="w-full min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg hover:bg-[#E9EFE9] dark:hover:bg-[#15231B] text-left font-semibold text-[#101411] dark:text-[#F4F7F4] inline-flex items-center gap-2 cursor-pointer"
              >
                <ShareNetwork className="w-3.5 h-3.5" />
                <span>Share Link / PNG</span>
              </button>
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
                    ? 'ap-nav-volt-active'
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
                      ? 'border-[#1C5436] bg-[#E3ECE5] text-[#1C5436] dark:border-[#C8FF00] dark:bg-[#15231B] dark:text-[#C8FF00]'
                      : 'border-stone-300 dark:border-[#244331] text-slate-700 dark:text-slate-300'
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
      <div className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/75 dark:bg-[#101B15]/75 p-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            data-testid="clipboard-shorthand-input"
            aria-label="Workout shorthand input"
            value={shorthandInput}
            onChange={(e) => setShorthandInput(e.target.value)}
            placeholder="e.g. 2mi WU, 5×800m @ CV (90s jog), 2mi CD"
            className="flex-1 min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-3 text-xs text-[#101411] dark:text-[#F4F7F4]"
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
          <span className="font-mono text-[#43584B] dark:text-[#93A39A]">Presets:</span>
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

      {/* Title, Date, Warm-up & Cooldown (1-line summary on <640px mobile) */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowMetaDetailsMobile((prev) => !prev)}
          className="sm:hidden w-full min-h-[44px] rounded-xl ap-card-inset px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-[#101411] dark:text-[#F4F7F4] cursor-pointer"
        >
          <span className="truncate font-mono text-2xs">
            {workoutDate} · WU {includeWarmup ? wuPreset.label : 'Off'} · CD{' '}
            {includeCooldown ? cdPreset.label : 'Off'}
          </span>
          <span className="inline-flex items-center gap-1 text-2xs text-[#1C5436] dark:text-[#C8FF00] shrink-0">
            <span>Details</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showMetaDetailsMobile ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        {showMetaDetailsMobile && (
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs">
            <label className="sm:col-span-5 flex flex-col gap-1 font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
              <span>Session Name</span>
              <input
                type="text"
                value={workoutTitle}
                onChange={(e) => setWorkoutTitle(e.target.value)}
                className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 text-xs font-sans font-semibold text-[#101411] dark:text-[#F4F7F4]"
              />
            </label>

            <label className="sm:col-span-3 flex flex-col gap-1 font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
              <span>Date</span>
              <input
                type="date"
                aria-label="Workout Date"
                value={workoutDate}
                onChange={(e) => setWorkoutDate(e.target.value)}
                className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
              />
            </label>

            <div className="sm:col-span-2 flex flex-col gap-1 font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeWarmup}
                  onChange={(e) => setIncludeWarmup(e.target.checked)}
                  className="rounded border-[#2B5B3F]/40"
                />
                <span>Warm-up</span>
              </label>
              <select
                aria-label="Warm-up distance"
                disabled={!includeWarmup}
                value={warmupDistanceMeters}
                onChange={(e) => setWarmupDistanceMeters(Number(e.target.value))}
                className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2 font-mono text-xs disabled:opacity-50"
              >
                {WARMUP_COOLDOWN_PRESETS.map((p) => (
                  <option key={`wu-${p.meters}`} value={p.meters}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2 flex flex-col gap-1 font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeCooldown}
                  onChange={(e) => setIncludeCooldown(e.target.checked)}
                  className="rounded border-[#2B5B3F]/40"
                />
                <span>Cooldown</span>
              </label>
              <select
                aria-label="Cooldown distance"
                disabled={!includeCooldown}
                value={cooldownDistanceMeters}
                onChange={(e) => setCooldownDistanceMeters(Number(e.target.value))}
                className="min-h-[44px] sm:min-h-[38px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2 font-mono text-xs disabled:opacity-50"
              >
                {WARMUP_COOLDOWN_PRESETS.map((p) => (
                  <option key={`cd-${p.meters}`} value={p.meters}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Structured Working Sets (Collapsible summary bar; auto-expands on shorthand parse or Add Set) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xs font-mono uppercase tracking-wider text-[#43584B] dark:text-[#93A39A] font-semibold shrink-0">
              Working Sets ({sets.length})
            </span>
            <span className="text-xs font-mono font-semibold text-[#101411] dark:text-[#F4F7F4] truncate">
              {builtWorkout.setsSummary}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              aria-expanded={showManualSetRows}
              onClick={() => setShowManualSetRows((prev) => !prev)}
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg ap-card-inset text-xs font-semibold text-[#101411] dark:text-[#F4F7F4] inline-flex items-center gap-1 cursor-pointer"
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
              className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1 rounded-lg bg-[#E3ECE5] dark:bg-[#15231B] text-[#1C5436] dark:text-[#C8FF00] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
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
              className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#101B15] p-2.5 grid grid-cols-2 sm:grid-cols-12 gap-2 items-center text-xs"
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
                  className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
                />
              </label>

              <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-[#43584B] dark:text-[#93A39A]">
                <div className="flex items-center justify-between gap-1">
                  <span>{clipboardSport === 'Cycling' || row.measureMode === 'TIME_MINS' ? 'Minutes' : 'Distance'}</span>
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
                      className="text-2xs underline text-[#1C5436] dark:text-[#C8FF00] cursor-pointer"
                    >
                      {row.measureMode === 'TIME_MINS' ? 'Use m' : 'Use min'}
                    </button>
                  )}
                </div>
                {clipboardSport === 'Cycling' || row.measureMode === 'TIME_MINS' ? (
                  <input
                    type="number"
                    min={1}
                    max={90}
                    aria-label={`Set ${idx + 1} Minutes`}
                    value={row.durationMins || 6}
                    onChange={(e) => {
                      const v = Math.max(1, Number(e.target.value) || 1);
                      setSets((prev) =>
                        prev.map((s) => (s.id === row.id ? { ...s, durationMins: v } : s))
                      );
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
                  />
                ) : (
                  <select
                    aria-label={`Set ${idx + 1} Distance`}
                    value={row.repDistanceMeters}
                    onChange={(e) => {
                      const v = Number(e.target.value) as TrackRepDistanceMeters;
                      setSets((prev) =>
                        prev.map((s) => (s.id === row.id ? { ...s, repDistanceMeters: v } : s))
                      );
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
                  >
                    {VALID_REP_DISTS.map((dist) => (
                      <option key={`set-${idx}-d-${dist}`} value={dist}>
                        {dist}m
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label className="col-span-2 sm:col-span-3 flex flex-col gap-0.5 text-2xs font-mono text-[#43584B] dark:text-[#93A39A]">
                <span>{clipboardSport === 'Cycling' ? 'Target % FTP' : 'Target Pace'}</span>
                {clipboardSport === 'Cycling' ? (
                  <select
                    aria-label={`Set ${idx + 1} Cycling Intensity`}
                    value={row.targetPctFtp || 90}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSets((prev) => prev.map((s) => (s.id === row.id ? { ...s, targetPctFtp: v } : s)));
                    }}
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
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
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
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

              <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-[#43584B] dark:text-[#93A39A]">
                <span>Rep Rest</span>
                <select
                  aria-label={`Set ${idx + 1} Rep Rest`}
                  value={row.restLabel}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSets((prev) => prev.map((s) => (s.id === row.id ? { ...s, restLabel: v } : s)));
                  }}
                  className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
                >
                  <option value="60s jog">60s jog</option>
                  <option value="90s jog">90s jog</option>
                  <option value="2m jog">2:00 jog</option>
                  <option value="150s jog">2:30 jog</option>
                  <option value="3m walk">3:00 walk</option>
                </select>
              </label>

              {idx < sets.length - 1 && (
                <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-[#43584B] dark:text-[#93A39A]">
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
                    className="min-h-[44px] sm:min-h-[36px] rounded-lg border border-[#2B5B3F]/25 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
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
                    className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] inline-flex items-center justify-center rounded-lg text-[#43584B] hover:text-[#DC2626] cursor-pointer"
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
        <details className="rounded-xl border border-stone-200 dark:border-[#244331] px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200 select-none">
            Individual Tweaks ({Object.keys(athleteOverrides).length} customized)
          </summary>
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-12 gap-2">
            <select
              aria-label="Select athlete to customize"
              value={overrideAthleteId}
              onChange={(e) => setOverrideAthleteId(e.target.value)}
              className="sm:col-span-4 min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2 text-xs"
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
              className="sm:col-span-6 min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2.5 text-xs"
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
              className="sm:col-span-2 min-h-[38px] rounded-lg bg-[#E3ECE5] dark:bg-[#15231B] text-[#1C5436] dark:text-[#C8FF00] font-semibold cursor-pointer"
            >
              Save Tweak
            </button>
          </div>
        </details>
      )}

      {/* Wave Start Selector + Live Multi-Set Pace Pod Split Preview */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs font-mono uppercase tracking-wider text-[#43584B] dark:text-[#93A39A] font-semibold">
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
                    : 'text-[#43584B] dark:text-[#93A39A]'
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
            className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#101B15] p-3 space-y-1.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900 dark:text-white truncate">
                {pod.podName} · {pod.athletes.length} runners
              </span>
            </div>
            <div className="text-2xs text-slate-600 dark:text-slate-300 truncate">
              {pod.athletes.map((a) => a.name).join(', ')}
            </div>
            <div className="pt-1 border-t border-stone-200/70 dark:border-[#244331] space-y-0.5 font-mono text-2xs">
              {pod.setSplits.map((sp) => (
                <div key={`${pod.podId}-s-${sp.setIndex}`} className="flex justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-300 truncate">{sp.summaryLabel}</span>
                  <span className="font-bold text-[#1C5436] dark:text-[#C8FF00] shrink-0">
                    {sp.formattedSplit}/rep
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        </div>
      </div>

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

          <button
            type="button"
            data-testid="clipboard-launch-stopwatch-btn"
            onClick={handleLaunchStopwatch}
            className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-4 py-2 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Timer className="w-3.5 h-3.5 ap-text-brand" />
            <span>Launch in Stopwatch</span>
          </button>
        </div>

        {assignFeedback && (
          <span className="text-2xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
            {assignFeedback}
          </span>
        )}
      </div>
    </section>
  );
};
