import React, { useRef } from 'react';
import {
  Check,
  ChevronDown,
  RefreshCw,
  Upload,
} from '../icons/PhosphorIcons';
import type { TeamBrandConfig, TeamOrgType } from '../../types';
import {
  CURATED_TEAM_PALETTE_PRESETS,
  type computeAccessibleTeamPalette,
} from '../../physiology/teamOnboardingEngine';
import { AeroPulseLogo } from '../AeroPulseLogo';

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

export interface TeamBrandingStudioFormProps {
  formId: string;
  studioMode: 'CREATE' | 'EDIT';
  activeTeamName?: string;
  orgType: TeamOrgType;
  onOrgTypeChange: (nextOrg: TeamOrgType) => void;
  teamName: string;
  setTeamName: (v: string) => void;
  shortName: string;
  setShortName: (v: string) => void;
  derivedShortName: string;
  districtName: string;
  setDistrictName: (v: string) => void;
  coachDisplayName: string;
  setCoachDisplayName: (v: string) => void;
  primaryHex: string;
  setPrimaryHex: (v: string) => void;
  secondaryHex: string;
  setSecondaryHex: (v: string) => void;
  logoDataUrl: string;
  setLogoDataUrl: (v: string) => void;
  defaultSafeSportShield: boolean;
  setDefaultSafeSportShield: (v: boolean) => void;
  enableParentGuardianCc: boolean;
  setEnableParentGuardianCc: (v: boolean) => void;
  showAdvancedBranding: boolean;
  setShowAdvancedBranding: React.Dispatch<React.SetStateAction<boolean>>;
  isSavingStudio: boolean;
  previewBrand: TeamBrandConfig;
  livePalette: ReturnType<typeof computeAccessibleTeamPalette>;
  lightRatio: string;
  darkRatio: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  onErrorMessage: (text: string) => void;
}

export const TeamBrandingStudioForm: React.FC<TeamBrandingStudioFormProps> = ({
  formId,
  studioMode,
  activeTeamName,
  orgType,
  onOrgTypeChange,
  teamName,
  setTeamName,
  shortName,
  setShortName,
  derivedShortName,
  districtName,
  setDistrictName,
  coachDisplayName,
  setCoachDisplayName,
  primaryHex,
  setPrimaryHex,
  secondaryHex,
  setSecondaryHex,
  logoDataUrl,
  setLogoDataUrl,
  defaultSafeSportShield,
  setDefaultSafeSportShield,
  enableParentGuardianCc,
  setEnableParentGuardianCc,
  showAdvancedBranding,
  setShowAdvancedBranding,
  isSavingStudio,
  previewBrand,
  livePalette,
  lightRatio,
  darkRatio,
  onSubmit,
  onCancel,
  onErrorMessage,
}) => {
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <form
      onSubmit={onSubmit}
      data-testid="team-studio-form"
      className="rounded-2xl liquid-glass border border-stone-200/90 dark:border-white/10 p-4 sm:p-5 space-y-4 shadow-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 dark:border-slate-800 pb-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {studioMode === 'EDIT'
              ? `Edit ${activeTeamName}`
              : 'Create Team Workspace'}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Choose your program type and enter your team name to get your Join Code right away.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
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
                onClick={() => onOrgTypeChange(opt.id)}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        ? derivedShortName
                        : 'Auto-generated from Team Name'
                    }
                    maxLength={18}
                    className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2 text-xs font-mono font-bold uppercase text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${formId}-district-name`}
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    District Name (Optional — Multi-School AD Rollup)
                  </label>
                  <input
                    id={`${formId}-district-name`}
                    data-testid="team-district-name-input"
                    type="text"
                    value={districtName}
                    onChange={(e) => setDistrictName(e.target.value)}
                    placeholder="e.g. San Jose Unified School District"
                    maxLength={80}
                    className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-ap-turf px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
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
                        onErrorMessage('Could not process crest image.');
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
  );
};
