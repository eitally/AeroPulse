/**
 * Centralized browser storage key registry and shared-device wipe helper (`RT-10`).
 * Zero DOM dependencies so it can run safely in browser and Vitest environments.
 */
export const STORAGE_KEYS = {
  // Auth & Session
  LOGGED_OUT: 'aeropulse_logged_out',
  AUTH_GATE_PASSED: 'aeropulse_auth_gate_passed',
  SESSION_TOKEN: 'aeropulse_session_token',
  STORE_OWNER_ATHLETE_ID: 'aeropulse_store_owner_athlete_id',
  CALIBRATED: 'aeropulse_calibrated_v1',
  OAUTH_JUST_CONNECTED: 'aeropulse_oauth_just_connected',
  OAUTH_RESULT: 'aeropulse_oauth_result_v1',

  // Provider Credentials & Identity
  STRAVA_ACCESS_TOKEN: 'aeropulse_strava_access_token',
  STRAVA_REFRESH_TOKEN: 'aeropulse_strava_refresh_token',
  STRAVA_EXPIRES_AT: 'aeropulse_strava_expires_at',
  STRAVA_CLIENT_ID: 'aeropulse_strava_client_id',
  STRAVA_CLIENT_SECRET: 'aeropulse_strava_client_secret',
  STRAVA_ATHLETE_ID: 'aeropulse_strava_athlete_id',
  STRAVA_ATHLETE_NAME: 'aeropulse_strava_athlete_name',
  STRAVA_ATHLETE_WEIGHT_KG: 'aeropulse_strava_athlete_weight_kg',
  STRAVA_ATHLETE_FTP: 'aeropulse_strava_athlete_ftp',
  STRAVA_SYNC_POLICY: 'aeropulse_strava_sync_policy',
  STRAVA_BACKFILL_DONE: 'aeropulse_strava_backfill_v4_done',
  STRAVA_BACKFILL_PREFIX: 'aeropulse_strava_backfill_v4_',
  INTERVALS_API_KEY: 'aeropulse_intervals_api_key',
  INTERVALS_ATHLETE_ID: 'aeropulse_intervals_athlete_id',
  INTERVALS_ATHLETE_NAME: 'aeropulse_intervals_athlete_name',
  GARMIN_PERSONAL_API_KEY: 'aeropulse_garmin_personal_api_key',
  GARMIN_BEARER_TOKEN: 'aeropulse_garmin_bearer_token',
  GARMIN_OAUTH1_TOKEN: 'aeropulse_garmin_oauth1_token',
  GARMIN_OAUTH1_SECRET: 'aeropulse_garmin_oauth1_secret',
  GARMIN_ATHLETE_NAME: 'aeropulse_garmin_athlete_name',
  WAHOO_CONNECTED: 'aeropulse_wahoo_connected',
  WAHOO_ATHLETE_ID: 'aeropulse_wahoo_athlete_id',
  WAHOO_ATHLETE_NAME: 'aeropulse_wahoo_athlete_name',
  POLAR_CONNECTED: 'aeropulse_polar_connected',
  POLAR_ATHLETE_ID: 'aeropulse_polar_athlete_id',
  POLAR_ATHLETE_NAME: 'aeropulse_polar_athlete_name',
  GEMINI_API_KEY: 'aeropulse_gemini_api_key',
  MAP_TILE_API_KEY: 'aeropulse_map_tile_api_key',
  MAP_TILE_PROVIDER: 'aeropulse_map_tile_provider',

  // User & Team Workspace Data
  TARGET_GOALS: 'aeropulse_target_goals',
  ANNUAL_MILEAGE_GOALS: 'aeropulse_annual_mileage_goals',
  SELF_PRIVACY_SETTINGS: 'aeropulse_self_privacy_settings',
  CONNECTED_ATHLETES: 'aeropulse_connected_athletes_v1',
  CUSTOM_CHARTS: 'aeropulse_custom_charts',
  DISMISS_STRAVA_BANNER: 'aeropulse_dismiss_strava_banner',
  MY_TEAMS: 'thresh_my_teams_v1',
  ACTIVE_TEAM_ID: 'thresh_active_team_id_v1',
  PERSONAL_MODE: 'thresh_personal_mode_v1',
  CLOUD_STATE_UPDATED_AT: 'thresh_cloud_state_updated_at',
  SESSION_CHECKINS: 'thresh_session_checkins_v1',
  PRIMARY_SPORT: 'thresh_primary_sport',
  QUICK_LOGS: 'thresh_quick_logs_v1',
  SAMPLE_DEMO_ACTIVE: 'thresh_sample_demo_active',
  DISMISS_WELCOME_FORK: 'thresh_dismiss_welcome_fork_v1',
  TODAY_DEEP_DIVE_OPEN: 'thresh_today_deep_dive_open',
  TRACKSIDE_STOPWATCH: 'thresh_trackside_stopwatch_v1',
  STOPWATCH_OUTBOX: 'thresh_stopwatch_outbox_v1',
  WALKON_STOPWATCH_LOGS: 'thresh_walkon_stopwatch_logs_v1',
  BEDTIME_REMINDER: 'thresh_bedtime_reminder_v1',
  PENDING_SHARED_WORKOUT: 'thresh_pending_shared_workout_v1',
  DAILY_SORENESS_PREFIX: 'thresh_daily_soreness_v1:',
  TEAM_VENUES_PREFIX: 'thresh_team_venues_v1:',

  // Session Storage
  PENDING_TEAM_JOIN: 'thresh_pending_team_join_v1',
  ONBOARDING_ROLE: 'thresh_onboarding_role',
  OPEN_PLAN_COHORT: 'thresh_open_plan_cohort',

  // Device Preferences (Preserved Across Sign Out)
  THEME_DARK: 'thresh_theme_dark',
  THEME_DAYTIME: 'thresh_daytime_palette',
  THEME_POLICY: 'thresh_sundown_policy',
  DUSK_MODE: 'thresh_dusk_mode',
  DISTANCE_UNIT: 'thresh_distance_unit',
  DISTANCE_UNIT_USER_SET: 'thresh_distance_unit_user_set',
  PLAIN_LANGUAGE: 'thresh_plain_language',
  STOPWATCH_SHORTCUTS: 'thresh_stopwatch_shortcuts_v1',
} as const;

export const DEVICE_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  STORAGE_KEYS.THEME_DARK,
  STORAGE_KEYS.THEME_DAYTIME,
  STORAGE_KEYS.THEME_POLICY,
  STORAGE_KEYS.DUSK_MODE,
  STORAGE_KEYS.DISTANCE_UNIT,
  STORAGE_KEYS.DISTANCE_UNIT_USER_SET,
  STORAGE_KEYS.PLAIN_LANGUAGE,
  STORAGE_KEYS.STOPWATCH_SHORTCUTS,
]);

export const USER_SCOPED_STORAGE_PREFIXES = ['aeropulse_', 'thresh_'] as const;

const EXPLICIT_USER_STORAGE_KEYS: readonly string[] = [
  STORAGE_KEYS.LOGGED_OUT,
  STORAGE_KEYS.AUTH_GATE_PASSED,
  STORAGE_KEYS.SESSION_TOKEN,
  STORAGE_KEYS.STORE_OWNER_ATHLETE_ID,
  STORAGE_KEYS.CALIBRATED,
  STORAGE_KEYS.OAUTH_JUST_CONNECTED,
  STORAGE_KEYS.OAUTH_RESULT,
  STORAGE_KEYS.STRAVA_ACCESS_TOKEN,
  STORAGE_KEYS.STRAVA_REFRESH_TOKEN,
  STORAGE_KEYS.STRAVA_EXPIRES_AT,
  STORAGE_KEYS.STRAVA_CLIENT_ID,
  STORAGE_KEYS.STRAVA_CLIENT_SECRET,
  STORAGE_KEYS.STRAVA_ATHLETE_ID,
  STORAGE_KEYS.STRAVA_ATHLETE_NAME,
  STORAGE_KEYS.STRAVA_ATHLETE_WEIGHT_KG,
  STORAGE_KEYS.STRAVA_ATHLETE_FTP,
  STORAGE_KEYS.STRAVA_SYNC_POLICY,
  STORAGE_KEYS.STRAVA_BACKFILL_DONE,
  STORAGE_KEYS.INTERVALS_API_KEY,
  STORAGE_KEYS.INTERVALS_ATHLETE_ID,
  STORAGE_KEYS.INTERVALS_ATHLETE_NAME,
  STORAGE_KEYS.GARMIN_PERSONAL_API_KEY,
  STORAGE_KEYS.GARMIN_BEARER_TOKEN,
  STORAGE_KEYS.GARMIN_OAUTH1_TOKEN,
  STORAGE_KEYS.GARMIN_OAUTH1_SECRET,
  STORAGE_KEYS.GARMIN_ATHLETE_NAME,
  STORAGE_KEYS.WAHOO_CONNECTED,
  STORAGE_KEYS.WAHOO_ATHLETE_ID,
  STORAGE_KEYS.WAHOO_ATHLETE_NAME,
  STORAGE_KEYS.POLAR_CONNECTED,
  STORAGE_KEYS.POLAR_ATHLETE_ID,
  STORAGE_KEYS.POLAR_ATHLETE_NAME,
  STORAGE_KEYS.GEMINI_API_KEY,
  STORAGE_KEYS.MAP_TILE_API_KEY,
  STORAGE_KEYS.MAP_TILE_PROVIDER,
  STORAGE_KEYS.TARGET_GOALS,
  STORAGE_KEYS.ANNUAL_MILEAGE_GOALS,
  STORAGE_KEYS.SELF_PRIVACY_SETTINGS,
  STORAGE_KEYS.CONNECTED_ATHLETES,
  STORAGE_KEYS.CUSTOM_CHARTS,
  STORAGE_KEYS.DISMISS_STRAVA_BANNER,
  STORAGE_KEYS.MY_TEAMS,
  STORAGE_KEYS.ACTIVE_TEAM_ID,
  STORAGE_KEYS.PERSONAL_MODE,
  STORAGE_KEYS.CLOUD_STATE_UPDATED_AT,
  STORAGE_KEYS.SESSION_CHECKINS,
  STORAGE_KEYS.PRIMARY_SPORT,
  STORAGE_KEYS.QUICK_LOGS,
  STORAGE_KEYS.SAMPLE_DEMO_ACTIVE,
  STORAGE_KEYS.DISMISS_WELCOME_FORK,
  STORAGE_KEYS.TODAY_DEEP_DIVE_OPEN,
  STORAGE_KEYS.TRACKSIDE_STOPWATCH,
  STORAGE_KEYS.STOPWATCH_OUTBOX,
  STORAGE_KEYS.WALKON_STOPWATCH_LOGS,
  STORAGE_KEYS.BEDTIME_REMINDER,
  STORAGE_KEYS.PENDING_SHARED_WORKOUT,
];

const EXPLICIT_USER_STORAGE_KEY_SET: ReadonlySet<string> = new Set(EXPLICIT_USER_STORAGE_KEYS);

function matchesUserPrefix(key: string): boolean {
  return USER_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function collectStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (typeof k === 'string') keys.push(k);
  }
  return keys;
}

/**
 * Unconditionally clears all user/credential/team browser storage keys on shared devices,
 * preserving only device UI/unit preferences (`DEVICE_PREFERENCE_KEYS`).
 */
export function clearAllUserBrowserStorage(options?: {
  preserveLoggedOutFlag?: boolean;
}): string[] {
  const removed = new Set<string>();

  if (typeof localStorage !== 'undefined') {
    try {
      const existingKeys = collectStorageKeys(localStorage);
      const candidates = new Set<string>([...EXPLICIT_USER_STORAGE_KEYS, ...existingKeys]);
      for (const key of candidates) {
        if (DEVICE_PREFERENCE_KEYS.has(key)) continue;
        if (EXPLICIT_USER_STORAGE_KEY_SET.has(key) || matchesUserPrefix(key)) {
          try {
            if (localStorage.getItem(key) !== null) {
              removed.add(key);
            }
            localStorage.removeItem(key);
          } catch {
            // ignore storage errors
          }
        }
      }
      if (options?.preserveLoggedOutFlag !== false) {
        try {
          localStorage.setItem(STORAGE_KEYS.LOGGED_OUT, '1');
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore storage enumeration failures
    }
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      const sessionKeys = collectStorageKeys(sessionStorage);
      for (const key of sessionKeys) {
        if (matchesUserPrefix(key)) {
          try {
            sessionStorage.removeItem(key);
            removed.add(`session:${key}`);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('thresh:trackside-stopwatch-sync'));
      window.dispatchEvent(new CustomEvent('thresh:stopwatch-outbox-updated'));
    } catch {
      // ignore
    }
  }

  return Array.from(removed).sort();
}
