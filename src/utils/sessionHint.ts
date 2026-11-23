import { STORAGE_KEYS } from './storageKeys';

/**
 * Non-secret client-side session indicator replacing XSS-readable `aeropulse_session_token`.
 * Real authentication relies strictly on HttpOnly `thresh_session` cookies sent via `credentials: 'include'`.
 */
export function hasSessionActiveHint(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    if (localStorage.getItem(STORAGE_KEYS.LOGGED_OUT) === '1') return false;
    return localStorage.getItem(STORAGE_KEYS.SESSION_ACTIVE_HINT) === '1';
  } catch {
    return false;
  }
}

export function markSessionActiveHint(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.LOGGED_OUT);
    localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
    localStorage.setItem(STORAGE_KEYS.SESSION_ACTIVE_HINT, '1');
  } catch {
    // ignore storage quota errors
  }
}

export function clearSessionActiveHint(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.SESSION_ACTIVE_HINT);
    localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
  } catch {
    // ignore storage quota errors
  }
}
