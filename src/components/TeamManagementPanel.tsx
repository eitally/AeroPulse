import React, { Suspense, useId, useMemo, useState } from 'react';
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Download,
  Globe,
  Link2,
  Plus,
  ShareNetwork,
  ShieldCheck,
  UserPlus,
} from './icons/PhosphorIcons';
import type {
  TeamBrandConfig,
  TeamOrgType,
  TeamSummaryWithRole,
} from '../types';
import {
  computeAccessibleTeamPalette,
  contrastRatio,
  getOrgTypeSafeguardingDefaults,
} from '../physiology/teamOnboardingEngine';
import {
  generateQrCodeSvgMarkup,
  openPrintableTeamPosterWindow,
} from '../utils/teamQrHelper';
import {
  buildThreshSessionHeaders,
  leaveOrGraduateTeamApi,
} from '../utils/teamLifecycleApi';
import { AeroPulseLogo } from './AeroPulseLogo';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
import { TeamBrandingStudioForm } from './team/TeamBrandingStudioForm';
import { TeamBulkRosterImporter } from './team/TeamBulkRosterImporter';
import { TeamRosterAndAuditSection } from './team/TeamRosterAndAuditSection';
import { getStoredCoachAttribution } from '../utils/attribution';
import { markSessionActiveHint } from '../utils/sessionHint';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const CoachingStaffPanel = lazyWithRetry(
  () =>
    import('./coach/CoachingStaffPanel').then((m) => ({
      default: m.CoachingStaffPanel,
    })),
  { chunkKey: 'CoachingStaffPanel', restoreTab: 'coach' }
);
const TeamBillingAndPoModal = lazyWithRetry(
  () =>
    import('./coach/TeamBillingAndPoModal').then((m) => ({
      default: m.TeamBillingAndPoModal,
    })),
  { chunkKey: 'TeamBillingAndPoModal', restoreTab: 'coach' }
);

interface TeamManagementPanelProps {
  selfName: string;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  resendConfigured: boolean;
  isSampleDemoMode?: boolean;
  initialShowCreateStudio?: boolean;
  onSelectActiveTeam: (teamId: string | null) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string | null) => void;
  onOpenClipboard?: () => void;
  onOpenExternalSync?: () => void;
  onOpenPublicTeamHub?: (slugOrCode: string) => void;
}

export function deriveShortNameFromTeamName(name: string): string {
  const clean = name.trim();
  if (!clean) return 'TEAM';
  if (clean.length <= 12) return clean.toUpperCase();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const compacted = words
      .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase()))
      .join('');
    if (compacted.length >= 2 && compacted.length <= 10) return compacted;
  }
  return clean.slice(0, 10).trim().toUpperCase();
}

export const TeamManagementPanel: React.FC<TeamManagementPanelProps> = ({
  selfName,
  myTeams,
  activeTeamId,
  resendConfigured,
  isSampleDemoMode = false,
  initialShowCreateStudio = false,
  onSelectActiveTeam,
  onTeamsUpdated,
  onOpenClipboard,
  onOpenExternalSync,
  onOpenPublicTeamHub,
}) => {
  const activeTeam = useMemo(
    () =>
      myTeams.find((t) => t.brand.teamId === activeTeamId) ||
      myTeams[0] ||
      null,
    [myTeams, activeTeamId]
  );

  const [showCreateOrEditStudio, setShowCreateOrEditStudio] = useState<boolean>(initialShowCreateStudio);
  const [studioMode, setStudioMode] = useState<'CREATE' | 'EDIT'>('CREATE');
  const [showAdvancedBranding, setShowAdvancedBranding] = useState<boolean>(false);

  React.useEffect(() => {
    if (initialShowCreateStudio) {
      setStudioMode('CREATE');
      setShowAdvancedBranding(false);
      setShowCreateOrEditStudio(true);
    }
  }, [initialShowCreateStudio]);

  // Studio Form State (clean empty defaults so coaches never submit sample school names)
  const [orgType, setOrgType] = useState<TeamOrgType>('HIGH_SCHOOL');
  const [teamName, setTeamName] = useState('');
  const [shortName, setShortName] = useState('');
  const [districtName, setDistrictName] = useState('');
  const [mascotOrMotto, setMascotOrMotto] = useState('');
  const [primarySport, setPrimarySport] = useState<
    'Running' | 'Cycling' | 'Swimming' | 'Triathlon' | 'Hybrid'
  >('Running');
  const [primaryHex, setPrimaryHex] = useState('#B83A24');
  const [secondaryHex, setSecondaryHex] = useState('#D97706');
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');
  const [defaultSafeSportShield, setDefaultSafeSportShield] = useState<boolean>(true);
  const [enableParentGuardianCc, setEnableParentGuardianCc] = useState<boolean>(true);
  const [coachDisplayName, setCoachDisplayName] = useState(
    selfName && selfName !== 'Athlete' ? selfName : ''
  );

  // Quick Join Additional Team State
  const [showJoinAnotherBar, setShowJoinAnotherBar] = useState(false);
  const [joinAnotherCode, setJoinAnotherCode] = useState('');
  const [joinBirthYear, setJoinBirthYear] = useState('');
  const [joinParentEmail, setJoinParentEmail] = useState('');
  const [showJoinAgeFields, setShowJoinAgeFields] = useState(false);
  const [isLeavingTeam, setIsLeavingTeam] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [defaultSquadForImport, setDefaultSquadForImport] = useState('Varsity');

  // Status & Feedback
  const [isSavingStudio, setIsSavingStudio] = useState(false);
  const [isSendingBulk, setIsSendingBulk] = useState(false);
  const [isJoiningTeam, setIsJoiningTeam] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    tone: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://meetready.app';
  const formId = useId();

  const handleOrgTypeChange = (nextOrg: TeamOrgType) => {
    setOrgType(nextOrg);
    const defaults = getOrgTypeSafeguardingDefaults(nextOrg);
    setDefaultSafeSportShield(defaults.defaultSafeSportShield);
    setEnableParentGuardianCc(defaults.enableParentGuardianCc);
    setPrimarySport(defaults.defaultPrimarySport);
    setDefaultSquadForImport(defaults.defaultSquads[0] || 'Varsity');
  };

  const openEditForActiveTeam = () => {
    if (!activeTeam) return;
    const b = activeTeam.brand;
    setStudioMode('EDIT');
    setOrgType(b.orgType);
    setTeamName(b.name);
    setShortName(b.shortName);
    setDistrictName(b.districtName || '');
    setMascotOrMotto(b.mascotOrMotto || '');
    setPrimarySport(b.primarySport);
    setPrimaryHex(b.primaryHex);
    setSecondaryHex(b.secondaryHex);
    setLogoDataUrl(b.logoDataUrl || '');
    setDefaultSafeSportShield(b.defaultSafeSportShield);
    setEnableParentGuardianCc(b.enableParentGuardianCc);
    setCoachDisplayName(b.coachDisplayName);
    setShowAdvancedBranding(true);
    setShowCreateOrEditStudio(true);
  };

  const openCreateNewTeam = () => {
    setStudioMode('CREATE');
    handleOrgTypeChange('HIGH_SCHOOL');
    setTeamName('');
    setShortName('');
    setDistrictName('');
    setMascotOrMotto('');
    setLogoDataUrl('');
    setShowAdvancedBranding(false);
    setShowCreateOrEditStudio(true);
  };

  const previewBrand = useMemo<TeamBrandConfig>(
    () => ({
      teamId: 'preview',
      slug: 'preview',
      joinCode: 'TEAM-26',
      name: teamName || 'Your Team Name',
      shortName: shortName || 'TEAM',
      mascotOrMotto: mascotOrMotto || undefined,
      districtName: districtName.trim() || undefined,
      orgType,
      primarySport,
      logoDataUrl: logoDataUrl || undefined,
      primaryHex,
      secondaryHex,
      defaultSafeSportShield,
      enableParentGuardianCc,
      coachDisplayName: coachDisplayName || 'Coach',
      createdAt: '',
    }),
    [
      teamName,
      shortName,
      mascotOrMotto,
      districtName,
      orgType,
      primarySport,
      logoDataUrl,
      primaryHex,
      secondaryHex,
      defaultSafeSportShield,
      enableParentGuardianCc,
      coachDisplayName,
    ]
  );

  const livePalette = useMemo(
    () => computeAccessibleTeamPalette(primaryHex, secondaryHex),
    [primaryHex, secondaryHex]
  );
  const lightRatio = useMemo(
    () => contrastRatio(livePalette.primaryOnLight, '#FFFFFF').toFixed(1),
    [livePalette.primaryOnLight]
  );
  const darkRatio = useMemo(
    () => contrastRatio(livePalette.primaryOnDark, '#15231B').toFixed(1),
    [livePalette.primaryOnDark]
  );

  const activeJoinUrl = activeTeam
    ? `${originUrl}/join/${activeTeam.brand.slug}`
    : `${originUrl}/join/team`;

  const activeQrSvg = useMemo(
    () =>
      activeTeam
        ? generateQrCodeSvgMarkup(activeJoinUrl, activeTeam.brand.primaryHex, 112)
        : '',
    [activeTeam, activeJoinUrl]
  );

  const copyTextWithFeedback = (key: string, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
      setCopiedId(key);
      window.setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleSaveTeamStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setIsSavingStudio(true);
    setBannerMessage(null);
    const trimmedDistrict = districtName.trim().slice(0, 80);
    try {
      if (isSampleDemoMode) {
        const resolvedShortName =
          shortName.trim() || deriveShortNameFromTeamName(teamName);
        if (studioMode === 'EDIT' && activeTeam) {
          const updatedTeam: TeamSummaryWithRole = {
            ...activeTeam,
            brand: {
              ...activeTeam.brand,
              name: teamName.trim(),
              shortName: resolvedShortName,
              mascotOrMotto: mascotOrMotto.trim() || undefined,
              districtName: trimmedDistrict || undefined,
              orgType,
              primarySport,
              primaryHex,
              secondaryHex,
              logoDataUrl: logoDataUrl || undefined,
              defaultSafeSportShield,
              enableParentGuardianCc,
              coachDisplayName: coachDisplayName.trim() || 'Coach',
            },
          };
          const nextList = myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          );
          onTeamsUpdated(nextList, updatedTeam.brand.teamId);
          setShowCreateOrEditStudio(false);
          setBannerMessage({
            tone: 'success',
            text: `Updated branding & safeguarding settings for ${updatedTeam.brand.name}.`,
          });
        } else {
          const nowIso = new Date().toISOString();
          const demoTeamId = `demo-team-${Date.now()}`;
          const slugBase =
            teamName
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'demo-team';
          const joinPrefix =
            resolvedShortName.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'DEMO';
          const resolvedCoachName = coachDisplayName.trim() || selfName || 'Head Coach';
          const created: TeamSummaryWithRole = {
            brand: {
              teamId: demoTeamId,
              slug: slugBase,
              joinCode: `${joinPrefix}-26`,
              name: teamName.trim(),
              shortName: resolvedShortName,
              ...(mascotOrMotto.trim() ? { mascotOrMotto: mascotOrMotto.trim() } : {}),
              ...(trimmedDistrict ? { districtName: trimmedDistrict } : {}),
              orgType,
              primarySport,
              primaryHex,
              secondaryHex,
              ...(logoDataUrl ? { logoDataUrl } : {}),
              defaultSafeSportShield,
              enableParentGuardianCc,
              coachDisplayName: resolvedCoachName,
              createdAt: nowIso,
            },
            myMembershipId: 'mem_demo_coach',
            myRole: 'HEAD_COACH',
            mySquadGroup: 'Varsity',
            totalInvited: 1,
            openedCount: 0,
            activeCount: 1,
            watchConnectedCount: 0,
            broadcastWorkouts: [],
            memberships: [
              {
                membershipId: 'mem_demo_coach',
                teamId: demoTeamId,
                role: 'HEAD_COACH',
                squadGroup: 'Varsity',
                invitedName: resolvedCoachName,
                isMinorU18: false,
                status: 'ACTIVE',
                sharingTier: 'FULL_STREAMS',
                invitedAt: nowIso,
                joinedAt: nowIso,
              },
            ],
          };
          onTeamsUpdated([...myTeams, created], created.brand.teamId);
          setShowCreateOrEditStudio(false);
          setBannerMessage({
            tone: 'success',
            text: `Created ${created.brand.name} (Join Code ${created.brand.joinCode}). Share the Join Code or paste your roster below.`,
          });
        }
        return;
      }

      if (studioMode === 'EDIT' && activeTeam) {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: buildThreshSessionHeaders(),
            body: JSON.stringify({
              origin: originUrl,
              name: teamName.trim(),
              shortName: shortName.trim() || undefined,
              mascotOrMotto: mascotOrMotto.trim(),
              districtName: trimmedDistrict,
              orgType,
              primarySport,
              primaryHex,
              secondaryHex,
              logoDataUrl: logoDataUrl || '',
              defaultSafeSportShield,
              enableParentGuardianCc,
              coachDisplayName: coachDisplayName.trim() || 'Coach',
            }),
          }
        );
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          setBannerMessage({
            tone: 'error',
            text: data.error || 'Could not update team branding.',
          });
          return;
        }
        const updatedTeam = data.team as TeamSummaryWithRole;
        const nextList = myTeams.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        );
        onTeamsUpdated(nextList, updatedTeam.brand.teamId);
        setShowCreateOrEditStudio(false);
        setBannerMessage({
          tone: 'success',
          text: `Updated branding & safeguarding settings for ${updatedTeam.brand.name}.`,
        });
      } else {
        const resolvedShortName =
          shortName.trim() || deriveShortNameFromTeamName(teamName);
        const resp = await fetch('/api/teams', {
          method: 'POST',
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
          body: JSON.stringify({
            origin: originUrl,
            name: teamName.trim(),
            shortName: resolvedShortName,
            mascotOrMotto: mascotOrMotto.trim() || undefined,
            districtName: trimmedDistrict || undefined,
            orgType,
            primarySport,
            primaryHex,
            secondaryHex,
            logoDataUrl: logoDataUrl || undefined,
            defaultSafeSportShield,
            enableParentGuardianCc,
            coachDisplayName: coachDisplayName.trim() || selfName || 'Head Coach',
            attribution: getStoredCoachAttribution(),
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          setBannerMessage({
            tone: 'error',
            text: data.error || 'Could not create team.',
          });
          return;
        }
        markSessionActiveHint();
        const created = data.team as TeamSummaryWithRole;
        onTeamsUpdated([...myTeams, created], created.brand.teamId);
        setShowCreateOrEditStudio(false);
        setBannerMessage({
          tone: 'success',
          text: `Created ${created.brand.name} (Join Code ${created.brand.joinCode}). Share the Join Code or paste your roster below.`,
        });
      }
    } catch {
      setBannerMessage({
        tone: 'error',
        text: 'Network error saving team settings.',
      });
    } finally {
      setIsSavingStudio(false);
    }
  };

  const handleJoinAdditionalTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinAnotherCode.trim()) return;
    const parsedYear = parseInt(joinBirthYear, 10);
    setIsJoiningTeam(true);
    setBannerMessage(null);
    try {
      const resp = await fetch('/api/teams/join-claim', {
        method: 'POST',
        credentials: 'include',
        headers: buildThreshSessionHeaders(),
        body: JSON.stringify({
          origin: originUrl,
          codeOrSlug: joinAnotherCode.trim(),
          athleteName: selfName || 'Athlete',
          ...(!isNaN(parsedYear) && parsedYear > 1900 ? { birthYear: parsedYear } : {}),
          ...(joinParentEmail.trim() ? { parentGuardianEmail: joinParentEmail.trim() } : {}),
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        if (
          typeof data.error === 'string' &&
          (data.error.toLowerCase().includes('parent') ||
            data.error.toLowerCase().includes('guardian') ||
            data.error.toLowerCase().includes('13'))
        ) {
          setShowJoinAgeFields(true);
        }
        setBannerMessage({
          tone: 'error',
          text: data.error || 'No team matched that Join Code.',
        });
        return;
      }
      markSessionActiveHint();
      const updatedTeams = (data.teams as TeamSummaryWithRole[]) || [];
      onTeamsUpdated(updatedTeams, data.team?.brand?.teamId);
      setJoinAnotherCode('');
      setJoinBirthYear('');
      setJoinParentEmail('');
      setShowJoinAgeFields(false);
      setShowJoinAnotherBar(false);
      setBannerMessage({
        tone: 'success',
        text: `Joined ${data.team?.brand?.name || 'team'}! Switch between your teams anytime above.`,
      });
    } catch {
      setBannerMessage({ tone: 'error', text: 'Could not join team.' });
    } finally {
      setIsJoiningTeam(false);
    }
  };

  const handleLeaveOrGraduateActiveTeam = async (mode: 'LEAVE' | 'GRADUATE_ALUMNI') => {
    if (!activeTeam) return;
    setIsLeavingTeam(true);
    setBannerMessage(null);
    try {
      const data = await leaveOrGraduateTeamApi(activeTeam.brand.teamId, mode, originUrl);
      const remaining = (data.teams as TeamSummaryWithRole[]) || [];
      onTeamsUpdated(remaining, remaining[0]?.brand?.teamId ?? null);
      setBannerMessage({
        tone: 'success',
        text:
          mode === 'GRADUATE_ALUMNI'
            ? `Moved to ${activeTeam.brand.shortName} Alumni. Official race marks stay credited and live sharing stopped.`
            : `Left ${activeTeam.brand.name}. Coach-recorded splits & official marks are saved in your personal history.`,
      });
    } catch (err) {
      setBannerMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not leave team.',
      });
    } finally {
      setIsLeavingTeam(false);
    }
  };

  const isActiveTeamCoach =
    activeTeam?.myRole === 'HEAD_COACH' ||
    activeTeam?.myRole === 'ASSISTANT_COACH' ||
    activeTeam?.myRole === 'ORG_ADMIN';
  const canManageGovernance =
    activeTeam?.myRole === 'HEAD_COACH' || activeTeam?.myRole === 'ORG_ADMIN';
  const isDemoTeam = Boolean(
    isSampleDemoMode || activeTeam?.brand.teamId.startsWith('demo_team_')
  );

  return (
    <div className="space-y-4">
      {/* Multi-Team Switcher Bar (only shown once at least one team exists) */}
      {myTeams.length > 0 && (
        <div className="rounded-2xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-3.5 sm:p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Your Teams ({myTeams.length})
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowJoinAnotherBar((prev) => !prev)}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl bg-white dark:bg-ap-carbon border border-stone-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 text-[#0D9488]" />
                <span>Join Team</span>
              </button>

              <button
                type="button"
                data-testid="team-create-new-btn"
                onClick={openCreateNewTeam}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl ap-btn-primary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create New Team</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {myTeams.map((t) => {
              const isSelected = activeTeamId === t.brand.teamId;
              return (
                <button
                  key={t.brand.teamId}
                  type="button"
                  onClick={() => {
                    onSelectActiveTeam(t.brand.teamId);
                    setShowCreateOrEditStudio(false);
                  }}
                  className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white dark:bg-ap-turf border-slate-900/30 dark:border-emerald-400/40 shadow-xs text-slate-900 dark:text-white'
                      : 'bg-white/60 dark:bg-ap-carbon border-stone-200 dark:border-emerald-400/20 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: t.brand.primaryHex }}
                  />
                  <span>{t.brand.shortName || t.brand.name}</span>
                  <span className="text-2xs font-mono uppercase px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {t.myRole === 'ATHLETE'
                      ? 'Athlete'
                      : t.myRole === 'PARENT_FOLLOWER'
                        ? 'Parent / Fan'
                        : t.myRole === 'ORG_ADMIN'
                          ? 'Org Admin'
                          : t.myRole === 'ATHLETIC_TRAINER'
                            ? 'Trainer'
                            : 'Coach'}
                  </span>
                </button>
              );
            })}

            {activeTeam && (
              <button
                type="button"
                data-testid="team-personal-mode-btn"
                onClick={() => onSelectActiveTeam(null)}
                className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-xl text-2xs font-mono text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Personal Mode
              </button>
            )}
          </div>

          {showJoinAnotherBar && (
            <form
              onSubmit={handleJoinAdditionalTeam}
              className="pt-2 border-t border-stone-200 dark:border-slate-800 space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={joinAnotherCode}
                  aria-label="Enter 6-character Team Join Code or slug"
                  onChange={(e) => setJoinAnotherCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-character Team Join Code (e.g. WGHS-26)"
                  className="flex-1 min-w-[200px] min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono font-bold uppercase text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setShowJoinAgeFields((v) => !v)}
                  className="min-h-[44px] px-3 py-1.5 rounded-xl text-2xs font-mono text-slate-600 dark:text-slate-300 hover:bg-stone-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {showJoinAgeFields ? 'Hide Age / Guardian' : 'Youth / Guardian?'}
                </button>
                <button
                  type="submit"
                  disabled={isJoiningTeam || !joinAnotherCode.trim()}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-semibold cursor-pointer"
                >
                  {isJoiningTeam ? 'Joining...' : 'Join Team'}
                </button>
              </div>
              {showJoinAgeFields && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1920}
                    max={new Date().getFullYear()}
                    aria-label="Birth year (optional)"
                    value={joinBirthYear}
                    onChange={(e) => setJoinBirthYear(e.target.value)}
                    placeholder="Birth Year (e.g. 2009)"
                    className="min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="email"
                    aria-label="Parent or guardian email (required if 13–17)"
                    value={joinParentEmail}
                    onChange={(e) => setJoinParentEmail(e.target.value)}
                    placeholder="Parent/Guardian Email (if 13–17)"
                    className="min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {bannerMessage && (
        <div
          role={bannerMessage.tone === 'error' ? 'alert' : 'status'}
          aria-live={bannerMessage.tone === 'error' ? undefined : 'polite'}
          className={`rounded-xl px-4 py-3 text-xs font-medium flex items-center justify-between gap-2 ${
            bannerMessage.tone === 'error'
              ? 'ap-status-strained'
              : bannerMessage.tone === 'info'
                ? 'ap-status-info'
                : 'ap-status-prime'
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{bannerMessage.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="min-h-[44px] sm:min-h-[36px] px-2 underline text-2xs font-mono cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ====================================================================
          EMPTY STATE 2-CARD CHOOSER: CREATE TEAM vs JOIN WITH CODE
         ==================================================================== */}
      {myTeams.length === 0 && !showCreateOrEditStudio && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 min-w-0">
          {/* Card 1: Head Coach Creating New Team */}
          <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-4 sm:p-5 flex flex-col justify-between space-y-4 shadow-sm min-w-0">
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Create a Team Workspace
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Get a 6-character Join Code, printable locker-room QR sheet, and automatic VDOT pace pods in one step.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="team-empty-create-btn"
                onClick={openCreateNewTeam}
                className="flex-1 min-h-[44px] ap-btn-primary justify-center text-xs sm:text-sm font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Team</span>
              </button>
              {onOpenExternalSync && (
                <button
                  type="button"
                  onClick={onOpenExternalSync}
                  className="min-h-[44px] px-3.5 ap-btn-secondary justify-center text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Globe className="w-4 h-4 ap-text-brand" />
                  <span>Import Athletic.net / TFRRS</span>
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Athlete / Assistant Joining w/ Team Code */}
          <form
            onSubmit={handleJoinAdditionalTeam}
            className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-4 sm:p-5 flex flex-col justify-between space-y-4 shadow-sm min-w-0"
          >
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Join With a Team Code
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Have a 6-character code from your head coach? Enter it below to join the squad.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={joinAnotherCode}
                  aria-label="Enter Team Join Code"
                  onChange={(e) => setJoinAnotherCode(e.target.value.toUpperCase())}
                  placeholder="e.g. WGHS-26"
                  className="flex-1 min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3.5 py-2 text-sm font-mono font-bold uppercase text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={isJoiningTeam || !joinAnotherCode.trim()}
                  className="min-h-[44px] px-4 ap-btn-secondary justify-center text-xs sm:text-sm font-bold cursor-pointer disabled:opacity-50"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{isJoiningTeam ? 'Joining...' : 'Join Team'}</span>
                </button>
              </div>
              {showJoinAgeFields && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1920}
                    max={new Date().getFullYear()}
                    aria-label="Birth year"
                    value={joinBirthYear}
                    onChange={(e) => setJoinBirthYear(e.target.value)}
                    placeholder="Birth Year (e.g. 2009)"
                    className="min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <input
                    type="email"
                    aria-label="Parent or guardian email"
                    value={joinParentEmail}
                    onChange={(e) => setJoinParentEmail(e.target.value)}
                    placeholder="Parent/Guardian Email (if 13–17)"
                    className="min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>
          </form>
        </div>
      )}

      {/* ====================================================================
          TEAM CREATION & OPTIONAL BRANDING / SAFEGUARDING (PROGRESSIVE)
         ==================================================================== */}
      {showCreateOrEditStudio && (
        <TeamBrandingStudioForm
          formId={formId}
          studioMode={studioMode}
          activeTeamName={activeTeam?.brand.name}
          orgType={orgType}
          onOrgTypeChange={handleOrgTypeChange}
          teamName={teamName}
          setTeamName={setTeamName}
          shortName={shortName}
          setShortName={setShortName}
          derivedShortName={deriveShortNameFromTeamName(teamName)}
          districtName={districtName}
          setDistrictName={setDistrictName}
          coachDisplayName={coachDisplayName}
          setCoachDisplayName={setCoachDisplayName}
          primaryHex={primaryHex}
          setPrimaryHex={setPrimaryHex}
          secondaryHex={secondaryHex}
          setSecondaryHex={setSecondaryHex}
          logoDataUrl={logoDataUrl}
          setLogoDataUrl={setLogoDataUrl}
          defaultSafeSportShield={defaultSafeSportShield}
          setDefaultSafeSportShield={setDefaultSafeSportShield}
          enableParentGuardianCc={enableParentGuardianCc}
          setEnableParentGuardianCc={setEnableParentGuardianCc}
          showAdvancedBranding={showAdvancedBranding}
          setShowAdvancedBranding={setShowAdvancedBranding}
          isSavingStudio={isSavingStudio}
          previewBrand={previewBrand}
          livePalette={livePalette}
          lightRatio={lightRatio}
          darkRatio={darkRatio}
          onSubmit={handleSaveTeamStudio}
          onCancel={() => setShowCreateOrEditStudio(false)}
          onErrorMessage={(text) => setBannerMessage({ tone: 'error', text })}
        />
      )}

      {/* ====================================================================
          ACTIVE TEAM DASHBOARD: QR POSTER, BULK RESEND INVITER & LIVE FUNNEL
         ==================================================================== */}
      {activeTeam && (
        <div className="space-y-6">
          {/* Team Identity & Zero-Cost Share Banner */}
          <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              {activeQrSvg && (
                <div
                  className="hidden sm:block p-1.5 rounded-xl bg-white border border-stone-200 shrink-0"
                  dangerouslySetInnerHTML={{ __html: activeQrSvg }}
                />
              )}
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <AeroPulseLogo size="sm" teamBrand={activeTeam.brand} />
                  <span className="px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ap-status-info">
                    Code: {activeTeam.brand.joinCode}
                  </span>
                  {activeTeam.brand.defaultSafeSportShield && (
                    <span className="px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ap-status-prime inline-flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Safe-Sport Shield ON</span>
                    </span>
                  )}
                </div>

                <div className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
                  Magic Team Link: <strong className="select-all">{activeJoinUrl}</strong>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => copyTextWithFeedback('team-url', activeJoinUrl)}
                    className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedId === 'team-url' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied Link!</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Copy Join Link</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      openPrintableTeamPosterWindow(activeTeam.brand, activeJoinUrl)
                    }
                    className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#0284C7]" />
                    <span>Print QR Poster</span>
                  </button>

                  {onOpenPublicTeamHub && (
                    <button
                      type="button"
                      data-testid="panel-open-public-hub-btn"
                      onClick={() => onOpenPublicTeamHub(activeTeam.brand.slug)}
                      className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ShareNetwork className="w-3.5 h-3.5 text-[#0D9488]" />
                      <span>Parent Hub</span>
                    </button>
                  )}

                  {(activeTeam.myRole === 'ATHLETE' ||
                    activeTeam.myRole === 'PARENT_FOLLOWER') && (
                    <>
                      {activeTeam.myRole === 'ATHLETE' &&
                        (activeTeam.brand.orgType === 'HIGH_SCHOOL' ||
                          activeTeam.brand.orgType === 'COLLEGIATE') &&
                        activeTeam.memberships.find(
                          (m) => m.membershipId === activeTeam.myMembershipId
                        )?.status !== 'ALUMNI' && (
                          <button
                            type="button"
                            data-testid="team-graduate-self-btn"
                            disabled={isLeavingTeam}
                            onClick={() =>
                              void handleLeaveOrGraduateActiveTeam('GRADUATE_ALUMNI')
                            }
                            className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg ap-btn-secondary text-xs font-semibold cursor-pointer disabled:opacity-50"
                          >
                            Graduate to Alumni
                          </button>
                        )}
                      <button
                        type="button"
                        data-testid="team-leave-btn"
                        disabled={isLeavingTeam}
                        onClick={() => void handleLeaveOrGraduateActiveTeam('LEAVE')}
                        className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 cursor-pointer disabled:opacity-50"
                      >
                        Leave Team (Keep My Data)
                      </button>
                    </>
                  )}

                  {isActiveTeamCoach && (
                    <>
                      <button
                        type="button"
                        onClick={openEditForActiveTeam}
                        className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold cursor-pointer"
                      >
                        Edit Team
                      </button>

                      {(activeTeam.myRole === 'HEAD_COACH' || activeTeam.myRole === 'ORG_ADMIN') && (
                        <button
                          type="button"
                          data-testid="panel-open-billing-btn"
                          onClick={() => setShowBillingModal(true)}
                          className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold cursor-pointer"
                        >
                          School PO &amp; Billing
                        </button>
                      )}

                      {onOpenClipboard && (
                        <button
                          type="button"
                          onClick={onOpenClipboard}
                          className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-lg ap-btn-primary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <CalendarPlus className="w-3.5 h-3.5" />
                          <span>Open Clipboard →</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 4-Stage Onboarding Funnel Metrics */}
            <div className="grid grid-cols-4 gap-2 w-full lg:w-auto shrink-0">
              {[
                { label: 'Invited', val: activeTeam.totalInvited },
                { label: 'Opened', val: activeTeam.openedCount },
                { label: 'Joined', val: activeTeam.activeCount },
                { label: 'Synced', val: activeTeam.watchConnectedCount },
              ].map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl liquid-glass-subtle px-3 py-2 text-center min-w-[68px]"
                >
                  <div className="text-base sm:text-lg font-bold font-mono text-slate-900 dark:text-white">
                    {kpi.val}
                  </div>
                  <div className="text-2xs font-mono uppercase text-slate-500">
                    {kpi.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Coach-Only Athlete Importer */}
          {isActiveTeamCoach && (
            <TeamBulkRosterImporter
              activeTeam={activeTeam}
              myTeams={myTeams}
              orgType={orgType}
              defaultSquadForImport={defaultSquadForImport}
              originUrl={originUrl}
              resendConfigured={resendConfigured}
              isSendingBulk={isSendingBulk}
              setIsSendingBulk={setIsSendingBulk}
              onTeamsUpdated={onTeamsUpdated}
              onOpenExternalSync={onOpenExternalSync}
              onBannerMessage={setBannerMessage}
            />
          )}

          <Suspense fallback={null}>
            <CoachingStaffPanel
              activeTeam={activeTeam}
              myTeams={myTeams}
              isSampleDemoMode={isSampleDemoMode}
              onTeamsUpdated={onTeamsUpdated}
            />
          </Suspense>

          {/* Live Team Roster & Onboarding Funnel Status Table */}
          <TeamRosterAndAuditSection
            activeTeam={activeTeam}
            myTeams={myTeams}
            activeJoinUrl={activeJoinUrl}
            originUrl={originUrl}
            resendConfigured={resendConfigured}
            isSampleDemoMode={isSampleDemoMode}
            isActiveTeamCoach={isActiveTeamCoach}
            canManageGovernance={canManageGovernance}
            isDemoTeam={isDemoTeam}
            isSendingBulk={isSendingBulk}
            setIsSendingBulk={setIsSendingBulk}
            copiedId={copiedId}
            onCopyText={copyTextWithFeedback}
            onTeamsUpdated={onTeamsUpdated}
            onBannerMessage={setBannerMessage}
          />
        </div>
      )}

      {showBillingModal && activeTeam && (
        <WorkspaceErrorBoundary fallbackTitle="School PO & Billing" restoreTab="coach">
          <Suspense fallback={null}>
            <TeamBillingAndPoModal
              isOpen={showBillingModal}
              onClose={() => setShowBillingModal(false)}
              activeTeam={activeTeam}
              myTeams={myTeams}
              isSampleDemoMode={isSampleDemoMode}
              onTeamsUpdated={onTeamsUpdated}
            />
          </Suspense>
        </WorkspaceErrorBoundary>
      )}
    </div>
  );
};
