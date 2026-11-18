import type {
  CoachEventGroup,
  SportCategory,
  TrackWorkoutSpec,
} from '../types';

export type PlanPublishCadence = 'ROLLING_1W' | 'ROLLING_2W' | 'FULL_BLOCK';

export type PlanPublishAudience =
  | 'SELF'
  | 'TEAM_ALL'
  | 'EVENT_SPRINTS'
  | 'EVENT_MID_DISTANCE'
  | 'EVENT_DISTANCE';

export interface PlanWeekSourceItem {
  weekNum: number;
  sessions: Array<{
    date: string;
    name: string;
    sportCategory: SportCategory;
    environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
    plannedDurationSecs: number;
    plannedLoad: number;
    workoutSyntax: string;
    description: string;
    trackSpec?: TrackWorkoutSpec;
  }>;
}

export interface PlanPublishBatchSession {
  date: string;
  name: string;
  sportCategory: SportCategory;
  environmentPreference: 'OUTDOOR' | 'INDOOR' | 'FLEXIBLE';
  plannedDurationSecs: number;
  plannedLoad: number;
  workoutSyntax: string;
  description: string;
  trackSpec?: TrackWorkoutSpec;
  planBlockId: string;
  planBlockName: string;
  planWeekNum: number;
}

export interface AudienceCohortSpec {
  audience: PlanPublishAudience;
  isTeamBroadcast: boolean;
  targetSquadGroup: string;
  targetEventGroups?: CoachEventGroup[];
  cohortLabel: string;
  shortTag?: string;
}

export function resolveAudienceCohortSpec(
  audience: PlanPublishAudience
): AudienceCohortSpec {
  switch (audience) {
    case 'TEAM_ALL':
      return {
        audience,
        isTeamBroadcast: true,
        targetSquadGroup: 'ALL',
        cohortLabel: 'Entire Team',
        shortTag: 'TEAM',
      };
    case 'EVENT_SPRINTS':
      return {
        audience,
        isTeamBroadcast: true,
        targetSquadGroup: 'ALL',
        targetEventGroups: ['SPRINTS'],
        cohortLabel: 'Sprints Cohort',
        shortTag: 'SPRINTS',
      };
    case 'EVENT_MID_DISTANCE':
      return {
        audience,
        isTeamBroadcast: true,
        targetSquadGroup: 'ALL',
        targetEventGroups: ['MID_DISTANCE'],
        cohortLabel: '800m / Mile Cohort',
        shortTag: '800M / MILE',
      };
    case 'EVENT_DISTANCE':
      return {
        audience,
        isTeamBroadcast: true,
        targetSquadGroup: 'ALL',
        targetEventGroups: ['DISTANCE'],
        cohortLabel: 'Distance / XC Cohort',
        shortTag: 'DISTANCE',
      };
    case 'SELF':
    default:
      return {
        audience: 'SELF',
        isTeamBroadcast: false,
        targetSquadGroup: 'ALL',
        cohortLabel: 'My Personal Calendar',
      };
  }
}

export function describePublishCadenceLabel(
  cadence: PlanPublishCadence,
  startWeekNum: number,
  endWeekNum: number
): string {
  if (cadence === 'ROLLING_1W') {
    return `Rolling 1-Week Window (Week ${startWeekNum})`;
  }
  if (cadence === 'ROLLING_2W') {
    return startWeekNum === endWeekNum
      ? `Rolling 2-Week Window (Week ${startWeekNum})`
      : `Rolling 2-Week Window (Weeks ${startWeekNum}–${endWeekNum})`;
  }
  return `Full ${endWeekNum - startWeekNum + 1}-Week Block`;
}

/**
 * Slices a generated multi-week Plan Builder block into either a rolling 1-week window,
 * a rolling 2-week window (starting at `startWeekIdx`), or the complete mesocycle,
 * tagging cohort & block metadata onto each session.
 */
export function selectSessionsForPublishCadence(
  weeks: PlanWeekSourceItem[],
  cadence: PlanPublishCadence,
  startWeekIdx = 0,
  blockMeta: {
    blockId: string;
    baseTitle: string;
    audience: PlanPublishAudience;
  }
): {
  sessions: PlanPublishBatchSession[];
  startWeekNum: number;
  endWeekNum: number;
  cadenceLabel: string;
  cohort: AudienceCohortSpec;
} {
  const cohort = resolveAudienceCohortSpec(blockMeta.audience);
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return {
      sessions: [],
      startWeekNum: 1,
      endWeekNum: 1,
      cadenceLabel: 'Empty Block',
      cohort,
    };
  }

  const safeStart = Math.max(0, Math.min(weeks.length - 1, Math.floor(startWeekIdx)));
  const selectedWeeks =
    cadence === 'ROLLING_1W'
      ? weeks.slice(safeStart, safeStart + 1)
      : cadence === 'ROLLING_2W'
        ? weeks.slice(safeStart, safeStart + 2)
        : weeks;

  const startWeekNum = selectedWeeks[0]?.weekNum ?? 1;
  const endWeekNum = selectedWeeks[selectedWeeks.length - 1]?.weekNum ?? startWeekNum;
  const blockName = cohort.shortTag
    ? `[${cohort.shortTag}] ${blockMeta.baseTitle}`
    : blockMeta.baseTitle;

  const sessions: PlanPublishBatchSession[] = selectedWeeks.flatMap((wk) =>
    (wk.sessions || []).map((sess) => ({
      ...sess,
      planBlockId: blockMeta.blockId,
      planBlockName: blockName,
      planWeekNum: wk.weekNum,
    }))
  );

  return {
    sessions,
    startWeekNum,
    endWeekNum,
    cadenceLabel: describePublishCadenceLabel(cadence, startWeekNum, endWeekNum),
    cohort,
  };
}
