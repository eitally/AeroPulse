import React, { useId, useRef, useState } from 'react';
import { Check, Copy, Trophy, Users, X } from '../icons/PhosphorIcons';
import { COACH_EVENT_GROUP_OPTIONS } from '../../physiology/teamOnboardingEngine';
import { buildThreshSessionHeaders } from '../../utils/teamLifecycleApi';
import { markSessionActiveHint } from '../../utils/sessionHint';
import { getStoredCoachAttribution } from '../../utils/attribution';
import { emitFunnelEvent, type FunnelEventTier } from '../../utils/funnelTelemetry';
import { useModalDialog } from '../../hooks/useModalDialog';
import type {
  CoachComplexityTier,
  CoachEventGroup,
  TeamOrgType,
  TeamSummaryWithRole,
} from '../../types';

export interface CoachOnboardingWizardProps {
  isOpen: boolean;
  myTeams: TeamSummaryWithRole[];
  selfName?: string;
  onClose: () => void;
  onSetComplexityTier: (tier: CoachComplexityTier) => void;
  onTeamCreated: (teams: TeamSummaryWithRole[], activeTeamId: string) => void;
  onOpenRosterStudio?: () => void;
}

const COLOR_PRESETS = [
  { id: 'mondo', label: 'Mondo Clay & Volt', primaryHex: '#B83A24', secondaryHex: '#D8FF2A' },
  { id: 'cobalt', label: 'Cobalt & Gold', primaryHex: '#1D4ED8', secondaryHex: '#F59E0B' },
  { id: 'crimson', label: 'Crimson & Slate', primaryHex: '#B91C1C', secondaryHex: '#1E293B' },
  { id: 'emerald', label: 'Pine & Copper', primaryHex: '#0F766E', secondaryHex: '#D97706' },
];

const DISCOVERY_CHANNELS = [
  'Another Coach',
  'Track Meet / Banner',
  'Athletic.net / Clinic',
  'Web Search',
  'Social Media',
] as const;

export const CoachOnboardingWizard: React.FC<CoachOnboardingWizardProps> = ({
  isOpen,
  myTeams,
  selfName,
  onClose,
  onSetComplexityTier,
  onTeamCreated,
  onOpenRosterStudio,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [teamName, setTeamName] = useState<string>('');
  const [orgType, setOrgType] = useState<TeamOrgType>('HIGH_SCHOOL');
  const [colorPresetId, setColorPresetId] = useState<string>('mondo');
  const [preferredTier, setPreferredTier] = useState<CoachComplexityTier>('ESSENTIALS');
  const [selectedGroups, setSelectedGroups] = useState<CoachEventGroup[]>([
    'SPRINTS',
    'HURDLES',
    'DISTANCE',
    'JUMPS',
    'THROWS',
  ]);
  const [creating, setCreating] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [createdTeam, setCreatedTeam] = useState<TeamSummaryWithRole | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [discoveryChannel, setDiscoveryChannel] = useState<string>('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  useModalDialog({ isOpen, onClose, dialogRef });

  if (!isOpen) return null;

  const activePreset = COLOR_PRESETS.find((p) => p.id === colorPresetId) || COLOR_PRESETS[0];

  const toggleGroup = (g: CoachEventGroup) => {
    setSelectedGroups((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  };

  const handleSelectAllGroups = () => {
    setSelectedGroups(COACH_EVENT_GROUP_OPTIONS.map((o) => o.id));
  };

  const handleCreateTeam = async () => {
    const trimmed = teamName.trim() || 'Varsity Track & Field';
    const shortName =
      trimmed.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 12).toUpperCase() || 'SQUAD TF';
    const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const defaultSafeSportShield = orgType === 'HIGH_SCHOOL' || orgType === 'RUNNING_CLUB';

    setCreating(true);
    setErrorText(null);
    onSetComplexityTier(orgType === 'COLLEGIATE' && preferredTier === 'PRO' ? 'PRO' : preferredTier);

    try {
      const resp = await fetch('/api/teams', {
        method: 'POST',
        credentials: 'include',
        headers: buildThreshSessionHeaders(),
        body: JSON.stringify({
          origin: originUrl,
          name: trimmed,
          shortName,
          orgType,
          primarySport: 'Running',
          primaryHex: activePreset.primaryHex,
          secondaryHex: activePreset.secondaryHex,
          defaultSafeSportShield,
          enableParentGuardianCc: orgType === 'HIGH_SCHOOL',
          coachDisplayName: selfName || 'Head Coach',
          eventGroups: selectedGroups,
          attribution: getStoredCoachAttribution(discoveryChannel || undefined),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok && data.team) {
        markSessionActiveHint();
        const created = data.team as TeamSummaryWithRole;
        const telemetryTier: FunnelEventTier =
          orgType === 'CYCLING_CLUB' ? 'RUNNING_CLUB' : orgType;
        emitFunnelEvent('team_created', {
          role: 'COACH',
          tier: telemetryTier,
        });
        setCreatedTeam(created);
        onTeamCreated([...myTeams, created], created.brand.teamId);
        setStep(3);
      } else {
        setErrorText(
          typeof data?.error === 'string' && data.error.trim()
            ? data.error
            : 'Could not create team on server. Sign in as a verified coach or retry.'
        );
      }
    } catch {
      setErrorText('Network error while creating your team. Check your connection and retry.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid="coach-onboarding-wizard"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
    >
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl liquid-glass bg-white dark:bg-ap-obsidian border border-ap-edge p-4 sm:p-6 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-lg font-extrabold text-ap-ink dark:text-ap-chalk">
                {step === 1
                  ? 'Name Your Program & Choose Simplicity'
                  : step === 2
                    ? 'Select Track & Field Event Groups'
                    : 'Your Team Clipboard Is Ready'}
              </h2>
              <span className="ap-lane-badge">
                <span className="ap-lane-badge-inner">Step {step} of 3</span>
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close setup wizard"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl ap-card-inset inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-3 text-xs">
            <label className="block space-y-1">
              <span className="font-bold text-ap-ink dark:text-ap-chalk">School or Club Name</span>
              <input
                type="text"
                data-testid="wizard-team-name-input"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Oakridge High Track & Field"
                className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 font-semibold text-ap-ink dark:text-ap-chalk"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="block space-y-1">
                <span className="font-bold text-ap-ink dark:text-ap-chalk">Program Level</span>
                <select
                  value={orgType}
                  onChange={(e) => {
                    const next = e.target.value as TeamOrgType;
                    setOrgType(next);
                    if (next === 'COLLEGIATE') setPreferredTier('PRO');
                    else setPreferredTier('ESSENTIALS');
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 font-semibold text-ap-ink dark:text-ap-chalk"
                >
                  <option value="HIGH_SCHOOL">High School Track &amp; Field</option>
                  <option value="RUNNING_CLUB">Youth / Community Track Club</option>
                  <option value="COLLEGIATE">Collegiate T&amp;F / XC</option>
                  <option value="COACH_SQUAD">Private Coaching Group</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="font-bold text-ap-ink dark:text-ap-chalk">Coach View Complexity</span>
                <select
                  value={preferredTier}
                  onChange={(e) => setPreferredTier(e.target.value as CoachComplexityTier)}
                  className="w-full min-h-[44px] rounded-xl border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-3 font-semibold text-ap-ink dark:text-ap-chalk"
                >
                  <option value="ESSENTIALS">Simple Clipboard (Recommended)</option>
                  <option value="PRO">Full Sports Science (CTL/TSB/VDOT)</option>
                </select>
              </label>
            </div>

            <div className="space-y-1.5">
              <span className="block font-bold text-ap-ink dark:text-ap-chalk">Team Colors</span>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((p) => {
                  const selected = p.id === colorPresetId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setColorPresetId(p.id)}
                      className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 cursor-pointer ${
                        selected
                          ? 'border-ap-cobalt dark:border-ap-volt ring-2 ring-ap-volt/50'
                          : 'border-ap-frame/20 dark:border-ap-edge-dark'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full inline-block"
                        style={{ backgroundColor: p.primaryHex }}
                      />
                      <span>{p.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block font-bold text-ap-ink dark:text-ap-chalk">
                How&apos;d you hear about MeetReady?{' '}
                <span className="font-normal text-ap-muted dark:text-ap-muted-dark">(optional)</span>
              </span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Discovery source">
                {DISCOVERY_CHANNELS.map((channel) => {
                  const active = discoveryChannel === channel;
                  return (
                    <button
                      key={channel}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setDiscoveryChannel((prev) => (prev === channel ? '' : channel))
                      }
                      className={`min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                        active
                          ? 'liquid-capsule-active text-ap-ink dark:text-white border-ap-frame/40 dark:border-ap-volt/60'
                          : 'border-ap-frame/20 dark:border-ap-edge-dark text-ap-muted dark:text-ap-muted-dark hover:text-ap-ink dark:hover:text-white'
                      }`}
                    >
                      {channel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                data-testid="wizard-step1-next-btn"
                onClick={() => setStep(2)}
                className="ap-btn-primary !min-h-[44px] px-5 py-2 text-xs font-bold cursor-pointer"
              >
                Next: Event Groups →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-ap-muted dark:text-ap-muted-dark">
                Select every discipline your staff coaches this season:
              </span>
              <button
                type="button"
                onClick={handleSelectAllGroups}
                className="font-mono text-2xs font-bold text-ap-cobalt dark:text-ap-volt underline cursor-pointer"
              >
                Select All 8
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {COACH_EVENT_GROUP_OPTIONS.map((opt) => {
                const active = selectedGroups.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleGroup(opt.id)}
                    className={`min-h-[44px] px-2.5 py-2 rounded-xl border text-xs font-bold text-left cursor-pointer ${
                      active
                        ? 'bg-ap-cobalt text-white border-ap-cobalt dark:bg-ap-volt dark:text-ap-obsidian dark:border-ap-volt'
                        : 'ap-card-inset text-ap-ink dark:text-ap-chalk border-ap-frame/20 dark:border-ap-edge-dark'
                    }`}
                  >
                    {opt.shortLabel}
                  </button>
                );
              })}
            </div>

            {errorText && (
              <div
                role="alert"
                data-testid="wizard-create-error"
                className="ap-status-strained rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs font-medium"
              >
                <span>{errorText}</span>
                <button
                  type="button"
                  data-testid="wizard-retry-btn"
                  disabled={creating}
                  onClick={() => void handleCreateTeam()}
                  className="ap-btn-secondary !min-h-[36px] px-3 py-1 text-xs font-bold shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="ap-btn-secondary !min-h-[44px] px-4 py-2 text-xs font-bold cursor-pointer"
              >
                ← Back
              </button>
              <button
                type="button"
                data-testid="wizard-create-team-btn"
                disabled={creating}
                onClick={() => void handleCreateTeam()}
                className="ap-btn-primary !min-h-[44px] px-5 py-2 text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {creating ? 'Creating Team…' : 'Create Team & Get Invite Code ✓'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && createdTeam && (
          <div className="space-y-4 text-xs">
            <div className="rounded-xl bg-ap-obsidian text-ap-chalk border border-ap-edge p-4 space-y-2">
              <div className="flex items-center gap-2 text-ap-volt font-bold">
                <Trophy className="w-4 h-4" />
                <span>{createdTeam.brand.name}</span>
              </div>
              <div className="text-2xs text-ap-muted-dark">
                Share this team join code at today&apos;s meeting so athletes can join in 15 seconds (watch optional):
              </div>
              <div className="flex items-center justify-between gap-2 bg-ap-carbon border border-ap-edge rounded-lg px-3 py-2">
                <span
                  data-testid="wizard-created-join-code"
                  className="font-mono text-lg font-extrabold tracking-widest text-ap-volt"
                >
                  {createdTeam.brand.joinCode}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(createdTeam.brand.joinCode);
                    setCopiedCode(true);
                  }}
                  className="min-h-[44px] sm:min-h-[34px] px-3 rounded-lg bg-ap-turf text-ap-chalk font-mono text-2xs font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-ap-volt" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                </button>
              </div>
              <div
                data-testid="wizard-pilot-reassurance-badge"
                className="inline-flex items-center gap-1.5 rounded-lg bg-ap-carbon border border-ap-edge px-2.5 py-1 text-2xs font-mono font-semibold text-ap-volt"
              >
                $0 Founding Season Pilot · Students &amp; Parents Free Forever
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              {onOpenRosterStudio && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenRosterStudio();
                  }}
                  className="ap-btn-secondary !min-h-[44px] px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Import CSV / Athletic.net</span>
                </button>
              )}
              <button
                type="button"
                data-testid="wizard-finish-btn"
                onClick={onClose}
                className="ap-btn-primary !min-h-[44px] px-5 py-2 text-xs font-bold cursor-pointer ml-auto"
              >
                Open Coach Clipboard →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
