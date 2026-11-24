import type {
  CoachEventGroup,
  SessionCheckInRecord,
  TeamInjuryCaseRecord,
  TeamInjuryRtpStage,
  TeamMemberRole,
  TeamMembershipRecord,
  TeamSummaryWithRole,
} from '../types.ts';
import { getLocalDateIso } from './stravaLoadCalibration.ts';

export type InjuryBodyRegion = NonNullable<SessionCheckInRecord['painArea']>;

export const ALL_INJURY_BODY_REGIONS: readonly InjuryBodyRegion[] = [
  'SHIN',
  'ACHILLES',
  'ANKLE',
  'FOOT',
  'KNEE',
  'HAMSTRING',
  'QUAD',
  'GROIN',
  'HIP',
  'BACK',
  'SHOULDER',
  'ELBOW',
  'OTHER',
] as const;

export const VALID_PAIN_AREA_SET: ReadonlySet<InjuryBodyRegion> = new Set(
  ALL_INJURY_BODY_REGIONS
);

export function normalizePainArea(raw?: unknown): InjuryBodyRegion | undefined {
  if (typeof raw !== 'string') return undefined;
  const upper = raw.trim().toUpperCase() as InjuryBodyRegion;
  return VALID_PAIN_AREA_SET.has(upper) ? upper : undefined;
}

export interface InjuryRegionMeta {
  region: InjuryBodyRegion;
  label: string;
  shortLabel: string;
  group: 'LOWER_LEG' | 'UPPER_LEG_HIP' | 'TRUNK_UPPER';
  defaultRestrictionHint: string;
}

export const INJURY_REGION_METADATA: Record<InjuryBodyRegion, InjuryRegionMeta> = {
  SHIN: {
    region: 'SHIN',
    label: 'Shin / Tibia',
    shortLabel: 'Shin',
    group: 'LOWER_LEG',
    defaultRestrictionHint: 'No spikes or hard track turns; swap to pool/bike or soft turf only.',
  },
  ACHILLES: {
    region: 'ACHILLES',
    label: 'Achilles / Calf',
    shortLabel: 'Achilles',
    group: 'LOWER_LEG',
    defaultRestrictionHint: 'Avoid spikes, plyos, and steep hills; eccentric heel drops per AT.',
  },
  ANKLE: {
    region: 'ANKLE',
    label: 'Ankle / Peroneal',
    shortLabel: 'Ankle',
    group: 'LOWER_LEG',
    defaultRestrictionHint: 'Taped/braced before warmups; no uneven trail or hurdle takeoff.',
  },
  FOOT: {
    region: 'FOOT',
    label: 'Foot / Plantar / Metatarsal',
    shortLabel: 'Foot',
    group: 'LOWER_LEG',
    defaultRestrictionHint: 'Max-cushion daily trainer only; zero barefoot strides or jumps.',
  },
  KNEE: {
    region: 'KNEE',
    label: 'Knee / Patellar',
    shortLabel: 'Knee',
    group: 'UPPER_LEG_HIP',
    defaultRestrictionHint: 'Limit downhill tempo & deep squat loading; monitor post-warmup.',
  },
  HAMSTRING: {
    region: 'HAMSTRING',
    label: 'Hamstring',
    shortLabel: 'Hamstring',
    group: 'UPPER_LEG_HIP',
    defaultRestrictionHint: 'Cap sprint speed <= 85% max velocity; no block starts.',
  },
  QUAD: {
    region: 'QUAD',
    label: 'Quad / Rectus Femoris',
    shortLabel: 'Quad',
    group: 'UPPER_LEG_HIP',
    defaultRestrictionHint: 'Avoid hurdle lead-leg snaps and maximal long-jump takeoff.',
  },
  GROIN: {
    region: 'GROIN',
    label: 'Groin / Adductor',
    shortLabel: 'Groin',
    group: 'UPPER_LEG_HIP',
    defaultRestrictionHint: 'Straight-line running only; no lateral agility or hurdle trail-leg.',
  },
  HIP: {
    region: 'HIP',
    label: 'Hip / Flexor / Iliac',
    shortLabel: 'Hip',
    group: 'UPPER_LEG_HIP',
    defaultRestrictionHint: 'Reduce stride-length overstriding; cross-train on elliptical/swim.',
  },
  BACK: {
    region: 'BACK',
    label: 'Low Back / Lumbar',
    shortLabel: 'Back',
    group: 'TRUNK_UPPER',
    defaultRestrictionHint: 'No heavy Olympic lifts or pole-vault plant compression.',
  },
  SHOULDER: {
    region: 'SHOULDER',
    label: 'Shoulder / Labrum',
    shortLabel: 'Shoulder',
    group: 'TRUNK_UPPER',
    defaultRestrictionHint: 'No javelin/shot throws or pole-vault plant; running cleared.',
  },
  ELBOW: {
    region: 'ELBOW',
    label: 'Elbow / UCL / Forearm',
    shortLabel: 'Elbow',
    group: 'TRUNK_UPPER',
    defaultRestrictionHint: 'Hold javelin & discus releases; sprint/track conditioning OK.',
  },
  OTHER: {
    region: 'OTHER',
    label: 'General / Other',
    shortLabel: 'Other',
    group: 'TRUNK_UPPER',
    defaultRestrictionHint: 'Check in with Athletic Trainer prior to high-intensity work.',
  },
};

export interface RtpStageMeta {
  stage: TeamInjuryRtpStage;
  label: string;
  shortLabel: string;
  tone: 'strained' | 'caution' | 'info' | 'prime';
  rosterSyncLabel: string;
  description: string;
}

export const RTP_STAGE_METADATA: Record<TeamInjuryRtpStage, RtpStageMeta> = {
  OUT: {
    stage: 'OUT',
    label: 'Out / Rehab Only',
    shortLabel: 'OUT',
    tone: 'strained',
    rosterSyncLabel: 'Roster: INJURED',
    description: 'No running/jumping impact; rehab & zero-impact modalities only.',
  },
  MODIFIED: {
    stage: 'MODIFIED',
    label: 'Modified / Cross-Train',
    shortLabel: 'MODIFIED',
    tone: 'caution',
    rosterSyncLabel: 'Roster: INJURED',
    description: 'Bike, aqua-jog, or pain-free drills only; excluded from hard pods.',
  },
  LIMITED: {
    stage: 'LIMITED',
    label: 'Limited Return',
    shortLabel: 'LIMITED',
    tone: 'info',
    rosterSyncLabel: 'Gradual Return',
    description: 'Controlled volume/intensity on soft surface or capped reps.',
  },
  CLEARED: {
    stage: 'CLEARED',
    label: 'Cleared Full Practice',
    shortLabel: 'CLEARED',
    tone: 'prime',
    rosterSyncLabel: 'Roster: ACTIVE',
    description: 'Full event-group training and meet competition cleared.',
  },
};

export interface PainHeatmapRegionSummary {
  region: InjuryBodyRegion;
  label: string;
  shortLabel: string;
  group: InjuryRegionMeta['group'];
  checkInCount: number;
  activeCaseCount: number;
  totalSignalCount: number;
  heatLevel: 'NONE' | 'LOW' | 'ELEVATED' | 'HOTSPOT';
  affectedAthletes: Array<{
    membershipId: string;
    athleteName: string;
    source: 'CASE' | 'CHECK_IN';
  }>;
}

export interface PainCheckInTriageItem {
  checkInId: string;
  membershipId: string;
  athleteName: string;
  eventGroup?: CoachEventGroup;
  date: string;
  bodyRegion: InjuryBodyRegion;
  rpe: number;
  sorenessNote?: string;
}

export interface SafeSportInjuryContextItem {
  membershipId: string;
  athleteName: string;
  eventGroup?: CoachEventGroup;
  trafficLight: 'AMBER_WATCH' | 'RED_MEDICAL_REVIEW';
  coachSafeSummaryLabel: string;
}

export interface InjuryHubDashboardSummary {
  windowDays: 7 | 30;
  regions: PainHeatmapRegionSummary[];
  totalPainFlags7d: number;
  totalPainFlags30d: number;
  activeCaseCount: number;
  outCount: number;
  modifiedCount: number;
  limitedCount: number;
  clearedCount: number;
  triageQueue: PainCheckInTriageItem[];
  safeSportFlags: SafeSportInjuryContextItem[];
}

export function shiftIsoDateDays(baseIso: string, deltaDays: number): string {
  const parsed = new Date(`${baseIso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return baseIso.slice(0, 10);
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Computes the 13-region pain trend heatmap, RTP stage counts, check-in triage queue,
 * and coach-safe SafeSport Pattern Watch flags without touching body-weight or BMI fields.
 */
export function computePainTrendHeatmap(params: {
  memberships: TeamMembershipRecord[];
  injuryCases?: TeamInjuryCaseRecord[];
  windowDays?: 7 | 30;
  referenceDateIso?: string;
}): InjuryHubDashboardSummary {
  const windowDays: 7 | 30 = params.windowDays === 30 ? 30 : 7;
  const refIso = (params.referenceDateIso || getLocalDateIso()).slice(0, 10);
  const cutoff7d = shiftIsoDateDays(refIso, -6);
  const cutoff30d = shiftIsoDateDays(refIso, -29);
  const activeCutoff = windowDays === 30 ? cutoff30d : cutoff7d;

  const cases = Array.isArray(params.injuryCases) ? params.injuryCases : [];
  const memberships = Array.isArray(params.memberships) ? params.memberships : [];

  const openCaseKeySet = new Set<string>();
  let outCount = 0;
  let modifiedCount = 0;
  let limitedCount = 0;
  let clearedCount = 0;

  const regionBuckets = new Map<
    InjuryBodyRegion,
    {
      checkInCount: number;
      activeCaseCount: number;
      athletes: Map<string, { membershipId: string; athleteName: string; source: 'CASE' | 'CHECK_IN' }>;
    }
  >();

  for (const reg of ALL_INJURY_BODY_REGIONS) {
    regionBuckets.set(reg, {
      checkInCount: 0,
      activeCaseCount: 0,
      athletes: new Map(),
    });
  }

  for (const c of cases) {
    if (c.rtpStage === 'OUT') outCount += 1;
    else if (c.rtpStage === 'MODIFIED') modifiedCount += 1;
    else if (c.rtpStage === 'LIMITED') limitedCount += 1;
    else if (c.rtpStage === 'CLEARED') clearedCount += 1;

    if (c.rtpStage !== 'CLEARED') {
      const reg = normalizePainArea(c.bodyRegion) || 'OTHER';
      openCaseKeySet.add(`${c.membershipId}|${reg}`);
      const bucket = regionBuckets.get(reg)!;
      bucket.activeCaseCount += 1;
      bucket.athletes.set(c.membershipId, {
        membershipId: c.membershipId,
        athleteName: c.athleteName,
        source: 'CASE',
      });
    }
  }

  let totalPainFlags7d = 0;
  let totalPainFlags30d = 0;
  const triageQueue: PainCheckInTriageItem[] = [];
  const safeSportFlags: SafeSportInjuryContextItem[] = [];

  for (const m of memberships) {
    if (m.status === 'REVOKED' || m.status === 'ALUMNI' || m.role !== 'ATHLETE') continue;

    const watch = m.liveSnapshot?.safeSportWatch;
    if (
      watch &&
      (watch.trafficLight === 'AMBER_WATCH' || watch.trafficLight === 'RED_MEDICAL_REVIEW')
    ) {
      safeSportFlags.push({
        membershipId: m.membershipId,
        athleteName: m.invitedName,
        eventGroup: m.eventGroup,
        trafficLight: watch.trafficLight,
        coachSafeSummaryLabel: watch.coachSafeSummaryLabel,
      });
    }

    const checkIns = m.liveSnapshot?.sessionCheckIns || [];
    for (const chk of checkIns) {
      if (!chk.painFlag) continue;
      const dateIso = String(chk.date || '').slice(0, 10);
      if (!dateIso) continue;
      if (dateIso >= cutoff7d) totalPainFlags7d += 1;
      if (dateIso >= cutoff30d) totalPainFlags30d += 1;

      const reg = normalizePainArea(chk.painArea) || 'OTHER';
      if (dateIso >= activeCutoff) {
        const bucket = regionBuckets.get(reg)!;
        bucket.checkInCount += 1;
        if (!bucket.athletes.has(m.membershipId)) {
          bucket.athletes.set(m.membershipId, {
            membershipId: m.membershipId,
            athleteName: m.invitedName,
            source: 'CHECK_IN',
          });
        }
      }

      if (dateIso >= cutoff7d && !openCaseKeySet.has(`${m.membershipId}|${reg}`)) {
        triageQueue.push({
          checkInId: chk.id,
          membershipId: m.membershipId,
          athleteName: m.invitedName,
          eventGroup: m.eventGroup,
          date: dateIso,
          bodyRegion: reg,
          rpe: chk.rpe,
          ...(chk.sorenessNote ? { sorenessNote: chk.sorenessNote } : {}),
        });
      }
    }
  }

  triageQueue.sort((a, b) => b.date.localeCompare(a.date));

  const regions: PainHeatmapRegionSummary[] = ALL_INJURY_BODY_REGIONS.map((reg) => {
    const meta = INJURY_REGION_METADATA[reg];
    const bucket = regionBuckets.get(reg)!;
    const totalSignalCount = bucket.checkInCount + bucket.activeCaseCount;
    const heatLevel: PainHeatmapRegionSummary['heatLevel'] =
      totalSignalCount === 0
        ? 'NONE'
        : totalSignalCount === 1
          ? 'LOW'
          : totalSignalCount === 2
            ? 'ELEVATED'
            : 'HOTSPOT';

    return {
      region: reg,
      label: meta.label,
      shortLabel: meta.shortLabel,
      group: meta.group,
      checkInCount: bucket.checkInCount,
      activeCaseCount: bucket.activeCaseCount,
      totalSignalCount,
      heatLevel,
      affectedAthletes: Array.from(bucket.athletes.values()),
    };
  });

  return {
    windowDays,
    regions,
    totalPainFlags7d,
    totalPainFlags30d,
    activeCaseCount: outCount + modifiedCount + limitedCount,
    outCount,
    modifiedCount,
    limitedCount,
    clearedCount,
    triageQueue,
    safeSportFlags,
  };
}

export function stripClinicalNotesForRole(
  cases: TeamInjuryCaseRecord[],
  role?: TeamMemberRole | string
): TeamInjuryCaseRecord[] {
  if (role === 'ATHLETIC_TRAINER') return cases;
  return cases.map((c) => {
    const { privateClinicalNotes: _drop, ...coachSafe } = c;
    return coachSafe;
  });
}

export function buildDemoSeedInjuryCases(
  team: TeamSummaryWithRole | null
): TeamInjuryCaseRecord[] {
  const teamId = team?.brand.teamId || 'demo-team';
  const athletes = (team?.memberships || []).filter(
    (m) => m.role === 'ATHLETE' && m.status !== 'REVOKED'
  );
  const hasActivePainCheckIn = (
    m: TeamMembershipRecord,
    preferredArea?: SessionCheckInRecord['painArea']
  ): boolean =>
    (m.liveSnapshot?.sessionCheckIns || []).some(
      (ci) => ci.painFlag && (!preferredArea || ci.painArea === preferredArea)
    );
  const usedIds = new Set<string>();
  const pickAthleteForRegion = (
    preferredArea: SessionCheckInRecord['painArea'],
    fallbackIdx: number
  ): TeamMembershipRecord | undefined => {
    const exactMatch = athletes.find(
      (m) => !usedIds.has(m.membershipId) && hasActivePainCheckIn(m, preferredArea)
    );
    const anyPainMatch = exactMatch
      ? undefined
      : athletes.find((m) => !usedIds.has(m.membershipId) && hasActivePainCheckIn(m));
    const fallback =
      athletes[fallbackIdx] && !usedIds.has(athletes[fallbackIdx].membershipId)
        ? athletes[fallbackIdx]
        : athletes.find((m) => !usedIds.has(m.membershipId)) || athletes[fallbackIdx] || athletes[0];
    const chosen = exactMatch || anyPainMatch || fallback;
    if (chosen) usedIds.add(chosen.membershipId);
    return chosen;
  };
  const first = pickAthleteForRegion('SHIN', 0);
  const second = pickAthleteForRegion('HAMSTRING', 1) || first;
  const third = pickAthleteForRegion('ANKLE', 2) || second || first;
  const todayIso = getLocalDateIso();
  const returnIn7d = shiftIsoDateDays(todayIso, 7);
  const returnIn3d = shiftIsoDateDays(todayIso, 3);
  const isTrainer = team?.myRole === 'ATHLETIC_TRAINER';

  const raw: TeamInjuryCaseRecord[] = [
    {
      id: 'demo-inj-shin-1',
      teamId,
      membershipId: first?.membershipId || 'demo-ath-1',
      athleteName: first?.invitedName || 'Maya Chen',
      bodyRegion: 'SHIN',
      severity: 'MODERATE',
      rtpStage: 'MODIFIED',
      restrictions: 'No track intervals or spikes; turf stride limits + post-session ice cup.',
      coachGuidance: 'Substitute 35m Pool / Spin Bike aerobic flush during threshold day.',
      ...(isTrainer
        ? {
            privateClinicalNotes:
              'Medial tibial border tenderness ~4cm proximal to malleolus; negative hop test. Re-evaluate after 5 days off track surface.',
          }
        : {}),
      targetReturnDate: returnIn7d,
      createdAt: `${todayIso}T14:00:00.000Z`,
      updatedAt: `${todayIso}T15:30:00.000Z`,
      updatedByName: 'Athletic Trainer',
    },
    {
      id: 'demo-inj-ham-2',
      teamId,
      membershipId: second?.membershipId || 'demo-ath-2',
      athleteName: second?.invitedName || 'Devon Brooks',
      bodyRegion: 'HAMSTRING',
      severity: 'LOW',
      rtpStage: 'LIMITED',
      restrictions: 'Cap sprint velocity at 85%; no starting blocks or hurdle lead snaps.',
      coachGuidance: 'Cleared for tempo strides on grass + Nordic eccentric progressions.',
      ...(isTrainer
        ? {
            privateClinicalNotes:
              'Mild distal biceps femoris tightness post-200m finals; full ROM symmetrical.',
          }
        : {}),
      targetReturnDate: returnIn3d,
      createdAt: `${shiftIsoDateDays(todayIso, -4)}T16:00:00.000Z`,
      updatedAt: `${todayIso}T12:15:00.000Z`,
      updatedByName: 'Athletic Trainer',
    },
    {
      id: 'demo-inj-ankle-3',
      teamId,
      membershipId: third?.membershipId || 'demo-ath-3',
      athleteName: third?.invitedName || 'Sofia Martinez',
      bodyRegion: 'ANKLE',
      severity: 'LOW',
      rtpStage: 'CLEARED',
      restrictions: 'Preventative figure-8 tape for uneven XC courses this week.',
      coachGuidance: 'Cleared for full varsity workout & Saturday invitational.',
      targetReturnDate: todayIso,
      createdAt: `${shiftIsoDateDays(todayIso, -9)}T15:00:00.000Z`,
      updatedAt: `${shiftIsoDateDays(todayIso, -1)}T17:00:00.000Z`,
      updatedByName: 'Athletic Trainer',
    },
  ];

  return stripClinicalNotesForRole(raw, team?.myRole);
}
