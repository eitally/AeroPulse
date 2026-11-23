import React, { createContext, useContext } from 'react';
import type {
  ConnectionStatus,
  DistanceUnit,
  MapTileProvider,
  StravaSyncPolicy,
  StravaSyncWindow,
  ThreshUser,
  UnifiedActivity,
} from '../types';

export interface SessionAuthContextValue {
  currentUser: ThreshUser | null;
  onUserUpdated: (user: ThreshUser) => void;
  onAccountDeleted: () => void;
  hasStandaloneAccount: boolean;
  connectionStatus: ConnectionStatus;
  hasGeminiKey: boolean;
  intervalsConnected: boolean;
  isSyncingProfile: boolean;
  isSyncing: boolean;
  syncError: string | null;
  idbSavedAt: string | null;
  persistedWorkoutCount: number;
  stravaSyncWindow?: StravaSyncWindow;
  isSampleDemoMode: boolean;
  plainLanguageMode: boolean;
  distanceUnit: DistanceUnit;
  resendConfigured: boolean;
  onConnectIntervals: (athleteId: string, apiKey: string) => Promise<void>;
  onLaunchIntervalsOAuth?: () => Promise<void>;
  onDisconnectIntervals: () => Promise<void>;
  onLaunchWahooOAuth?: () => Promise<void>;
  onDisconnectWahoo?: () => Promise<void>;
  onLaunchPolarOAuth?: () => Promise<void>;
  onDisconnectPolar?: () => Promise<void>;
  onLaunchGarminOAuth?: () => Promise<void>;
  onDisconnectGarmin: () => Promise<void>;
  onLaunchCorosOAuth?: () => Promise<void>;
  onDisconnectCoros?: () => Promise<void>;
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
  onSaveGeminiApiKey: (key: string) => Promise<void>;
  onExportBundle: () => Promise<{ bundle: string; envText: string } | null>;
  onImportBundle: (bundleOrEnv: string) => Promise<void>;
  onSyncNow: (fullHistory?: boolean, explicitWindow?: StravaSyncWindow) => Promise<void>;
  onSyncProfileFromRemote: () => Promise<void>;
  onRebuildPersistedArchive: () => Promise<void>;
  onImportBatchActivities: (newActs: UnifiedActivity[]) => void;
  onImportOfficialRaces: (races: UnifiedActivity[]) => void;
}

const SessionAuthContext = createContext<SessionAuthContextValue | null>(null);

export const SessionAuthProvider: React.FC<
  React.PropsWithChildren<{ value: SessionAuthContextValue }>
> = ({ value, children }) => (
  <SessionAuthContext.Provider value={value}>{children}</SessionAuthContext.Provider>
);

/** Reads authenticated session, connector status, and telemetry sync handlers. */
export function useSessionAuth(): SessionAuthContextValue {
  const ctx = useContext(SessionAuthContext);
  if (!ctx) {
    throw new Error('useSessionAuth must be used inside a SessionAuthProvider');
  }
  return ctx;
}
