import React, { useMemo, useRef, useState } from 'react';
import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Link2,
  Lock,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  UserPlus,
  Users,
} from './icons/PhosphorIcons';
import type {
  SportCategory,
  TeamBrandConfig,
  TeamOrgType,
  TeamSummaryWithRole,
} from '../types';
import {
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
import { AeroPulseLogo } from './AeroPulseLogo';

interface TeamManagementPanelProps {
  selfName: string;
  myTeams: TeamSummaryWithRole[];
  activeTeamId: string | null;
  resendConfigured: boolean;
  onSelectActiveTeam: (teamId: string | null) => void;
  onTeamsUpdated: (teams: TeamSummaryWithRole[], nextActiveTeamId?: string) => void;
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

export const TeamManagementPanel: React.FC<TeamManagementPanelProps> = ({
  selfName,
  myTeams,
  activeTeamId,
  resendConfigured,
  onSelectActiveTeam,
  onTeamsUpdated,
}) => {
  const activeTeam = useMemo(
    () =>
      myTeams.find((t) => t.brand.teamId === activeTeamId) ||
      myTeams[0] ||
      null,
    [myTeams, activeTeamId]
  );

  const [showCreateOrEditStudio, setShowCreateOrEditStudio] = useState<boolean>(
    myTeams.length === 0
  );
  const [studioMode, setStudioMode] = useState<'CREATE' | 'EDIT'>('CREATE');

  // Studio Form State
  const [orgType, setOrgType] = useState<TeamOrgType>('HIGH_SCHOOL');
  const [teamName, setTeamName] = useState('Palo Alto High Varsity XC');
  const [shortName, setShortName] = useState('PALY XC');
  const [mascotOrMotto, setMascotOrMotto] = useState('Vikings Distance');
  const [primarySport, setPrimarySport] = useState<'Running' | 'Cycling' | 'Hybrid'>(
    'Running'
  );
  const [primaryHex, setPrimaryHex] = useState('#14532D');
  const [secondaryHex, setSecondaryHex] = useState('#D97706');
  const [logoDataUrl, setLogoDataUrl] = useState<string>('');
  const [defaultSafeSportShield, setDefaultSafeSportShield] = useState<boolean>(true);
  const [enableParentGuardianCc, setEnableParentGuardianCc] = useState<boolean>(true);
  const [coachDisplayName, setCoachDisplayName] = useState(
    selfName && selfName !== 'Athlete' ? selfName : 'Coach Rivera'
  );

  // Quick Join Second Team State
  const [showJoinAnotherBar, setShowJoinAnotherBar] = useState(false);
  const [joinAnotherCode, setJoinAnotherCode] = useState('');

  // Bulk Roster CSV / Paste Inviter State
  const [rawRosterInput, setRawRosterInput] = useState('');
  const [defaultSquadForImport, setDefaultSquadForImport] = useState('Varsity');
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  // Squad Workout Broadcast State
  const [showBroadcastForm, setShowBroadcastForm] = useState(false);
  const [broadcastSquad, setBroadcastSquad] = useState('ALL');
  const [broadcastDate, setBroadcastDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [broadcastName, setBroadcastName] = useState(
    'Squad Session: 5x1000m Cruise Threshold + 4x150m Strides'
  );
  const [broadcastSport, setBroadcastSport] = useState<SportCategory>('Running');
  const [broadcastDurationMins, setBroadcastDurationMins] = useState(55);
  const [broadcastLoad, setBroadcastLoad] = useState(74);
  const [broadcastSyntax, setBroadcastSyntax] = useState(
    '- 15m 70% Pace\n- 5x 4m 100% Pace / 60s 65% Pace\n- 4x 25s 118% Pace / 65s 60% Pace\n- 10m 68% Pace'
  );
  const [broadcastNotes, setBroadcastNotes] = useState(
    'Run in VDOT pacing pods. Controlled first 2 reps; smooth turnover on strides.'
  );

  // Status & Feedback
  const [isSavingStudio, setIsSavingStudio] = useState(false);
  const [isSendingBulk, setIsSendingBulk] = useState(false);
  const [isJoiningTeam, setIsJoiningTeam] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    tone: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://thresh.app';

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
    setShowCreateOrEditStudio(true);
  };

  const openCreateNewTeam = () => {
    setStudioMode('CREATE');
    handleOrgTypeChange('HIGH_SCHOOL');
    setTeamName('');
    setShortName('');
    setMascotOrMotto('');
    setLogoDataUrl('');
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
    () => contrastRatio(livePalette.primaryOnDark, '#121419').toFixed(1),
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

  const handleSaveTeamStudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setIsSavingStudio(true);
    setBannerMessage(null);
    try {
      if (studioMode === 'EDIT' && activeTeam) {
        const resp = await fetch(
          `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
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
        const resp = await fetch('/api/teams', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: originUrl,
            name: teamName.trim(),
            shortName: shortName.trim() || undefined,
            mascotOrMotto: mascotOrMotto.trim() || undefined,
            orgType,
            primarySport,
            primaryHex,
            secondaryHex,
            logoDataUrl: logoDataUrl || undefined,
            defaultSafeSportShield,
            enableParentGuardianCc,
            coachDisplayName: coachDisplayName.trim() || selfName || 'Head Coach',
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
        const created = data.team as TeamSummaryWithRole;
        onTeamsUpdated([...myTeams, created], created.brand.teamId);
        setShowCreateOrEditStudio(false);
        setBannerMessage({
          tone: 'success',
          text: `Created ${created.brand.name} (Join Code ${created.brand.joinCode}). Paste your roster below to invite athletes!`,
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
    setIsJoiningTeam(true);
    setBannerMessage(null);
    try {
      const resp = await fetch('/api/teams/join-claim', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originUrl,
          codeOrSlug: joinAnotherCode.trim(),
          athleteName: selfName || 'Athlete',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setBannerMessage({
          tone: 'error',
          text: data.error || 'No team matched that Join Code.',
        });
        return;
      }
      const updatedTeams = (data.teams as TeamSummaryWithRole[]) || [];
      onTeamsUpdated(updatedTeams, data.team?.brand?.teamId);
      setJoinAnotherCode('');
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
          headers: { 'Content-Type': 'application/json' },
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
          ? `Added ${data.addedCount} athletes and dispatched ${data.emailedCount} branded invite email(s) via Resend!`
          : `Added ${data.addedCount} athletes with personalized Magic Join Links ready to copy, text (free SMS), or email!`,
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
          headers: { 'Content-Type': 'application/json' },
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
              ? `Nudged ${data.emailedCount} pending invite(s) via Resend.`
              : 'Refreshed magic invite links (set RESEND_API_KEY in Vercel to dispatch direct emails, or use Copy Link / Mailto / SMS).',
        });
      }
    } finally {
      setIsSendingBulk(false);
    }
  };

  const handleBroadcastWorkout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam) return;
    setIsBroadcasting(true);
    try {
      const resp = await fetch(
        `/api/teams/${encodeURIComponent(activeTeam.brand.teamId)}/workouts/broadcast`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: originUrl,
            targetSquadGroup: broadcastSquad,
            date: broadcastDate,
            name: broadcastName,
            sportCategory: broadcastSport,
            plannedDurationSecs: broadcastDurationMins * 60,
            plannedLoad: broadcastLoad,
            workoutSyntax: broadcastSyntax,
            description: broadcastNotes,
          }),
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
        setShowBroadcastForm(false);
        setBannerMessage({
          tone: 'success',
          text: `Broadcasted "${broadcastName}" to ${
            broadcastSquad === 'ALL' ? 'all squads' : broadcastSquad
          } on ${updatedTeam.brand.shortName}!`,
        });
      }
    } finally {
      setIsBroadcasting(false);
    }
  };

  const isActiveTeamCoach =
    activeTeam?.myRole === 'HEAD_COACH' || activeTeam?.myRole === 'ASSISTANT_COACH';

  const distinctSquads = useMemo(() => {
    if (!activeTeam) return ['Varsity', 'Junior Varsity', 'Frosh/Soph'];
    const defaults = getOrgTypeSafeguardingDefaults(activeTeam.brand.orgType).defaultSquads;
    const fromMembers = activeTeam.memberships.map((m) => m.squadGroup).filter(Boolean);
    return Array.from(new Set([...defaults, ...fromMembers]));
  }, [activeTeam]);

  return (
    <div className="space-y-6">
      {/* Multi-Team Switcher & Quick Actions Bar */}
      <div className="rounded-2xl liquid-glass-subtle border border-stone-200/80 dark:border-white/10 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
              MULTI-TEAM WORKSPACE SWITCHER
            </span>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {myTeams.length === 0
                ? 'Launch Your High School, Collegiate, or Club Team Hub'
                : `Your Active School & Club Teams (${myTeams.length})`}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowJoinAnotherBar((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-[#14181F] border border-stone-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-blue-500/50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#0D9488]" />
              <span>Join Team w/ Code</span>
            </button>

            <button
              type="button"
              onClick={openCreateNewTeam}
              className="px-3 py-1.5 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create New Team</span>
            </button>
          </div>
        </div>

        {myTeams.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
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
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white dark:bg-[#1E222B] border-slate-900/30 dark:border-white/30 shadow-xs text-slate-900 dark:text-white'
                      : 'bg-white/60 dark:bg-[#0E1117] border-stone-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                    style={{ backgroundColor: t.brand.primaryHex }}
                  />
                  <span>{t.brand.shortName || t.brand.name}</span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-stone-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {t.myRole === 'ATHLETE' ? 'Athlete' : 'Coach'}
                  </span>
                </button>
              );
            })}

            {activeTeamId && (
              <button
                type="button"
                onClick={() => onSelectActiveTeam(null)}
                className="px-2.5 py-2 rounded-xl text-[11px] font-mono text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Neutral THRESH Chrome
              </button>
            )}
          </div>
        )}

        {showJoinAnotherBar && (
          <form
            onSubmit={handleJoinAdditionalTeam}
            className="pt-2 border-t border-stone-200 dark:border-slate-800 flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              value={joinAnotherCode}
              onChange={(e) => setJoinAnotherCode(e.target.value.toUpperCase())}
              placeholder="Enter 6-character Team Join Code (e.g. PAXC-26) or slug"
              className="flex-1 min-w-[220px] min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-1.5 text-xs font-mono font-bold uppercase text-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={isJoiningTeam || !joinAnotherCode.trim()}
              className="px-3.5 py-2 rounded-xl bg-[#0D9488] hover:bg-[#0F766E] text-white text-xs font-semibold cursor-pointer"
            >
              {isJoiningTeam ? 'Joining...' : 'Claim Multi-Team Membership'}
            </button>
          </form>
        )}
      </div>

      {bannerMessage && (
        <div
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
            className="underline text-[11px] font-mono cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ====================================================================
          TEAM BRANDING & HIGH SCHOOL SAFEGUARDING STUDIO (CREATE / EDIT)
         ==================================================================== */}
      {showCreateOrEditStudio && (
        <form
          onSubmit={handleSaveTeamStudio}
          className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-5 space-y-5 shadow-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 dark:border-slate-800 pb-3.5">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#D9480F] dark:text-[#FB6514] font-bold">
                {studioMode === 'EDIT'
                  ? 'EDIT TEAM IDENTITY & SAFEGUARDING'
                  : 'STEP 1 · TEAM BRANDING & SAFEGUARDING STUDIO'}
              </span>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                {studioMode === 'EDIT'
                  ? `Customize ${activeTeam?.brand.name}`
                  : 'Create Branded School, Collegiate, or Club Workspace'}
              </h3>
            </div>
            {myTeams.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCreateOrEditStudio(false)}
                className="text-xs font-mono text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Organization Type Cards */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Program Type (Automatically Configures Safeguarding Defaults)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {ORG_TYPE_OPTIONS.map((opt) => {
                const selected = orgType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleOrgTypeChange(opt.id)}
                    className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                      selected
                        ? 'border-[#1D4ED8] bg-[#EFF6FF] dark:bg-blue-500/15 text-slate-900 dark:text-white'
                        : 'border-stone-200 dark:border-slate-800 bg-white dark:bg-[#0E1015] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold leading-snug">{opt.label}</div>
                    <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      {opt.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name, Short Lockup, Motto, Coach Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Full School / Club Name
              </label>
              <input
                type="text"
                required
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Palo Alto High Varsity XC"
                className="w-full min-h-[42px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Header Short Name
              </label>
              <input
                type="text"
                value={shortName}
                onChange={(e) => setShortName(e.target.value.toUpperCase())}
                placeholder="e.g. PALY XC"
                maxLength={18}
                className="w-full min-h-[42px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm font-mono font-bold uppercase text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Coach Display Name
              </label>
              <input
                type="text"
                value={coachDisplayName}
                onChange={(e) => setCoachDisplayName(e.target.value)}
                placeholder="e.g. Coach Rivera"
                className="w-full min-h-[42px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Colors, Presets, Crest Upload & Live Co-Branded Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  School / Club Palette (WCAG 2.1 AA Contrast-Clamped)
                </label>
                <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300">
                  Light {lightRatio}:1 · Dark {darkRatio}:1 · Zones Z1–Z7 Protected
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {CURATED_TEAM_PALETTE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setPrimaryHex(preset.primaryHex);
                      setSecondaryHex(preset.secondaryHex);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-slate-800 bg-white dark:bg-[#0E1015] hover:border-slate-400 text-[11px] font-medium cursor-pointer"
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
                <div className="flex items-center gap-2 rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2">
                  <input
                    type="color"
                    value={primaryHex}
                    onChange={(e) => setPrimaryHex(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <div className="text-xs">
                    <div className="font-semibold">Primary</div>
                    <div className="font-mono text-[11px] text-slate-500">{primaryHex}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2">
                  <input
                    type="color"
                    value={secondaryHex}
                    onChange={(e) => setSecondaryHex(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <div className="text-xs">
                    <div className="font-semibold">Secondary</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {secondaryHex}
                    </div>
                  </div>
                </div>

                <div>
                  <input
                    ref={logoFileInputRef}
                    type="file"
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
                    className="w-full h-full min-h-[46px] rounded-xl border border-dashed border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 hover:border-blue-500 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#1D4ED8]" />
                    <span>{logoDataUrl ? 'Replace Crest' : 'Upload Crest / Logo'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Live Header & Safeguarding Preview */}
            <div className="lg:col-span-5 rounded-xl liquid-glass-subtle p-4 space-y-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                LIVE CO-BRANDED HEADER PREVIEW
              </div>
              <div className="rounded-xl bg-white dark:bg-[#121419] border border-stone-200 dark:border-slate-800 p-3 relative overflow-hidden">
                <div
                  className="absolute top-0 left-0 right-0 h-[3px]"
                  style={{ background: livePalette.hairlineGradientLight }}
                />
                <AeroPulseLogo size="md" showTagline teamBrand={previewBrand} />
              </div>

              {/* Youth Safeguarding Checkboxes */}
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
                      Safe-Sport Weight Shield (Default ON for High School)
                    </strong>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      Masks body weight &amp; W/kg across team views to protect youth athletes.
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
                      Parent / Guardian CC on Roster Invites
                    </strong>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                      Automatically CCs parent emails when importing rosters &amp; sending Resend invites.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-2 border-t border-stone-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={isSavingStudio || !teamName.trim()}
              className="ap-btn-primary text-xs sm:text-sm cursor-pointer"
            >
              {isSavingStudio ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>
                {studioMode === 'EDIT'
                  ? 'Save Branding & Safeguarding'
                  : 'Create Team & Generate Join Code'}
              </span>
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
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ap-status-info">
                    Code: {activeTeam.brand.joinCode}
                  </span>
                  {activeTeam.brand.defaultSafeSportShield && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ap-status-prime inline-flex items-center gap-1">
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
                    className="px-2.5 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedId === 'team-url' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied Link!</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3.5 h-3.5" />
                        <span>Copy Magic Join Link</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      openPrintableTeamPosterWindow(activeTeam.brand, activeJoinUrl)
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#1D4ED8]" />
                    <span>Print Locker-Room QR Sheet</span>
                  </button>

                  {isActiveTeamCoach && (
                    <>
                      <button
                        type="button"
                        onClick={openEditForActiveTeam}
                        className="px-2.5 py-1.5 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300/70 text-xs font-semibold cursor-pointer"
                      >
                        Edit Branding &amp; Colors
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowBroadcastForm((prev) => !prev)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#D9480F]/15 hover:bg-[#D9480F]/25 text-[#B93800] dark:text-[#FB923C] border border-[#FDBA74] dark:border-[#FB6514]/35 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                        <span>Broadcast Squad Workout</span>
                      </button>
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
                  <div className="text-[10px] font-mono uppercase text-slate-500">
                    {kpi.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Squad Broadcast Workout Drawer */}
          {isActiveTeamCoach && showBroadcastForm && (
            <form
              onSubmit={handleBroadcastWorkout}
              className="rounded-2xl liquid-glass-subtle border border-[#D9480F]/40 p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-slate-800 pb-2.5">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CalendarPlus className="w-4 h-4 text-[#D9480F]" />
                  <span>Broadcast Structured Workout to {activeTeam.brand.shortName}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setShowBroadcastForm(false)}
                  className="text-xs font-mono text-slate-500 cursor-pointer"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-500 mb-1">
                    Target Squad Pod
                  </label>
                  <select
                    value={broadcastSquad}
                    onChange={(e) => setBroadcastSquad(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-2.5 text-xs font-semibold"
                  >
                    <option value="ALL">All Squads ({activeTeam.activeCount} active)</option>
                    {distinctSquads.map((sq) => (
                      <option key={sq} value={sq}>
                        {sq} Only
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-500 mb-1">
                    Workout Date
                  </label>
                  <input
                    type="date"
                    value={broadcastDate}
                    onChange={(e) => setBroadcastDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-2.5 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-500 mb-1">
                    Sport
                  </label>
                  <select
                    value={broadcastSport}
                    onChange={(e) => setBroadcastSport(e.target.value as SportCategory)}
                    className="w-full min-h-[40px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-2.5 text-xs font-semibold"
                  >
                    <option value="Running">Running</option>
                    <option value="Cycling">Cycling</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-slate-500 mb-1">
                      Mins
                    </label>
                    <input
                      type="number"
                      value={broadcastDurationMins}
                      onChange={(e) => setBroadcastDurationMins(Number(e.target.value))}
                      className="w-full min-h-[40px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-2.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-slate-500 mb-1">
                      Load
                    </label>
                    <input
                      type="number"
                      value={broadcastLoad}
                      onChange={(e) => setBroadcastLoad(Number(e.target.value))}
                      className="w-full min-h-[40px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-2.5 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-500 mb-1">
                    Session Title &amp; Coach Notes
                  </label>
                  <input
                    type="text"
                    value={broadcastName}
                    onChange={(e) => setBroadcastName(e.target.value)}
                    className="w-full min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] px-3 py-1.5 text-xs font-semibold mb-2"
                  />
                  <textarea
                    rows={2}
                    value={broadcastNotes}
                    onChange={(e) => setBroadcastNotes(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] p-2.5 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-500 mb-1">
                    Structured Steps (Auto-scales to each athlete&apos;s threshold)
                  </label>
                  <textarea
                    rows={4}
                    value={broadcastSyntax}
                    onChange={(e) => setBroadcastSyntax(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] p-2.5 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isBroadcasting}
                  className="ap-btn-primary text-xs cursor-pointer"
                >
                  {isBroadcasting ? 'Broadcasting...' : 'Push Workout to Squad Calendars'}
                </button>
              </div>
            </form>
          )}

          {/* Coach-Only Bulk Roster CSV / Spreadsheet / Resend Email Inviter */}
          {isActiveTeamCoach && (
            <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-[#1D4ED8] dark:text-[#60A5FA] font-bold">
                      BULK ROSTER IMPORTER · RESEND EMAIL + FREE NATIVE SMS
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        resendConfigured ? 'ap-status-prime' : 'ap-status-caution'
                      }`}
                    >
                      {resendConfigured
                        ? 'Resend Email API Active'
                        : 'Link / Mailto Mode (Set RESEND_API_KEY for Auto-Email)'}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                    Paste Spreadsheet Rows, Upload .CSV, or Enter Athlete Emails
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Supports columns: <code>Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark</code> (or plain email lists). Phone numbers generate zero-cost native <code>sms:</code> tap-to-text links—no paid SMS required.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={csvFileInputRef}
                    type="file"
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
                    className="px-3 py-1.5 rounded-xl bg-stone-200/70 dark:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
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
                    className="px-3 py-1.5 rounded-xl bg-stone-200/70 dark:bg-slate-800 text-xs font-mono cursor-pointer"
                  >
                    Load Sample CSV
                  </button>
                </div>
              </div>

              <textarea
                rows={4}
                value={rawRosterInput}
                onChange={(e) => setRawRosterInput(e.target.value)}
                placeholder={`Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark\nMaya Chen, maya@school.edu, 650-555-0119, Varsity, 2027, parent@family.com, 18:05 5K`}
                className="w-full rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#0E1015] p-3 text-xs font-mono text-slate-900 dark:text-slate-100"
              />

              {parsedRosterPreview.length > 0 && (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-100 dark:bg-[#0F131A] text-[10px] font-mono uppercase text-slate-500">
                        <tr>
                          <th className="py-2 px-3">Athlete</th>
                          <th className="py-2 px-3">Email</th>
                          <th className="py-2 px-3">Phone (Free SMS)</th>
                          <th className="py-2 px-3">Squad</th>
                          <th className="py-2 px-3">Seed Mark</th>
                          <th className="py-2 px-3">Safeguarding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200/70 dark:divide-slate-800">
                        {parsedRosterPreview.slice(0, 12).map((row, idx) => (
                          <tr key={`${row.invitedName}-${idx}`}>
                            <td className="py-2 px-3 font-semibold">{row.invitedName}</td>
                            <td className="py-2 px-3 font-mono text-[11px]">
                              {row.invitedEmail || '—'}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px]">
                              {row.invitedPhone || '—'}
                            </td>
                            <td className="py-2 px-3">{row.squadGroup}</td>
                            <td className="py-2 px-3 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                              {row.seedMarkOrFtp || 'Auto'}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex flex-wrap gap-1">
                                {row.isMinorU18 && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono ap-status-prime">
                                    Safe-Sport Shield
                                  </span>
                                )}
                                {row.parentGuardianEmail && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono ap-status-info">
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
                          ? `Import & Email ${parsedRosterPreview.length} Branded Invites (Resend)`
                          : `Import ${parsedRosterPreview.length} Athletes & Generate Magic Links`}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live Team Roster & Onboarding Funnel Status Table */}
          <div className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-stone-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {activeTeam.brand.name} — Roster &amp; Onboarding Funnel (
                  {activeTeam.memberships.length})
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Track who has opened their invite, claimed their spot, and synced their morning readiness.
                </p>
              </div>

              {isActiveTeamCoach &&
                activeTeam.memberships.some((m) => m.status !== 'ACTIVE') && (
                  <button
                    type="button"
                    disabled={isSendingBulk}
                    onClick={() => handleResendPending('ALL_PENDING')}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Nudge All Pending</span>
                  </button>
                )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-stone-100 dark:bg-[#0F131A] text-[10px] font-mono uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Member</th>
                    <th className="py-2.5 px-3">Squad / Role</th>
                    <th className="py-2.5 px-3">Funnel Status</th>
                    <th className="py-2.5 px-3">7d Readiness / Seed</th>
                    <th className="py-2.5 px-4 text-right">Share / Nudge Actions ($0)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200/70 dark:divide-slate-800">
                  {activeTeam.memberships.map((m) => {
                    const joinLink = m.magicJoinUrl || activeJoinUrl;
                    const firstName = m.invitedName.split(/\s+/)[0];
                    const smsHref = m.invitedPhone
                      ? buildFreeNativeSmsUri(
                          m.invitedPhone,
                          activeTeam.brand,
                          joinLink,
                          firstName
                        )
                      : null;
                    const mailtoHref = m.invitedEmail
                      ? `mailto:${encodeURIComponent(m.invitedEmail)}?${
                          m.parentGuardianEmail
                            ? `cc=${encodeURIComponent(m.parentGuardianEmail)}&`
                            : ''
                        }subject=${encodeURIComponent(
                          `Join ${activeTeam.brand.name} on THRESH`
                        )}&body=${encodeURIComponent(
                          `Hi ${firstName},\n\nTap your personalized link to join ${activeTeam.brand.name} (${m.squadGroup}) on THRESH:\n${joinLink}\n\nTeam Join Code: ${activeTeam.brand.joinCode}`
                        )}`
                      : null;

                    return (
                      <tr key={m.membershipId}>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{m.invitedName}</span>
                            {m.isMinorU18 && (
                              <span
                                className="px-1.5 py-0.2 rounded text-[9px] font-mono ap-status-prime"
                                title="Safe-Sport Weight Shield Active"
                              >
                                Safe-Sport
                              </span>
                            )}
                          </div>
                          {m.invitedEmail && (
                            <div className="text-[11px] font-mono text-slate-500">
                              {m.invitedEmail}
                              {m.parentGuardianEmail ? ` · CC: ${m.parentGuardianEmail}` : ''}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-medium">{m.squadGroup}</div>
                          <div className="text-[10px] font-mono uppercase text-slate-500">
                            {m.role.replace('_', ' ')}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              m.status === 'ACTIVE'
                                ? 'ap-status-prime'
                                : m.status === 'OPENED'
                                  ? 'ap-status-info'
                                  : 'ap-status-caution'
                            }`}
                          >
                            {m.status === 'ACTIVE'
                              ? 'Joined'
                              : m.status === 'OPENED'
                                ? 'Link Opened'
                                : 'Invited'}
                          </span>
                          {m.emailDeliveryStatus === 'SENT_RESEND' && (
                            <span className="ml-1.5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                              · Resend ✓
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 font-mono text-[11px]">
                          {m.liveSnapshot ? (
                            <div>
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {m.liveSnapshot.verdictLabel}
                              </span>
                              <span className="block text-[10px] text-slate-500">
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
                                className="px-2 py-1 rounded-lg bg-stone-200/70 dark:bg-slate-800 hover:bg-stone-300 text-[11px] font-mono inline-flex items-center gap-1 cursor-pointer"
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

                              {smsHref && (
                                <a
                                  href={smsHref}
                                  className="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 text-[11px] font-mono inline-flex items-center gap-1"
                                  title="Open native Messages / SMS pre-filled with Magic Join Link ($0)"
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
                                    className="px-2 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-700 dark:text-sky-300 border border-blue-500/30 text-[11px] font-mono cursor-pointer"
                                  >
                                    Nudge
                                  </button>
                                ) : (
                                  mailtoHref && (
                                    <a
                                      href={mailtoHref}
                                      className="px-2 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-700 dark:text-sky-300 border border-blue-500/30 text-[11px] font-mono inline-flex items-center gap-1"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                      <span>Email</span>
                                    </a>
                                  )
                                ))}
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
        </div>
      )}
    </div>
  );
};
