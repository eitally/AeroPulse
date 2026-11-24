import type {
  CuratedMeetAlbumLink,
  TeamAnnouncementRecord,
  TeamCustomSubgroup,
  TeamEventType,
  TeamMessageRecord,
  TeamMessagingPolicy,
} from './commsAndEvents.ts';
import type {
  CoachEventGroup,
  SafeSportPatternWatchReport,
  TrackWorkoutSpec,
} from './scholastic.ts';
import type {
  AthletePrivacySettings,
  CoachDataSharingTier,
  OfficialRacePlatform,
  OfficialTrackSurface,
  SportCategory,
  UnifiedActivity,
  UnifiedWellnessDay,
} from './telemetry.ts';
import type {
  AthleteOwnMeetScheduleItem,
  DelegatedSplitSubmissionRecord,
  DelegatedTimingSessionRecord,
  MeetDayPacketRecord,
} from './timing.ts';
import type {
  PracticeVenueCategory,
  SessionCheckInRecord,
  WorkoutSessionSlot,
} from './workouts.ts';

export type TeamOrgType =
  | 'HIGH_SCHOOL'
  | 'COLLEGIATE'
  | 'RUNNING_CLUB'
  | 'CYCLING_CLUB'
  | 'COACH_SQUAD';

export type TeamMemberRole =
  | 'HEAD_COACH'
  | 'ASSISTANT_COACH'
  | 'ORG_ADMIN'
  | 'ATHLETIC_TRAINER'
  | 'ATHLETE'
  | 'PARENT_FOLLOWER';

export type TeamWorkoutLibraryCategory =
  | 'TRACK'
  | 'XC_TEMPO'
  | 'ROAD'
  | 'CYCLING'
  | 'SWIMMING'
  | 'TRIATHLON'
  | 'RECOVERY';

export interface TeamWorkoutLibraryTemplate {
  id: string;
  name: string;
  category: TeamWorkoutLibraryCategory;
  sportCategory: SportCategory;
  workoutSyntax: string;
  description: string;
  plannedDurationSecs: number;
  plannedLoad: number;
  trackSpec?: TrackWorkoutSpec;
  createdByName: string;
  createdAt: string;
}

export interface TeamWorkoutComment {
  id: string;
  teamId: string;
  targetMembershipId: string;
  targetAthleteName?: string;
  activityId?: string;
  workoutDate: string;
  authorSid: string;
  authorName: string;
  authorRole: TeamMemberRole;
  body: string;
  guardianCcApplied: boolean;
  guardianVisible: boolean;
  createdAt: string;
}

export interface GuardianSafetyAlertRecord {
  id: string;
  teamId: string;
  targetMembershipId: string;
  athleteName: string;
  sourceCheckInId?: string;
  severity: 'CAUTION' | 'HIGH';
  category: 'PAIN_FLAG' | 'HIGH_STRAIN' | 'SAFE_SPORT_WATCH';
  summary: string;
  painLocation?: string;
  guardianEmailMasked?: string;
  deliveryStatus: 'SENT' | 'LOCAL_LOGGED' | 'NO_GUARDIAN_ON_FILE';
  createdAt: string;
}

export interface TeamAuditLogEntry {
  eventId: string;
  createdAt: string;
  teamId: string;
  actorSid: string;
  action: string;
  targetId?: string;
  metadata: Record<string, unknown>;
}

export type TeamInviteStatus =
  | 'INVITED'
  | 'OPENED'
  | 'ACTIVE'
  | 'INJURED'
  | 'OFF_SEASON'
  | 'ALUMNI'
  | 'REVOKED';

export type TeamPlanTier = 'SANDBOX' | 'FOUNDING_TEAM';

export type ExternalTeamPlatform = 'ATHLETIC_NET' | 'TFRRS' | 'HYTEK';

export interface TeamExternalSyncConfig {
  platform?: 'ATHLETIC_NET' | 'TFRRS';
  athleticNetSchoolId?: string;
  athleticNetSportSlug?: 'xc' | 'track-and-field-outdoor' | 'track-and-field-indoor';
  athleticNetUrl?: string;
  tfrrsTeamUrl?: string;
  tfrrsTeamCode?: string;
  teamFilterKeyword?: string;
  icsCalendarUrl?: string;
  enablePublicParentHub?: boolean;
  publishUnofficialSplits?: boolean;
  lastSyncedAt?: string;
}

export interface PracticeVenueGeofence {
  id: string;
  name: string;
  category: PracticeVenueCategory;
  latitude: number; // Public facility pin ONLY — never athlete coords
  longitude: number;
  radiusMeters: number; // Clamped 50..1500m, default 250m
  enabled: boolean;
}

export interface TeamBrandConfig {
  teamId: string;
  slug: string; // e.g. 'palo-alto-xc' -> /join/palo-alto-xc
  joinCode: string; // e.g. 'PAXC-26'
  name: string; // e.g. 'Palo Alto High Varsity XC'
  shortName: string; // e.g. 'PALY XC'
  mascotOrMotto?: string;
  districtName?: string;
  timezone?: string;
  practiceVenues?: PracticeVenueGeofence[];
  orgType: TeamOrgType;
  primarySport: 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid';
  logoDataUrl?: string; // Optional SVG/PNG/WebP crest data URL
  primaryHex: string; // e.g. '#1E5631'
  secondaryHex: string; // e.g. '#D97706'
  defaultSafeSportShield: boolean; // Auto-defaults to true for HIGH_SCHOOL
  enableParentGuardianCc: boolean; // Auto-defaults to true for HIGH_SCHOOL
  coachDisplayName: string;
  planTier?: TeamPlanTier;
  externalSync?: TeamExternalSyncConfig;
  createdAt: string;
}

export interface TeamAthleteLiveSnapshot {
  updatedAt: string;
  hasConnectedWatch: boolean;
  verdictLabel: string;
  readinessScore: number;
  ctl: number;
  atl: number;
  tsb: number;
  acuteLoad7d: number;
  lowAerobicPct: number;
  highAerobicPct: number;
  neuromuscularPct: number;
  caraHours7d: number;
  ftpWatts?: number;
  thresholdPaceSecsPerKm?: number;
  safeSportHideWeight: boolean;
  birthMonthYear?: string;
  sharingTier?: CoachDataSharingTier;
  privacySettings?: AthletePrivacySettings;
  wellnessDays?: UnifiedWellnessDay[];
  activities?: UnifiedActivity[];
  sessionCheckIns?: SessionCheckInRecord[];
  safeSportWatch?: {
    trafficLight: 'GREEN_CLEAR' | 'AMBER_WATCH' | 'RED_MEDICAL_REVIEW';
    coachSafeSummaryLabel: string;
    privateAlertForSelfAndParentOnly?: SafeSportPatternWatchReport;
  };
}

export type ParentConsentStatus = 'PENDING' | 'ACKNOWLEDGED' | 'NOT_REQUIRED';

export interface TeamMembershipRecord {
  membershipId: string;
  teamId: string;
  userSid?: string;
  stravaAthleteId?: string;
  sharingTier?: CoachDataSharingTier;
  role: TeamMemberRole;
  squadGroup: string;
  eventGroup?: CoachEventGroup;
  coachEventGroups?: CoachEventGroup[];
  coachSpecialtyTitle?: string;
  assignedAthleteMembershipIds?: string[];
  invitedName: string;
  invitedEmail?: string;
  invitedPhone?: string;
  parentGuardianEmail?: string;
  graduationYear?: number;
  birthYear?: number;
  birthMonthYear?: string;
  isMinorU18: boolean;
  parentConsentStatus?: ParentConsentStatus;
  parentConsentToken?: string;
  parentConsentAt?: string;
  seedMarkOrFtp?: string;
  externalSource?: ExternalTeamPlatform;
  externalAthleteId?: string;
  externalProfileUrl?: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  photoReleaseOptOut?: boolean;
  status: TeamInviteStatus;
  emailDeliveryStatus?: 'SENT_RESEND' | 'READY_MANUAL_LINK' | 'FAILED';
  magicJoinUrl?: string; // Populated for coaches so they can copy or share via free sms:/mailto:
  invitedAt: string;
  openedAt?: string;
  joinedAt?: string;
  leftAt?: string;
  graduatedAt?: string;
  liveSnapshot?: TeamAthleteLiveSnapshot;
  coachRecordedActivities?: UnifiedActivity[];
}

export interface TeamBroadcastWorkout {
  broadcastId: string;
  teamId: string;
  targetSquadGroup: string; // 'ALL' or specific squad like 'Varsity'
  targetEventGroups?: CoachEventGroup[]; // Optional Event Group filter ('SPRINTS', 'MID_DISTANCE', 'DISTANCE')
  targetMembershipIds?: string[]; // Optional subset of membershipIds (e.g. single athlete or VDOT pod)
  date: string;
  name: string;
  sportCategory: SportCategory;
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
  athleteOverrides?: Record<
    string,
    {
      name?: string;
      workoutSyntax: string;
      description?: string;
      plannedDurationSecs?: number;
      plannedLoad?: number;
      scheduledTime?: string;
      sessionSlot?: WorkoutSessionSlot;
      locationName?: string;
      locationCategory?: PracticeVenueCategory;
      meetingNotes?: string;
      trackSpec?: TrackWorkoutSpec;
    }
  >;
  planBlockId?: string;
  planBlockName?: string;
  planWeekNum?: number;
  publishMode?: 'ROLLING_1W' | 'ROLLING_2W' | 'FULL_BLOCK';
  isOfficialMeet?: boolean;
  externalSource?: ExternalTeamPlatform;
  eventId?: string;
  liveResultsUrl?: string;
  liveResultsLabel?: string;
  curatedAlbumLinks?: CuratedMeetAlbumLink[];
  pushedByCoachName: string;
  createdAt: string;
}

export interface PublicTeamHubMeetItem {
  id: string;
  date: string;
  name: string;
  eventType?: TeamEventType;
  scheduledTime?: string;
  endTime?: string;
  locationName?: string;
  locationCategory?: PracticeVenueCategory;
  description?: string;
  externalSource?: ExternalTeamPlatform;
  liveResultsUrl?: string;
  liveResultsLabel?: string;
  meetDelayMinutes?: number;
  busDepartureTime?: string;
  curatedAlbumLinks?: CuratedMeetAlbumLink[];
}

export interface PublicTeamHubUnofficialSplitItem {
  id: string;
  date: string;
  meetName: string;
  eventLabel: string;
  athleteDisplayName: string;
  displayTime: string;
  lapSplitsSecs: number[];
  lapSplitDistanceMeters?: number;
  timingLabel: 'Hand-Timed';
  capturedByName?: string;
}

export interface PublicTeamHubAthleteResultItem {
  date: string;
  meetName: string;
  eventLabel: string;
  eventDistanceMeters: number;
  displayFatTime: string;
  fatTimeSecs: number;
  placeFinish?: string;
  vdotScore: number;
  platform: OfficialRacePlatform;
  trackType: OfficialTrackSurface;
  sourceUrl?: string;
}

export interface PublicTeamHubFieldPrItem {
  id: string;
  membershipId?: string;
  displayName: string;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  graduationYear?: number;
  squadGroup?: string;
  eventCode: FieldEventCode;
  eventLabel: string;
  bestMarkMeters?: number;
  displayMark: string;
  windMps?: number;
  isWindAided?: boolean;
  multiPoints?: number;
  meetName?: string;
  date: string;
}

export interface PublicTeamHubRosterEntry {
  membershipId: string;
  name: string;
  squadGroup: string;
  eventGroup?: CoachEventGroup;
  graduationYear?: number;
  genderDivision?: 'M' | 'F' | 'NONBINARY';
  seedMarkOrFtp?: string;
  externalSource?: ExternalTeamPlatform;
  externalAthleteId?: string;
  externalProfileUrl?: string;
  officialResults: PublicTeamHubAthleteResultItem[];
  fieldPrs?: PublicTeamHubFieldPrItem[];
}

export interface PublicTeamHubPayload {
  found: boolean;
  error?: string;
  brand?: {
    teamId: string;
    slug: string;
    joinCode?: string;
    name: string;
    shortName: string;
    mascotOrMotto?: string;
    orgType: TeamOrgType;
    primarySport: 'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid';
    logoDataUrl?: string;
    primaryHex: string;
    secondaryHex: string;
    defaultSafeSportShield: boolean;
    coachDisplayName: string;
    timezone?: string;
    externalSync?: TeamExternalSyncConfig;
  };
  upcomingMeets: PublicTeamHubMeetItem[];
  recentSchedule: PublicTeamHubMeetItem[];
  rosterLeaderboard: PublicTeamHubRosterEntry[];
  fieldLeaderboard?: PublicTeamHubFieldPrItem[];
  unofficialStopwatchSplits?: PublicTeamHubUnofficialSplitItem[];
  announcements?: Array<
    Pick<TeamAnnouncementRecord, 'id' | 'title' | 'body' | 'category' | 'createdAt'>
  >;
  stats: {
    athleteCount: number;
    meetCount: number;
    officialResultCount: number;
    fieldPrCount?: number;
  };
}

export type TeamInjuryRtpStage = 'OUT' | 'MODIFIED' | 'LIMITED' | 'CLEARED';

export interface TeamInjuryCaseRecord {
  id: string;
  teamId: string;
  membershipId: string;
  athleteName: string;
  bodyRegion: NonNullable<SessionCheckInRecord['painArea']>;
  severity: 'LOW' | 'MODERATE' | 'HIGH';
  rtpStage: TeamInjuryRtpStage;
  restrictions: string;
  coachGuidance: string;
  privateClinicalNotes?: string;
  targetReturnDate?: string;
  createdAt: string;
  updatedAt: string;
  updatedBySid?: string;
  updatedByName?: string;
}

export type TeamBillingPlanCode =
  | 'FREE_FOUNDING'
  | 'HS_250'
  | 'COLLEGIATE_1200'
  | 'DISTRICT_2000';

export type TeamBillingStatus =
  | 'PILOT'
  | 'PO_ISSUED'
  | 'ACTIVE_PAID'
  | 'RENEWAL_DUE'
  | 'PAST_DUE';

export interface SchoolPoInvoiceRecord {
  invoiceNumber: string;
  planCode: TeamBillingPlanCode;
  amountUsd: number;
  schoolOrDistrictName: string;
  poNumber?: string;
  billingContactEmail: string;
  issuedAt: string;
  dueDate: string;
  status: 'ISSUED' | 'PAID' | 'VOID';
  paidAt?: string;
}

export interface TeamBillingSummary {
  planCode: TeamBillingPlanCode;
  status: TeamBillingStatus;
  stripeConfigured?: boolean;
  billingCycleEndIso?: string;
  poNumber?: string;
  schoolOrDistrictName?: string;
  billingContactEmail?: string;
  poInvoices?: SchoolPoInvoiceRecord[];
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  updatedAt?: string;
}

export interface DistrictSchoolRollupItem {
  teamId: string;
  teamName: string;
  shortName: string;
  orgType: TeamOrgType;
  districtName?: string;
  myRole: TeamMemberRole;
  totalAthletes: number;
  activeAthletes: number;
  totalCoachesAndStaff: number;
  watchConnectedAthletes: number;
  activeAtInjuries: number;
  modifiedAttendanceToday: number;
  safeSportRedFlags: number;
  safeSportAmberFlags: number;
  safeSportShieldEnabled: boolean;
  guardianCcEnabled: boolean;
  minorAthleteCount: number;
  parentConsentAcknowledgedCount: number;
  guardianCcCompliancePct: number;
  caraTrackedAthletes: number;
  avgCaraHours7d: number;
  maxCaraHours7d: number;
  caraOverCapCount: number;
  caraWarningCount: number;
  billingPlanCode: TeamBillingPlanCode;
  billingStatus: TeamBillingStatus;
  billingSchoolOrDistrictName?: string;
  poNumber?: string;
  billingCycleEndIso?: string;
  renewalAlert: boolean;
  latestInvoice?: SchoolPoInvoiceRecord;
}

export interface DistrictOverviewReport {
  generatedAt: string;
  districtFilter?: string;
  availableDistrictNames: string[];
  hasDistrictPlan: boolean;
  totals: {
    schoolCount: number;
    totalAthletes: number;
    activeAthletes: number;
    totalCoachesAndStaff: number;
    activeAtInjuries: number;
    modifiedAttendanceToday: number;
    safeSportRedFlags: number;
    safeSportAmberFlags: number;
    minorAthleteCount: number;
    parentConsentAcknowledgedCount: number;
    overallGuardianCcCompliancePct: number;
    caraOverCapCount: number;
    caraWarningCount: number;
    avgCaraHours7d: number;
    schoolsNeedingRenewal: number;
    totalAnnualCommittedUsd: number;
  };
  schools: DistrictSchoolRollupItem[];
}

export interface TeamSummaryWithRole {
  brand: TeamBrandConfig;
  myRole: TeamMemberRole;
  mySquadGroup: string;
  myEventGroup?: CoachEventGroup;
  myCoachEventGroups?: CoachEventGroup[];
  myCoachSpecialtyTitle?: string;
  myAssignedAthleteMembershipIds?: string[];
  myLinkedChildMembershipIds?: string[];
  myMembershipId: string;
  totalInvited: number;
  openedCount: number;
  activeCount: number;
  watchConnectedCount: number;
  memberships: TeamMembershipRecord[];
  broadcastWorkouts: TeamBroadcastWorkout[];
  workoutLibrary?: TeamWorkoutLibraryTemplate[];
  workoutComments?: TeamWorkoutComment[];
  guardianSafetyAlerts?: GuardianSafetyAlertRecord[];
  attendanceByDate?: Record<string, Record<string, TeamAttendanceRecord>>;
  announcements?: TeamAnnouncementRecord[];
  fieldMarkLogs?: FieldEventLogRecord[];
  fieldMarkLogsTotalCount?: number;
  meetDayPackets?: MeetDayPacketRecord[];
  delegatedTimingSessions?: DelegatedTimingSessionRecord[];
  pendingTimingSubmissions?: DelegatedSplitSubmissionRecord[];
  myDelegatedTimingAssignments?: DelegatedTimingSessionRecord[];
  myMeetDaySchedule?: AthleteOwnMeetScheduleItem[];
  injuryCases?: TeamInjuryCaseRecord[];
  billing?: TeamBillingSummary;
  teamMessages?: TeamMessageRecord[];
  messagingPolicy?: TeamMessagingPolicy;
  customSubgroups?: TeamCustomSubgroup[];
}

export interface TeamInvitePreviewPayload {
  found: boolean;
  brand?: TeamBrandConfig;
  membership?: {
    membershipId: string;
    invitedName: string;
    invitedEmail?: string;
    parentGuardianEmail?: string;
    squadGroup: string;
    role: TeamMemberRole;
    coachSpecialtyTitle?: string;
    isMinorU18: boolean;
    birthYear?: number;
    parentConsentStatus?: ParentConsentStatus;
    seedMarkOrFtp?: string;
  };
}

export type FieldEventCode =
  | 'LJ'
  | 'TJ'
  | 'HJ'
  | 'PV'
  | 'SP'
  | 'DISCUS'
  | 'JAVELIN'
  | 'HAMMER'
  | 'PENT'
  | 'HEPT'
  | 'DEC';

export type FieldAttemptOutcome = 'MARK' | 'FOUL' | 'PASS' | 'CLEAR' | 'MISS';

export interface FieldTrialEntry {
  attemptNumber: number;
  outcome: FieldAttemptOutcome;
  markMeters?: number;
  barHeightMeters?: number;
  windMps?: number;
  round?: 'PRELIM' | 'FINAL';
  note?: string;
}

export interface FieldEventLogRecord {
  id: string;
  teamId?: string;
  membershipId?: string;
  athleteName: string;
  date: string;
  eventCode: FieldEventCode;
  eventGroup: CoachEventGroup;
  isCompetition: boolean;
  meetOrPracticeTitle: string;
  flightName?: string;
  implementSpec?: string;
  poleSpec?: string;
  approachSteps?: number;
  attempts: FieldTrialEntry[];
  bestMarkMeters?: number;
  bestWindLegalMeters?: number;
  bestMarkWindMps?: number;
  isWindAidedBest?: boolean;
  isNoHeight?: boolean;
  missesAtClearingHeight?: number;
  totalVerticalMisses?: number;
  placeRank?: number;
  advancedToFinals?: boolean;
  multiPoints?: number;
  rpe?: number;
  clientBatchId?: string;
  createdAt: string;
}

export type TeamAttendanceStatus =
  | 'PRESENT'
  | 'LATE'
  | 'EXCUSED'
  | 'ABSENT'
  | 'INJURED_MODIFIED';

export type TeamAttendanceMethod = 'COACH_MANUAL' | 'GPS_GEOFENCE';

export interface TeamAttendanceRecord {
  date: string;
  eventId?: string;
  membershipId: string;
  status: TeamAttendanceStatus;
  note?: string;
  checkedInAt?: string;
  verifiedOnSite?: boolean;
  distanceMeters?: number; // Rounded integer meters only — never coordinates
  venueId?: string;
  venueName?: string;
  method?: TeamAttendanceMethod;
  updatedAt: string;
  updatedBySid?: string;
}
