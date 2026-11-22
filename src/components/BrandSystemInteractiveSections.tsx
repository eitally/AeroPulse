import React, { useEffect, useState } from 'react';
import {
  BRAND_DO_DONT_RULES,
  BRAND_PERMISSIONS_POLICY,
  PARTNER_ISOLATION_TOKENS,
  PRESS_BOILERPLATES,
  READINESS_PILL_SPECS,
  SACRED_PMC_SERIES,
  SACRED_ZONES_SPECTRUM,
  STADIUM_BUDGET_SLICES,
  TYPOGRAPHY_HIERARCHY,
  ARCHITECTURE_COLOR_TOKENS,
  formatColorTokenValue,
  type BrandColorTokenSpec,
  type ColorCopyFormat,
} from '../data/brandStyleGuideData';
import {
  CURATED_TEAM_PALETTE_PRESETS,
  computeAccessibleTeamPalette,
  normalizeHexColor,
} from '../physiology/teamOnboardingEngine';
import {
  buildTeamCobrandLockupSvg,
  rasterizeSvgToPngBlob,
  triggerBlobDownload,
} from '../utils/brandAssetEngine';
import {
  Check,
  Copy,
  DownloadSimple,
  Layers,
  Lock,
  Pause,
  Play,
  ShieldCheck,
  Sparkle,
  Timer,
  Warning,
  X,
} from './icons/PhosphorIcons';

interface CopyNoticeState {
  key: string;
  label: string;
}

const useCopyNotice = () => {
  const [copied, setCopied] = useState<CopyNoticeState | null>(null);

  const copyText = async (key: string, value: string, label?: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
      setCopied({ key, label: label || value });
      window.setTimeout(() => {
        setCopied((curr) => (curr?.key === key ? null : curr));
      }, 1800);
    } catch {
      // fallback no-op in restricted clipboard contexts
    }
  };

  return { copied, copyText };
};

// =============================================================================
// Section B: 3-Tier Interactive Color Map & Stadium Budget Architecture
// =============================================================================
export const BrandColorMapSection: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [copyFormat, setCopyFormat] = useState<ColorCopyFormat>('HEX');
  const { copied, copyText } = useCopyNotice();

  const renderDualTokenRow = (token: BrandColorTokenSpec) => {
    const lightFormatted = formatColorTokenValue(token.lightHex, copyFormat, token.cssVar);
    const darkFormatted = formatColorTokenValue(token.darkHex, copyFormat, token.cssVar);
    const lightKey = `${token.id}-light`;
    const darkKey = `${token.id}-dark`;

    return (
      <div
        key={token.id}
        className="ap-card rounded-xl p-3.5 sm:p-4 flex flex-col gap-3 min-w-0"
      >
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <h4 className="font-display text-sm font-bold tracking-tight text-slate-950 dark:text-white truncate">
              {token.name}
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
              {token.role}
            </p>
          </div>
          <span className="ap-status-info px-2 py-0.5 rounded-full font-mono text-2xs font-bold shrink-0">
            {token.wcagBadge}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void copyText(lightKey, lightFormatted, `${token.name} Light`)}
            className="ap-card-inset rounded-lg px-2.5 py-2 min-h-[44px] flex items-center gap-2 text-left hover:border-emerald-700/40 dark:hover:border-lime-400/50 transition-colors cursor-pointer min-w-0"
            title={`Copy Light ${copyFormat}: ${lightFormatted}`}
          >
            <span
              className="w-5 h-5 rounded-md border border-black/15 shrink-0"
              style={{ backgroundColor: token.lightHex }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-2xs uppercase text-slate-500 dark:text-slate-400">
                Light
              </span>
              <span className="block font-mono text-2xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {copied?.key === lightKey ? 'Copied!' : lightFormatted}
              </span>
            </span>
            {copied?.key === lightKey ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-lime-400 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void copyText(darkKey, darkFormatted, `${token.name} Dark`)}
            className="ap-card-inset rounded-lg px-2.5 py-2 min-h-[44px] flex items-center gap-2 text-left hover:border-emerald-700/40 dark:hover:border-lime-400/50 transition-colors cursor-pointer min-w-0"
            title={`Copy Dark ${copyFormat}: ${darkFormatted}`}
          >
            <span
              className="w-5 h-5 rounded-md border border-white/20 shrink-0"
              style={{ backgroundColor: token.darkHex }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-2xs uppercase text-slate-500 dark:text-slate-400">
                Dark
              </span>
              <span className="block font-mono text-2xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {copied?.key === darkKey ? 'Copied!' : darkFormatted}
              </span>
            </span>
            {copied?.key === darkKey ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-lime-400 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400 shrink-0" />
            )}
          </button>
        </div>

        <p className="text-2xs font-mono text-slate-600 dark:text-slate-400 leading-snug">
          {token.contrastNote}
        </p>
      </div>
    );
  };

  return (
    <section id="brand-colors" aria-labelledby="brand-colors-heading" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2
            id="brand-colors-heading"
            className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white"
          >
            3-Tier Color Scheme &amp; Stadium Map
          </h2>
          <span className="ap-lane-badge">
            <span className="ap-lane-badge-inner">80 / 15 / 5 BUDGET</span>
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
            Copy Format
          </span>
          <div className="ap-pill-track inline-flex items-center p-1 rounded-xl gap-1" role="group" aria-label="Color token copy format">
            {(['HEX', 'RGB', 'HSL', 'CSS'] as ColorCopyFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setCopyFormat(fmt)}
                aria-pressed={copyFormat === fmt}
                className={`px-3 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg font-mono text-2xs font-bold transition-colors cursor-pointer ${
                  copyFormat === fmt
                    ? 'ap-pill-active'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive 80 / 15 / 5 Budget Cutaway + 4 Opaque Depth Planes (Stage-Level, No Nested Cards) */}
      <div className="space-y-4 pt-3 border-t border-emerald-950/10 dark:border-emerald-700/25">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 ap-text-brand shrink-0" />
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
              Tier 1 · Stadium Architecture &amp; Zero-Blur Elevation Planes
            </h3>
          </div>
          {copied && (
            <span className="ap-status-prime px-2.5 py-1 rounded-full font-mono text-2xs font-bold">
              Copied {copied.label}
            </span>
          )}
        </div>

        <div className="w-full h-7 rounded-xl overflow-hidden flex border border-emerald-950/20 dark:border-emerald-700/40" aria-label="80 15 5 Stadium Color Budget">
          <div
            className="h-full flex items-center px-3 font-mono text-2xs font-bold border-r border-emerald-950/15 whitespace-nowrap"
            style={{
              width: '80%',
              backgroundColor: isDark ? '#0B120E' : '#F4F7F2',
              color: isDark ? '#F4F7F4' : '#101411',
            }}
          >
            <span className="hidden sm:inline">80% Neutral Stage &amp; Paper</span>
            <span className="sm:hidden">80% Neutral</span>
          </div>
          <div
            className="h-full flex items-center justify-center px-1.5 font-mono text-2xs font-bold text-white border-r border-emerald-950/20 whitespace-nowrap"
            style={{ width: '15%', minWidth: '52px', backgroundColor: '#163022' }}
          >
            <span className="hidden sm:inline">15% Pine</span>
            <span className="sm:hidden">15%</span>
          </div>
          <div
            className="h-full flex items-center justify-center font-mono text-2xs font-bold whitespace-nowrap"
            style={{ width: '5%', minWidth: '42px', backgroundColor: '#C8FF00', color: '#080A09' }}
            title="Track Volt <= 5%"
          >
            5%
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {STADIUM_BUDGET_SLICES.map((slice) => (
            <div key={slice.id} className="ap-card-inset rounded-xl p-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-xs font-bold text-slate-950 dark:text-white">
                  {slice.label}
                </span>
                <span className="font-mono text-2xs font-bold ap-telemetry-label">
                  {isDark ? slice.darkHex : slice.lightHex}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {slice.detail}
              </p>
            </div>
          ))}
        </div>

        {/* Print CMYK vs Digital Note */}
        <div className="ap-card-inset rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-start sm:items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
            <Warning className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <span>
              <strong>Print &amp; CMYK Calibration:</strong> Electric Track Volt (<code className="font-mono">#C8FF00</code>) is an out-of-gamut RGB ink. For 4-color CMYK paper without Pantone 809C spot ink, use the <strong>Light Stage Pine + Turf Lime</strong> lockup (<code className="font-mono">#1C5436 / #56BA00</code>) or <strong>1-Ink Stencil</strong>.
            </span>
          </div>
          <span className="font-mono text-2xs font-bold ap-telemetry-label shrink-0">
            No backdrop-filter blur
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ARCHITECTURE_COLOR_TOKENS.map(renderDualTokenRow)}
        </div>
      </div>

      {/* Tier 2: Sacred Physiology Lock (Stage-Level, No Nested Cards) */}
      <div className="space-y-5 pt-4 border-t border-emerald-950/10 dark:border-emerald-700/25">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Lock className="w-4 h-4 ap-text-brand shrink-0" />
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
              Tier 2 · The Sacred Physiology Lock (Z1–Z6, Banister PMC &amp; Readiness)
            </h3>
          </div>
          <span className="ap-status-prime px-2.5 py-1 rounded-full font-mono text-2xs font-bold inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>INVARIANT UNDER SCHOOL CO-BRANDING</span>
          </span>
        </div>

        <p className="text-sm text-slate-700 dark:text-slate-300 max-w-[74ch]">
          Effort zones, Banister load splines (<code className="font-mono">CTL</code> / <code className="font-mono">ATL</code> / <code className="font-mono">TSB</code>), and autonomic readiness pills never re-theme — even when a school overrides outer chrome with Crimson, Navy, or Gold.
        </p>

        {/* 6-Zone Physiological Spectrum */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {SACRED_ZONES_SPECTRUM.map((z) => {
            const formatted = formatColorTokenValue(z.hex, copyFormat, z.cssVar);
            const key = `zone-${z.zone}`;
            return (
              <button
                key={z.zone}
                type="button"
                onClick={() => void copyText(key, formatted, `${z.zone} ${z.name}`)}
                className="rounded-xl border border-black/10 dark:border-white/10 overflow-hidden text-left bg-white dark:bg-ap-carbon hover:border-emerald-700/50 dark:hover:border-lime-400/50 transition-colors cursor-pointer"
              >
                <div
                  className="px-3 py-3 flex items-center justify-between"
                  style={{ backgroundColor: z.hex, color: z.textOnSwatch }}
                >
                  <span className="font-mono text-sm font-bold">{z.zone}</span>
                  {copied?.key === key ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 opacity-80" />
                  )}
                </div>
                <div className="p-2.5 space-y-0.5">
                  <div className="font-display text-xs font-bold text-slate-950 dark:text-white truncate">
                    {z.name}
                  </div>
                  <div className="text-2xs text-slate-600 dark:text-slate-300 truncate">
                    {z.domain}
                  </div>
                  <div className="font-mono text-2xs font-semibold ap-telemetry-label truncate">
                    {copied?.key === key ? 'Copied!' : formatted}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Banister PMC Series */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SACRED_PMC_SERIES.map(renderDualTokenRow)}
        </div>

        {/* Semantic Readiness Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {READINESS_PILL_SPECS.map((pill) => (
            <div key={pill.id} className="ap-card-inset rounded-xl p-3 space-y-2">
              <span
                className={`${pill.className} inline-flex items-center px-2.5 py-1 rounded-full font-mono text-2xs font-bold`}
              >
                {pill.label}
              </span>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
                {pill.meaning}
              </p>
              <p className="font-mono text-2xs text-slate-500 dark:text-slate-400">
                {isDark ? pill.darkColors : pill.lightColors}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Tier 3: Partner Attribution Isolation (Stage-Level, No Nested Cards) */}
      <div className="space-y-4 pt-4 border-t border-emerald-950/10 dark:border-emerald-700/25">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
            Tier 3 · Partner Attribution Isolation (Clean-Room Separation)
          </h3>
          <span className="font-mono text-2xs font-bold uppercase text-slate-600 dark:text-slate-400">
            Zero Partner Colors Inside MeetReady Marks
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
          <div className="ap-card-inset rounded-xl p-3.5 flex flex-col justify-between gap-3">
            <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Strava Vermilion (<code className="font-mono">#C23800</code>, deepened from <code className="font-mono">#FC4C02</code> for <code className="font-mono">5.44:1</code> AA white-ink legibility) appears solely on the <code className="font-mono">&gt;= 48px</code> partner OAuth CTA and read-only provenance badges.
            </div>
            <div className="ap-btn-strava min-h-[48px] rounded-xl px-4 inline-flex items-center justify-center font-display text-sm font-bold shadow-xs">
              Connect with Strava (Spec Specimen)
            </div>
          </div>
          {PARTNER_ISOLATION_TOKENS.map(renderDualTokenRow)}
        </div>
      </div>
    </section>
  );
};

// =============================================================================
// Section C: Live Team × MeetReady Co-Branding Sandbox & Exporter
// =============================================================================
export const BrandCobrandLabSection: React.FC<{ isDark?: boolean }> = ({
  isDark = false,
}) => {
  const [shortName, setShortName] = useState('NORTHSIDE XC');
  const [monogram, setMonogram] = useState('NX');
  const [rawPrimaryHex, setRawPrimaryHex] = useState('#1E3A8A');
  const [rawSecondaryHex, setRawSecondaryHex] = useState('#CA8A04');
  const [previewMode, setPreviewMode] = useState<'light' | 'dark' | '1ink-black' | '1ink-white'>(
    () => (isDark ? 'dark' : 'light')
  );
  const [isExporting, setIsExporting] = useState<string | null>(null);

  useEffect(() => {
    setPreviewMode((curr) =>
      curr === 'light' || curr === 'dark' ? (isDark ? 'dark' : 'light') : curr
    );
  }, [isDark]);

  const normalizedPrimary = normalizeHexColor(rawPrimaryHex, '#1E3A8A');
  const normalizedSecondary = normalizeHexColor(rawSecondaryHex, '#CA8A04');
  const palette = computeAccessibleTeamPalette(normalizedPrimary, normalizedSecondary);
  const displayName = (shortName || 'VARSITY XC').trim().slice(0, 22) || 'VARSITY XC';
  const displayMono = (monogram || 'VX').trim().toUpperCase().slice(0, 3) || 'VX';
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';

  const handleDownloadCobrandSvg = (variant: 'light' | 'dark' | '1ink-black' | '1ink-white') => {
    const svg = buildTeamCobrandLockupSvg({
      shortName: displayName,
      monogram: displayMono,
      primaryHex: normalizedPrimary,
      secondaryHex: normalizedSecondary,
      variant,
    });
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    triggerBlobDownload(blob, `${slug}-x-meetready-${variant}.svg`);
  };

  const handleDownloadCobrandPng = async (variant: 'light' | 'dark' | '1ink-black' | '1ink-white') => {
    setIsExporting(variant);
    try {
      const svg = buildTeamCobrandLockupSvg({
        shortName: displayName,
        monogram: displayMono,
        primaryHex: normalizedPrimary,
        secondaryHex: normalizedSecondary,
        variant,
      });
      const vbMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      const vw = vbMatch ? Number(vbMatch[1]) : 760;
      const vh = vbMatch ? Number(vbMatch[2]) : 124;
      const blob = await rasterizeSvgToPngBlob(svg, vw * 3, vh * 3);
      triggerBlobDownload(blob, `${slug}-x-meetready-${variant}-3x.png`);
    } finally {
      setIsExporting(null);
    }
  };

  const isPreviewDarkSurface = previewMode === 'dark' || previewMode === '1ink-white';
  const previewSvg = buildTeamCobrandLockupSvg({
    shortName: displayName,
    monogram: displayMono,
    primaryHex: normalizedPrimary,
    secondaryHex: normalizedSecondary,
    variant: previewMode,
  });

  return (
    <section id="brand-cobrand" aria-labelledby="brand-cobrand-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2
          id="brand-cobrand-heading"
          className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white"
        >
          School &amp; Club Co-Branding Sandbox
        </h2>
        <span className="ap-lane-badge">
          <span className="ap-lane-badge-inner">WCAG AA CLAMPED · CUSTOM SVG/PNG</span>
        </span>
      </div>

      <div className="ap-card rounded-2xl p-4 sm:p-5 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Controls Column */}
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Coaches and athletic directors can test any squad name and raw school hex — MeetReady clamps light/dark contrast automatically (<code className="font-mono">&gt;= 4.55:1</code>), shifts inner track lanes to neutral Slate so school colors never clash with Pine green, and exports print-ready lockups for tent valances, flyers, and warm-ups.
            </p>

            <div className="space-y-1.5">
              <div className="font-mono text-2xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Synthetic Team Palette Presets
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CURATED_TEAM_PALETTE_PRESETS.slice(0, 6).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setRawPrimaryHex(preset.primaryHex);
                      setRawSecondaryHex(preset.secondaryHex);
                    }}
                    className="ap-card-inset px-2.5 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-emerald-700/50 dark:hover:border-lime-400/50 cursor-pointer"
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: preset.primaryHex }}
                      aria-hidden="true"
                    />
                    <span className="truncate max-w-[140px]">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="sm:col-span-2 block space-y-1">
                <span className="font-mono text-2xs font-bold uppercase text-slate-600 dark:text-slate-400">
                  Squad Short Name
                </span>
                <input
                  type="text"
                  maxLength={22}
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl px-3 py-2 text-sm font-semibold ap-card-inset text-slate-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:focus:ring-lime-400"
                  placeholder="NORTHSIDE XC"
                />
              </label>

              <label className="block space-y-1">
                <span className="font-mono text-2xs font-bold uppercase text-slate-600 dark:text-slate-400">
                  Monogram
                </span>
                <input
                  type="text"
                  maxLength={3}
                  value={monogram}
                  onChange={(e) => setMonogram(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl px-3 py-2 text-sm font-mono font-bold uppercase ap-card-inset text-slate-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:focus:ring-lime-400"
                  placeholder="NX"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="font-mono text-2xs font-bold uppercase text-slate-600 dark:text-slate-400">
                  Raw Primary Hex
                </span>
                <div className="flex items-center gap-2 ap-card-inset rounded-xl px-2.5 min-h-[44px]">
                  <input
                    type="color"
                    value={normalizedPrimary}
                    onChange={(e) => setRawPrimaryHex(e.target.value.toUpperCase())}
                    aria-label="Team Primary Color Picker"
                    className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 shrink-0"
                  />
                  <input
                    type="text"
                    value={rawPrimaryHex}
                    onChange={(e) => setRawPrimaryHex(e.target.value)}
                    aria-label="Team Primary Hex Code"
                    className="w-full bg-transparent font-mono text-xs font-bold text-slate-950 dark:text-white rounded px-1"
                  />
                </div>
              </label>

              <label className="block space-y-1">
                <span className="font-mono text-2xs font-bold uppercase text-slate-600 dark:text-slate-400">
                  Raw Secondary Hex
                </span>
                <div className="flex items-center gap-2 ap-card-inset rounded-xl px-2.5 min-h-[44px]">
                  <input
                    type="color"
                    value={normalizedSecondary}
                    onChange={(e) => setRawSecondaryHex(e.target.value.toUpperCase())}
                    aria-label="Team Secondary Color Picker"
                    className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 shrink-0"
                  />
                  <input
                    type="text"
                    value={rawSecondaryHex}
                    onChange={(e) => setRawSecondaryHex(e.target.value)}
                    aria-label="Team Secondary Hex Code"
                    className="w-full bg-transparent font-mono text-xs font-bold text-slate-950 dark:text-white rounded px-1"
                  />
                </div>
              </label>
            </div>
          </div>

          {/* Live Stage Preview & Export Column */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="ap-pill-track flex flex-wrap items-center p-1 rounded-xl gap-1 w-full sm:w-auto" role="group" aria-label="Co-brand backdrop variant">
                {(
                  [
                    { id: 'dark', label: 'Dark Stage' },
                    { id: 'light', label: 'Light Stage' },
                    { id: '1ink-black', label: '1-Ink Black' },
                    { id: '1ink-white', label: '1-Ink White' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPreviewMode(tab.id)}
                    aria-pressed={previewMode === tab.id}
                    className={`px-2.5 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      previewMode === tab.id
                        ? 'ap-pill-active'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <span className="font-mono text-2xs font-bold text-slate-600 dark:text-slate-400">
                SVG / 3x PNG Export Ready
              </span>
            </div>

            <div
              className="rounded-2xl border p-5 sm:p-7 flex flex-col gap-4 transition-colors"
              style={{
                backgroundColor: isPreviewDarkSurface ? '#0B120E' : '#F4F7F2',
                borderColor: isPreviewDarkSurface ? '#2B543B' : '#2B5B3F',
                color: isPreviewDarkSurface ? '#F4F7F4' : '#101411',
              }}
            >
              {/* 1:1 WYSIWYG Vector Lockup Preview matching exported SVG & 3x PNG */}
              <div className="overflow-x-auto">
                <img
                  src={`data:image/svg+xml,${encodeURIComponent(previewSvg)}`}
                  alt={`${displayName} × MeetReady ${previewMode} co-branded lockup`}
                  className="h-11 sm:h-14 w-auto max-w-full"
                />
              </div>

              {/* Clamped Token Telemetry & Sacred Zone Invariance Bar */}
              <div
                className="rounded-xl p-3 border flex flex-wrap items-center justify-between gap-2.5"
                style={{
                  backgroundColor: isPreviewDarkSurface ? '#15231B' : '#FFFFFF',
                  borderColor: isPreviewDarkSurface
                    ? 'rgba(57, 150, 99, 0.3)'
                    : 'rgba(38, 88, 58, 0.16)',
                  color: isPreviewDarkSurface ? '#C8D8CE' : '#1F3528',
                }}
              >
                <div className="font-mono text-2xs space-x-3">
                  <span>
                    Clamped Light: <strong>{palette.primaryOnLight}</strong>
                  </span>
                  <span>
                    Clamped Dark: <strong>{palette.primaryOnDark}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5" aria-label="Locked Physiology Zones Z1 through Z6">
                  <span className="font-mono text-2xs font-bold uppercase mr-1">
                    Z1–Z6 Locked:
                  </span>
                  {SACRED_ZONES_SPECTRUM.map((z) => (
                    <span
                      key={z.zone}
                      className="w-3.5 h-3.5 rounded-sm border border-black/15"
                      style={{ backgroundColor: z.hex }}
                      title={`${z.zone} ${z.name} (${z.hex}) — Sacred`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownloadCobrandSvg(previewMode)}
                className="ap-btn-primary px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <DownloadSimple className="w-4 h-4" />
                <span>Download {displayName} × MeetReady (.SVG)</span>
              </button>
              <button
                type="button"
                disabled={isExporting !== null}
                onClick={() => void handleDownloadCobrandPng(previewMode)}
                className="ap-btn-secondary px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <DownloadSimple className="w-4 h-4" />
                <span>
                  {isExporting === previewMode ? 'Rendering PNG...' : 'Download 3x Hi-DPI (.PNG)'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// =============================================================================
// Section D: Typography Scale, 0.01s Tabular Comparator & Brand Policy
// =============================================================================
export const BrandTypographyAndUsageSection: React.FC = () => {
  const [tabularOn, setTabularOn] = useState(true);
  const [isRunningSplit, setIsRunningSplit] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  const [elapsedCs, setElapsedCs] = useState(24518); // 4:05.18
  const { copied, copyText } = useCopyNotice();

  useEffect(() => {
    if (!isRunningSplit) return;
    const id = window.setInterval(() => {
      setElapsedCs((prev) => (prev >= 29999 ? 24000 : prev + 3));
    }, 60);
    return () => window.clearInterval(id);
  }, [isRunningSplit]);

  const mins = Math.floor(elapsedCs / 6000);
  const secs = Math.floor((elapsedCs % 6000) / 100)
    .toString()
    .padStart(2, '0');
  const cs = (elapsedCs % 100).toString().padStart(2, '0');
  const formattedClock = `${mins}:${secs}.${cs}`;

  return (
    <section id="brand-typography-usage" aria-labelledby="brand-type-heading" className="space-y-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2
          id="brand-type-heading"
          className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white"
        >
          Typography, Rules &amp; Press Boilerplate
        </h2>
        <span className="ap-lane-badge">
          <span className="ap-lane-badge-inner">2-FONT SYSTEM · 11PX FLOOR</span>
        </span>
      </div>

      {/* Live 0.01s Tabular Telemetry Comparator + Type Scale */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-5 ap-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 ap-text-brand" />
                <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                  0.01s Tabular Telemetry Rule
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRunningSplit((r) => !r)}
                className="ap-card-inset px-2.5 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg inline-flex items-center gap-1.5 font-mono text-2xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                {isRunningSplit ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isRunningSplit ? 'Pause' : 'Resume'}</span>
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Live stopwatch splits and <code className="font-mono">1Hz</code> scrubbers must never jitter horizontally. Toggle below to compare <code className="font-mono">JetBrains Mono tabular-nums</code> against proportional glyphs.
            </p>
          </div>

          <div className="ap-card-inset rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-2xs font-bold uppercase text-slate-600 dark:text-slate-400">
                1600M SPLIT · LANE 1
              </span>
              <span className="ap-status-info px-2 py-0.5 rounded-full font-mono text-2xs font-bold">
                {tabularOn ? 'tabular-nums ON' : 'Proportional (Prohibited)'}
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={
                  tabularOn
                    ? 'font-mono tabular-nums text-4xl font-bold tracking-[-0.03em] text-slate-950 dark:text-white'
                    : 'font-sans text-4xl font-bold tracking-tight text-amber-700 dark:text-amber-300'
                }
                style={tabularOn ? undefined : { fontVariantNumeric: 'proportional-nums' }}
              >
                {formattedClock}
              </span>
              <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
                61.4s / 400m
              </span>
            </div>

            <div className="ap-pill-track inline-flex items-center p-1 rounded-xl gap-1 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setTabularOn(true)}
                aria-pressed={tabularOn}
                className={`flex-1 sm:flex-none px-3 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg text-xs font-bold cursor-pointer ${
                  tabularOn ? 'ap-pill-active' : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                JetBrains Mono (Required)
              </button>
              <button
                type="button"
                onClick={() => setTabularOn(false)}
                aria-pressed={!tabularOn}
                className={`flex-1 sm:flex-none px-3 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg text-xs font-bold cursor-pointer ${
                  !tabularOn ? 'ap-pill-active' : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                Proportional (Jitter)
              </button>
            </div>
          </div>
        </div>

        {/* Full Type Hierarchy Specimen */}
        <div className="lg:col-span-7 ap-card rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
              Plus Jakarta Sans + JetBrains Mono Hierarchy
            </h3>
            <span className="font-mono text-2xs font-bold ap-telemetry-label">
              Unassisted Headings · Zero Stacked Kickers
            </span>
          </div>

          <div className="divide-y divide-emerald-950/10 dark:divide-emerald-700/25">
            {TYPOGRAPHY_HIERARCHY.map((item) => (
              <div key={item.role} className="py-3 first:pt-1 last:pb-1 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-2xs text-slate-500 dark:text-slate-400">
                  <span className="font-bold text-slate-800 dark:text-slate-200">{item.role}</span>
                  <span>
                    {item.fontFamily} · {item.sizeLabel} · {item.weightLabel} ({item.trackingLabel})
                  </span>
                </div>
                <div className={item.className}>{item.sampleText}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Do & Don't Visual Usage Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {BRAND_DO_DONT_RULES.map((rule) => (
          <div key={rule.id} className="ap-card rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="ap-card-inset rounded-xl p-3 space-y-1.5">
              <div className="inline-flex items-center gap-1.5 font-mono text-2xs font-bold uppercase text-emerald-700 dark:text-emerald-300">
                <Check className="w-3.5 h-3.5" />
                <span>DO · {rule.doTitle}</span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {rule.doDetail}
              </p>
            </div>
            <div className="ap-card-inset rounded-xl p-3 space-y-1.5">
              <div className="inline-flex items-center gap-1.5 font-mono text-2xs font-bold uppercase text-rose-700 dark:text-rose-300">
                <X className="w-3.5 h-3.5" />
                <span>DON’T · {rule.dontTitle}</span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {rule.dontDetail}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Brand Naming, Permissions & NFHS/NCAA Policy */}
      <div className="ap-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkle className="w-4 h-4 ap-text-brand" />
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
              Canonical Naming, Apparel Permissions &amp; Uniform Rules
            </h3>
          </div>
          <span className="font-mono text-2xs font-bold ap-telemetry-label">
            CAMELCASE &quot;MeetReady&quot; · LEGACY NAMING RETIRED
          </span>
        </div>

        <div className="ap-card-inset rounded-xl px-3.5 py-2.5 text-xs text-slate-700 dark:text-slate-300">
          Write <strong>MeetReady</strong> in CamelCase across UI, print, meet sheets, and press copy (e.g. <em>MeetReady — Track &amp; Field &amp; Cross Country Team OS</em>); use lowercase only inside web domains (<code className="font-mono">https://meetready.app</code>).
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {BRAND_PERMISSIONS_POLICY.map((item) => (
            <div key={item.title} className="ap-card-inset rounded-xl p-3.5 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white leading-snug">
                  {item.title}
                </h4>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full font-mono text-2xs font-bold shrink-0 ${
                    item.status === 'PERMITTED'
                      ? 'ap-status-prime'
                      : item.status === 'UNIFORM CAP'
                        ? 'ap-status-caution'
                        : 'ap-status-strained'
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Official Factual Press & API Partner Boilerplates */}
      <div className="ap-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
            Factual Press &amp; API Partner Boilerplate
          </h3>
          <span className="font-mono text-2xs text-slate-600 dark:text-slate-400">
            Factual specifications &amp; partner copy
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {PRESS_BOILERPLATES.map((item) => {
            const copyKey = `boilerplate-${item.id}`;
            return (
              <div key={item.id} className="ap-card-inset rounded-xl p-3.5 flex flex-col justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-bold text-slate-950 dark:text-white">
                      {item.label}
                    </span>
                    <span className="font-mono text-2xs text-slate-500 dark:text-slate-400">
                      {item.wordCountLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {item.text}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText(copyKey, item.text, item.label)}
                  className="ap-btn-secondary w-full px-3 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copied?.key === copyKey ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-lime-400" />
                      <span>Copied Blurb</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy {item.label}</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
