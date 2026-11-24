import { useEffect, useRef, useState } from 'react';
import type { TeamSummaryWithRole } from '../types';
import { emitFunnelEvent } from '../utils/funnelTelemetry';
import { STORAGE_KEYS } from '../utils/storageKeys';

export interface PendingBillingCheckoutRecord {
  teamId: string;
  teamName?: string;
  startedAt: number;
}

export interface BillingReturnNoticeState {
  tone: 'success' | 'info';
  text: string;
}

const PENDING_BILLING_TTL_MS = 30 * 60 * 1000;

export function recordPendingBillingCheckoutTeam(teamId: string, teamName?: string): void {
  const cleanId = String(teamId || '').trim();
  if (!cleanId) return;
  const record: PendingBillingCheckoutRecord = {
    teamId: cleanId,
    ...(teamName?.trim() ? { teamName: teamName.trim() } : {}),
    startedAt: Date.now(),
  };
  const serialized = JSON.stringify(record);
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(STORAGE_KEYS.PENDING_BILLING_CHECKOUT, serialized);
    } catch {
      // ignore storage quota errors
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.PENDING_BILLING_CHECKOUT, serialized);
    } catch {
      // ignore storage quota errors
    }
  }
}

export function readPendingBillingCheckoutTeam(
  nowMs = Date.now()
): PendingBillingCheckoutRecord | null {
  const storages: Storage[] = [];
  if (typeof sessionStorage !== 'undefined') storages.push(sessionStorage);
  if (typeof localStorage !== 'undefined') storages.push(localStorage);
  for (const store of storages) {
    try {
      const raw = store.getItem(STORAGE_KEYS.PENDING_BILLING_CHECKOUT);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<PendingBillingCheckoutRecord>;
      if (
        typeof parsed?.teamId === 'string' &&
        parsed.teamId.trim() &&
        typeof parsed.startedAt === 'number' &&
        nowMs - parsed.startedAt <= PENDING_BILLING_TTL_MS
      ) {
        return {
          teamId: parsed.teamId.trim(),
          ...(typeof parsed.teamName === 'string' && parsed.teamName.trim()
            ? { teamName: parsed.teamName.trim() }
            : {}),
          startedAt: parsed.startedAt,
        };
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return null;
}

export function clearPendingBillingCheckoutTeam(): void {
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.PENDING_BILLING_CHECKOUT);
    } catch {
      // ignore
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEYS.PENDING_BILLING_CHECKOUT);
    } catch {
      // ignore
    }
  }
}

/**
 * Resolves Stripe checkout activation against an exact target `teamId` when known
 * so multi-school District ADs with another already-paid school do not get a false positive.
 */
export function resolveBillingCheckoutActivation(
  teams: TeamSummaryWithRole[],
  targetTeamId?: string | null
): { activated: boolean; matchedTeam?: TeamSummaryWithRole } {
  const cleanTargetId = String(targetTeamId || '').trim();
  if (cleanTargetId) {
    const target = (teams || []).find((t) => t.brand.teamId === cleanTargetId);
    return {
      activated: target?.billing?.status === 'ACTIVE_PAID',
      matchedTeam: target,
    };
  }
  const anyPaid = (teams || []).find((t) => t.billing?.status === 'ACTIVE_PAID');
  return {
    activated: Boolean(anyPaid),
    matchedTeam: anyPaid,
  };
}

interface UseBillingReturnNoticeParams {
  initialIsSampleQuery: boolean;
  isSampleDemoMode: boolean;
  activeTeamId: string | null;
  setMyTeams: React.Dispatch<React.SetStateAction<TeamSummaryWithRole[]>>;
  setActiveTeamId: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useBillingReturnNotice({
  initialIsSampleQuery,
  isSampleDemoMode,
  activeTeamId,
  setMyTeams,
  setActiveTeamId,
}: UseBillingReturnNoticeParams) {
  const [billingNotice, setBillingNotice] = useState<BillingReturnNoticeState | null>(null);
  const activeTeamIdRef = useRef(activeTeamId);
  activeTeamIdRef.current = activeTeamId;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (initialIsSampleQuery) {
      const r = params.get('sample') === 'coach' ? 'COACH' : 'ATHLETE';
      emitFunnelEvent('demo_enter', {
        role: r,
        tier: r === 'COACH' ? 'DEMO_COACH' : 'DEMO_ATHLETE',
        dedupeSessionKey: 'demo_enter',
      });
    }

    const billing = params.get('billing');
    if (billing !== 'success' && billing !== 'cancelled') return;

    const urlTeamId = params.get('teamId')?.trim() || '';
    params.delete('billing');
    params.delete('teamId');
    try {
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`
      );
    } catch {
      // ignore history errors
    }

    const pendingCheckout = readPendingBillingCheckoutTeam();
    const targetTeamId = urlTeamId || pendingCheckout?.teamId || activeTeamIdRef.current || null;

    if (billing === 'cancelled') {
      clearPendingBillingCheckoutTeam();
      setBillingNotice({
        tone: 'info',
        text: 'Stripe checkout cancelled — your Net-30 PO and current team plan remain unchanged.',
      });
      return;
    }

    const initialLabel = pendingCheckout?.teamName ? ` for ${pendingCheckout.teamName}` : '';
    setBillingNotice({
      tone: 'success',
      text: `Stripe checkout completed${initialLabel} — verifying annual plan activation…`,
    });
    if (isSampleDemoMode) {
      clearPendingBillingCheckoutTeam();
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;
    const pollBilling = (attempt: number) => {
      fetch(`/api/teams/mine?origin=${encodeURIComponent(window.location.origin)}`, {
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { teams?: TeamSummaryWithRole[] } | null) => {
          if (cancelled) return;
          const teams = Array.isArray(d?.teams) ? d.teams : [];
          if (teams.length > 0) setMyTeams(teams);
          const { activated, matchedTeam } = resolveBillingCheckoutActivation(teams, targetTeamId);
          if (activated) {
            clearPendingBillingCheckoutTeam();
            if (matchedTeam?.brand.teamId) {
              setActiveTeamId(matchedTeam.brand.teamId);
            }
            const activatedName = matchedTeam?.brand.name || pendingCheckout?.teamName;
            setBillingNotice({
              tone: 'success',
              text: activatedName
                ? `Annual program billing activated for ${activatedName} (Active Paid).`
                : 'Annual program billing activated (Active Paid).',
            });
          } else if (attempt < 3) {
            timerId = window.setTimeout(() => pollBilling(attempt + 1), 2000);
          } else {
            const pendingName = matchedTeam?.brand.name || pendingCheckout?.teamName;
            setBillingNotice({
              tone: 'info',
              text: pendingName
                ? `Stripe return received for ${pendingName} — plan activation is still finalizing. Refresh shortly if still Pilot.`
                : 'Stripe return received — plan activation is still finalizing. Refresh shortly if still Pilot.',
            });
          }
        })
        .catch(() => {
          if (!cancelled && attempt < 3) {
            timerId = window.setTimeout(() => pollBilling(attempt + 1), 2000);
          }
        });
    };
    pollBilling(1);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [initialIsSampleQuery, isSampleDemoMode, setMyTeams, setActiveTeamId]);

  return { billingNotice, setBillingNotice };
}
