import { useCallback, useEffect, useState } from 'react';
import {
  decodeSharedWorkoutPayload,
  encodeSharedWorkoutPayload,
  isShareWorkoutLocation,
  sanitizeSharedWorkoutPayload,
  type SharedWorkoutPayload,
} from './shareWorkoutCodec.ts';

export * from './shareWorkoutCodec.ts';

export const PENDING_SHARED_WORKOUT_STORAGE_KEY = 'thresh_pending_shared_workout_v1';
const SHARE_ROUTE_EVENT = 'thresh:share-workout-route-change';

export function readSharedWorkoutFromLocation(): SharedWorkoutPayload | null {
  if (typeof window === 'undefined') return null;
  if (!isShareWorkoutLocation(window.location.pathname)) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('w');
    if (encoded) {
      return decodeSharedWorkoutPayload(encoded);
    }
  } catch {
    // ignore malformed URLSearchParams
  }
  return null;
}

export function openShareWorkoutRoute(payload: SharedWorkoutPayload): void {
  if (typeof window === 'undefined') return;
  const encoded = encodeSharedWorkoutPayload(payload);
  window.history.pushState({ threshShare: true }, '', `/share/workout?w=${encodeURIComponent(encoded)}`);
  window.dispatchEvent(new CustomEvent(SHARE_ROUTE_EVENT));
}

export function exitShareWorkoutRoute(): void {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new CustomEvent(SHARE_ROUTE_EVENT));
}

export function useShareWorkoutRoute() {
  const [isShareRoute, setIsShareRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isShareWorkoutLocation(window.location.pathname);
  });
  const [sharedWorkout, setSharedWorkout] = useState<SharedWorkoutPayload | null>(() =>
    readSharedWorkoutFromLocation()
  );

  useEffect(() => {
    const sync = () => {
      setIsShareRoute(isShareWorkoutLocation(window.location.pathname));
      setSharedWorkout(readSharedWorkoutFromLocation());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener(SHARE_ROUTE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(SHARE_ROUTE_EVENT, sync);
    };
  }, []);

  const openShareWorkout = useCallback((payload: SharedWorkoutPayload) => {
    openShareWorkoutRoute(payload);
  }, []);

  const closeShareWorkout = useCallback(() => {
    exitShareWorkoutRoute();
  }, []);

  return { isShareRoute, sharedWorkout, openShareWorkout, closeShareWorkout };
}

export function stashPendingSharedWorkout(payload: SharedWorkoutPayload): void {
  const clean = sanitizeSharedWorkoutPayload(payload);
  if (!clean || typeof window === 'undefined') return;
  const serialized = JSON.stringify(clean);
  try {
    window.localStorage.setItem(PENDING_SHARED_WORKOUT_STORAGE_KEY, serialized);
  } catch {
    // ignore storage quota errors
  }
  try {
    window.sessionStorage.setItem(PENDING_SHARED_WORKOUT_STORAGE_KEY, serialized);
  } catch {
    // ignore sessionStorage errors
  }
}

export function peekPendingSharedWorkout(): SharedWorkoutPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      window.sessionStorage.getItem(PENDING_SHARED_WORKOUT_STORAGE_KEY) ||
      window.localStorage.getItem(PENDING_SHARED_WORKOUT_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeSharedWorkoutPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearPendingSharedWorkout(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_SHARED_WORKOUT_STORAGE_KEY);
    window.localStorage.removeItem(PENDING_SHARED_WORKOUT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function consumePendingSharedWorkout(): SharedWorkoutPayload | null {
  const found = peekPendingSharedWorkout();
  clearPendingSharedWorkout();
  return found;
}
