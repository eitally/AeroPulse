import React, { Suspense } from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
import { useSessionAuth } from '../contexts/SessionAuthContext';
import { useTelemetryWorkspace } from '../contexts/TelemetryWorkspaceContext';
import { useTeamCoach } from '../contexts/TeamCoachContext';
import type { RosterTab } from './AthleteRosterModal';
import type { UserGuideChapterId } from './UserGuideModal';

const AICoachDrawer = lazyWithRetry(
  () => import('./AICoachDrawer').then((m) => ({ default: m.AICoachDrawer })),
  { chunkKey: 'AICoachDrawer' }
);
const DataSourcesModal = lazyWithRetry(
  () => import('./DataSourcesModal').then((m) => ({ default: m.DataSourcesModal })),
  { chunkKey: 'DataSourcesModal' }
);
const AthleteProfileModal = lazyWithRetry(
  () => import('./AthleteProfileModal').then((m) => ({ default: m.AthleteProfileModal })),
  { chunkKey: 'AthleteProfileModal' }
);
const OfficialRaceModal = lazyWithRetry(
  () => import('./OfficialRaceModal').then((m) => ({ default: m.OfficialRaceModal })),
  { chunkKey: 'OfficialRaceModal' }
);
const AthleteRosterModal = lazyWithRetry(
  () => import('./AthleteRosterModal').then((m) => ({ default: m.AthleteRosterModal })),
  { chunkKey: 'AthleteRosterModal' }
);
const UserGuideModal = lazyWithRetry(
  () => import('./UserGuideModal').then((m) => ({ default: m.UserGuideModal })),
  { chunkKey: 'UserGuideModal' }
);

export interface CockpitModalsProps {
  // AI Coach Drawer
  isCoachDrawerOpen: boolean;
  onCloseCoachDrawer: () => void;

  // Athlete Profile Modal
  isProfileModalOpen: boolean;
  onCloseProfileModal: () => void;

  // Data Sources Modal
  isDataSourcesOpen: boolean;
  onCloseDataSources: () => void;

  // Official Race Modal
  isOfficialRaceModalOpen: boolean;
  onCloseOfficialRaceModal: () => void;

  // Athlete Roster Modal
  isRosterModalOpen: boolean;
  onCloseRosterModal: () => void;
  rosterInitialTab: RosterTab;

  // User Guide Modal
  showMetricsGuide: boolean;
  guideInitialChapter?: UserGuideChapterId;
  onCloseMetricsGuide: () => void;
}

export const CockpitModals: React.FC<CockpitModalsProps> = ({
  isCoachDrawerOpen,
  onCloseCoachDrawer,
  isProfileModalOpen,
  onCloseProfileModal,
  isDataSourcesOpen,
  onCloseDataSources,
  isOfficialRaceModalOpen,
  onCloseOfficialRaceModal,
  isRosterModalOpen,
  onCloseRosterModal,
  rosterInitialTab,
  showMetricsGuide,
  guideInitialChapter,
  onCloseMetricsGuide,
}) => {
  const {
    currentUser,
    onUserUpdated,
    onAccountDeleted,
    hasStandaloneAccount,
    connectionStatus,
    hasGeminiKey,
    intervalsConnected,
    isSyncingProfile,
    isSyncing,
    syncError,
    idbSavedAt,
    persistedWorkoutCount,
    distanceUnit,
    resendConfigured,
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
    onSaveGeminiApiKey,
    onExportBundle,
    onImportBundle,
    onSyncNow,
    onSyncProfileFromRemote,
    onRebuildPersistedArchive,
    onImportBatchActivities,
    onImportOfficialRaces,
  } = useSessionAuth();

  const {
    activeTab: activeViewName,
    setActiveTab: onNavigateTab,
    effectiveActivities,
    latestWellness,
    effectiveAthleteProfile,
    handleSaveProfileOverride: onSaveProfileOverride,
    handleScheduleProposedWorkout: onScheduleProposedWorkout,
    handleOpenDataSources: onOpenDataSourcesFromGuide,
    handleOpenRosterModal: onOpenRosterModalFromGuide,
    handleOpenProfileModal: onOpenProfileModalFromGuide,
    handleOpenOfficialRaceModal: onOpenOfficialRaceModalFromGuide,
  } = useTelemetryWorkspace();

  const {
    chatMessages,
    onSendChatMessage,
    isSendingChat,
    onCancelSendChat,
    coachDraftPrompt,
    onClearDraftPrompt,
    primaryAthleteDisplayName,
    selfInviteCode,
    selfLatestWellness,
    effectiveSelfPrivacySettings,
    onUpdateSelfPrivacy,
    combinedRoster,
    activeViewedAthleteId,
    onSelectAthleteViewportFromModal: onSelectAthleteViewport,
    onApproveAthleteRequest,
    onRemoveOrDeclineAthlete,
    onToggleAthleteRole,
    onAddFollowByInviteOrName,
    onPushCoachWorkout,
    myTeams,
    activeTeamId,
    onSelectActiveTeam,
    onTeamsUpdated,
    onOpenFullScreenStopwatch,
    onOpenCoachWorkspace,
    onOpenAICoachFromGuide,
  } = useTeamCoach();

  return (
    <WorkspaceErrorBoundary resetKey="cockpit-modals" fallbackTitle="Modal Needs Recovery">
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
            onOpenOfficialRaceModal={() => {
              onCloseProfileModal();
              onOpenOfficialRaceModalFromGuide();
            }}
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
            hasStandaloneAccount={hasStandaloneAccount}
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
            currentUser={currentUser}
            onUserUpdated={onUserUpdated}
            onAccountDeleted={onAccountDeleted}
            onOpenFullScreenStopwatch={onOpenFullScreenStopwatch}
            onOpenCoachWorkspace={onOpenCoachWorkspace ? () => onOpenCoachWorkspace('ROSTER') : undefined}
          />
        </Suspense>
      )}

      {showMetricsGuide && (
        <Suspense fallback={null}>
          <UserGuideModal
            isOpen={showMetricsGuide}
            onClose={onCloseMetricsGuide}
            initialChapter={guideInitialChapter}
            onNavigateTab={onNavigateTab}
            onOpenCoachWorkspace={(subTab) => {
              onCloseMetricsGuide();
              onOpenCoachWorkspace?.(subTab);
            }}
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
    </WorkspaceErrorBoundary>
  );
};
