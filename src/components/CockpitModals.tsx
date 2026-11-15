import React, { Suspense, lazy } from 'react';
import type { RosterTab } from './AthleteRosterModal';
import type {
  ActiveTab,
  AthleteProfile,
  AthletePrivacySettings,
  CoachChatMessage,
  ConnectedAthleteRecord,
  ConnectionStatus,
  DistanceUnit,
  MapTileProvider,
  PlannedWorkoutEvent,
  StravaSyncPolicy,
  StravaSyncWindow,
  TeamSummaryWithRole,
  UnifiedActivity,
  UnifiedWellnessDay,
} from '../types';

const AICoachDrawer = lazy(() =>
  import('./AICoachDrawer').then((m) => ({ default: m.AICoachDrawer }))
);
const DataSourcesModal = lazy(() =>
  import('./DataSourcesModal').then((m) => ({ default: m.DataSourcesModal }))
);
const AthleteProfileModal = lazy(() =>
  import('./AthleteProfileModal').then((m) => ({ default: m.AthleteProfileModal }))
);
const OfficialRaceModal = lazy(() =>
  import('./OfficialRaceModal').then((m) => ({ default: m.OfficialRaceModal }))
);
const AthleteRosterModal = lazy(() =>
  import('./AthleteRosterModal').then((m) => ({ default: m.AthleteRosterModal }))
);
const UserGuideModal = lazy(() =>
  import('./UserGuideModal').then((m) => ({ default: m.UserGuideModal }))
);

export interface CockpitModalsProps {
  // AI Coach Drawer
  isCoachDrawerOpen: boolean;
  onCloseCoachDrawer: () => void;
  activeViewName: ActiveTab;
  latestWellness: UnifiedWellnessDay | null;
  chatMessages: CoachChatMessage[];
  onSendChatMessage: (userText: string) => Promise<void>;
  isSendingChat: boolean;
  onCancelSendChat: () => void;
  coachDraftPrompt: string;
  onClearDraftPrompt: () => void;
  hasGeminiKey: boolean;
  onSaveGeminiApiKey: (key: string) => Promise<void>;
  onScheduleProposedWorkout: (workout: Partial<PlannedWorkoutEvent>) => Promise<void>;

  // Athlete Profile Modal
  isProfileModalOpen: boolean;
  onCloseProfileModal: () => void;
  effectiveAthleteProfile: AthleteProfile;
  distanceUnit: DistanceUnit;
  intervalsConnected: boolean;
  isSyncingProfile: boolean;
  onSyncProfileFromRemote: () => Promise<void>;
  onSaveProfileOverride: (updated: AthleteProfile) => Promise<void>;

  // Data Sources Modal
  isDataSourcesOpen: boolean;
  onCloseDataSources: () => void;
  connectionStatus: ConnectionStatus;
  onConnectIntervals: (athleteId: string, apiKey: string) => Promise<void>;
  onLaunchIntervalsOAuth?: () => Promise<void>;
  onDisconnectIntervals: () => Promise<void>;
  onLaunchWahooOAuth?: () => Promise<void>;
  onDisconnectWahoo?: () => Promise<void>;
  onLaunchPolarOAuth?: () => Promise<void>;
  onDisconnectPolar?: () => Promise<void>;
  onDisconnectGarmin: () => Promise<void>;
  onDisconnectStrava: () => void;
  onUpdateStravaSyncPolicy?: (
    windowChoice: StravaSyncWindow,
    importProfileAndGear?: boolean
  ) => Promise<StravaSyncPolicy | null>;
  onSaveStravaCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  onLaunchStravaOAuth: (mode?: 'cloud' | 'localhost') => Promise<void>;
  onExchangeStravaCode: (codeOrUrl: string) => Promise<void>;
  onSaveStravaDirectToken: (refreshToken: string, accessToken?: string) => Promise<void>;
  onSaveMapTileConfig: (provider: MapTileProvider, apiKey: string) => Promise<void>;
  onExportBundle: () => Promise<{ bundle: string; envText: string } | null>;
  onImportBundle: (bundleOrEnv: string) => Promise<void>;
  onSyncNow: (fullHistory?: boolean, explicitWindow?: StravaSyncWindow) => Promise<void>;
  isSyncing: boolean;
  syncError: string | null;
  idbSavedAt: string | null;
  persistedWorkoutCount: number;
  onRebuildPersistedArchive: () => Promise<void>;
  effectiveActivities: UnifiedActivity[];
  onImportBatchActivities: (newActs: UnifiedActivity[]) => void;

  // Official Race Modal
  isOfficialRaceModalOpen: boolean;
  onCloseOfficialRaceModal: () => void;
  onImportOfficialRaces: (races: UnifiedActivity[]) => void;

  // Athlete Roster Modal
  isRosterModalOpen: boolean;
  onCloseRosterModal: () => void;
  primaryAthleteDisplayName: string;
  selfInviteCode: string;
  selfLatestWellness: UnifiedWellnessDay | null;
  effectiveSelfPrivacySettings: AthletePrivacySettings;
  onUpdateSelfPrivacy: React.Dispatch<React.SetStateAction<AthletePrivacySettings>>;
  combinedRoster: ConnectedAthleteRecord[];
  activeViewedAthleteId: string;
  onSelectAthleteViewport: (id: string) => void;
  onApproveAthleteRequest: (id: string, role: 'COACH_EDIT' | 'FRIEND_VIEW') => void;
  onRemoveOrDeclineAthlete: (id: string) => void;
  onToggleAthleteRole: (id: string) => void;
  onAddFollowByInviteOrName: (
    query: string,
    role: 'COACH_EDIT' | 'FRIEND_VIEW',
    specialty: 'Running' | 'Cycling'
  ) => void;
  onPushCoachWorkout: (
    athleteId: string,
    workout: {
      date: string;
      name: string;
      sportCategory: 'Running' | 'Cycling';
      plannedDurationSecs: number;
      plannedLoad: number;
      workoutSyntax: string;
      description: string;
    }
  ) => void;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  resendConfigured: boolean;
  rosterInitialTab: RosterTab;
  onSelectActiveTeam: (teamId: string | null) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], preferredActiveId?: string | null) => void;
  onOpenFullScreenStopwatch?: () => void;

  // User Guide Modal
  showMetricsGuide: boolean;
  onCloseMetricsGuide: () => void;
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenDataSourcesFromGuide: () => void;
  onOpenRosterModalFromGuide: () => void;
  onOpenProfileModalFromGuide: () => void;
  onOpenOfficialRaceModalFromGuide: () => void;
  onOpenAICoachFromGuide: (prompt?: string) => void;
}

export const CockpitModals: React.FC<CockpitModalsProps> = ({
  isCoachDrawerOpen,
  onCloseCoachDrawer,
  activeViewName,
  latestWellness,
  chatMessages,
  onSendChatMessage,
  isSendingChat,
  onCancelSendChat,
  coachDraftPrompt,
  onClearDraftPrompt,
  hasGeminiKey,
  onSaveGeminiApiKey,
  onScheduleProposedWorkout,

  isProfileModalOpen,
  onCloseProfileModal,
  effectiveAthleteProfile,
  distanceUnit,
  intervalsConnected,
  isSyncingProfile,
  onSyncProfileFromRemote,
  onSaveProfileOverride,

  isDataSourcesOpen,
  onCloseDataSources,
  connectionStatus,
  onConnectIntervals,
  onLaunchIntervalsOAuth,
  onDisconnectIntervals,
  onLaunchWahooOAuth,
  onDisconnectWahoo,
  onLaunchPolarOAuth,
  onDisconnectPolar,
  onDisconnectGarmin,
  onDisconnectStrava,
  onUpdateStravaSyncPolicy,
  onSaveStravaCredentials,
  onLaunchStravaOAuth,
  onExchangeStravaCode,
  onSaveStravaDirectToken,
  onSaveMapTileConfig,
  onExportBundle,
  onImportBundle,
  onSyncNow,
  isSyncing,
  syncError,
  idbSavedAt,
  persistedWorkoutCount,
  onRebuildPersistedArchive,
  effectiveActivities,
  onImportBatchActivities,

  isOfficialRaceModalOpen,
  onCloseOfficialRaceModal,
  onImportOfficialRaces,

  isRosterModalOpen,
  onCloseRosterModal,
  primaryAthleteDisplayName,
  selfInviteCode,
  selfLatestWellness,
  effectiveSelfPrivacySettings,
  onUpdateSelfPrivacy,
  combinedRoster,
  activeViewedAthleteId,
  onSelectAthleteViewport,
  onApproveAthleteRequest,
  onRemoveOrDeclineAthlete,
  onToggleAthleteRole,
  onAddFollowByInviteOrName,
  onPushCoachWorkout,
  myTeams,
  activeTeamId,
  resendConfigured,
  rosterInitialTab,
  onSelectActiveTeam,
  onTeamsUpdated,
  onOpenFullScreenStopwatch,

  showMetricsGuide,
  onCloseMetricsGuide,
  onNavigateTab,
  onOpenDataSourcesFromGuide,
  onOpenRosterModalFromGuide,
  onOpenProfileModalFromGuide,
  onOpenOfficialRaceModalFromGuide,
  onOpenAICoachFromGuide,
}) => {
  return (
    <>
      {isCoachDrawerOpen && (
        <Suspense fallback={null}>
          <AICoachDrawer
            isOpen={isCoachDrawerOpen}
            onClose={onCloseCoachDrawer}
            activeViewName={activeViewName}
            latestWellness={latestWellness || undefined}
            chatMessages={chatMessages}
            onSendChatMessage={onSendChatMessage}
            isSendingChat={isSendingChat}
            onCancelSend={onCancelSendChat}
            initialDraftPrompt={coachDraftPrompt}
            onClearDraftPrompt={onClearDraftPrompt}
            hasGeminiKey={hasGeminiKey}
            onSaveGeminiApiKey={onSaveGeminiApiKey}
            onScheduleProposedWorkout={onScheduleProposedWorkout}
          />
        </Suspense>
      )}

      {isProfileModalOpen && (
        <Suspense fallback={null}>
          <AthleteProfileModal
            isOpen={isProfileModalOpen}
            onClose={onCloseProfileModal}
            athleteProfile={effectiveAthleteProfile}
            latestWellness={latestWellness || undefined}
            distanceUnit={distanceUnit}
            intervalsConnected={intervalsConnected}
            isSyncingProfile={isSyncingProfile}
            onSyncProfileFromRemote={onSyncProfileFromRemote}
            onSaveProfileOverride={onSaveProfileOverride}
          />
        </Suspense>
      )}

      {isDataSourcesOpen && (
        <Suspense fallback={null}>
          <DataSourcesModal
            isOpen={isDataSourcesOpen}
            onClose={onCloseDataSources}
            status={connectionStatus}
            onConnectIntervals={onConnectIntervals}
            onLaunchIntervalsOAuth={onLaunchIntervalsOAuth}
            onDisconnectIntervals={onDisconnectIntervals}
            onLaunchWahooOAuth={onLaunchWahooOAuth}
            onDisconnectWahoo={onDisconnectWahoo}
            onLaunchPolarOAuth={onLaunchPolarOAuth}
            onDisconnectPolar={onDisconnectPolar}
            onDisconnectGarmin={onDisconnectGarmin}
            onDisconnectStrava={onDisconnectStrava}
            onUpdateStravaSyncPolicy={onUpdateStravaSyncPolicy}
            onSaveStravaCredentials={onSaveStravaCredentials}
            onLaunchStravaOAuth={onLaunchStravaOAuth}
            onExchangeStravaCode={onExchangeStravaCode}
            onSaveStravaDirectToken={onSaveStravaDirectToken}
            onSaveMapTileConfig={onSaveMapTileConfig}
            onExportBundle={onExportBundle}
            onImportBundle={onImportBundle}
            onSyncNow={onSyncNow}
            isSyncing={isSyncing}
            errorMessage={syncError}
            idbSavedAt={idbSavedAt}
            persistedWorkoutCount={persistedWorkoutCount}
            onRebuildPersistedArchive={onRebuildPersistedArchive}
            existingActivities={effectiveActivities}
            onImportBatchActivities={onImportBatchActivities}
          />
        </Suspense>
      )}

      {isOfficialRaceModalOpen && (
        <Suspense fallback={null}>
          <OfficialRaceModal
            isOpen={isOfficialRaceModalOpen}
            onClose={onCloseOfficialRaceModal}
            athleteProfile={effectiveAthleteProfile}
            distanceUnit={distanceUnit}
            existingOfficialRaces={effectiveActivities.filter((a) => Boolean(a.officialRaceData))}
            onImportOfficialRaces={onImportOfficialRaces}
            onSaveProfileOverride={onSaveProfileOverride}
          />
        </Suspense>
      )}

      {isRosterModalOpen && (
        <Suspense fallback={null}>
          <AthleteRosterModal
            isOpen={isRosterModalOpen}
            onClose={onCloseRosterModal}
            selfName={primaryAthleteDisplayName}
            selfInviteCode={selfInviteCode}
            selfCtl={selfLatestWellness?.ctl ?? 0}
            selfAtl={selfLatestWellness?.atl ?? 0}
            selfTsb={selfLatestWellness?.tsb ?? 0}
            selfHrv={selfLatestWellness?.hrvRMSSD ?? 0}
            selfProfile={effectiveAthleteProfile}
            selfPrivacySettings={effectiveSelfPrivacySettings}
            onUpdateSelfPrivacy={onUpdateSelfPrivacy}
            roster={combinedRoster}
            activeAthleteId={activeViewedAthleteId}
            onSelectAthleteViewport={onSelectAthleteViewport}
            onApproveRequest={onApproveAthleteRequest}
            onRemoveOrDeclineAthlete={onRemoveOrDeclineAthlete}
            onToggleAthleteRole={onToggleAthleteRole}
            onAddFollowByInviteOrName={onAddFollowByInviteOrName}
            onPushCoachWorkout={onPushCoachWorkout}
            distanceUnit={distanceUnit}
            myTeams={myTeams}
            activeTeamId={activeTeamId}
            resendConfigured={resendConfigured}
            initialTab={rosterInitialTab}
            onSelectActiveTeam={onSelectActiveTeam}
            onTeamsUpdated={onTeamsUpdated}
            onOpenFullScreenStopwatch={onOpenFullScreenStopwatch}
          />
        </Suspense>
      )}

      {showMetricsGuide && (
        <Suspense fallback={null}>
          <UserGuideModal
            isOpen={showMetricsGuide}
            onClose={onCloseMetricsGuide}
            onNavigateTab={onNavigateTab}
            onOpenDataSources={() => {
              onCloseMetricsGuide();
              onOpenDataSourcesFromGuide();
            }}
            onOpenRosterModal={() => {
              onCloseMetricsGuide();
              onOpenRosterModalFromGuide();
            }}
            onOpenProfileModal={() => {
              onCloseMetricsGuide();
              onOpenProfileModalFromGuide();
            }}
            onOpenOfficialRaceModal={() => {
              onCloseMetricsGuide();
              onOpenOfficialRaceModalFromGuide();
            }}
            onOpenAICoach={(prompt) => {
              onCloseMetricsGuide();
              onOpenAICoachFromGuide(prompt);
            }}
          />
        </Suspense>
      )}
    </>
  );
};
