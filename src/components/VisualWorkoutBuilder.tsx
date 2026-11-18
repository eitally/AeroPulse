import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  Bike,
  ChevronDown,
  Download,
  Dumbbell,
  Footprints,
  Plus,
  Send,
  ShareNetwork,
  Sparkles,
  Timer,
  Trash2,
  Waves,
} from './icons/PhosphorIcons';
import type {
  AthleteProfile,
  DistanceUnit,
  PlannedWorkoutEvent,
  SportCategory,
  TrackWorkoutSpec,
} from '../types';
import { formatPace } from '../utils/formatters';
import {
  computeAmplitudeHeightPct,
  formatHumanReadableStepLine,
  parseStructuredTrackWorkout,
  parseWorkoutSteps,
} from '../utils/workoutParser';
import {
  exportWorkoutAsErg,
  exportWorkoutAsFit,
  exportWorkoutAsZwo,
  pushWorkoutDirectToGarmin,
} from '../utils/workoutExportActions';
import { BracketedIntervalTape } from './charts/MicroGraphics';
import { openShareWorkoutRoute } from '../utils/shareWorkoutEngine';
import {
  inferTrackWorkoutSpecFromPlannedEvent,
  stageWorkoutInTracksideStopwatch,
} from '../hooks/useTracksideStopwatch';

export type StepDurationUnit = 'min' | 'sec' | 'm' | 'km' | 'mi';
export type RestDurationUnit = 'sec' | 'min' | 'm';

export interface VisualWarmupCooldownBlock {
  enabled: boolean;
  value: number;
  unit: 'min' | 'mi' | 'km';
  intensityPct: number;
}

export interface VisualWorkingSetRow {
  id: string;
  label: string;
  reps: number;
  value: number;
  unit: StepDurationUnit;
  intensityPct: number;
  restValue: number;
  restUnit: RestDurationUnit;
  setRestAfterSecs: number;
}

export interface VisualWorkoutSavePayload {
  id?: string;
  date: string;
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  trackSpec?: TrackWorkoutSpec;
}

export interface VisualWorkoutBuilderProps {
  dateIso: string;
  defaultSport?: SportCategory;
  athleteProfile?: AthleteProfile;
  athleteFtp?: number;
  distanceUnit: DistanceUnit;
  initialEvent?: PlannedWorkoutEvent | null;
  submitLabel?: string;
  compact?: boolean;
  onSave: (payload: VisualWorkoutSavePayload) => Promise<void> | void;
  onCancel?: () => void;
  onOpenTracksideStopwatch?: () => void;
}

const STEP_ZONE_PRESETS = [
  { id: 'Z1', label: 'Z1 Recovery', intensityPct: 55 },
  { id: 'Z2', label: 'Z2 Aerobic / Base', intensityPct: 70 },
  { id: 'Z3', label: 'Z3 Tempo / Sweet Spot', intensityPct: 88 },
  { id: 'SUB_T', label: 'Sub-T Threshold', intensityPct: 94 },
  { id: 'Z4', label: 'Z4 Threshold / CV', intensityPct: 100 },
  { id: 'Z5', label: 'Z5 VO2max (3K–5K)', intensityPct: 112 },
  { id: 'R', label: 'Mile / Rep Speed', intensityPct: 120 },
  { id: 'FR', label: '400m / 800m Fast Rep', intensityPct: 132 },
] as const;

function makeRowId(idx: number): string {
  return `vwb-row-${idx}-${Math.random().toString(36).slice(2, 6)}`;
}

function closestZoneLabel(pct: number, sport: SportCategory): string {
  if (pct <= 58) return sport === 'Cycling' ? 'Z1 Spin' : 'Easy';
  if (pct <= 76) return sport === 'Cycling' ? 'Z2 Endurance' : 'Aerobic';
  if (pct <= 91) return sport === 'Cycling' ? 'Sweet Spot' : 'Tempo';
  if (pct <= 104) return sport === 'Cycling' ? 'Threshold' : 'Threshold Pace';
  if (pct <= 116) return sport === 'Cycling' ? 'VO2max' : '5K / VO2 Pace';
  if (pct <= 125) return sport === 'Cycling' ? 'Anaerobic' : 'Mile Pace';
  return sport === 'Cycling' ? 'Sprint Peak' : '800m Pace';
}

function formatBlockAmountToken(value: number, unit: 'min' | 'mi' | 'km' | StepDurationUnit): string {
  const cleanVal = Number.isInteger(value) ? String(value) : Number(value.toFixed(1)).toString();
  if (unit === 'min') return `${cleanVal}m`;
  if (unit === 'sec') return `${cleanVal}s`;
  return `${cleanVal}${unit}`;
}

function formatStepPreviewTarget(
  pct: number,
  sport: SportCategory,
  ftpWatts: number,
  thresholdPaceSecsPerKm: number,
  distanceUnit: DistanceUnit,
  repDistMeters?: number
): string {
  if (sport === 'Cycling') {
    const watts = Math.max(40, Math.round((ftpWatts * pct) / 100));
    return `${watts}W (${pct}% FTP)`;
  }
  if (sport === 'Running') {
    const targetPaceSecsKm = Math.max(95, thresholdPaceSecsPerKm / Math.max(0.35, pct / 100));
    if (repDistMeters && repDistMeters >= 100 && repDistMeters <= 3200) {
      const repSecs = (targetPaceSecsKm * repDistMeters) / 1000;
      const mins = Math.floor(repSecs / 60);
      const rem = repSecs - mins * 60;
      const splitStr = mins > 0 ? `${mins}:${rem.toFixed(1).padStart(4, '0')}` : `${repSecs.toFixed(1)}s`;
      return `${splitStr}/rep (${formatPace(targetPaceSecsKm, distanceUnit)})`;
    }
    return formatPace(targetPaceSecsKm, distanceUnit);
  }
  return `${pct}% Effort`;
}

function defaultBlocksForSport(
  sport: SportCategory,
  trackMode: boolean
): {
  warmup: VisualWarmupCooldownBlock;
  sets: VisualWorkingSetRow[];
  cooldown: VisualWarmupCooldownBlock;
  notes: string;
} {
  if (sport === 'Cycling') {
    return {
      warmup: { enabled: true, value: 15, unit: 'min', intensityPct: 60 },
      sets: [
        {
          id: makeRowId(1),
          label: 'Sweet Spot',
          reps: 4,
          value: 8,
          unit: 'min',
          intensityPct: 90,
          restValue: 4,
          restUnit: 'min',
          setRestAfterSecs: 0,
        },
      ],
      cooldown: { enabled: true, value: 10, unit: 'min', intensityPct: 55 },
      notes: 'Keep cadence 90+ rpm and stay seated on steady threshold efforts.',
    };
  }
  if (trackMode) {
    return {
      warmup: { enabled: true, value: 2, unit: 'mi', intensityPct: 65 },
      sets: [
        {
          id: makeRowId(1),
          label: 'Mile Pace',
          reps: 6,
          value: 400,
          unit: 'm',
          intensityPct: 118,
          restValue: 90,
          restUnit: 'sec',
          setRestAfterSecs: 0,
        },
      ],
      cooldown: { enabled: true, value: 1.5, unit: 'mi', intensityPct: 62 },
      notes: 'Relaxed upper body; hit even 200m splits.',
    };
  }
  if (sport === 'Running') {
    return {
      warmup: { enabled: true, value: 15, unit: 'min', intensityPct: 66 },
      sets: [
        {
          id: makeRowId(1),
          label: 'Threshold',
          reps: 4,
          value: 6,
          unit: 'min',
          intensityPct: 98,
          restValue: 2,
          restUnit: 'min',
          setRestAfterSecs: 0,
        },
      ],
      cooldown: { enabled: true, value: 10, unit: 'min', intensityPct: 62 },
      notes: 'Controlled lactate cruise; float the recovery rather than stopping.',
    };
  }
  return {
    warmup: { enabled: true, value: 10, unit: 'min', intensityPct: 58 },
    sets: [
      {
        id: makeRowId(1),
        label: 'Main Block',
        reps: 4,
        value: 5,
        unit: 'min',
        intensityPct: 85,
        restValue: 60,
        restUnit: 'sec',
        setRestAfterSecs: 0,
      },
    ],
    cooldown: { enabled: true, value: 10, unit: 'min', intensityPct: 55 },
    notes: 'Smooth technical form throughout each work block.',
  };
}

function hydrateBlocksFromSyntax(
  syntax: string,
  sport: SportCategory,
  thresholdPaceSecsPerKm: number
): {
  warmup: VisualWarmupCooldownBlock;
  sets: VisualWorkingSetRow[];
  cooldown: VisualWarmupCooldownBlock;
  hasTrackDistances: boolean;
} | null {
  const ast = parseStructuredTrackWorkout(syntax, thresholdPaceSecsPerKm);
  if (ast.length === 0) return null;

  let warmup: VisualWarmupCooldownBlock = { enabled: false, value: 12, unit: 'min', intensityPct: 62 };
  let cooldown: VisualWarmupCooldownBlock = { enabled: false, value: 10, unit: 'min', intensityPct: 58 };
  const sets: VisualWorkingSetRow[] = [];
  let hasTrackDistances = false;

  for (const node of ast) {
    if (node.type === 'step') {
      const s = node.step;
      if (s.stepKind === 'warmup') {
        warmup = {
          enabled: true,
          value: s.distanceMeters ? Number((s.distanceMeters / 1609.34).toFixed(1)) : Math.max(5, Math.round(s.durationSecs / 60)),
          unit: s.distanceMeters ? 'mi' : 'min',
          intensityPct: s.intensityPct || 62,
        };
      } else if (s.stepKind === 'cooldown') {
        cooldown = {
          enabled: true,
          value: s.distanceMeters ? Number((s.distanceMeters / 1609.34).toFixed(1)) : Math.max(5, Math.round(s.durationSecs / 60)),
          unit: s.distanceMeters ? 'mi' : 'min',
          intensityPct: s.intensityPct || 58,
        };
      } else if (s.stepKind === 'rest' && sets.length > 0) {
        sets[sets.length - 1].setRestAfterSecs = Math.max(30, Math.round(s.durationSecs));
      } else {
        const useMeters = Boolean(s.distanceMeters && s.distanceMeters >= 100 && s.distanceMeters <= 3200);
        if (useMeters) hasTrackDistances = true;
        sets.push({
          id: makeRowId(sets.length + 1),
          label: s.label.slice(0, 24) || closestZoneLabel(s.intensityPct || 75, sport),
          reps: 1,
          value: useMeters
            ? Math.round(s.distanceMeters!)
            : s.distanceMeters && s.distanceMeters > 3200
              ? Number((s.distanceMeters / 1000).toFixed(1))
              : Math.max(1, Math.round(s.durationSecs / 60)),
          unit: useMeters ? 'm' : s.distanceMeters && s.distanceMeters > 3200 ? 'km' : 'min',
          intensityPct: s.intensityPct || 75,
          restValue: 60,
          restUnit: 'sec',
          setRestAfterSecs: 0,
        });
      }
      continue;
    }

    const work = node.steps.find((st) => st.stepKind !== 'rest') || node.steps[0];
    const rest = node.steps.find((st) => st.stepKind === 'rest');
    if (work) {
      const useMeters = Boolean(work.distanceMeters && work.distanceMeters >= 100 && work.distanceMeters <= 3200);
      if (useMeters) hasTrackDistances = true;
      const isSubMin = !useMeters && work.durationSecs > 0 && work.durationSecs < 60;
      const restIsDist = Boolean(rest?.distanceMeters && rest.distanceMeters >= 100);
      const restIsMin = !restIsDist && rest && rest.durationSecs >= 120 && rest.durationSecs % 60 === 0;
      sets.push({
        id: makeRowId(sets.length + 1),
        label: work.label.slice(0, 24) || closestZoneLabel(work.intensityPct || 95, sport),
        reps: Math.max(1, node.repeatCount),
        value: useMeters
          ? Math.round(work.distanceMeters!)
          : isSubMin
            ? Math.round(work.durationSecs)
            : Math.max(1, Math.round(work.durationSecs / 60)),
        unit: useMeters ? 'm' : isSubMin ? 'sec' : 'min',
        intensityPct: work.intensityPct || 95,
        restValue: rest
          ? restIsDist
            ? Math.round(rest.distanceMeters!)
            : restIsMin
              ? Math.round(rest.durationSecs / 60)
              : Math.round(rest.durationSecs)
          : 60,
        restUnit: rest ? (restIsDist ? 'm' : restIsMin ? 'min' : 'sec') : 'sec',
        setRestAfterSecs: 0,
      });
    }
  }

  return { warmup, sets, cooldown, hasTrackDistances };
}

function compileVisualBlocksToSyntax(
  sport: SportCategory,
  warmup: VisualWarmupCooldownBlock,
  sets: VisualWorkingSetRow[],
  cooldown: VisualWarmupCooldownBlock
): string {
  const unitTag = sport === 'Cycling' ? 'FTP' : sport === 'Running' ? 'Pace' : 'Effort';
  const lines: string[] = [];

  if (warmup.enabled) {
    lines.push(
      `- ${formatBlockAmountToken(warmup.value, warmup.unit)} ${warmup.intensityPct}% ${unitTag} Warmup`
    );
  }

  for (const row of sets) {
    const workToken = formatBlockAmountToken(row.value, row.unit);
    const labelText = row.label.trim() || closestZoneLabel(row.intensityPct, sport);
    if (row.reps > 1) {
      lines.push('');
      lines.push(`Main Set ${row.reps}x`);
      lines.push(`- ${workToken} ${row.intensityPct}% ${unitTag} ${labelText}`);
      const restToken =
        row.restUnit === 'm'
          ? `${row.restValue}m jog`
          : row.restUnit === 'min'
            ? `${row.restValue}m`
            : `${row.restValue}s`;
      lines.push(`- ${restToken} 55% ${unitTag} Recovery`);
      lines.push('');
    } else {
      lines.push(`- ${workToken} ${row.intensityPct}% ${unitTag} ${labelText}`);
    }
    if (row.setRestAfterSecs > 0) {
      const restStr =
        row.setRestAfterSecs >= 120 && row.setRestAfterSecs % 60 === 0
          ? `${row.setRestAfterSecs / 60}m`
          : `${row.setRestAfterSecs}s`;
      lines.push(`- ${restStr} 52% ${unitTag} Set Rest`);
    }
  }

  if (cooldown.enabled) {
    lines.push(
      `- ${formatBlockAmountToken(cooldown.value, cooldown.unit)} ${cooldown.intensityPct}% ${unitTag} Cooldown`
    );
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const VisualWorkoutBuilder: React.FC<VisualWorkoutBuilderProps> = ({
  dateIso,
  defaultSport = 'Cycling',
  athleteProfile,
  athleteFtp = 250,
  distanceUnit,
  initialEvent,
  submitLabel,
  compact = false,
  onSave,
  onCancel,
  onOpenTracksideStopwatch,
}) => {
  const formId = useId();
  const safeFtp = Math.max(80, Math.round(athleteProfile?.ftp || athleteFtp || 250));
  const safeThresholdPace = Math.max(95, athleteProfile?.thresholdPaceSecsPerKm || 250);
  const safeLthr = Math.max(110, athleteProfile?.runLthr || athleteProfile?.lthr || 170);

  const initialSport: SportCategory = initialEvent?.sportCategory || defaultSport;
  const initialIsTrack = Boolean(
    initialEvent?.trackSpec ||
      (initialEvent?.workoutSyntax && /\b\d{3,4}\s*m\b/i.test(initialEvent.workoutSyntax))
  );
  const starterBlocks = useMemo(
    () => defaultBlocksForSport(initialSport, initialIsTrack),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [builderDate, setBuilderDate] = useState(initialEvent?.date?.slice(0, 10) || dateIso);
  const [builderName, setBuilderName] = useState(
    initialEvent?.name ||
      (initialSport === 'Running' ? '4x6m Threshold Cruise' : '4x8m Sweet Spot Progression')
  );
  const [builderSport, setBuilderSport] = useState<SportCategory>(initialSport);
  const [isTrackOvalMode, setIsTrackOvalMode] = useState<boolean>(initialIsTrack);
  const [builderEnv, setBuilderEnv] = useState<'OUTDOOR' | 'INDOOR' | 'FLEXIBLE'>(
    initialEvent?.environmentPreference || 'FLEXIBLE'
  );
  const [warmup, setWarmup] = useState<VisualWarmupCooldownBlock>(starterBlocks.warmup);
  const [sets, setSets] = useState<VisualWorkingSetRow[]>(starterBlocks.sets);
  const [cooldown, setCooldown] = useState<VisualWarmupCooldownBlock>(starterBlocks.cooldown);
  const [notes, setNotes] = useState(initialEvent?.description || starterBlocks.notes);
  const [shorthandInput, setShorthandInput] = useState('');
  const [rawSyntaxOverride, setRawSyntaxOverride] = useState<string | null>(
    initialEvent?.workoutSyntax || null
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Re-hydrate cleanly when switching into editing another existing event or date
  useEffect(() => {
    setBuilderDate(initialEvent?.date?.slice(0, 10) || dateIso);
    if (!initialEvent) {
      setRawSyntaxOverride(null);
      return;
    }
    const sp = initialEvent.sportCategory;
    setBuilderSport(sp);
    setBuilderName(initialEvent.name);
    setBuilderEnv(initialEvent.environmentPreference || 'FLEXIBLE');
    setNotes(initialEvent.description || '');
    const hydrated = initialEvent.workoutSyntax
      ? hydrateBlocksFromSyntax(initialEvent.workoutSyntax, sp, safeThresholdPace)
      : null;
    if (hydrated && hydrated.sets.length > 0) {
      setWarmup(hydrated.warmup);
      setSets(hydrated.sets);
      setCooldown(hydrated.cooldown);
      setIsTrackOvalMode(Boolean(initialEvent.trackSpec || hydrated.hasTrackDistances));
      setRawSyntaxOverride(null);
    } else {
      setIsTrackOvalMode(Boolean(initialEvent.trackSpec));
      setRawSyntaxOverride(initialEvent.workoutSyntax || '');
    }
  }, [initialEvent, dateIso, safeThresholdPace]);

  const compiledSyntax = useMemo(
    () => compileVisualBlocksToSyntax(builderSport, warmup, sets, cooldown),
    [builderSport, warmup, sets, cooldown]
  );

  const effectiveSyntax = rawSyntaxOverride !== null ? rawSyntaxOverride : compiledSyntax;

  const parsedSteps = useMemo(
    () => parseWorkoutSteps(effectiveSyntax, safeThresholdPace),
    [effectiveSyntax, safeThresholdPace]
  );

  const summaryStats = useMemo(() => {
    if (parsedSteps.length === 0) {
      return { durationSecs: 2700, load: 55 };
    }
    const totalSecs = parsedSteps.reduce((acc, s) => acc + (s.durationSecs || s.durationMins * 60), 0);
    const totalMins = Math.max(1, totalSecs / 60);
    const weightedIf =
      parsedSteps.reduce((acc, s) => {
        const mins = (s.durationSecs || s.durationMins * 60) / 60;
        return acc + mins * Math.pow((s.intensityPct || 70) / 100, 2);
      }, 0) / totalMins;
    const tss = Math.max(10, Math.round((totalMins / 60) * weightedIf * 95));
    return {
      durationSecs: Math.round(totalSecs),
      load: tss,
    };
  }, [parsedSteps]);

  const detectedTrackSpec = useMemo(() => {
    if (builderSport !== 'Running') return null;
    return inferTrackWorkoutSpecFromPlannedEvent({
      name: builderName,
      workoutSyntax: effectiveSyntax,
    });
  }, [builderName, builderSport, effectiveSyntax]);

  const applySportDiscipline = (sport: SportCategory, trackOval: boolean) => {
    setBuilderSport(sport);
    setIsTrackOvalMode(trackOval);
    setRawSyntaxOverride(null);
    const defaults = defaultBlocksForSport(sport, trackOval);
    setWarmup(defaults.warmup);
    setSets(defaults.sets);
    setCooldown(defaults.cooldown);
    setNotes(defaults.notes);
    setBuilderName(
      sport === 'Cycling'
        ? '4x8m Sweet Spot Progression'
        : trackOval
          ? '6x400m Mile-Pace Track Session'
          : sport === 'Running'
            ? '4x6m Threshold Cruise'
            : sport === 'Swimming'
              ? '2000m Aerobic & Threshold Pull'
              : '45m Runner Strength & Plyos'
    );
  };

  const applyShorthandParse = () => {
    const clean = shorthandInput.trim();
    if (!clean) return;
    if (/\b(?:ftp|watts|w)\b/i.test(clean) && builderSport !== 'Cycling') {
      setBuilderSport('Cycling');
      setIsTrackOvalMode(false);
    }
    const targetSport: SportCategory = /\b(?:ftp|watts|w)\b/i.test(clean) ? 'Cycling' : builderSport;
    const hydrated = hydrateBlocksFromSyntax(clean, targetSport, safeThresholdPace);
    if (!hydrated || (hydrated.sets.length === 0 && !hydrated.warmup.enabled && !hydrated.cooldown.enabled)) {
      setRawSyntaxOverride(clean);
      setStatusMessage('Loaded raw text into Advanced Syntax.');
      return;
    }
    setWarmup(hydrated.warmup);
    setSets(hydrated.sets.length > 0 ? hydrated.sets : defaultBlocksForSport(targetSport, hydrated.hasTrackDistances).sets);
    setCooldown(hydrated.cooldown);
    setIsTrackOvalMode(hydrated.hasTrackDistances && targetSport === 'Running');
    setRawSyntaxOverride(null);
    if (hydrated.sets.length > 0) {
      const autoTitle = hydrated.sets
        .map((s) => `${s.reps > 1 ? `${s.reps}×` : ''}${s.value}${s.unit === 'min' ? 'm' : s.unit}`)
        .join(' + ');
      setBuilderName(autoTitle);
    }
    setStatusMessage(`Parsed ${hydrated.sets.length} block${hydrated.sets.length === 1 ? '' : 's'} into visual editor.`);
  };

  const sportPresets = useMemo(() => {
    if (builderSport === 'Running') {
      return [
        {
          label: 'Easy Aerobic Run (45m)',
          name: '45m Easy Aerobic Base',
          trackOval: false,
          syntax: `- 10m 62% Pace Warm-up\n- 25m 75% Pace Z2 Easy\n- 10m 60% Pace Cool-down`,
        },
        {
          label: 'Threshold Cruise (4x1mi)',
          name: '4x1mi Threshold Cruise Intervals',
          trackOval: true,
          syntax: `- 15m Z2 Warm-up\n- 4x 1600m @ threshold pace w/ 60s jog\n- 10m Z1 Cool-down`,
        },
        {
          label: 'Track 800m / Mile (6x400m)',
          name: '6x400m Mile-Pace Track Session',
          trackOval: true,
          syntax: `- 12m Z1 Warm-up\n- 6x 400m @ mile pace w/ 200m jog\n- 10m Z1 Cool-down`,
        },
      ];
    }
    if (builderSport === 'Cycling') {
      return [
        {
          label: 'Z2 Aerobic Endurance (90m)',
          name: '90m Z2 Aerobic Base',
          trackOval: false,
          syntax: `- 10m 55% FTP Warmup\n- 70m 70% FTP Z2 Endurance\n- 10m 55% FTP Cooldown`,
        },
        {
          label: '4x8m Sweet Spot',
          name: '4x8m Sweet Spot Progression',
          trackOval: false,
          syntax: `- 15m 60% FTP Warmup\nMain Set 4x\n- 8m 90% FTP Sweet Spot\n- 4m 55% FTP Recovery\n- 10m 55% FTP Cooldown`,
        },
        {
          label: '5x4m VO2max Intervals',
          name: '5x4m VO2max Ceiling',
          trackOval: false,
          syntax: `- 15m 60% FTP Warmup\nMain Set 5x\n- 4m 112% FTP VO2max\n- 4m 50% FTP Recovery\n- 10m 50% FTP Cooldown`,
        },
      ];
    }
    return [
      {
        label: builderSport === 'Swimming' ? '8x100m CSS Threshold' : '3x10m Runner Strength',
        name: builderSport === 'Swimming' ? '8x100m CSS Threshold' : 'Runner Stability & Power',
        trackOval: false,
        syntax:
          builderSport === 'Swimming'
            ? `- 10m 62% Effort Warmup\nMain Set 8x\n- 100m 96% Effort Threshold\n- 20s 50% Effort Rest\n- 10m 55% Effort Cooldown`
            : `- 10m 58% Effort Mobility Warmup\n- 25m 78% Effort Strength & Plyos\n- 10m 52% Effort Cooldown`,
      },
    ];
  }, [builderSport]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        ...(initialEvent?.id ? { id: initialEvent.id } : {}),
        date: builderDate,
        name: builderName.trim() || 'Structured Workout',
        sportCategory: builderSport,
        environmentPreference: builderEnv,
        plannedDurationSecs: summaryStats.durationSecs,
        plannedLoad: summaryStats.load,
        workoutSyntax: effectiveSyntax,
        description: notes.trim() || `${builderSport} structured session`,
        ...(detectedTrackSpec ? { trackSpec: detectedTrackSpec } : {}),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportFitClick = () => {
    exportWorkoutAsFit({
      name: builderName,
      sport: builderSport,
      workoutSyntax: effectiveSyntax,
      ftpWatts: safeFtp,
      lthrBpm: safeLthr,
      thresholdPaceSecsPerKm: safeThresholdPace,
      dateIso: builderDate,
    });
    setStatusMessage('Downloaded Garmin .FIT workout file.');
  };

  const handleExportZwoClick = () => {
    exportWorkoutAsZwo({
      name: builderName,
      sport: builderSport,
      workoutSyntax: effectiveSyntax,
      description: notes,
      ftpWatts: safeFtp,
      thresholdPaceSecsPerKm: safeThresholdPace,
      dateIso: builderDate,
    });
    setStatusMessage('Downloaded Zwift .ZWO workout file.');
  };

  const handleExportErgClick = () => {
    exportWorkoutAsErg({
      name: builderName,
      sport: builderSport,
      workoutSyntax: effectiveSyntax,
      ftpWatts: safeFtp,
      thresholdPaceSecsPerKm: safeThresholdPace,
      dateIso: builderDate,
    });
    setStatusMessage(`Downloaded .ERG file calibrated to ${safeFtp}W FTP.`);
  };

  const handleShareWorkoutClick = () => {
    openShareWorkoutRoute({
      kind: 'WORKOUT',
      version: 1,
      title: builderName.trim() || 'THRESH Structured Workout',
      sport: builderSport,
      date: builderDate,
      workoutSyntax: effectiveSyntax,
      plannedDurationSecs: summaryStats.durationSecs,
      plannedLoad: summaryStats.load,
      description: notes.trim() || `${builderSport} structured session`,
      defaultUnit: distanceUnit,
      referenceFtpWatts: safeFtp,
      referenceThresholdPaceSecsPerKm: safeThresholdPace,
    });
  };

  const handlePushGarminClick = async () => {
    const res = await pushWorkoutDirectToGarmin({
      name: builderName,
      sport: builderSport,
      workoutSyntax: effectiveSyntax,
      description: notes,
      ftpWatts: safeFtp,
      lthrBpm: safeLthr,
      thresholdPaceSecsPerKm: safeThresholdPace,
      dateIso: builderDate,
    });
    setStatusMessage(res.message);
  };

  const handleOpenStopwatchClick = () => {
    if (!detectedTrackSpec) return;
    stageWorkoutInTracksideStopwatch({
      title: builderName,
      spec: detectedTrackSpec,
    });
    onOpenTracksideStopwatch?.();
  };

  const resolvedStepLines = useMemo(
    () =>
      effectiveSyntax
        .split('\n')
        .map((l) =>
          formatHumanReadableStepLine(
            l,
            builderSport,
            safeThresholdPace,
            distanceUnit,
            safeFtp
          )
        )
        .filter((l) => l && !/^Main Set/i.test(l)),
    [effectiveSyntax, builderSport, safeThresholdPace, distanceUnit, safeFtp]
  );

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="visual-workout-builder"
      className={compact ? 'space-y-3' : 'space-y-4'}
    >
      {/* Sport Discipline Pills */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Workout Sport">
        {(
          [
            { id: 'Running', label: 'Running', trackOval: false, Icon: Footprints },
            { id: 'TrackOval', label: 'Track Oval', trackOval: true, Icon: Timer },
            { id: 'Cycling', label: 'Cycling', trackOval: false, Icon: Bike },
            { id: 'Swimming', label: 'Swim', trackOval: false, Icon: Waves },
            { id: 'Strength', label: 'Strength', trackOval: false, Icon: Dumbbell },
          ] as const
        ).map(({ id, label, trackOval, Icon }) => {
          const active =
            id === 'TrackOval'
              ? builderSport === 'Running' && isTrackOvalMode
              : id === 'Running'
                ? builderSport === 'Running' && !isTrackOvalMode
                : builderSport === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                applySportDiscipline(id === 'TrackOval' ? 'Running' : id, trackOval)
              }
              className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
                active
                  ? 'bg-[#1C5436] dark:bg-[#C8FF00] text-white dark:text-[#080A09] border-[#1C5436] dark:border-[#C8FF00]'
                  : 'bg-white/80 dark:bg-[#101B15] text-slate-700 dark:text-slate-300 border-stone-200 dark:border-[#244331] hover:border-[#1C5436]/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Metadata Row: Title, Date, Environment */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-6">
          <label
            htmlFor={`${formId}-title`}
            className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Workout Title
          </label>
          <input
            id={`${formId}-title`}
            type="text"
            required
            value={builderName}
            onChange={(e) => setBuilderName(e.target.value)}
            className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="sm:col-span-3">
          <label
            htmlFor={`${formId}-date`}
            className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Date
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            required
            value={builderDate}
            onChange={(e) => setBuilderDate(e.target.value)}
            className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="sm:col-span-3">
          <label
            htmlFor={`${formId}-env`}
            className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
          >
            Environment
          </label>
          <select
            id={`${formId}-env`}
            value={builderEnv}
            onChange={(e) =>
              setBuilderEnv(e.target.value as 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE')
            }
            className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="FLEXIBLE">Flexible</option>
            <option value="OUTDOOR">Outdoor</option>
            <option value="INDOOR">Indoor Trainer / Treadmill</option>
          </select>
        </div>
      </div>

      {/* Sport Presets + 1-Line Quick-Type Shorthand Parser */}
      <div className="space-y-2 rounded-xl bg-stone-50/90 dark:bg-[#101B15] border border-stone-200 dark:border-[#244331] p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-2xs font-mono text-slate-500">Presets:</span>
          {sportPresets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setBuilderName(preset.name);
                setIsTrackOvalMode(preset.trackOval);
                const hydrated = hydrateBlocksFromSyntax(
                  preset.syntax,
                  builderSport,
                  safeThresholdPace
                );
                if (hydrated) {
                  setWarmup(hydrated.warmup);
                  setSets(hydrated.sets);
                  setCooldown(hydrated.cooldown);
                  setRawSyntaxOverride(null);
                } else {
                  setRawSyntaxOverride(preset.syntax);
                }
              }}
              className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg bg-white dark:bg-[#15231B] border border-stone-200 dark:border-[#2B543B] hover:border-[#1C5436] text-2xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            data-testid="visual-builder-shorthand-input"
            aria-label="Quick-type workout shorthand"
            value={shorthandInput}
            onChange={(e) => setShorthandInput(e.target.value)}
            placeholder={
              builderSport === 'Cycling'
                ? 'e.g. 15m wu, 4x8m @ 90% FTP / 4m'
                : 'e.g. 2mi wu, 4x800m / 90s jog, 2mi cd'
            }
            className="flex-1 min-h-[44px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs text-slate-900 dark:text-white"
          />
          <button
            type="button"
            data-testid="visual-builder-parse-btn"
            onClick={applyShorthandParse}
            className="min-h-[44px] px-3.5 py-1.5 rounded-lg ap-btn-secondary text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Build Steps</span>
          </button>
        </div>
      </div>

      {/* Visual Warm-Up + Working Sets + Cooldown Stack */}
      <div className="space-y-2.5">
        {/* Warm-up Block */}
        <div className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#15231B]/60 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[40px]">
            <input
              type="checkbox"
              checked={warmup.enabled}
              onChange={(e) => {
                setRawSyntaxOverride(null);
                setWarmup((prev) => ({ ...prev, enabled: e.target.checked }));
              }}
              className="rounded border-stone-300 text-[#1C5436]"
            />
            <span>Warm-Up</span>
          </label>
          {warmup.enabled && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                max={60}
                step={warmup.unit === 'min' ? 1 : 0.5}
                aria-label="Warm-up amount"
                value={warmup.value}
                onChange={(e) => {
                  setRawSyntaxOverride(null);
                  setWarmup((prev) => ({
                    ...prev,
                    value: Math.max(0.5, Number(e.target.value) || 1),
                  }));
                }}
                className="w-16 min-h-[40px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2 font-mono text-xs text-slate-900 dark:text-white"
              />
              <select
                aria-label="Warm-up unit"
                value={warmup.unit}
                onChange={(e) => {
                  setRawSyntaxOverride(null);
                  setWarmup((prev) => ({
                    ...prev,
                    unit: e.target.value as 'min' | 'mi' | 'km',
                  }));
                }}
                className="min-h-[40px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2 font-mono text-xs text-slate-900 dark:text-white"
              >
                <option value="min">min</option>
                <option value="mi">mi</option>
                <option value="km">km</option>
              </select>
              <span className="text-2xs font-mono text-slate-500">
                @ {formatStepPreviewTarget(warmup.intensityPct, builderSport, safeFtp, safeThresholdPace, distanceUnit)}
              </span>
            </div>
          )}
        </div>

        {/* Working Sets Header + Rows */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
              Working Sets ({sets.length})
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-testid="visual-builder-add-repeat-btn"
                onClick={() => {
                  setRawSyntaxOverride(null);
                  setSets((prev) => [
                    ...prev,
                    {
                      id: makeRowId(prev.length + 1),
                      label: builderSport === 'Cycling' ? 'Threshold' : 'Interval',
                      reps: 4,
                      value: builderSport === 'Cycling' ? 6 : isTrackOvalMode ? 400 : 5,
                      unit: builderSport === 'Cycling' ? 'min' : isTrackOvalMode ? 'm' : 'min',
                      intensityPct: builderSport === 'Cycling' ? 98 : 108,
                      restValue: 90,
                      restUnit: 'sec',
                      setRestAfterSecs: 0,
                    },
                  ]);
                }}
                className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg bg-[#E3ECE5] dark:bg-[#15231B] text-[#1C5436] dark:text-[#C8FF00] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Repeat Set</span>
              </button>
              <button
                type="button"
                data-testid="visual-builder-add-steady-btn"
                onClick={() => {
                  setRawSyntaxOverride(null);
                  setSets((prev) => [
                    ...prev,
                    {
                      id: makeRowId(prev.length + 1),
                      label: builderSport === 'Cycling' ? 'Steady Z2' : 'Aerobic Tempo',
                      reps: 1,
                      value: 20,
                      unit: 'min',
                      intensityPct: 75,
                      restValue: 60,
                      restUnit: 'sec',
                      setRestAfterSecs: 0,
                    },
                  ]);
                }}
                className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg border border-stone-300 dark:border-[#2B543B] text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Steady Block</span>
              </button>
            </div>
          </div>

          {sets.map((row, idx) => {
            const repDistMeters =
              row.unit === 'm'
                ? row.value
                : row.unit === 'km'
                  ? row.value * 1000
                  : row.unit === 'mi'
                    ? row.value * 1609.34
                    : undefined;
            const liveTargetLabel = formatStepPreviewTarget(
              row.intensityPct,
              builderSport,
              safeFtp,
              safeThresholdPace,
              distanceUnit,
              repDistMeters
            );
            return (
              <div
                key={row.id}
                data-testid={`visual-builder-set-row-${idx}`}
                className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/85 dark:bg-[#101B15] p-3 space-y-2 text-xs"
              >
                <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
                  <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-slate-500">
                    <span>Reps</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      aria-label={`Block ${idx + 1} Reps`}
                      value={row.reps}
                      onChange={(e) => {
                        setRawSyntaxOverride(null);
                        const v = Math.max(1, Number(e.target.value) || 1);
                        setSets((prev) =>
                          prev.map((s) => (s.id === row.id ? { ...s, reps: v } : s))
                        );
                      }}
                      className="min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-slate-900 dark:text-white"
                    />
                  </label>

                  <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-slate-500">
                    <span>Duration / Dist</span>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      step={row.unit === 'km' || row.unit === 'mi' ? 0.25 : 1}
                      aria-label={`Block ${idx + 1} Value`}
                      value={row.value}
                      onChange={(e) => {
                        setRawSyntaxOverride(null);
                        const v = Math.max(1, Number(e.target.value) || 1);
                        setSets((prev) =>
                          prev.map((s) => (s.id === row.id ? { ...s, value: v } : s))
                        );
                      }}
                      className="min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-slate-900 dark:text-white"
                    />
                  </label>

                  <label className="sm:col-span-2 flex flex-col gap-0.5 text-2xs font-mono text-slate-500">
                    <span>Unit</span>
                    <select
                      aria-label={`Block ${idx + 1} Unit`}
                      value={row.unit}
                      onChange={(e) => {
                        setRawSyntaxOverride(null);
                        const u = e.target.value as StepDurationUnit;
                        setSets((prev) =>
                          prev.map((s) => (s.id === row.id ? { ...s, unit: u } : s))
                        );
                      }}
                      className="min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-slate-900 dark:text-white"
                    >
                      <option value="min">min</option>
                      <option value="sec">sec</option>
                      <option value="m">meters (Track)</option>
                      <option value="km">km</option>
                      <option value="mi">mi</option>
                    </select>
                  </label>

                  <label className="col-span-2 sm:col-span-3 flex flex-col gap-0.5 text-2xs font-mono text-slate-500">
                    <span>Intensity ({builderSport === 'Cycling' ? '% FTP' : '% Pace'})</span>
                    <select
                      aria-label={`Block ${idx + 1} Intensity Preset`}
                      value={row.intensityPct}
                      onChange={(e) => {
                        setRawSyntaxOverride(null);
                        const pct = Number(e.target.value);
                        setSets((prev) =>
                          prev.map((s) =>
                            s.id === row.id
                              ? {
                                  ...s,
                                  intensityPct: pct,
                                  label: closestZoneLabel(pct, builderSport),
                                }
                              : s
                          )
                        );
                      }}
                      className="min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-slate-900 dark:text-white"
                    >
                      {!STEP_ZONE_PRESETS.some((z) => z.intensityPct === row.intensityPct) && (
                        <option value={row.intensityPct}>{row.intensityPct}% Custom</option>
                      )}
                      {STEP_ZONE_PRESETS.map((z) => (
                        <option key={z.id} value={z.intensityPct}>
                          {z.label} ({z.intensityPct}%)
                        </option>
                      ))}
                    </select>
                  </label>

                  {row.reps > 1 ? (
                    <div className="col-span-2 sm:col-span-2 flex gap-1">
                      <label className="flex-1 flex flex-col gap-0.5 text-2xs font-mono text-slate-500">
                        <span>Rest</span>
                        <input
                          type="number"
                          min={5}
                          max={800}
                          aria-label={`Block ${idx + 1} Rest`}
                          value={row.restValue}
                          onChange={(e) => {
                            setRawSyntaxOverride(null);
                            const v = Math.max(5, Number(e.target.value) || 30);
                            setSets((prev) =>
                              prev.map((s) => (s.id === row.id ? { ...s, restValue: v } : s))
                            );
                          }}
                          className="min-h-[42px] sm:min-h-[38px] w-full rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2 font-mono text-xs text-slate-900 dark:text-white"
                        />
                      </label>
                      <label className="w-14 flex flex-col gap-0.5 text-2xs font-mono text-slate-500">
                        <span>Unit</span>
                        <select
                          aria-label={`Block ${idx + 1} Rest Unit`}
                          value={row.restUnit}
                          onChange={(e) => {
                            setRawSyntaxOverride(null);
                            const u = e.target.value as RestDurationUnit;
                            setSets((prev) =>
                              prev.map((s) => (s.id === row.id ? { ...s, restUnit: u } : s))
                            );
                          }}
                          className="min-h-[42px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-1 font-mono text-xs text-slate-900 dark:text-white"
                        >
                          <option value="sec">s</option>
                          <option value="min">m</option>
                          <option value="m">m jog</option>
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div className="sm:col-span-2 text-2xs font-mono text-slate-500 pb-2">
                      Steady Effort
                    </div>
                  )}

                  <div className="sm:col-span-1 flex justify-end">
                    <button
                      type="button"
                      disabled={sets.length <= 1}
                      onClick={() => {
                        setRawSyntaxOverride(null);
                        setSets((prev) => prev.filter((s) => s.id !== row.id));
                      }}
                      aria-label={`Remove block ${idx + 1}`}
                      className="min-h-[42px] min-w-[42px] sm:min-h-[38px] sm:min-w-[38px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-[#1C5436] dark:text-[#C8FF00]">
                  <span>
                    Target: <strong>{liveTargetLabel}</strong>
                  </span>
                  {sets.length > 1 && idx < sets.length - 1 && (
                    <label className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <span>Break before next set:</span>
                      <select
                        aria-label={`Rest after block ${idx + 1}`}
                        value={row.setRestAfterSecs}
                        onChange={(e) => {
                          setRawSyntaxOverride(null);
                          const val = Number(e.target.value);
                          setSets((prev) =>
                            prev.map((s) =>
                              s.id === row.id ? { ...s, setRestAfterSecs: val } : s
                            )
                          );
                        }}
                        className="rounded border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-1.5 py-0.5 text-2xs text-slate-900 dark:text-white"
                      >
                        <option value={0}>None</option>
                        <option value={120}>2m</option>
                        <option value={180}>3m</option>
                        <option value={240}>4m</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Cooldown Block */}
        <div className="rounded-xl border border-stone-200 dark:border-[#244331] bg-white/80 dark:bg-[#15231B]/60 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100 cursor-pointer min-h-[40px]">
            <input
              type="checkbox"
              checked={cooldown.enabled}
              onChange={(e) => {
                setRawSyntaxOverride(null);
                setCooldown((prev) => ({ ...prev, enabled: e.target.checked }));
              }}
              className="rounded border-stone-300 text-[#1C5436]"
            />
            <span>Cooldown</span>
          </label>
          {cooldown.enabled && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                max={60}
                step={cooldown.unit === 'min' ? 1 : 0.5}
                aria-label="Cooldown amount"
                value={cooldown.value}
                onChange={(e) => {
                  setRawSyntaxOverride(null);
                  setCooldown((prev) => ({
                    ...prev,
                    value: Math.max(0.5, Number(e.target.value) || 1),
                  }));
                }}
                className="w-16 min-h-[40px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2 font-mono text-xs text-slate-900 dark:text-white"
              />
              <select
                aria-label="Cooldown unit"
                value={cooldown.unit}
                onChange={(e) => {
                  setRawSyntaxOverride(null);
                  setCooldown((prev) => ({
                    ...prev,
                    unit: e.target.value as 'min' | 'mi' | 'km',
                  }));
                }}
                className="min-h-[40px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#101B15] px-2 font-mono text-xs text-slate-900 dark:text-white"
              >
                <option value="min">min</option>
                <option value="mi">mi</option>
                <option value="km">km</option>
              </select>
              <span className="text-2xs font-mono text-slate-500">
                @ {formatStepPreviewTarget(cooldown.intensityPct, builderSport, safeFtp, safeThresholdPace, distanceUnit)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Live Effort Skyline + Human-Readable Summary */}
      {parsedSteps.length > 0 && (
        <div className="rounded-xl bg-stone-50 dark:bg-[#15231B] border border-stone-200 dark:border-[#244331] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-slate-600 dark:text-slate-300">
            <span className="font-semibold">
              Effort Skyline · {parsedSteps.length} steps
            </span>
            <div className="flex items-center gap-2">
              <BracketedIntervalTape workoutSyntax={effectiveSyntax} compact className="!w-24 shrink-0" />
              <span className="text-[#1C5436] dark:text-[#C8FF00] font-bold">
                Est. {Math.round(summaryStats.durationSecs / 60)}m · ~{summaryStats.load} TSS
              </span>
            </div>
          </div>
          <div className="h-14 w-full flex items-end gap-[2px] pt-1">
            {parsedSteps.map((s, idx) => (
              <div
                key={idx}
                style={{
                  flex: Math.max(0.25, s.durationMins),
                  height: `${computeAmplitudeHeightPct(s.intensityPct, 50)}%`,
                  backgroundColor: s.zoneColor,
                }}
                className="rounded-t transition-all"
                title={`${s.label} (${s.durationMins}m @ ${s.intensityPct}%)`}
              />
            ))}
          </div>
          {resolvedStepLines.length > 0 && (
            <div className="text-2xs font-mono text-slate-600 dark:text-slate-300 space-y-0.5 pt-1 border-t border-stone-200/80 dark:border-white/10">
              {resolvedStepLines.slice(0, 6).map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapsible Advanced Raw Syntax Drawer */}
      <details
        data-testid="visual-builder-raw-syntax-drawer"
        className="rounded-xl border border-stone-200 dark:border-[#244331] bg-stone-50/70 dark:bg-[#101B15] p-3 text-xs"
      >
        <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-between list-none">
          <span>Advanced: Edit Raw Workout Syntax</span>
          <ChevronDown className="w-4 h-4 text-slate-500" />
        </summary>
        <div className="mt-2.5 space-y-2">
          <textarea
            id={`${formId}-syntax`}
            rows={5}
            aria-label="Raw workout syntax"
            value={effectiveSyntax}
            onChange={(e) => setRawSyntaxOverride(e.target.value)}
            className="w-full rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] p-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
          />
          {rawSyntaxOverride !== null && (
            <button
              type="button"
              onClick={() => {
                const hydrated = hydrateBlocksFromSyntax(
                  rawSyntaxOverride,
                  builderSport,
                  safeThresholdPace
                );
                if (hydrated && hydrated.sets.length > 0) {
                  setWarmup(hydrated.warmup);
                  setSets(hydrated.sets);
                  setCooldown(hydrated.cooldown);
                  setRawSyntaxOverride(null);
                  setStatusMessage('Synced raw syntax back into visual blocks.');
                }
              }}
              className="min-h-[36px] px-3 py-1 rounded-lg ap-btn-secondary text-2xs font-semibold cursor-pointer"
            >
              Sync Text → Visual Blocks
            </button>
          )}
        </div>
      </details>

      {/* Notes */}
      <div>
        <label
          htmlFor={`${formId}-notes`}
          className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
        >
          Execution &amp; Pacing Notes
        </label>
        <input
          id={`${formId}-notes`}
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full min-h-[44px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
        />
      </div>

      {statusMessage && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
          {statusMessage}
        </div>
      )}

      {/* Footer Actions: Export Menu (.FIT / .ZWO / .ERG / Garmin Push / Share) + Stopwatch + Save */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <details className="relative">
            <summary className="list-none min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg ap-btn-secondary text-2xs font-mono font-semibold inline-flex items-center gap-1.5 cursor-pointer select-none">
              <Download className="w-3.5 h-3.5" />
              <span>Export / Push ▾</span>
            </summary>
            <div className="absolute left-0 bottom-full mb-1.5 z-30 w-44 rounded-xl liquid-glass p-1.5 space-y-1 shadow-xl border border-emerald-900/15 dark:border-white/15">
              <button
                type="button"
                data-testid="visual-builder-export-fit"
                onClick={handleExportFitClick}
                className="w-full min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-[#101411] dark:text-[#F4F7F4] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .FIT</span>
              </button>
              <button
                type="button"
                data-testid="visual-builder-export-zwo"
                onClick={handleExportZwoClick}
                className="w-full min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-[#101411] dark:text-[#F4F7F4] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .ZWO</span>
              </button>
              {builderSport === 'Cycling' && (
                <button
                  type="button"
                  data-testid="visual-builder-export-erg"
                  onClick={handleExportErgClick}
                  className="w-full min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-[#101411] dark:text-[#F4F7F4] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .ERG</span>
                </button>
              )}
              <button
                type="button"
                data-testid="visual-builder-garmin-push"
                onClick={handlePushGarminClick}
                className="w-full min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-[#101411] dark:text-[#F4F7F4] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Garmin Push</span>
              </button>
              <button
                type="button"
                data-testid="visual-builder-share-btn"
                onClick={handleShareWorkoutClick}
                className="w-full min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-left text-2xs font-mono font-semibold text-[#101411] dark:text-[#F4F7F4] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ShareNetwork className="w-3.5 h-3.5" />
                <span>Share / PNG</span>
              </button>
            </div>
          </details>
          {detectedTrackSpec && onOpenTracksideStopwatch && (
            <button
              type="button"
              data-testid="visual-builder-stopwatch-btn"
              onClick={handleOpenStopwatchClick}
              className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg ap-btn-secondary text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <Timer className="w-3.5 h-3.5" />
              <span>Time on Track</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="min-h-[44px] px-4 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSaving}
            data-testid="visual-builder-submit-btn"
            className="min-h-[44px] px-4 py-1.5 rounded-lg ap-btn-primary disabled:opacity-50 text-xs font-semibold cursor-pointer"
          >
            {isSaving
              ? 'Saving...'
              : submitLabel || (initialEvent?.id ? 'Save Changes' : 'Save to Calendar')}
          </button>
        </div>
      </div>
    </form>
  );
};
