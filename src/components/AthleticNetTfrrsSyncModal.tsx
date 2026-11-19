import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  RefreshCw,
  ShareNetwork,
  ShieldCheck,
  Sparkles,
  Trophy,
  Upload,
  Users,
  X,
} from './icons/PhosphorIcons';
import type { TeamExternalSyncConfig, TeamSummaryWithRole } from '../types';
import {
  COLLEGIATE_TFRRS_PRESET,
  COURSE_DISTANCE_PRESETS,
  WILLOW_GLEN_XC_PRESET,
  applyExternalSyncLocallyToTeamSummary,
  buildPresetExternalTeamSummary,
  buildThreshExternalSyncBookmarklet,
  detectExternalPasteKind,
  matchExternalResultsToRoster,
  parseExternalMeetResults,
  parseExternalTeamRoster,
  parseExternalTeamUrl,
  parseIcsCalendarToMeets,
  parsePastedScheduleToMeets,
  type ExternalPasteKind,
} from '../utils/athleticNetAndTfrrsEngine';
import { getSavedIntervalsHeaders } from '../utils/telemetryStorage';
import { useModalDialog } from '../hooks/useModalDialog';

export interface AthleticNetTfrrsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTeam: TeamSummaryWithRole | null;
  myTeams: TeamSummaryWithRole[];
  selfName: string;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
  onOpenPublicHub?: (slugOrCode: string) => void;
  inlineRenderForTest?: boolean;
}

type SyncModalTab = 'PASTE_IMPORT' | 'CONNECT_ICS' | 'BOOKMARKLET';

export const AthleticNetTfrrsSyncModal: React.FC<AthleticNetTfrrsSyncModalProps> = ({
  isOpen,
  onClose,
  activeTeam,
  myTeams,
  selfName,
  onTeamsUpdated,
  onOpenPublicHub,
  inlineRenderForTest = false,
}) => {
  const formId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const icsFileInputRef = useRef<HTMLInputElement>(null);

  useModalDialog({
    isOpen: isOpen && !inlineRenderForTest,
    onClose,
    dialogRef,
  });

  const [tab, setTab] = useState<SyncModalTab>('PASTE_IMPORT');
  const [teamUrlInput, setTeamUrlInput] = useState<string>(
    activeTeam?.brand.externalSync?.athleticNetUrl ||
      activeTeam?.brand.externalSync?.tfrrsTeamUrl ||
      ''
  );
  const [icsUrlInput, setIcsUrlInput] = useState<string>(
    activeTeam?.brand.externalSync?.icsCalendarUrl || ''
  );
  const [enablePublicHub, setEnablePublicHub] = useState<boolean>(
    activeTeam?.brand.externalSync?.enablePublicParentHub !== false
  );
  const [teamFilterKeyword, setTeamFilterKeyword] = useState<string>(
    activeTeam?.brand.externalSync?.teamFilterKeyword ||
      (activeTeam?.brand.name
        ? activeTeam.brand.name.replace(/\s+(high\s+school|xc|track|varsity).*$/i, '').trim()
        : 'Willow Glen')
  );
  const [coursePresetId, setCoursePresetId] = useState<string>('AUTO');
  const [pasteMode, setPasteMode] = useState<ExternalPasteKind>('ROSTER');
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<{
    tone: 'success' | 'warning';
    text: string;
  } | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState<boolean>(false);
  const [copiedHubLink, setCopiedHubLink] = useState<boolean>(false);

  useEffect(() => {
    if (!activeTeam) return;
    setTeamUrlInput(
      activeTeam.brand.externalSync?.athleticNetUrl ||
        activeTeam.brand.externalSync?.tfrrsTeamUrl ||
        ''
    );
    setIcsUrlInput(activeTeam.brand.externalSync?.icsCalendarUrl || '');
    setEnablePublicHub(activeTeam.brand.externalSync?.enablePublicParentHub !== false);
    if (activeTeam.brand.externalSync?.teamFilterKeyword) {
      setTeamFilterKeyword(activeTeam.brand.externalSync.teamFilterKeyword);
    }
  }, [activeTeam]);

  // Listen for live 1-Click "Send to THRESH" Bookmarklet postMessage payloads
  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen) return;
    const allowedOrigins = new Set([
      window.location.origin,
      'https://www.athletic.net',
      'https://athletic.net',
      'https://www.tfrrs.org',
      'https://tfrrs.org',
    ]);
    const onMessage = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin)) return;
      const data = event.data;
      if (!data || data.type !== 'THRESH_EXTERNAL_SYNC_V1' || !data.payload) return;
      const serialized = `THRESH_SYNC_V1:${JSON.stringify(data.payload)}`;
      setRawPasteText(serialized);
      setPasteMode(detectExternalPasteKind(serialized));
      setTab('PASTE_IMPORT');
      if (data.payload.pageUrl) {
        setTeamUrlInput(String(data.payload.pageUrl));
      }
      setStatusBanner({
        tone: 'success',
        text: 'Received live page data from the Send to THRESH bookmarklet. Review below and click Sync to Team.',
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isOpen]);

  const parsedUrlPreview = useMemo(() => parseExternalTeamUrl(teamUrlInput), [teamUrlInput]);

  const selectedCoursePreset = useMemo(
    () => COURSE_DISTANCE_PRESETS.find((p) => p.id === coursePresetId) || COURSE_DISTANCE_PRESETS[0],
    [coursePresetId]
  );

  const previewAnalysis = useMemo(() => {
    const trimmed = rawPasteText.trim();
    if (!trimmed) {
      return {
        athletes: [],
        meets: [],
        results: [],
        matchedSummary: { matched: [], matchedExistingCount: 0, newWalkOnCount: 0 },
      };
    }

    const orgType =
      activeTeam?.brand.orgType || parsedUrlPreview?.orgTypeHint || 'HIGH_SCHOOL';
    const extSource =
      parsedUrlPreview?.platform ||
      activeTeam?.brand.externalSync?.platform ||
      (/tfrrs/i.test(trimmed) ? 'TFRRS' : 'ATHLETIC_NET');

    if (pasteMode === 'ICS_CALENDAR') {
      return {
        athletes: [],
        meets: parseIcsCalendarToMeets(trimmed, extSource),
        results: [],
        matchedSummary: { matched: [], matchedExistingCount: 0, newWalkOnCount: 0 },
      };
    }
    if (pasteMode === 'SCHEDULE') {
      return {
        athletes: [],
        meets: parsePastedScheduleToMeets(trimmed, { externalSource: extSource }),
        results: [],
        matchedSummary: { matched: [], matchedExistingCount: 0, newWalkOnCount: 0 },
      };
    }
    if (pasteMode === 'MEET_RESULTS') {
      const courseHint =
        coursePresetId === 'AUTO' ? '' : selectedCoursePreset.label;
      const results = parseExternalMeetResults(trimmed, {
        defaultCourseOrDistance: courseHint,
        teamFilterKeyword,
        externalSource: extSource,
        sourceUrl: teamUrlInput || undefined,
      });
      const rosterRefs = (activeTeam?.memberships || [])
        .filter((m) => m.role === 'ATHLETE' && m.status !== 'REVOKED')
        .map((m) => ({
          membershipId: m.membershipId,
          invitedName: m.invitedName,
          squadGroup: m.squadGroup,
          graduationYear: m.graduationYear,
          externalAthleteId: m.externalAthleteId,
        }));
      return {
        athletes: [],
        meets: [],
        results,
        matchedSummary: matchExternalResultsToRoster(results, rosterRefs),
      };
    }

    return {
      athletes: parseExternalTeamRoster(trimmed, {
        orgType,
        externalSource: extSource,
      }),
      meets: [],
      results: [],
      matchedSummary: { matched: [], matchedExistingCount: 0, newWalkOnCount: 0 },
    };
  }, [
    rawPasteText,
    pasteMode,
    activeTeam,
    parsedUrlPreview,
    coursePresetId,
    selectedCoursePreset,
    teamFilterKeyword,
    teamUrlInput,
  ]);

  const appOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://thresh-dev.vercel.app';
  const bookmarkletHref = useMemo(
    () => buildThreshExternalSyncBookmarklet(appOrigin),
    [appOrigin]
  );

  const publicHubUrl = activeTeam
    ? `${appOrigin}/team/${activeTeam.brand.slug}`
    : `${appOrigin}/team/willow-glen-high-school-xc`;

  const updateLocalOrRemoteTeamList = (updated: TeamSummaryWithRole) => {
    const exists = myTeams.some((t) => t.brand.teamId === updated.brand.teamId);
    const nextList = exists
      ? myTeams.map((t) => (t.brand.teamId === updated.brand.teamId ? updated : t))
      : [updated, ...myTeams];
    onTeamsUpdated(nextList, updated.brand.teamId);
  };

  const handleQuickSetupPreset = async (presetKey: 'WILLOW_GLEN' | 'COLLEGIATE_TFRRS') => {
    setIsBusy(true);
    setStatusBanner(null);
    const isWg = presetKey === 'WILLOW_GLEN';
    try {
      const externalSync: TeamExternalSyncConfig = isWg
        ? {
            platform: 'ATHLETIC_NET',
            athleticNetSchoolId: '1073',
            athleticNetSportSlug: 'xc',
            athleticNetUrl: WILLOW_GLEN_XC_PRESET.athleticNetUrl,
            teamFilterKeyword: WILLOW_GLEN_XC_PRESET.teamFilterKeyword,
            enablePublicParentHub: true,
          }
        : {
            platform: 'TFRRS',
            tfrrsTeamUrl: COLLEGIATE_TFRRS_PRESET.tfrrsTeamUrl,
            tfrrsTeamCode: 'CA_college_m_Pacific',
            teamFilterKeyword: COLLEGIATE_TFRRS_PRESET.teamFilterKeyword,
            enablePublicParentHub: true,
          };

      const createResp = await fetch('/api/teams', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
        body: JSON.stringify({
          origin: appOrigin,
          name: isWg ? WILLOW_GLEN_XC_PRESET.teamName : COLLEGIATE_TFRRS_PRESET.teamName,
          shortName: isWg ? WILLOW_GLEN_XC_PRESET.shortName : COLLEGIATE_TFRRS_PRESET.shortName,
          mascotOrMotto: isWg
            ? WILLOW_GLEN_XC_PRESET.mascotOrMotto
            : COLLEGIATE_TFRRS_PRESET.mascotOrMotto,
          orgType: isWg ? 'HIGH_SCHOOL' : 'COLLEGIATE',
          primarySport: 'Running',
          primaryHex: isWg ? WILLOW_GLEN_XC_PRESET.primaryHex : COLLEGIATE_TFRRS_PRESET.primaryHex,
          secondaryHex: isWg
            ? WILLOW_GLEN_XC_PRESET.secondaryHex
            : COLLEGIATE_TFRRS_PRESET.secondaryHex,
          coachDisplayName: selfName || 'Head Coach',
          externalSync,
        }),
      });

      if (createResp.ok) {
        const createdData = await createResp.json();
        const createdTeam: TeamSummaryWithRole | undefined = createdData.team;
        if (createdData.sessionToken && typeof window !== 'undefined') {
          try {
            localStorage.setItem('aeropulse_session_token', String(createdData.sessionToken));
          } catch {
            // ignore
          }
        }
        if (createdTeam) {
          const athletes = parseExternalTeamRoster(
            isWg ? WILLOW_GLEN_XC_PRESET.sampleRosterText : COLLEGIATE_TFRRS_PRESET.sampleRosterText,
            {
              orgType: isWg ? 'HIGH_SCHOOL' : 'COLLEGIATE',
              externalSource: isWg ? 'ATHLETIC_NET' : 'TFRRS',
            }
          );
          const meets = isWg
            ? parseIcsCalendarToMeets(WILLOW_GLEN_XC_PRESET.sampleScheduleIcs, 'ATHLETIC_NET')
            : [];
          const results = isWg
            ? parseExternalMeetResults(WILLOW_GLEN_XC_PRESET.sampleMeetResultsText, {
                teamFilterKeyword: 'Willow Glen',
                externalSource: 'ATHLETIC_NET',
              })
            : [];

          const applyResp = await fetch(
            `/api/teams/${encodeURIComponent(createdTeam.brand.teamId)}/external-sync/apply`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
              body: JSON.stringify({
                origin: appOrigin,
                externalSyncPatch: externalSync,
                athletes,
                meets,
                results,
              }),
            }
          );
          if (applyResp.ok) {
            const applyData = await applyResp.json();
            if (Array.isArray(applyData.teams)) {
              onTeamsUpdated(applyData.teams, createdTeam.brand.teamId);
            } else if (applyData.team) {
              updateLocalOrRemoteTeamList(applyData.team);
            }
            setTeamUrlInput(externalSync.athleticNetUrl || externalSync.tfrrsTeamUrl || '');
            setTeamFilterKeyword(externalSync.teamFilterKeyword || 'Willow Glen');
            setStatusBanner({
              tone: 'success',
              text: isWg
                ? 'Connected Willow Glen HS XC (1073/xc) with 6 athletes, 5 meets, and Crystal Springs 2.95 mi results.'
                : 'Connected Collegiate TFRRS squad with roster IDs and VDOT pace zones.',
            });
            return;
          }
        }
      }
    } catch {
      // Fallback to deterministic local preset below
    } finally {
      setIsBusy(false);
    }

    const fallbackTeam = buildPresetExternalTeamSummary(presetKey, selfName || 'Head Coach');
    updateLocalOrRemoteTeamList(fallbackTeam);
    setTeamUrlInput(
      fallbackTeam.brand.externalSync?.athleticNetUrl ||
        fallbackTeam.brand.externalSync?.tfrrsTeamUrl ||
        ''
    );
    setTeamFilterKeyword(fallbackTeam.brand.externalSync?.teamFilterKeyword || 'Willow Glen');
    setStatusBanner({
      tone: 'success',
      text: isWg
        ? 'Loaded Willow Glen HS XC (1073/xc) with roster, BVAL/CCS schedule, and Crystal Springs results.'
        : 'Loaded Collegiate TFRRS squad with roster IDs and seed marks.',
    });
  };

  const handleSaveExternalConfig = async () => {
    if (!activeTeam) {
      setStatusBanner({
        tone: 'warning',
        text: 'Create or select a team above first (or click Quick-Setup Willow Glen HS).',
      });
      return;
    }
    setIsBusy(true);
    setStatusBanner(null);
    const patch: Partial<TeamExternalSyncConfig> = {
      ...(parsedUrlPreview?.platform === 'ATHLETIC_NET'
        ? {
            platform: 'ATHLETIC_NET',
            athleticNetSchoolId: parsedUrlPreview.athleticNetSchoolId,
            athleticNetSportSlug: parsedUrlPreview.athleticNetSportSlug,
            athleticNetUrl: parsedUrlPreview.canonicalUrl,
          }
        : parsedUrlPreview?.platform === 'TFRRS'
          ? {
              platform: 'TFRRS',
              tfrrsTeamUrl: parsedUrlPreview.canonicalUrl,
              tfrrsTeamCode: parsedUrlPreview.tfrrsTeamCode,
            }
          : {}),
      teamFilterKeyword,
      ...(icsUrlInput.trim() ? { icsCalendarUrl: icsUrlInput.trim() } : {}),
      enablePublicParentHub: enablePublicHub,
    };

    try {
      const resp = await fetch(
        `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/external-sync/config`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
          body: JSON.stringify({
            origin: appOrigin,
            teamUrl: teamUrlInput.trim(),
            config: patch,
          }),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.teams)) {
          onTeamsUpdated(data.teams, activeTeam.brand.teamId);
        } else if (data.team) {
          updateLocalOrRemoteTeamList(data.team);
        }
        setStatusBanner({
          tone: 'success',
          text: 'Saved external Athletic.net / TFRRS link and Parent Hub settings.',
        });
        return;
      }
    } catch {
      // local fallback
    } finally {
      setIsBusy(false);
    }

    const { updatedTeam } = applyExternalSyncLocallyToTeamSummary(activeTeam, {
      externalSyncPatch: patch,
    });
    updateLocalOrRemoteTeamList(updatedTeam);
    setStatusBanner({
      tone: 'success',
      text: 'Saved external Athletic.net / TFRRS link and Parent Hub settings.',
    });
  };

  const handleSyncIcsFeed = async (icsBodyOverride?: string) => {
    const targetTeam =
      activeTeam || buildPresetExternalTeamSummary('WILLOW_GLEN', selfName || 'Head Coach');
    setIsBusy(true);
    setStatusBanner(null);

    try {
      if (activeTeam) {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/external-sync/ics`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
            body: JSON.stringify({
              origin: appOrigin,
              icsUrl: icsBodyOverride ? undefined : icsUrlInput.trim(),
              icsText: icsBodyOverride,
            }),
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.teams)) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          }
          setStatusBanner({
            tone: data.ok ? 'success' : 'warning',
            text: data.note || 'Calendar check completed.',
          });
          return;
        }
      }
    } catch {
      // local fallback if icsBodyOverride present
    } finally {
      setIsBusy(false);
    }

    if (icsBodyOverride) {
      const meets = parseIcsCalendarToMeets(icsBodyOverride, 'ATHLETIC_NET');
      const res = applyExternalSyncLocallyToTeamSummary(targetTeam, { meets });
      updateLocalOrRemoteTeamList(res.updatedTeam);
      setStatusBanner({
        tone: 'success',
        text: `Imported ${meets.length} calendar meets (${res.addedMeets} new) onto ${res.updatedTeam.brand.shortName}.`,
      });
    } else {
      setStatusBanner({
        tone: 'warning',
        text: 'Remote calendar host blocked server fetch or URL was empty. Download the .ics file in your browser and upload it here.',
      });
    }
  };

  const handleApplySmartPaste = async () => {
    const hasPayload =
      previewAnalysis.athletes.length > 0 ||
      previewAnalysis.meets.length > 0 ||
      previewAnalysis.results.length > 0;
    if (!hasPayload) return;

    const targetTeam =
      activeTeam || buildPresetExternalTeamSummary('WILLOW_GLEN', selfName || 'Head Coach');
    setIsBusy(true);
    setStatusBanner(null);

    const extPatch: Partial<TeamExternalSyncConfig> = {
      ...(parsedUrlPreview?.platform
        ? {
            platform: parsedUrlPreview.platform,
            athleticNetSchoolId: parsedUrlPreview.athleticNetSchoolId,
            athleticNetSportSlug: parsedUrlPreview.athleticNetSportSlug,
            athleticNetUrl:
              parsedUrlPreview.platform === 'ATHLETIC_NET'
                ? parsedUrlPreview.canonicalUrl
                : undefined,
            tfrrsTeamUrl:
              parsedUrlPreview.platform === 'TFRRS' ? parsedUrlPreview.canonicalUrl : undefined,
          }
        : {}),
      teamFilterKeyword,
      enablePublicParentHub: enablePublicHub,
    };

    try {
      if (activeTeam) {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/external-sync/apply`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...getSavedIntervalsHeaders() },
            body: JSON.stringify({
              origin: appOrigin,
              externalSyncPatch: extPatch,
              athletes: previewAnalysis.athletes,
              meets: previewAnalysis.meets,
              results: previewAnalysis.results,
            }),
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.teams)) {
            onTeamsUpdated(data.teams, activeTeam.brand.teamId);
          } else if (data.team) {
            updateLocalOrRemoteTeamList(data.team);
          }
          setStatusBanner({
            tone: 'success',
            text: `Synced ${data.addedAthletes || 0} new athletes (${data.updatedAthletes || 0} updated), ${data.addedMeets || 0} meets, and ${data.recordedResults || 0} official race results.`,
          });
          setRawPasteText('');
          return;
        }
      }
    } catch {
      // local fallback
    } finally {
      setIsBusy(false);
    }

    const localRes = applyExternalSyncLocallyToTeamSummary(targetTeam, {
      externalSyncPatch: extPatch,
      athletes: previewAnalysis.athletes,
      meets: previewAnalysis.meets,
      results: previewAnalysis.results,
    });
    updateLocalOrRemoteTeamList(localRes.updatedTeam);
    setStatusBanner({
      tone: 'success',
      text: `Synced ${localRes.addedAthletes} new athletes (${localRes.updatedAthletes} updated), ${localRes.addedMeets} meets, and ${localRes.recordedResults} official race results.`,
    });
    setRawPasteText('');
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    asDirectIcsSync = false
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      if (asDirectIcsSync) {
        void handleSyncIcsFeed(content);
      } else {
        setRawPasteText(content);
        setPasteMode(detectExternalPasteKind(content));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  const modalInner = (
    <div
      className={inlineRenderForTest ? '' : 'ap-modal-backdrop z-[90]'}
      onClick={inlineRenderForTest ? undefined : onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-sync-title`}
        data-testid="athletic-tfrrs-sync-modal"
        onClick={(e) => e.stopPropagation()}
        className="ap-modal-sheet max-w-3xl ap-content-stage p-4 sm:p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 dark:border-[#244331] pb-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id={`${formId}-sync-title`}
                className="text-base sm:text-lg font-bold text-[#101411] dark:text-[#F4F7F4]"
              >
                Athletic.net &amp; TFRRS Team Sync
              </h2>
              {activeTeam && (
                <span className="px-2 py-0.5 rounded-md font-mono text-2xs font-bold bg-[#E3ECE5] text-[#1C5436] dark:bg-[#15231B] dark:text-[#C8FF00]">
                  {activeTeam.brand.shortName}
                </span>
              )}
            </div>
            <p className="text-xs text-[#43584B] dark:text-[#93A39A]">
              Import rosters, .ics meet schedules, and official race marks from Athletic.net or TFRRS.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Athletic.net and TFRRS sync modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-[#F4F7F4] shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Setup Bar when no team is active */}
        {!activeTeam && (
          <div className="rounded-xl border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] p-3.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="text-xs text-[#101411] dark:text-[#F4F7F4]">
              <strong>No team yet?</strong> Try a pre-configured demo program or paste your own roster below:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                data-testid="sync-quick-setup-willow-glen"
                onClick={() => void handleQuickSetupPreset('WILLOW_GLEN')}
                className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Quick-Setup Willow Glen HS (1073/xc)</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                data-testid="sync-quick-setup-tfrrs"
                onClick={() => void handleQuickSetupPreset('COLLEGIATE_TFRRS')}
                className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Collegiate TFRRS Demo</span>
              </button>
            </div>
          </div>
        )}

        {statusBanner && (
          <div
            role="status"
            data-testid="sync-status-banner"
            className={`rounded-xl px-3.5 py-2.5 text-xs font-medium flex items-center gap-2 ${
              statusBanner.tone === 'success' ? 'ap-status-prime' : 'ap-status-caution'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusBanner.text}</span>
          </div>
        )}

        {/* 3-Tab Switcher */}
        <div
          role="tablist"
          aria-label="External sync channels"
          className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-stone-100 dark:bg-[#101B15] border border-stone-200 dark:border-[#244331]"
        >
          {(
            [
              { id: 'PASTE_IMPORT', label: 'Paste / CSV Import' },
              { id: 'CONNECT_ICS', label: 'Team URL & .ics' },
              { id: 'BOOKMARKLET', label: '1-Click Bookmarklet' },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                data-testid={`sync-tab-${item.id.toLowerCase()}`}
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`min-h-[44px] sm:min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'ap-nav-volt-active'
                    : 'text-[#43584B] dark:text-[#93A39A] hover:text-[#101411] dark:hover:text-[#F4F7F4]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: SMART PASTE & CSV / FILE DROP */}
        {tab === 'PASTE_IMPORT' && (
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Import data type">
                {(
                  [
                    { id: 'ROSTER', label: 'Roster & Seeds', icon: Users },
                    { id: 'SCHEDULE', label: 'Meet Schedule', icon: CalendarPlus },
                    { id: 'MEET_RESULTS', label: 'Meet Results', icon: Trophy },
                  ] as const
                ).map((m) => {
                  const Icon = m.icon;
                  const active =
                    pasteMode === m.id || (m.id === 'SCHEDULE' && pasteMode === 'ICS_CALENDAR');
                  return (
                    <button
                      key={m.id}
                      type="button"
                      data-testid={`sync-mode-${m.id.toLowerCase()}`}
                      aria-pressed={active}
                      onClick={() => setPasteMode(m.id)}
                      className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer ${
                        active
                          ? 'bg-[#1C5436] dark:bg-[#C8FF00] text-white dark:text-[#080A09] border-[#1C5436] dark:border-[#C8FF00] font-bold'
                          : 'bg-white dark:bg-[#15231B] text-[#101411] dark:text-[#F4F7F4] border-stone-200 dark:border-[#244331]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt,.ics,.hy3"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e, false)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-2.5 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload .CSV / .ICS</span>
                </button>
              </div>
            </div>

            {/* Quick Sample Loaders for Testing & Onboarding */}
            <div className="flex flex-wrap items-center gap-1.5 text-2xs">
              <span className="font-mono text-[#43584B] dark:text-[#93A39A]">Try sample:</span>
              <button
                type="button"
                data-testid="sync-sample-wg-roster"
                onClick={() => {
                  setRawPasteText(WILLOW_GLEN_XC_PRESET.sampleRosterText);
                  setPasteMode('ROSTER');
                }}
                className="min-h-[44px] sm:min-h-[28px] px-2.5 py-0.5 rounded-md border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] font-mono text-[#101411] dark:text-[#F4F7F4] cursor-pointer"
              >
                Willow Glen Roster
              </button>
              <button
                type="button"
                data-testid="sync-sample-wg-results"
                onClick={() => {
                  setTeamFilterKeyword('Willow Glen');
                  setCoursePresetId('CRYSTAL_SPRINGS');
                  setRawPasteText(WILLOW_GLEN_XC_PRESET.sampleMeetResultsText);
                  setPasteMode('MEET_RESULTS');
                }}
                className="min-h-[44px] sm:min-h-[28px] px-2.5 py-0.5 rounded-md border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] font-mono text-[#101411] dark:text-[#F4F7F4] cursor-pointer"
              >
                Crystal Springs 2.95 mi Results
              </button>
              <button
                type="button"
                data-testid="sync-sample-tfrrs-csv"
                onClick={() => {
                  setRawPasteText(COLLEGIATE_TFRRS_PRESET.sampleRosterText);
                  setPasteMode('ROSTER');
                }}
                className="min-h-[44px] sm:min-h-[28px] px-2.5 py-0.5 rounded-md border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] font-mono text-[#101411] dark:text-[#F4F7F4] cursor-pointer"
              >
                TFRRS Roster CSV
              </button>
            </div>

            {pasteMode === 'MEET_RESULTS' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div>
                  <label
                    htmlFor={`${formId}-team-filter`}
                    className="block text-2xs font-semibold text-[#43584B] dark:text-[#93A39A] mb-1"
                  >
                    School / Team Filter (Filters multi-team invitationals)
                  </label>
                  <input
                    id={`${formId}-team-filter`}
                    data-testid="sync-team-filter-input"
                    type="text"
                    value={teamFilterKeyword}
                    onChange={(e) => setTeamFilterKeyword(e.target.value)}
                    placeholder="e.g. Willow Glen"
                    className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-3 py-1.5 text-xs text-[#101411] dark:text-[#F4F7F4]"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${formId}-course-dist`}
                    className="block text-2xs font-semibold text-[#43584B] dark:text-[#93A39A] mb-1"
                  >
                    XC Course / Track Distance
                  </label>
                  <select
                    id={`${formId}-course-dist`}
                    data-testid="sync-course-preset-select"
                    value={coursePresetId}
                    onChange={(e) => setCoursePresetId(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-2.5 py-1.5 text-xs text-[#101411] dark:text-[#F4F7F4]"
                  >
                    {COURSE_DISTANCE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor={`${formId}-paste-box`}
                className="block text-2xs font-semibold text-[#43584B] dark:text-[#93A39A] mb-1"
              >
                Select-All &amp; Paste from Athletic.net, TFRRS, or Hy-Tek CSV
              </label>
              <textarea
                id={`${formId}-paste-box`}
                data-testid="sync-paste-textarea"
                rows={6}
                value={rawPasteText}
                onChange={(e) => {
                  const next = e.target.value;
                  setRawPasteText(next);
                  if (next.trim().length > 15) {
                    setPasteMode(detectExternalPasteKind(next));
                  }
                }}
                placeholder="Open your team's Athletic.net or TFRRS page in your browser, press Cmd+A then Cmd+C, and paste here..."
                className="w-full rounded-xl border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] p-3 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
              />
            </div>

            {/* Live Diff Preview */}
            {(previewAnalysis.athletes.length > 0 ||
              previewAnalysis.meets.length > 0 ||
              previewAnalysis.results.length > 0) && (
              <div
                data-testid="sync-preview-box"
                className="rounded-xl border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <span className="font-bold text-[#1C5436] dark:text-[#C8FF00]">
                    {previewAnalysis.athletes.length > 0 &&
                      `${previewAnalysis.athletes.length} Roster Athletes Parsed`}
                    {previewAnalysis.meets.length > 0 &&
                      `${previewAnalysis.meets.length} Scheduled Meets Parsed`}
                    {previewAnalysis.results.length > 0 &&
                      `${previewAnalysis.results.length} Race Marks (${previewAnalysis.matchedSummary.matchedExistingCount} Matched · ${previewAnalysis.matchedSummary.newWalkOnCount} New Roster)`}
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto divide-y divide-stone-200/70 dark:divide-[#244331] text-xs font-mono">
                  {previewAnalysis.athletes.slice(0, 8).map((a, idx) => (
                    <div
                      key={`${a.name}-${idx}`}
                      className="py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="font-sans font-semibold text-[#101411] dark:text-[#F4F7F4] truncate">
                        {a.name}{' '}
                        <span className="font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
                          ({a.squadGroup}
                          {a.graduationYear ? ` · '${String(a.graduationYear).slice(-2)}` : ''})
                        </span>
                      </span>
                      <span className="text-[#1C5436] dark:text-[#C8FF00] font-bold shrink-0">
                        {a.seedMarkOrFtp || a.externalAthleteId || 'Roster'}
                      </span>
                    </div>
                  ))}
                  {previewAnalysis.meets.slice(0, 8).map((m, idx) => (
                    <div
                      key={`${m.date}-${idx}`}
                      className="py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="font-sans font-semibold text-[#101411] dark:text-[#F4F7F4] truncate">
                        {m.date} · {m.name}
                      </span>
                      <span className="text-2xs text-[#43584B] dark:text-[#93A39A] truncate">
                        {m.locationName || m.locationCategory}
                      </span>
                    </div>
                  ))}
                  {previewAnalysis.matchedSummary.matched.slice(0, 8).map((item, idx) => (
                    <div
                      key={`${item.row.athleteName}-${idx}`}
                      className="py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="font-sans font-semibold text-[#101411] dark:text-[#F4F7F4] truncate">
                        {item.row.athleteName}{' '}
                        <span className="font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
                          ({item.row.eventLabel} ·{' '}
                          {item.action === 'MATCHED' ? 'Matched' : 'Add to Roster'})
                        </span>
                      </span>
                      <span className="text-[#1C5436] dark:text-[#C8FF00] font-bold shrink-0">
                        {item.row.displayFatTime} · VDOT{' '}
                        {item.activity.officialRaceData?.vdotScore.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={
                  isBusy ||
                  (previewAnalysis.athletes.length === 0 &&
                    previewAnalysis.meets.length === 0 &&
                    previewAnalysis.results.length === 0)
                }
                data-testid="sync-apply-batch-btn"
                onClick={() => void handleApplySmartPaste()}
                className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-4 py-1.5 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sync to Team</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: TEAM URL, .ICS CALENDAR & PUBLIC PARENT HUB */}
        {tab === 'CONNECT_ICS' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] p-3.5 space-y-3">
              <div>
                <label
                  htmlFor={`${formId}-team-url`}
                  className="block text-xs font-bold text-[#101411] dark:text-[#F4F7F4] mb-1"
                >
                  Athletic.net or TFRRS Team Homepage URL
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id={`${formId}-team-url`}
                    data-testid="sync-team-url-input"
                    type="url"
                    value={teamUrlInput}
                    onChange={(e) => setTeamUrlInput(e.target.value)}
                    placeholder="https://www.athletic.net/team/1073/xc or https://xc.tfrrs.org/teams/..."
                    className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-3 py-1.5 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    data-testid="sync-save-config-btn"
                    onClick={() => void handleSaveExternalConfig()}
                    className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-3.5 py-1.5 text-xs font-bold shrink-0 cursor-pointer"
                  >
                    Save Team Link
                  </button>
                </div>
                {parsedUrlPreview && (
                  <div className="mt-1.5 text-2xs font-mono text-[#1C5436] dark:text-[#C8FF00]">
                    Detected:{' '}
                    {parsedUrlPreview.platform === 'ATHLETIC_NET'
                      ? `Athletic.net · SchoolID #${parsedUrlPreview.athleticNetSchoolId} (${parsedUrlPreview.athleticNetSportSlug})`
                      : `TFRRS · ${parsedUrlPreview.tfrrsTeamCode || 'Collegiate Squad'}`}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-stone-200 dark:border-[#244331] space-y-2">
                <label
                  htmlFor={`${formId}-ics-url`}
                  className="block text-xs font-bold text-[#101411] dark:text-[#F4F7F4]"
                >
                  Electronic Calendar (.ics / webcal://) Meet Schedule Sync
                </label>
                <p className="text-2xs text-[#43584B] dark:text-[#93A39A]">
                  On Athletic.net, open Electronic Calendar Options on your team calendar to copy the Subscribe URL or download the .ics snapshot.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id={`${formId}-ics-url`}
                    data-testid="sync-ics-url-input"
                    type="text"
                    value={icsUrlInput}
                    onChange={(e) => setIcsUrlInput(e.target.value)}
                    placeholder="webcal://www.athletic.net/... or https://.../calendar.ics"
                    className="flex-1 min-h-[44px] sm:min-h-[38px] rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] px-3 py-1.5 font-mono text-xs text-[#101411] dark:text-[#F4F7F4]"
                  />
                  <button
                    type="button"
                    disabled={isBusy || !icsUrlInput.trim()}
                    data-testid="sync-ics-fetch-btn"
                    onClick={() => void handleSyncIcsFeed()}
                    className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-1.5 text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    Sync .ics URL
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    ref={icsFileInputRef}
                    type="file"
                    accept=".ics,text/calendar"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e, true)}
                  />
                  <button
                    type="button"
                    onClick={() => icsFileInputRef.current?.click()}
                    className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Downloaded .ics File</span>
                  </button>
                  <button
                    type="button"
                    data-testid="sync-load-wg-ics-btn"
                    onClick={() => void handleSyncIcsFeed(WILLOW_GLEN_XC_PRESET.sampleScheduleIcs)}
                    className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-lg border border-stone-300 dark:border-[#2B543B] bg-white dark:bg-[#15231B] font-mono text-2xs font-semibold text-[#101411] dark:text-[#F4F7F4] cursor-pointer"
                  >
                    Import Willow Glen Sample .ics
                  </button>
                </div>
              </div>
            </div>

            {/* Parent & Supporter Public Read-Only Hub */}
            <div className="rounded-xl border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck className="w-4 h-4 text-[#1C5436] dark:text-[#C8FF00] shrink-0" />
                  <h3 className="text-xs sm:text-sm font-bold text-[#101411] dark:text-[#F4F7F4] truncate">
                    Parent &amp; Supporter Read-Only Team Hub
                  </h3>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enablePublicHub}
                    onChange={(e) => setEnablePublicHub(e.target.checked)}
                    className="rounded border-stone-300"
                  />
                  <span>Enabled</span>
                </label>
              </div>
              <p className="text-xs text-[#43584B] dark:text-[#93A39A]">
                Shares meet schedules and official marks publicly; athlete emails, GPS routes, HRV, RPE, and weight stay private.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <code className="flex-1 min-w-[200px] rounded-lg border border-stone-200 dark:border-[#244331] bg-white dark:bg-[#15231B] px-2.5 py-2 font-mono text-2xs text-[#101411] dark:text-[#F4F7F4] truncate">
                  {publicHubUrl}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(publicHubUrl).catch(() => {});
                    setCopiedHubLink(true);
                    window.setTimeout(() => setCopiedHubLink(false), 2000);
                  }}
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedHubLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedHubLink ? 'Copied' : 'Copy Link'}</span>
                </button>
                {onOpenPublicHub && (
                  <button
                    type="button"
                    data-testid="sync-open-public-hub-btn"
                    onClick={() => {
                      const slug = activeTeam?.brand.slug || 'willow-glen-high-school-xc';
                      onClose();
                      onOpenPublicHub(slug);
                    }}
                    className="ap-btn-primary !min-h-[44px] sm:!min-h-[34px] px-3 py-1 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShareNetwork className="w-3.5 h-3.5" />
                    <span>Preview Parent Hub</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: 1-CLICK BROWSER BOOKMARKLET */}
        {tab === 'BOOKMARKLET' && (
          <div className="rounded-xl border border-stone-200 dark:border-[#244331] bg-stone-50 dark:bg-[#101B15] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-[#1C5436] dark:text-[#C8FF00] shrink-0" />
              <h3 className="text-sm font-bold text-[#101411] dark:text-[#F4F7F4]">
                1-Click &ldquo;Send to THRESH&rdquo; Browser Clipper
              </h3>
            </div>
            <p className="text-xs text-[#43584B] dark:text-[#93A39A]">
              One click inside any open Athletic.net or TFRRS browser tab sends that page&apos;s roster IDs or meet results straight to THRESH.
            </p>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-[#101411] dark:text-[#F4F7F4]">
              <li>
                Drag the <strong>Send to THRESH</strong> button below onto your browser&rsquo;s Bookmarks Bar.
              </li>
              <li>
                Open any Athletic.net team/meet page (e.g., Willow Glen <code>1073/xc</code>) or TFRRS team page and click <strong>Send to THRESH</strong>.
              </li>
            </ol>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <a
                href={bookmarkletHref}
                data-testid="sync-bookmarklet-link"
                onClick={(e) => {
                  e.preventDefault();
                  setStatusBanner({
                    tone: 'warning',
                    text: 'Drag this "Send to THRESH" button to your browser Bookmarks Bar, then click it while viewing Athletic.net or TFRRS.',
                  });
                }}
                className="ap-btn-primary !min-h-[44px] sm:!min-h-[38px] px-4 py-1.5 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Send to THRESH</span>
              </a>

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(bookmarkletHref).catch(() => {});
                  setCopiedBookmarklet(true);
                  window.setTimeout(() => setCopiedBookmarklet(false), 2000);
                }}
                className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3.5 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copiedBookmarklet ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedBookmarklet ? 'Copied Bookmarklet URL' : 'Copy Bookmarklet URL'}</span>
              </button>

              {activeTeam?.brand.externalSync?.athleticNetUrl && (
                <a
                  href={activeTeam.brand.externalSync.athleticNetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ap-btn-secondary !min-h-[44px] sm:!min-h-[38px] px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <span>Open Athletic.net</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (inlineRenderForTest || typeof document === 'undefined') {
    return modalInner;
  }
  return createPortal(modalInner, document.body);
};
