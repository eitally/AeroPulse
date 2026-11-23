import { useCallback, useEffect, useState } from 'react';
import type { UnifiedActivity } from '../types';

export function parseDelegatedTimingPassCodeFromPath(pathname: string): string | null {
  const match = String(pathname || '').match(/^\/time\/([a-zA-Z0-9_-]{4,64})\/?$/);
  return match?.[1] || null;
}

export function useDelegatedTimingRoute() {
  const [delegatedPassCode, setDelegatedPassCode] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseDelegatedTimingPassCodeFromPath(window.location.pathname);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setDelegatedPassCode(parseDelegatedTimingPassCodeFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const closeDelegatedPass = useCallback(() => {
    setDelegatedPassCode(null);
    if (typeof window === 'undefined') return;
    try {
      window.history.replaceState({}, '', '/');
    } catch {
      // ignore navigation errors
    }
  }, []);

  return { delegatedPassCode, closeDelegatedPass };
}

export function buildWatchlessSelfLoggedActivity(input: {
  workoutName: string;
  durationMins: number;
  distanceKm: number;
  rpe: number;
  dateIso: string;
}): UnifiedActivity {
  const safeDurationMins = Math.max(10, Math.min(240, Math.round(input.durationMins || 35)));
  const movingTimeSecs = safeDurationMins * 60;
  const distanceMeters = Math.max(0, Math.round((input.distanceKm || 0) * 1000));
  const safeRpe = Math.max(1, Math.min(10, Math.round(input.rpe || 5)));
  const trainingLoad = Math.max(12, Math.round(safeDurationMins * (0.45 + safeRpe * 0.11)));
  const datePrefix = String(input.dateIso || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

  return {
    id: `self-logged-${datePrefix}-${Date.now()}`,
    startDateLocal: `${datePrefix}T15:45:00`,
    name: input.workoutName?.trim() || 'Self-Logged Session',
    sportCategory: 'Running',
    environment: 'OUTDOOR',
    subType: 'Track',
    movingTimeSecs,
    distanceMeters,
    elevationGainMeters: 0,
    trainingLoad,
    avgHr: 0,
    maxHr: 0,
    aerobicDecouplingPct: 0,
    efficiencyFactor: 0,
    firstHalfEf: 0,
    secondHalfEf: 0,
    zoneSecs: { hr: [0, 0, 0, 0, 0, 0, 0] },
    stravaPrCount: 0,
    segmentEfforts: [],
    quickLog: {
      rpe: safeRpe,
      feelRating: safeRpe >= 8 ? 'HEAVY' : 'NORMAL',
      notes: 'Watchless self-logged completion',
      loggedAt: new Date().toISOString(),
    },
    sourceBadges: ['Self-Logged'],
  };
}
