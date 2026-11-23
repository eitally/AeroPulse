import React, { createContext, useContext } from 'react';
import type {
  AthletePrivacySettings,
  CoachChatMessage,
  CoachWorkspaceSubTab,
  ConnectedAthleteRecord,
  TeamMessageChannelScope,
  TeamSummaryWithRole,
  UnifiedWellnessDay,
} from '../types';
import type { SavedStopwatchEntry } from '../components/TracksideStopwatchView';
import type {
  StopwatchOutboxFlushResult,
  StopwatchSaveResult,
} from '../utils/stopwatchTeamSync';

export interface TeamCoachContextValue {
  coachSubTab: CoachWorkspaceSubTab;
  setCoachSubTab: (tab: CoachWorkspaceSubTab) => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  combinedRoster: ConnectedAthleteRecord[];
  activeViewedAthleteId: string;
  primaryAthleteDisplayName: string;
  selfInviteCode: string;
  selfLatestWellness: UnifiedWellnessDay | null;
  effectiveSelfPrivacySettings: AthletePrivacySettings;
  onUpdateSelfPrivacy: React.Dispatch<React.SetStateAction<AthletePrivacySettings>>;
  onSelectAthleteViewportFromWorkspace: (athleteId: string) => void;
  onSelectAthleteViewportFromModal: (athleteId: string) => void;
  onSelectActiveTeam: (teamId: string | null) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], preferredActiveId?: string | null) => void;
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
  onOpenPublicTeamHub?: (slugOrCode: string) => void;
  onOpenCoachGuide?: () => void;
  onOpenTeamMessages?: (scope?: TeamMessageChannelScope) => void;
  onOpenFullScreenStopwatch: () => void;
  onOpenCoachWorkspace: (subTab?: CoachWorkspaceSubTab) => void;
  handleSaveStopwatchActivities: (
    entries: SavedStopwatchEntry[]
  ) => Promise<StopwatchSaveResult> | StopwatchSaveResult | number;
  handleFlushStopwatchOutbox?: () => Promise<StopwatchOutboxFlushResult>;
  chatMessages: CoachChatMessage[];
  onSendChatMessage: (userText: string) => Promise<void>;
  isSendingChat: boolean;
  onCancelSendChat: () => void;
  coachDraftPrompt: string;
  onClearDraftPrompt: () => void;
  onOpenAICoachFromGuide: (prompt?: string) => void;
}

const TeamCoachContext = createContext<TeamCoachContextValue | null>(null);

export const TeamCoachProvider: React.FC<
  React.PropsWithChildren<{ value: TeamCoachContextValue }>
> = ({ value, children }) => (
  <TeamCoachContext.Provider value={value}>{children}</TeamCoachContext.Provider>
);

/** Reads coach workspace, roster/team state, stopwatch persistence, and AI Coach drawer state. */
export function useTeamCoach(): TeamCoachContextValue {
  const ctx = useContext(TeamCoachContext);
  if (!ctx) {
    throw new Error('useTeamCoach must be used inside a TeamCoachProvider');
  }
  return ctx;
}
