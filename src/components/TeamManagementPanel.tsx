import React, { Suspense, useId, useMemo, useRef, useState } from 'react';
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Link2,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShareNetwork,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
  Users,
} from './icons/PhosphorIcons';
import type {
  CoachEventGroup,
  TeamAuditLogEntry,
  TeamBrandConfig,
  TeamMemberRole,
  TeamOrgType,
  TeamSummaryWithRole,
} from '../types';
import {
  COACH_EVENT_GROUP_OPTIONS,
  CURATED_TEAM_PALETTE_PRESETS,
  buildFreeNativeSmsUri,
  computeAccessibleTeamPalette,
  contrastRatio,
  getOrgTypeSafeguardingDefaults,
  parseBulkRosterCsvOrText,
} from '../physiology/teamOnboardingEngine';
import {
  generateQrCodeSvgMarkup,
  openPrintableTeamPosterWindow,
} from '../utils/teamQrHelper';
import {
  buildThreshSessionHeaders,
  fetchTeamAuditLogApi,
  graduateClassApi,
  leaveOrGraduateTeamApi,
  mergeRosterMembersApi,
  requestParentConsentLinkApi,
  transferHeadCoachApi,
  updateAssistantCoachEventGroupsApi,
  updateMemberRoleApi,
  updateMemberStatusApi,
} from '../utils/teamLifecycleApi';
import { AeroPulseLogo } from './AeroPulseLogo';
import { getStoredCoachAttribution } from '../utils/attribution';
import { lazyWithRetry } from '../utils/lazyWithRetry';

const CoachingStaffPanel = lazyWithRetry(
  () =>
    import('./coach/CoachingStaffPanel').then((m) => ({
      default: m.CoachingStaffPanel,
    })),
  { chunkKey: 'CoachingStaffPanel', restoreTab: 'coach' }
);
const TeamBillingAndPoModal = lazyWithRetry(() => import('./coach/TeamBillingAndPoModal').then((m) => ({ default: m.TeamBillingAndPoModal })), { chunkKey: 'TeamBillingAndPoModal', restoreTab: 'coach' });

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

const ORG_TYPE_OPTIONS: Array<{ id: TeamOrgType; label: string; subtitle: string }> = [
  {
    id: 'HIGH_SCHOOL',
    label: 'High School XC / Track',
    subtitle: 'Safe-Sport Shield + Parent CC ON',
  },
  {
    id: 'COLLEGIATE',
    label: 'Collegiate Program',
    subtitle: 'NCAA 20h CARA + Safe-Sport ON',
  },
  {
    id: 'RUNNING_CLUB',
    label: 'Running Club / Track Group',
    subtitle: 'VDOT Pods & Road/Track Blocks',
  },
  {
    id: 'CYCLING_CLUB',
    label: 'Cycling Team / Velo Club',
    subtitle: 'A/B/C Ride Groups & eFTP Zones',
  },
  {
    id: 'COACH_SQUAD',
    label: '1-on-1 / Private Coach Squad',
    subtitle: 'Hybrid Run & Ride Athletes',
  },
];

async function downscaleLogoFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.onload = () => {
      const resultStr = String(reader.result || '');
      if (file.type === 'image/svg+xml' && resultStr.length <= 48_000) {
        resolve(resultStr);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image format.'));
      img.onload = () => {
        const maxDim = 128;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(16, Math.round(img.width * scale));
        const h = Math.max(16, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(resultStr.slice(0, 90_000));
          return;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const webp = canvas.toDataURL('image/webp', 0.86);
        if (webp.startsWith('data:image/webp') && webp.length <= 64_000) {
          resolve(webp);
        } else {
          resolve(canvas.toDataURL('image/png'));
        }
      };
      img.src = resultStr;
    };
    reader.readAsDataURL(file);
  });
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
  const [busyRosterMemberId, setBusyRosterMemberId] = useState<string | null>(null);
  const [isGraduatingClass, setIsGraduatingClass] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [auditEntries, setAuditEntries] = useState<TeamAuditLogEntry[]>([]);
  const [isLoadingAuditLog, setIsLoadingAuditLog] = useState(false);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);

  // Bulk Roster CSV / Paste Inviter State
  const [rawRosterInput, setRawRosterInput] = useState('');
  const [defaultSquadForImport, setDefaultSquadForImport] = useState('Varsity');
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Status & Feedback
  const [isSavingStudio, setIsSavingStudio] = useState(false);
  const [isSendingBulk, setIsSendingBulk] = useState(false);
  const [isJoiningTeam, setIsJoiningTeam] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyingParentLinkId, setCopyingParentLinkId] = useState<string | null>(null);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterEventFilter, setRosterEventFilter] = useState<string>('ALL');
  const [rosterAwaitingParentOnly, setRosterAwaitingParentOnly] = useState(false);
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

  const parsedRosterPreview = useMemo(
    () =>
      parseBulkRosterCsvOrText(
        rawRosterInput,
        activeTeam?.brand.orgType || orgType,
        defaultSquadForImport
      ),
    [rawRosterInput, activeTeam?.brand.orgType, orgType, defaultSquadForImport]
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

  const handleCopyParentConsentLink = async (membershipId: string) => {
    if (!activeTeam) return;
    if (isSampleDemoMode || activeTeam.brand.teamId.startsWith('demo-team-')) {
      copyTextWithFeedback(
        `parent-${membershipId}`,
        `${originUrl}/api/teams/parent-consent?token=demo-${membershipId}`
      );
      setBannerMessage({ tone: 'info', text: 'Copied 1-click Parent Consent link.' });
      return;
    }
    setCopyingParentLinkId(membershipId);
    try {
      const data = await requestParentConsentLinkApi({
        teamId: activeTeam.brand.teamId,
        membershipId,
        originUrl,
      });
      if (data.consentUrl) {
        copyTextWithFeedback(`parent-${membershipId}`, data.consentUrl);
      }
      if (data.team) {
        applyUpdatedTeamSummary(data.team);
      }
      setBannerMessage({
        tone: 'success',
        text:
          data.emailStatus === 'SENT_RESEND'
            ? 'Copied Parent Consent link & emailed guardian.'
            : 'Copied 1-click Parent Consent link — paste via text or email.',
      });
    } catch (err) {
      setBannerMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Failed generating parent consent link.',
      });
    } finally {
      setCopyingParentLinkId(null);
    }
  };

  const handleSaveTeamStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setIsSavingStudio(true);
    setBannerMessage(null);
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
        if (data.sessionToken && typeof window !== 'undefined') {
          try {
            localStorage.setItem('aeropulse_session_token', String(data.sessionToken));
          } catch {
            // ignore storage failures
          }
        }
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
      if (data.sessionToken && typeof window !== 'undefined') {
        try {
          localStorage.setItem('aeropulse_session_token', String(data.sessionToken));
        } catch {
          // ignore storage failures
        }
      }
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

  const applyUpdatedTeamSummary = (updatedTeam: TeamSummaryWithRole) => {
    onTeamsUpdated(
      myTeams.map((t) =>
        t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
      ),
      updatedTeam.brand.teamId
    );
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

  const runMemberMutation = async (
    membershipId: string,
    fn: () => Promise<{ team?: TeamSummaryWithRole; error?: string }>,
    successMsg?: string
  ) => {
    setBusyRosterMemberId(membershipId);
    setBannerMessage(null);
    try {
      const data = await fn();
      if (data.team) applyUpdatedTeamSummary(data.team);
      if (successMsg) setBannerMessage({ tone: 'success', text: successMsg });
    } catch (err) {
      setBannerMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Roster update failed.',
      });
    } finally {
      setBusyRosterMemberId(null);
    }
  };

  const handleGraduateClass = async (graduationYear: number) => {
    if (!activeTeam) return;
    setIsGraduatingClass(true);
    setBannerMessage(null);
    try {
      const data = await graduateClassApi(activeTeam.brand.teamId, graduationYear, originUrl);
      if (data.team) applyUpdatedTeamSummary(data.team);
      setBannerMessage({
        tone: 'success',
        text: `Graduated Class of ${graduationYear} (${data.graduatedCount || 0} moved to Alumni).`,
      });
    } catch (err) {
      setBannerMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not graduate class.',
      });
    } finally {
      setIsGraduatingClass(false);
    }
  };

  const handleSendBulkInvites = async () => {
    if (!activeTeam || parsedRosterPreview.length === 0) return;
    setIsSendingBulk(true);
    setBannerMessage(null);
    try {
      const resp = await fetch(
        `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/invites/bulk`,
        {
          method: 'POST',
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
          body: JSON.stringify({
            origin: originUrl,
            rows: parsedRosterPreview,
            sendEmailsNow: true,
          }),
        }
      );
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setBannerMessage({
          tone: 'error',
          text: data.error || 'Failed to add roster invites.',
        });
        return;
      }
      const updatedTeam = data.team as TeamSummaryWithRole;
      onTeamsUpdated(
        myTeams.map((t) =>
          t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
        ),
        updatedTeam.brand.teamId
      );
      setRawRosterInput('');
      setBannerMessage({
        tone: 'success',
        text: data.emailedCount > 0
          ? `Added ${data.addedCount} athletes and dispatched ${data.emailedCount} branded invite email(s).`
          : `Added ${data.addedCount} athletes with personalized Magic Join Links ready to copy, text (SMS), or email!`,
      });
    } catch {
      setBannerMessage({
        tone: 'error',
        text: 'Network error sending bulk roster invites.',
      });
    } finally {
      setIsSendingBulk(false);
    }
  };

  const handleResendPending = async (membershipId = 'ALL_PENDING') => {
    if (!activeTeam) return;
    setIsSendingBulk(true);
    try {
      const resp = await fetch(
        `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/invites/resend`,
        {
          method: 'POST',
          credentials: 'include',
          headers: buildThreshSessionHeaders(),
          body: JSON.stringify({ origin: originUrl, membershipId }),
        }
      );
      const data = await resp.json();
      if (resp.ok && data.team) {
        const updatedTeam = data.team as TeamSummaryWithRole;
        onTeamsUpdated(
          myTeams.map((t) =>
            t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
          ),
          updatedTeam.brand.teamId
        );
        setBannerMessage({
          tone: 'info',
          text:
            data.emailedCount > 0
              ? `Sent ${data.emailedCount} invite reminder email(s).`
              : 'Refreshed magic invite links — share via Copy Link, Email, or Text.',
        });
      }
    } finally {
      setIsSendingBulk(false);
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

  const handleToggleAuditLog = async () => {
    if (!activeTeam) return;
    if (showAuditLog) {
      setShowAuditLog(false);
      return;
    }
    setShowAuditLog(true);
    setAuditLogError(null);
    if (isDemoTeam) {
      setAuditEntries([
        {
          eventId: 'demo-audit-1',
          createdAt: activeTeam.brand.createdAt,
          teamId: activeTeam.brand.teamId,
          actorSid: activeTeam.myMembershipId,
          action: 'TEAM_CREATED',
          metadata: { orgType: activeTeam.brand.orgType, safeSportShield: true },
        },
        {
          eventId: 'demo-audit-2',
          createdAt: new Date().toISOString(),
          teamId: activeTeam.brand.teamId,
          actorSid: activeTeam.myMembershipId,
          action: 'GUARDIAN_SAFETY_ALERT_SENT',
          targetId: 'demo-mem-ath-02',
          metadata: { category: 'PAIN_FLAG', painLocation: 'SHIN', ccGuardian: true },
        },
      ]);
      return;
    }
    setIsLoadingAuditLog(true);
    try {
      const res = await fetchTeamAuditLogApi(activeTeam.brand.teamId, 100);
      setAuditEntries(res.entries || []);
    } catch (err) {
      setAuditLogError(err instanceof Error ? err.message : 'Could not load audit log.');
    } finally {
      setIsLoadingAuditLog(false);
    }
  };

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
        <form
          onSubmit={handleSaveTeamStudio}
          data-testid="team-studio-form"
          className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-4 sm:p-5 space-y-4 shadow-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {studioMode === 'EDIT'
                  ? `Edit ${activeTeam?.brand.name}`
                  : 'Create Team Workspace'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Choose your program type and enter your team name to get your Join Code right away.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateOrEditStudio(false)}
              className="min-h-[44px] sm:min-h-[34px] px-3 rounded-lg text-xs font-mono text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>

          {/* Organization Type Cards */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                id={`${formId}-org-type-label`}
                className="text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Program Type
              </div>
              <span className="text-2xs font-mono text-ap-cobalt dark:text-ap-volt">
                Auto-defaults: {defaultSafeSportShield ? 'Safe-Sport Shield ON' : 'Standard Weight View'}
                {enableParentGuardianCc ? ' · Parent CC ON' : ''}
              </span>
            </div>
            <div
              role="group"
              aria-labelledby={`${formId}-org-type-label`}
              className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2"
            >
              {ORG_TYPE_OPTIONS.map((opt) => {
                const selected = orgType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleOrgTypeChange(opt.id)}
                    className={`min-h-[44px] text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                      selected
                        ? 'liquid-capsule-active text-ap-ink dark:text-ap-chalk'
                        : 'border-emerald-900/15 dark:border-emerald-400/20 bg-white dark:bg-ap-turf text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold leading-snug">{opt.label}</div>
                    <div className="text-2xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      {opt.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Essential 2-Field Row: Team Name + Coach Display Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`${formId}-team-name`}
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                School or Club Team Name
              </label>
              <input
                id={`${formId}-team-name`}
                data-testid="team-name-input"
                type="text"
                required
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Willow Glen High School XC"
                className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor={`${formId}-coach-name`}
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Coach Display Name
              </label>
              <input
                id={`${formId}-coach-name`}
                type="text"
                value={coachDisplayName}
                onChange={(e) => setCoachDisplayName(e.target.value)}
                placeholder="e.g. Coach Rivera"
                className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Progressive Disclosure: Optional Short Name, Colors, Crest & Safeguarding Overrides */}
          <div className="rounded-xl ap-card-inset overflow-hidden">
            <button
              type="button"
              data-testid="team-toggle-advanced-branding"
              aria-expanded={showAdvancedBranding}
              onClick={() => setShowAdvancedBranding((prev) => !prev)}
              className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
            >
              <span>Customize Short Name, Colors, Crest &amp; Safeguarding (Optional)</span>
              <ChevronDown
                className={`w-4 h-4 text-slate-500 transition-transform ${
                  showAdvancedBranding ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showAdvancedBranding && (
              <div className="px-3.5 pb-4 pt-2 border-t border-stone-200/80 dark:border-ap-edge grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <div className="lg:col-span-7 space-y-3">
                  <div>
                    <label
                      htmlFor={`${formId}-short-name`}
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Header Short Name
                    </label>
                    <input
                      id={`${formId}-short-name`}
                      type="text"
                      value={shortName}
                      onChange={(e) => setShortName(e.target.value.toUpperCase())}
                      placeholder={
                        teamName.trim()
                          ? deriveShortNameFromTeamName(teamName)
                          : 'Auto-generated from Team Name'
                      }
                      maxLength={18}
                      className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2 text-xs font-mono font-bold uppercase text-slate-900 dark:text-slate-100"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      id={`${formId}-palette-label`}
                      className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      School / Club Palette (WCAG 2.1 AA Contrast-Safe)
                    </div>
                    <span className="text-2xs font-mono text-emerald-700 dark:text-emerald-300">
                      Light {lightRatio}:1 · Dark {darkRatio}:1 · Zones Z1–Z6 Protected
                    </span>
                  </div>

                  <div
                    role="group"
                    aria-labelledby={`${formId}-palette-label`}
                    className="flex flex-wrap gap-1.5"
                  >
                    {CURATED_TEAM_PALETTE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setPrimaryHex(preset.primaryHex);
                          setSecondaryHex(preset.secondaryHex);
                        }}
                        className="min-h-[38px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-slate-800 bg-white dark:bg-ap-turf hover:border-slate-400 text-2xs font-medium cursor-pointer"
                      >
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: preset.primaryHex }}
                        />
                        <span
                          className="w-3 h-3 rounded-full -ml-1"
                          style={{ backgroundColor: preset.secondaryHex }}
                        />
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div className="flex items-center gap-2 rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2">
                      <input
                        id={`${formId}-primary-color`}
                        type="color"
                        value={primaryHex}
                        aria-label="Primary school or club color"
                        onChange={(e) => setPrimaryHex(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <label htmlFor={`${formId}-primary-color`} className="text-xs cursor-pointer">
                        <span className="block font-semibold">Primary</span>
                        <span className="block font-mono text-2xs text-slate-500">{primaryHex}</span>
                      </label>
                    </div>

                    <div className="flex items-center gap-2 rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2">
                      <input
                        id={`${formId}-secondary-color`}
                        type="color"
                        value={secondaryHex}
                        aria-label="Secondary school or club color"
                        onChange={(e) => setSecondaryHex(e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                      />
                      <label htmlFor={`${formId}-secondary-color`} className="text-xs cursor-pointer">
                        <span className="block font-semibold">Secondary</span>
                        <span className="block font-mono text-2xs text-slate-500">
                          {secondaryHex}
                        </span>
                      </label>
                    </div>

                    <div>
                      <input
                        ref={logoFileInputRef}
                        type="file"
                        aria-label="Upload team crest or logo image"
                        accept="image/svg+xml,image/png,image/webp,image/jpeg"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            const resized = await downscaleLogoFileToDataUrl(f);
                            setLogoDataUrl(resized);
                          } catch {
                            setBannerMessage({
                              tone: 'error',
                              text: 'Could not process crest image.',
                            });
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => logoFileInputRef.current?.click()}
                        className="w-full h-full min-h-[46px] rounded-xl border border-dashed border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 hover:border-blue-500 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-[#0284C7]" />
                        <span>{logoDataUrl ? 'Replace Crest' : 'Upload Crest'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-xl bg-white dark:bg-ap-carbon border border-stone-200 dark:border-emerald-400/20 p-3.5 space-y-3">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Header Lockup Preview
                  </div>
                  <div className="rounded-xl bg-white dark:bg-ap-turf border border-stone-200 dark:border-emerald-400/20 p-3 relative overflow-hidden">
                    <div
                      className="absolute top-0 left-0 right-0 h-[3px]"
                      style={{ background: livePalette.hairlineGradientLight }}
                    />
                    <AeroPulseLogo size="md" showTagline teamBrand={previewBrand} />
                  </div>

                  <div className="space-y-2 pt-1 text-xs">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={defaultSafeSportShield}
                        onChange={(e) => setDefaultSafeSportShield(e.target.checked)}
                        className="mt-0.5 rounded"
                      />
                      <span>
                        <strong className="text-slate-900 dark:text-white">
                          Safe-Sport Weight Shield
                        </strong>
                        <span className="block text-2xs text-slate-500 dark:text-slate-400">
                          Hides body weight and W/kg across youth team views.
                        </span>
                      </span>
                    </label>

                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableParentGuardianCc}
                        onChange={(e) => setEnableParentGuardianCc(e.target.checked)}
                        className="mt-0.5 rounded"
                      />
                      <span>
                        <strong className="text-slate-900 dark:text-white">
                          Parent / Guardian CC on Invites
                        </strong>
                        <span className="block text-2xs text-slate-500 dark:text-slate-400">
                          Automatically copies parent emails on U18 invites.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2.5 pt-1">
            <button
              type="submit"
              data-testid="team-studio-submit-btn"
              disabled={isSavingStudio || !teamName.trim()}
              className="ap-btn-primary text-xs sm:text-sm font-bold cursor-pointer"
            >
              {isSavingStudio ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>{studioMode === 'EDIT' ? 'Save Team Settings' : 'Create Team'}</span>
            </button>
          </div>
        </form>
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
            <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    Invite or Import Athletes (CSV, Email or SMS)
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${
                      resendConfigured ? 'ap-status-prime' : 'ap-status-info'
                    }`}
                  >
                    {resendConfigured
                      ? 'Direct Email Active'
                      : 'Magic Link, Email & SMS Ready'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onOpenExternalSync && (
                    <button
                      type="button"
                      onClick={onOpenExternalSync}
                      className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-white dark:bg-ap-carbon border border-stone-300 dark:border-ap-edge text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5 text-ap-cobalt dark:text-ap-volt" />
                      <span>Athletic.net / TFRRS Sync</span>
                    </button>
                  )}
                  <input
                    ref={csvFileInputRef}
                    type="file"
                    aria-label="Upload roster CSV or text file"
                    accept=".csv,.tsv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setRawRosterInput(String(reader.result || ''));
                      reader.readAsText(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => csvFileInputRef.current?.click()}
                    className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-stone-200/70 dark:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload .CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setRawRosterInput(
                        [
                          'Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark',
                          'Liam OConnor, liam.xc@example.edu, 650-555-0142, Varsity, 2027, parent.oconnor@example.com, 16:48 5K',
                          'Sofia Martinez, sofia.run@example.edu, 650-555-0188, Varsity, 2028, parent.martinez@example.com, 5:09 1600m',
                          'Ethan Patel, ethan.jv@example.edu, 650-555-0194, Junior Varsity, 2029, parent.patel@example.com, 19:15 5K',
                        ].join('\n')
                      )
                    }
                    className="min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded-xl bg-stone-200/70 dark:bg-slate-800 text-xs font-mono cursor-pointer"
                  >
                    Sample CSV
                  </button>
                </div>
              </div>

              <textarea
                rows={3}
                value={rawRosterInput}
                aria-label="Paste spreadsheet rows or athlete email list for roster import"
                onChange={(e) => setRawRosterInput(e.target.value)}
                placeholder={`Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark\nMaya Chen, maya@school.edu, 650-555-0119, Varsity, 2027, parent@family.com, 18:05 5K`}
                className="w-full rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf p-3 text-xs font-mono text-slate-900 dark:text-slate-100"
              />

              {parsedRosterPreview.length > 0 && (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-100 dark:bg-ap-carbon text-2xs font-mono uppercase text-slate-500">
                        <tr>
                          <th className="py-2 px-3">Athlete</th>
                          <th className="py-2 px-3">Email</th>
                          <th className="py-2 px-3">Phone (SMS)</th>
                          <th className="py-2 px-3">Squad</th>
                          <th className="py-2 px-3">Seed Mark</th>
                          <th className="py-2 px-3">Safeguarding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200/70 dark:divide-slate-800">
                        {parsedRosterPreview.slice(0, 12).map((row, idx) => (
                          <tr key={`${row.invitedName}-${idx}`}>
                            <td className="py-2 px-3 font-semibold">{row.invitedName}</td>
                            <td className="py-2 px-3 font-mono text-2xs">
                              {row.invitedEmail || '—'}
                            </td>
                            <td className="py-2 px-3 font-mono text-2xs">
                              {row.invitedPhone || '—'}
                            </td>
                            <td className="py-2 px-3">{row.squadGroup}</td>
                            <td className="py-2 px-3 font-mono text-2xs text-emerald-700 dark:text-emerald-300">
                              {row.seedMarkOrFtp || 'Auto'}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex flex-wrap gap-1">
                                {row.isMinorU18 && (
                                  <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-status-prime">
                                    Safe-Sport Shield
                                  </span>
                                )}
                                {row.parentGuardianEmail && (
                                  <span className="px-1.5 py-0.5 rounded text-2xs font-mono ap-status-info">
                                    CC: {row.parentGuardianEmail}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
                      {parsedRosterPreview.length > 12
                        ? `Showing 12 of ${parsedRosterPreview.length} preview rows · `
                        : ''}
                      Ready to import <strong>{parsedRosterPreview.length}</strong> athlete
                      {parsedRosterPreview.length === 1 ? '' : 's'} into{' '}
                      <strong>{activeTeam.brand.shortName}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={isSendingBulk}
                      onClick={handleSendBulkInvites}
                      className="ap-btn-primary text-xs cursor-pointer"
                    >
                      {isSendingBulk ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      <span>
                        {resendConfigured
                          ? `Import & Email ${parsedRosterPreview.length} Team Invites`
                          : `Import ${parsedRosterPreview.length} Athletes & Generate Magic Links`}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
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
          {(() => {
            const awaitingParentCount = activeTeam.memberships.filter(
              (m) =>
                m.role === 'ATHLETE' &&
                m.isMinorU18 &&
                m.parentConsentStatus !== 'ACKNOWLEDGED' &&
                m.status !== 'REVOKED'
            ).length;
            const cleanSearch = rosterSearchQuery.trim().toLowerCase();
            const filteredMemberships = activeTeam.memberships.filter((m) => {
              if (
                rosterAwaitingParentOnly &&
                !(
                  m.role === 'ATHLETE' &&
                  m.isMinorU18 &&
                  m.parentConsentStatus !== 'ACKNOWLEDGED' &&
                  m.status !== 'REVOKED'
                )
              ) {
                return false;
              }
              if (rosterEventFilter !== 'ALL' && m.eventGroup !== rosterEventFilter) {
                return false;
              }
              if (cleanSearch) {
                const hay = `${m.invitedName} ${m.invitedEmail || ''} ${m.squadGroup}`.toLowerCase();
                if (!hay.includes(cleanSearch)) return false;
              }
              return true;
            });
            return (
          <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {activeTeam.brand.name} — Roster ({filteredMemberships.length}
                  {filteredMemberships.length !== activeTeam.memberships.length
                    ? ` / ${activeTeam.memberships.length}`
                    : ''})
                </h4>
                {awaitingParentCount > 0 && (
                  <button
                    type="button"
                    data-testid="roster-awaiting-parent-pill"
                    onClick={() => setRosterAwaitingParentOnly((prev) => !prev)}
                    className={`px-2 py-0.5 rounded-full text-2xs font-mono font-bold cursor-pointer ${
                      rosterAwaitingParentOnly ? 'ap-nav-volt-active' : 'ap-status-caution'
                    }`}
                  >
                    {awaitingParentCount} awaiting parent
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canManageGovernance && (
                  <button
                    type="button"
                    data-testid="team-audit-log-btn"
                    onClick={() => void handleToggleAuditLog()}
                    className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5 ap-text-brand" />
                    <span>{showAuditLog ? 'Hide Audit Log' : 'Compliance & Audit Log'}</span>
                  </button>
                )}

                {activeTeam.myRole === 'HEAD_COACH' &&
                  (() => {
                    const gradYears = activeTeam.memberships
                      .filter(
                        (m) =>
                          typeof m.graduationYear === 'number' &&
                          m.status !== 'ALUMNI' &&
                          m.status !== 'REVOKED'
                      )
                      .map((m) => m.graduationYear as number);
                    if (gradYears.length === 0) return null;
                    const targetYear = Math.min(...gradYears);
                    return (
                      <button
                        type="button"
                        data-testid="team-graduate-class-btn"
                        disabled={isGraduatingClass}
                        onClick={() => void handleGraduateClass(targetYear)}
                        className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {isGraduatingClass
                          ? 'Graduating…'
                          : `Graduate Class of ${targetYear}`}
                      </button>
                    );
                  })()}

                {isActiveTeamCoach &&
                  activeTeam.memberships.some((m) => m.status !== 'ACTIVE') && (
                    <button
                      type="button"
                      disabled={isSendingBulk}
                      onClick={() => handleResendPending('ALL_PENDING')}
                      className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-xl bg-ap-cobalt hover:bg-ap-clay-dark dark:bg-ap-volt dark:hover:bg-[#C8EF1E] text-white dark:text-ap-obsidian text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Nudge All Pending</span>
                    </button>
                  )}
              </div>
            </div>

            {showAuditLog && canManageGovernance && (
              <div
                data-testid="team-audit-log-panel"
                className="px-5 py-3 border-b border-stone-200 dark:border-slate-800 bg-stone-50/90 dark:bg-ap-carbon space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 ap-text-brand" />
                    <span>Immutable Governance &amp; Compliance Audit Log</span>
                  </span>
                  <span className="text-2xs font-mono text-slate-500">
                    {auditEntries.length} events
                  </span>
                </div>
                {isLoadingAuditLog && (
                  <p className="text-2xs font-mono text-slate-500">Loading audit trail…</p>
                )}
                {auditLogError && (
                  <p role="alert" className="text-2xs font-mono text-red-600 dark:text-red-400">
                    {auditLogError}
                  </p>
                )}
                {!isLoadingAuditLog && !auditLogError && auditEntries.length === 0 && (
                  <p className="text-2xs font-mono text-slate-500">
                    No governance events recorded for this team yet.
                  </p>
                )}
                {auditEntries.length > 0 && (
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                    {auditEntries.map((ev) => (
                      <div
                        key={ev.eventId}
                        className="rounded-lg border border-stone-200 dark:border-slate-800 bg-white dark:bg-ap-turf px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-2xs"
                      >
                        <span className="font-bold text-ap-cobalt dark:text-ap-volt">
                          {ev.action}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300 truncate max-w-[320px]">
                          {ev.targetId ? `Target: ${ev.targetId} · ` : ''}
                          {Object.keys(ev.metadata || {}).length > 0
                            ? JSON.stringify(ev.metadata)
                            : 'Recorded'}
                        </span>
                        <span className="text-slate-500">{ev.createdAt.slice(0, 19).replace('T', ' ')}Z</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="px-5 py-2.5 border-b border-stone-200/80 dark:border-slate-800 flex flex-wrap items-center gap-2 bg-stone-50/70 dark:bg-ap-carbon/60">
              <input
                type="search"
                aria-label="Search roster"
                value={rosterSearchQuery}
                onChange={(e) => setRosterSearchQuery(e.target.value)}
                placeholder="Search roster..."
                className="flex-1 min-w-[170px] min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 text-xs text-slate-900 dark:text-slate-100"
              />
              <select
                aria-label="Filter roster by event group"
                value={rosterEventFilter}
                onChange={(e) => setRosterEventFilter(e.target.value)}
                className="min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2.5 text-xs font-mono text-slate-800 dark:text-slate-100"
              >
                <option value="ALL">All Events</option>
                {COACH_EVENT_GROUP_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.shortLabel}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-pressed={rosterAwaitingParentOnly}
                onClick={() => setRosterAwaitingParentOnly((prev) => !prev)}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-mono font-semibold cursor-pointer ${
                  rosterAwaitingParentOnly
                    ? 'ap-nav-volt-active'
                    : 'ap-card-inset text-slate-700 dark:text-slate-200'
                }`}
              >
                Awaiting Parent
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-100 dark:bg-ap-carbon text-2xs font-mono uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Member</th>
                    <th className="py-2.5 px-3">Squad / Role</th>
                    <th className="py-2.5 px-3">Funnel Status</th>
                    <th className="py-2.5 px-3">7d Readiness / Seed</th>
                    <th className="py-2.5 px-4 text-right">Invite &amp; Share Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200/70 dark:divide-slate-800">
                  {filteredMemberships.map((m) => {
                    const joinLink = m.magicJoinUrl || activeJoinUrl;
                    const firstName = m.invitedName.split(/\s+/)[0];
                    const isSelfRow = m.membershipId === activeTeam.myMembershipId;
                    const isRowBusy = busyRosterMemberId === m.membershipId;
                    const activeMergeTargets = activeTeam.memberships.filter(
                      (other) =>
                        other.membershipId !== m.membershipId &&
                        other.status === 'ACTIVE' &&
                        other.role === 'ATHLETE'
                    );
                    const allowDirectSms =
                      !m.isMinorU18 && activeTeam.brand.orgType !== 'HIGH_SCHOOL';
                    const smsHref =
                      allowDirectSms && m.invitedPhone
                        ? buildFreeNativeSmsUri(
                            m.invitedPhone,
                            activeTeam.brand,
                            joinLink,
                            firstName
                          )
                        : null;
                    const mailtoHref = m.invitedEmail
                      ? `mailto:${encodeURIComponent(m.invitedEmail)}?${
                          activeTeam.brand.enableParentGuardianCc &&
                          m.isMinorU18 &&
                          m.parentGuardianEmail
                            ? `cc=${encodeURIComponent(m.parentGuardianEmail)}&`
                            : ''
                        }subject=${encodeURIComponent(
                          `Join ${activeTeam.brand.name} on MeetReady`
                        )}&body=${encodeURIComponent(
                          `Hi ${firstName},\n\nTap your personalized link to join ${activeTeam.brand.name} (${m.squadGroup}) on MeetReady:\n${joinLink}\n\nTeam Join Code: ${activeTeam.brand.joinCode}`
                        )}`
                      : null;

                    return (
                      <tr key={m.membershipId}>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white flex flex-wrap items-center gap-1.5">
                            <span>{m.invitedName}</span>
                            {m.isMinorU18 && (
                              <span
                                className="px-1.5 py-0.2 rounded text-2xs font-mono ap-status-prime"
                                title="Safe-Sport Weight Shield Active"
                              >
                                Safe-Sport
                              </span>
                            )}
                            {m.role === 'ATHLETE' && m.isMinorU18 && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-2xs font-mono ${
                                  m.parentConsentStatus === 'ACKNOWLEDGED'
                                    ? 'ap-status-prime'
                                    : 'ap-status-caution'
                                }`}
                              >
                                {m.parentConsentStatus === 'ACKNOWLEDGED'
                                  ? 'Parent Approved ✓'
                                  : 'Awaiting Parent'}
                              </span>
                            )}
                          </div>
                          {m.invitedEmail && (
                            <div className="text-2xs font-mono text-slate-500">
                              {m.invitedEmail}
                              {m.parentGuardianEmail ? ` · CC: ${m.parentGuardianEmail}` : ''}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-medium">{m.squadGroup}</div>
                          <div className="text-2xs font-mono uppercase text-slate-500">
                            {m.role.replace(/_/g, ' ')}
                          </div>
                          {canManageGovernance &&
                            !isSelfRow &&
                            m.status === 'ACTIVE' &&
                            m.role !== 'HEAD_COACH' &&
                            m.role !== 'PARENT_FOLLOWER' && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <select
                                  aria-label={`Role for ${m.invitedName}`}
                                  disabled={isRowBusy}
                                  value={
                                    m.role === 'ASSISTANT_COACH' ||
                                    m.role === 'ORG_ADMIN' ||
                                    m.role === 'ATHLETIC_TRAINER'
                                      ? m.role
                                      : 'ATHLETE'
                                  }
                                  onChange={(e) => {
                                    const nextRole = e.target.value as Extract<
                                      TeamMemberRole,
                                      'ATHLETE' | 'ASSISTANT_COACH' | 'ORG_ADMIN' | 'ATHLETIC_TRAINER'
                                    >;
                                    if (isDemoTeam) {
                                      applyUpdatedTeamSummary({
                                        ...activeTeam,
                                        memberships: activeTeam.memberships.map((mem) =>
                                          mem.membershipId === m.membershipId
                                            ? { ...mem, role: nextRole }
                                            : mem
                                        ),
                                      });
                                      return;
                                    }
                                    void runMemberMutation(m.membershipId, () =>
                                      updateMemberRoleApi(
                                        activeTeam.brand.teamId,
                                        m.membershipId,
                                        nextRole,
                                        originUrl
                                      )
                                    );
                                  }}
                                  className="min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-800 dark:text-slate-100"
                                >
                                  <option value="ATHLETE">Athlete</option>
                                  <option value="ASSISTANT_COACH">Assistant Coach</option>
                                  <option value="ORG_ADMIN">Org / Athletic Admin</option>
                                  <option value="ATHLETIC_TRAINER">Athletic Trainer</option>
                                </select>
                                {m.role === 'ASSISTANT_COACH' && (
                                  <button
                                    type="button"
                                    disabled={isRowBusy}
                                    onClick={() =>
                                      void runMemberMutation(
                                        m.membershipId,
                                        () =>
                                          transferHeadCoachApi(
                                            activeTeam.brand.teamId,
                                            m.membershipId,
                                            originUrl
                                          ),
                                        'Head Coach ownership transferred successfully.'
                                      )
                                    }
                                    className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 text-2xs font-mono cursor-pointer disabled:opacity-50"
                                  >
                                    Make Head Coach
                                  </button>
                                )}
                              </div>
                            )}
                          {isActiveTeamCoach && m.role === 'ASSISTANT_COACH' && (
                            <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={`Groups coached by ${m.invitedName}`}>
                              {COACH_EVENT_GROUP_OPTIONS.map((opt) => {
                                const active = (m.coachEventGroups || []).includes(opt.id);
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    disabled={isRowBusy}
                                    aria-pressed={active}
                                    onClick={() => {
                                      const curr = m.coachEventGroups || [];
                                      const next = active ? curr.filter((g) => g !== opt.id) : [...curr, opt.id];
                                      void runMemberMutation(
                                        m.membershipId,
                                        () =>
                                          updateAssistantCoachEventGroupsApi({
                                            teamId: activeTeam.brand.teamId,
                                            membershipId: m.membershipId,
                                            coachEventGroups: next,
                                          }),
                                        `Updated coached event groups for ${m.invitedName}.`
                                      );
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-2xs font-mono cursor-pointer ${
                                      active ? 'bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian font-bold' : 'ap-card-inset text-ap-muted dark:text-ap-muted-dark'
                                    }`}
                                  >
                                    {opt.shortLabel}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {isActiveTeamCoach && m.role === 'ATHLETE' && (
                            <select
                              aria-label={`Event group for ${m.invitedName}`}
                              value={m.eventGroup || ''}
                              onChange={async (e) => {
                                const val = (e.target.value || null) as CoachEventGroup | null;
                                try {
                                  const res = await fetch(
                                    `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/members/${encodeURIComponent(m.membershipId)}/event-group`,
                                    {
                                      method: 'PATCH',
                                      credentials: 'include',
                                      headers: buildThreshSessionHeaders(),
                                      body: JSON.stringify({ eventGroup: val, origin: originUrl }),
                                    }
                                  );
                                  const payload = await res.json();
                                  if (res.ok && payload.team) {
                                    const updatedTeam = payload.team as TeamSummaryWithRole;
                                    onTeamsUpdated(
                                      myTeams.map((t) =>
                                        t.brand.teamId === updatedTeam.brand.teamId ? updatedTeam : t
                                      ),
                                      updatedTeam.brand.teamId
                                    );
                                  }
                                } catch {
                                  // ignore offline event-group change error
                                }
                              }}
                              className="mt-1 min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-800 dark:text-slate-100"
                            >
                              <option value="">All Events</option>
                              {COACH_EVENT_GROUP_OPTIONS.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.shortLabel}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-mono font-bold uppercase ${
                              m.status === 'ACTIVE'
                                ? 'ap-status-prime'
                                : m.status === 'OPENED' || m.status === 'ALUMNI'
                                  ? 'ap-status-info'
                                  : m.status === 'INJURED'
                                    ? 'ap-status-strained'
                                    : 'ap-status-caution'
                            }`}
                          >
                            {m.status === 'ACTIVE'
                              ? 'Joined'
                              : m.status === 'OPENED'
                                ? 'Link Opened'
                                : m.status === 'INJURED'
                                  ? 'Injured'
                                  : m.status === 'OFF_SEASON'
                                    ? 'Off-Season'
                                    : m.status === 'ALUMNI'
                                      ? 'Alumni'
                                      : 'Invited'}
                          </span>
                          {m.emailDeliveryStatus === 'SENT_RESEND' && (
                            <span className="ml-1.5 text-2xs font-mono text-emerald-600 dark:text-emerald-400">
                              · Emailed ✓
                            </span>
                          )}
                          {isActiveTeamCoach && !isSelfRow && (
                            <div className="mt-1">
                              <select
                                aria-label={`Status for ${m.invitedName}`}
                                disabled={isRowBusy}
                                value={m.status}
                                onChange={(e) => {
                                  const nextStatus = e.target.value as typeof m.status;
                                  if (isDemoTeam) {
                                    applyUpdatedTeamSummary({
                                      ...activeTeam,
                                      memberships: activeTeam.memberships.map((mem) =>
                                        mem.membershipId === m.membershipId
                                          ? { ...mem, status: nextStatus }
                                          : mem
                                      ),
                                    });
                                    return;
                                  }
                                  void runMemberMutation(m.membershipId, () =>
                                    updateMemberStatusApi(
                                      activeTeam.brand.teamId,
                                      m.membershipId,
                                      nextStatus,
                                      originUrl
                                    )
                                  );
                                }}
                                className="min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-800 dark:text-slate-100"
                              >
                                <option value="ACTIVE">Joined</option>
                                <option value="INVITED">Invited</option>
                                <option value="INJURED">Injured</option>
                                <option value="OFF_SEASON">Off-Season</option>
                                <option value="ALUMNI">Alumni</option>
                                <option value="REVOKED">Remove</option>
                              </select>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 font-mono text-2xs">
                          {m.liveSnapshot ? (
                            <div>
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {m.liveSnapshot.verdictLabel}
                              </span>
                              <span className="block text-2xs text-slate-500">
                                CTL {Math.round(m.liveSnapshot.ctl)} · TSB{' '}
                                {m.liveSnapshot.tsb >= 0
                                  ? `+${Math.round(m.liveSnapshot.tsb)}`
                                  : Math.round(m.liveSnapshot.tsb)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">
                              {m.seedMarkOrFtp ? `Seed: ${m.seedMarkOrFtp}` : 'Pending claim'}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right">
                          {isActiveTeamCoach && m.role === 'ATHLETE' && (
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  copyTextWithFeedback(m.membershipId, joinLink)
                                }
                                className="px-2 py-1 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300 text-2xs font-mono inline-flex items-center gap-1 cursor-pointer"
                              >
                                {copiedId === m.membershipId ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-600" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Link</span>
                                  </>
                                )}
                              </button>

                              {m.isMinorU18 && (
                                <button
                                  type="button"
                                  disabled={copyingParentLinkId === m.membershipId}
                                  onClick={() => void handleCopyParentConsentLink(m.membershipId)}
                                  className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-300 border border-amber-500/30 text-2xs font-mono inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  <ShieldCheck className="w-3 h-3" />
                                  <span>
                                    {copiedId === `parent-${m.membershipId}`
                                      ? 'Parent Link Copied ✓'
                                      : copyingParentLinkId === m.membershipId
                                        ? 'Creating…'
                                        : 'Copy Parent Link'}
                                  </span>
                                </button>
                              )}

                              {allowDirectSms && smsHref && (
                                <a
                                  href={smsHref}
                                  className="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 text-2xs font-mono inline-flex items-center gap-1"
                                  title="Open native Messages / SMS pre-filled with Magic Join Link"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  <span>Text</span>
                                </a>
                              )}

                                {m.status !== 'ACTIVE' &&
                                  (resendConfigured ? (
                                    <button
                                      type="button"
                                      onClick={() => handleResendPending(m.membershipId)}
                                      className="px-2 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-700 dark:text-sky-300 border border-blue-500/30 text-2xs font-mono cursor-pointer"
                                    >
                                      Nudge
                                    </button>
                                  ) : (
                                    mailtoHref && (
                                      <a
                                        href={mailtoHref}
                                        className="px-2 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-700 dark:text-sky-300 border border-blue-500/30 text-2xs font-mono inline-flex items-center gap-1"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                        <span>Email</span>
                                      </a>
                                    )
                                  ))}
                                {m.status === 'INVITED' &&
                                  activeMergeTargets.length > 0 && (
                                    <select
                                      aria-label={`Merge ${m.invitedName} into active athlete`}
                                      disabled={isRowBusy}
                                      defaultValue=""
                                      onChange={(e) => {
                                        const targetId = e.target.value;
                                        if (targetId) {
                                          void runMemberMutation(
                                            m.membershipId,
                                            () =>
                                              mergeRosterMembersApi(
                                                activeTeam.brand.teamId,
                                                m.membershipId,
                                                targetId,
                                                originUrl
                                              ),
                                            'Merged pre-seeded profile & official marks into the claimed athlete account.'
                                          );
                                          e.target.value = '';
                                        }
                                      }}
                                      className="min-h-[34px] rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-2 py-0.5 text-2xs font-mono text-slate-700 dark:text-slate-200"
                                    >
                                      <option value="">Merge into…</option>
                                      {activeMergeTargets.map((target) => (
                                        <option
                                          key={target.membershipId}
                                          value={target.membershipId}
                                        >
                                          {target.invitedName}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                              </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
            );
          })()}
        </div>
      )}

      {showBillingModal && activeTeam && (
        <Suspense fallback={null}>
          <TeamBillingAndPoModal isOpen={showBillingModal} onClose={() => setShowBillingModal(false)} activeTeam={activeTeam} myTeams={myTeams} isSampleDemoMode={isSampleDemoMode} onTeamsUpdated={onTeamsUpdated} />
        </Suspense>
      )}
    </div>
  );
};
