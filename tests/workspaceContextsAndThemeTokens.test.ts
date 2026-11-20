import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  SessionAuthProvider,
  useSessionAuth,
  type SessionAuthContextValue,
} from '../src/contexts/SessionAuthContext';
import {
  TelemetryWorkspaceProvider,
  useTelemetryWorkspace,
  type TelemetryWorkspaceContextValue,
} from '../src/contexts/TelemetryWorkspaceContext';
import {
  TeamCoachProvider,
  useTeamCoach,
  type TeamCoachContextValue,
} from '../src/contexts/TeamCoachContext';
import {
  PublicTeamHubPage,
  formatPublicPlaceFinish,
} from '../src/components/PublicTeamHubPage';
import { DEFAULT_SELF_PRIVACY_SETTINGS } from '../src/data/athleteRosterData';
import { buildPresetExternalTeamSummary } from '../src/utils/athleticNetAndTfrrsEngine';
import { buildCleanRoomPublicHubFromTeamSummary } from '../src/utils/publicTeamHubRoute';
import { buildCompleteAthleteProfile } from '../src/utils/telemetryStorage';

const ROOT = process.cwd();

function buildSessionStub(overrides: Partial<SessionAuthContextValue> = {}): SessionAuthContextValue {
  const asyncNoop = async () => {};
  return {
    currentUser: null,
    onUserUpdated: () => {},
    onAccountDeleted: () => {},
    hasStandaloneAccount: false,
    connectionStatus: {
      mode: 'SANDBOX_CALIBRATION',
      stravaConnected: false,
      stravaSource: 'NONE',
      garminConnected: false,
      intervalsConnected: false,
      intervalsAthleteId: '',
      intervalsSource: 'NONE',
      hasGeminiServerKey: false,
      devCallbackUrl: '',
      sharedCallbackUrl: '',
      currentOriginCallbackUrl: '',
      lastSyncedAt: undefined,
    },
    hasGeminiKey: false,
    intervalsConnected: false,
    isSyncingProfile: false,
    isSyncing: false,
    syncError: null,
    idbSavedAt: null,
    persistedWorkoutCount: 0,
    isSampleDemoMode: false,
    plainLanguageMode: false,
    distanceUnit: 'mi',
    resendConfigured: false,
    onConnectIntervals: asyncNoop,
    onDisconnectIntervals: asyncNoop,
    onDisconnectGarmin: asyncNoop,
    onDisconnectStrava: () => {},
    onSaveStravaCredentials: asyncNoop,
    onLaunchStravaOAuth: asyncNoop,
    onExchangeStravaCode: asyncNoop,
    onSaveStravaDirectToken: asyncNoop,
    onSaveMapTileConfig: asyncNoop,
    onSaveGeminiApiKey: asyncNoop,
    onExportBundle: async () => null,
    onImportBundle: asyncNoop,
    onSyncNow: asyncNoop,
    onSyncProfileFromRemote: asyncNoop,
    onRebuildPersistedArchive: asyncNoop,
    onImportBatchActivities: () => {},
    onImportOfficialRaces: () => {},
    ...overrides,
  };
}

function buildTelemetryStub(
  overrides: Partial<TelemetryWorkspaceContextValue> = {}
): TelemetryWorkspaceContextValue {
  const asyncNoop = async () => {};
  return {
    activeTab: 'fitness',
    setActiveTab: () => {},
    effectiveActivities: [],
    effectiveWellnessDays: [],
    latestWellness: null,
    effectivePlannedEvents: [],
    effectiveTargetGoals: [],
    effectiveAnnualMileageGoals: [],
    effectiveGearItems: [],
    effectiveSessionCheckIns: [],
    envFilter: 'COMBINED',
    setEnvFilter: () => {},
    selectedSport: 'ALL',
    setSelectedSport: () => {},
    athleteFtp: 280,
    latestWeightKg: 66,
    latestCtl: 54,
    effectiveAthleteProfile: buildCompleteAthleteProfile({ name: 'Taylor Runner' }),
    selectedActivity: null,
    benchmarkSegments: [],
    isScanningSegments: false,
    isHydratingRoutes: false,
    handleSelectActivityAndOpenTab: () => {},
    handleCalendarCreatePlannedEvent: asyncNoop,
    handleUpdatePlannedEvent: asyncNoop,
    handleDeletePlannedEvent: asyncNoop,
    handleDeletePlanBlock: asyncNoop,
    handleBatchCreatePlannedEvents: asyncNoop,
    handleCreatePlannedEvent: asyncNoop,
    handleScheduleProposedWorkout: asyncNoop,
    handleSelectActivity: () => {},
    loadStreamsForActivity: asyncNoop,
    handleScanMoreSegments: asyncNoop,
    handleHydrateMoreRoutes: asyncNoop,
    handleToggleActivityKudos: asyncNoop,
    handleAddActivityComment: asyncNoop,
    handleImportSingleParsedActivity: () => {},
    handleImportMultipleParsedActivities: () => {},
    handleUpdateAnnualMileageGoal: () => {},
    handleAddTargetGoal: () => {},
    handleDeleteTargetGoal: () => {},
    handleSaveProfileOverride: asyncNoop,
    handleOpenTodayTab: () => {},
    handleOpenActivitiesTab: () => {},
    handleOpenGoalsTab: () => {},
    handleSwitchToCalendarTab: () => {},
    handleOpenProfileModal: () => {},
    handleOpenOfficialRaceModal: () => {},
    handleOpenDataSources: () => {},
    handleOpenRosterModal: () => {},
    handleOpenCoachWithPrompt: () => {},
    ...overrides,
  };
}

function buildTeamCoachStub(overrides: Partial<TeamCoachContextValue> = {}): TeamCoachContextValue {
  return {
    coachSubTab: 'CLIPBOARD',
    setCoachSubTab: () => {},
    activeTeam: null,
    myTeams: [],
    activeTeamId: null,
    combinedRoster: [],
    activeViewedAthleteId: 'SELF',
    primaryAthleteDisplayName: 'Taylor Runner',
    selfInviteCode: 'THRESH-01',
    selfLatestWellness: null,
    effectiveSelfPrivacySettings: DEFAULT_SELF_PRIVACY_SETTINGS,
    onUpdateSelfPrivacy: () => {},
    onSelectAthleteViewportFromWorkspace: () => {},
    onSelectAthleteViewportFromModal: () => {},
    onSelectActiveTeam: () => {},
    onTeamsUpdated: () => {},
    onApproveAthleteRequest: () => {},
    onRemoveOrDeclineAthlete: () => {},
    onToggleAthleteRole: () => {},
    onAddFollowByInviteOrName: () => {},
    onPushCoachWorkout: () => {},
    onOpenFullScreenStopwatch: () => {},
    onOpenCoachWorkspace: () => {},
    handleSaveStopwatchActivities: () => 0,
    chatMessages: [],
    onSendChatMessage: async () => {},
    isSendingChat: false,
    onCancelSendChat: () => {},
    coachDraftPrompt: '',
    onClearDraftPrompt: () => {},
    onOpenAICoachFromGuide: () => {},
    ...overrides,
  };
}

describe('Sprint 3B: Workspace Contexts, @theme Tokens & Public Hub Place Formatting', () => {
  it('throws descriptive errors when context hooks are called outside their providers', () => {
    const SessionProbe: React.FC = () => {
      useSessionAuth();
      return null;
    };
    const TelemetryProbe: React.FC = () => {
      useTelemetryWorkspace();
      return null;
    };
    const TeamProbe: React.FC = () => {
      useTeamCoach();
      return null;
    };

    expect(() => renderToStaticMarkup(React.createElement(SessionProbe))).toThrow(
      'useSessionAuth must be used inside a SessionAuthProvider'
    );
    expect(() => renderToStaticMarkup(React.createElement(TelemetryProbe))).toThrow(
      'useTelemetryWorkspace must be used inside a TelemetryWorkspaceProvider'
    );
    expect(() => renderToStaticMarkup(React.createElement(TeamProbe))).toThrow(
      'useTeamCoach must be used inside a TeamCoachProvider'
    );
  });

  it('provides session, telemetry, and team coach context values cleanly to consumers', () => {
    const CombinedConsumer: React.FC = () => {
      const { distanceUnit } = useSessionAuth();
      const { activeTab, latestCtl } = useTelemetryWorkspace();
      const { primaryAthleteDisplayName, coachSubTab } = useTeamCoach();
      return React.createElement(
        'div',
        null,
        `${primaryAthleteDisplayName}|${distanceUnit}|${activeTab}|${latestCtl}|${coachSubTab}`
      );
    };

    const html = renderToStaticMarkup(
      React.createElement(
        SessionAuthProvider,
        { value: buildSessionStub({ distanceUnit: 'km' }) },
        React.createElement(
          TelemetryWorkspaceProvider,
          { value: buildTelemetryStub({ activeTab: 'coach', latestCtl: 68 }) },
          React.createElement(
            TeamCoachProvider,
            {
              value: buildTeamCoachStub({
                primaryAthleteDisplayName: 'Coach Morales',
                coachSubTab: 'ROSTER',
              }),
            },
            React.createElement(CombinedConsumer)
          )
        )
      )
    );

    expect(html).toContain('Coach Morales|km|coach|68|ROSTER');
  });

  it('collapses drilled props across WorkspaceRouter, CockpitModals, and removes mode as any in App.tsx', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8');
    const modalsSrc = fs.readFileSync(path.join(ROOT, 'src/components/CockpitModals.tsx'), 'utf8');
    const routerSrc = fs.readFileSync(path.join(ROOT, 'src/components/WorkspaceRouter.tsx'), 'utf8');

    expect(appSrc).toContain('<WorkspaceRouter />');
    expect(appSrc).not.toContain('handleLaunchStravaOAuth(mode as any)');
    expect(routerSrc).toContain('export const WorkspaceRouter: React.FC = () =>');

    const modalPropsMatch = modalsSrc.match(
      /export interface CockpitModalsProps \{([\s\S]*?)\n\}/
    );
    expect(modalPropsMatch).not.toBeNull();
    const modalPropLines = modalPropsMatch![1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'));
    expect(modalPropLines.length).toBeLessThanOrEqual(16);
  });

  it('defines all 12 core Track Volt & Obsidian @theme tokens and eliminates top-12 raw hex Tailwind utilities', () => {
    const indexCss = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
    const requiredTokens = [
      '--color-ap-volt',
      '--color-ap-cobalt',
      '--color-ap-ink',
      '--color-ap-obsidian',
      '--color-ap-chalk',
      '--color-ap-muted',
      '--color-ap-muted-dark',
      '--color-ap-carbon',
      '--color-ap-turf',
      '--color-ap-edge',
      '--color-ap-edge-dark',
      '--color-ap-frame',
    ];
    for (const token of requiredTokens) {
      expect(indexCss).toContain(`${token}:`);
    }

    const excluded = new Set(['AeroPulseLogo.tsx', 'BrandGuidePage.tsx', 'CockpitFooter.tsx']);
    const targetHexes = new Set([
      '#15231B',
      '#C8FF00',
      '#101411',
      '#1C5436',
      '#93A39A',
      '#43584B',
      '#101B15',
      '#F4F7F4',
      '#2B543B',
      '#244331',
      '#080A09',
      '#2B5B3F',
    ]);
    const utilRe = /(?:^|[^A-Za-z0-9-])((?:bg|text|border|ring|from|via|to|fill|stroke|divide)-\[(#[0-9A-Fa-f]{6})\])/g;
    const leaks: string[] = [];

    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (p.endsWith('.tsx') && !excluded.has(ent.name)) {
          const src = fs.readFileSync(p, 'utf8');
          for (const m of src.matchAll(utilRe)) {
            if (targetHexes.has(m[2].toUpperCase())) {
              leaks.push(`${path.relative(ROOT, p)}:${m[1]}`);
            }
          }
        }
      }
    };
    walk(path.join(ROOT, 'src/components'));
    expect(leaks).toEqual([]);
  });

  it('formats PublicTeamHubPage race placeFinish labels without duplicate # on #10 or Leg #2', () => {
    expect(formatPublicPlaceFinish('#10')).toBe('#10');
    expect(formatPublicPlaceFinish('Leg #2')).toBe('Leg #2');
    expect(formatPublicPlaceFinish('3')).toBe('#3');
    expect(formatPublicPlaceFinish('Sample Mark')).toBe('Sample Mark');
    expect(formatPublicPlaceFinish('')).toBe('');

    const preset = buildPresetExternalTeamSummary('WILLOW_GLEN', 'Coach Morales');
    const hub = buildCleanRoomPublicHubFromTeamSummary(preset);
    const html = renderToStaticMarkup(
      React.createElement(PublicTeamHubPage, {
        slugOrCode: 'willow-glen-high-school-xc',
        isDark: false,
        onToggleDark: () => {},
        initialPayloadForTest: hub,
        onExitHub: () => {},
      })
    );
    expect(html).not.toContain('##');
    expect(html).not.toContain('#Leg #2');
  });
});
