import React, { useMemo, useState } from 'react';
import {
  BRAND_ASSET_CATALOG,
  BRAND_SURFACES,
  buildBrandKitZipUint8Array,
  evaluateAssetOnBackdrop,
  rasterizeSvgToPngBlob,
  resolveEffectiveSurfaceForAsset,
  triggerBlobDownload,
  type BrandAssetCategory,
  type BrandAssetDefinition,
  type BrandSurfaceId,
} from '../utils/brandAssetEngine';
import { AeroPulseLogo, ThreshBrandWatermark, ThreshFullVectorLockup } from './AeroPulseLogo';
import {
  BrandCobrandLabSection,
  BrandColorMapSection,
  BrandTypographyAndUsageSection,
} from './BrandSystemInteractiveSections';
import {
  ArrowRight,
  CaretLeft,
  Check,
  Copy,
  Crosshair,
  DownloadSimple,
  Eye,
  FileText,
  Gauge,
  Moon,
  SquaresFour,
  Sun,
} from './icons/PhosphorIcons';

interface BrandGuidePageProps {
  isDark: boolean;
  onToggleDark: () => void;
  hasActiveWorkspace: boolean;
  onExitBrand: () => void;
}

type CategoryFilter = 'ALL' | BrandAssetCategory;
type ActiveNavSection = 'brand-assets' | 'brand-colors' | 'brand-cobrand' | 'brand-typography-usage';

const CATEGORY_TABS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'ALL', label: 'All 17' },
  { id: 'LOCKUPS', label: 'Primary Lockups (3)' },
  { id: 'STENCILS', label: '1-Ink Knockouts (3)' },
  { id: 'ICONS', label: 'Gauge Icons & Tiles (7)' },
  { id: 'WORDMARK_AND_SOCIAL', label: 'Wordmark & Social (4)' },
];

const NAV_SECTIONS: Array<{ id: ActiveNavSection; label: string }> = [
  { id: 'brand-assets', label: 'Assets & Icons' },
  { id: 'brand-colors', label: 'Color Scheme / Map' },
  { id: 'brand-cobrand', label: 'Team × THRESH' },
  { id: 'brand-typography-usage', label: 'Typography & Press' },
];

function getSurfacePreviewStyle(surface: Exclude<BrandSurfaceId, 'auto'>): React.CSSProperties {
  switch (surface) {
    case 'obsidian':
      return {
        backgroundColor: '#0B120E',
        backgroundImage:
          'radial-gradient(circle at 18% 12%, rgba(200, 255, 0, 0.14), transparent 58%)',
        borderColor: '#2B543B',
      };
    case 'chalk':
      return {
        backgroundColor: '#F4F7F2',
        borderColor: 'rgba(38, 88, 58, 0.24)',
      };
    case 'paper':
      return {
        backgroundColor: '#FFFFFF',
        borderColor: 'rgba(16, 20, 17, 0.16)',
      };
    case 'volt':
      return {
        backgroundColor: '#C8FF00',
        borderColor: '#65A30D',
      };
    case 'photo-sunlit':
      return {
        backgroundColor: '#D6B89C',
        backgroundImage:
          'linear-gradient(135deg, rgba(255, 245, 232, 0.65) 0%, rgba(186, 114, 78, 0.42) 55%, rgba(132, 74, 48, 0.55) 100%)',
        borderColor: 'rgba(132, 74, 48, 0.35)',
      };
    case 'photo-night':
      return {
        backgroundColor: '#0E1C16',
        backgroundImage:
          'radial-gradient(circle at 75% 18%, rgba(255, 255, 255, 0.18), transparent 48%), linear-gradient(160deg, #09110D 0%, #173326 100%)',
        borderColor: '#2B543B',
      };
    case 'bw-copier':
      return {
        backgroundColor: '#EFEFEF',
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.025) 0px, rgba(0, 0, 0, 0.025) 1px, transparent 1px, transparent 4px)',
        borderColor: '#A3A3A3',
        filter: 'grayscale(1) contrast(1.16)',
      };
  }
}

export default function BrandGuidePage({
  isDark,
  onToggleDark,
  hasActiveWorkspace,
  onExitBrand,
}: BrandGuidePageProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [activeSurface, setActiveSurface] = useState<BrandSurfaceId>('auto');
  const [showBlueprint, setShowBlueprint] = useState<boolean>(true);
  const [activeNav, setActiveNav] = useState<ActiveNavSection>('brand-assets');
  const [copiedSvgId, setCopiedSvgId] = useState<string | null>(null);
  const [busyExportKey, setBusyExportKey] = useState<string | null>(null);
  const [isZipBuilding, setIsZipBuilding] = useState<boolean>(false);
  const [kitStatusNote, setKitStatusNote] = useState<string | null>(null);

  const visibleAssets = useMemo(() => {
    if (categoryFilter === 'ALL') return BRAND_ASSET_CATALOG;
    return BRAND_ASSET_CATALOG.filter((asset) => asset.category === categoryFilter);
  }, [categoryFilter]);

  const handleJumpSection = (sectionId: ActiveNavSection) => {
    setActiveNav(sectionId);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCopySvgMarkup = async (asset: BrandAssetDefinition) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(asset.svgMarkup);
      }
      setCopiedSvgId(asset.id);
      window.setTimeout(() => {
        setCopiedSvgId((curr) => (curr === asset.id ? null : curr));
      }, 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleDownloadSvg = (asset: BrandAssetDefinition) => {
    const blob = new Blob([asset.svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    triggerBlobDownload(blob, `${asset.id}.svg`);
  };

  const handleDownloadPng = async (
    asset: BrandAssetDefinition,
    specKey: '1x' | '2x' | '4x',
    width: number,
    height: number
  ) => {
    const busyKey = `${asset.id}-${specKey}`;
    setBusyExportKey(busyKey);
    try {
      const blob = await rasterizeSvgToPngBlob(asset.svgMarkup, width, height);
      triggerBlobDownload(blob, `${asset.id}-${specKey}.png`);
    } finally {
      setBusyExportKey(null);
    }
  };

  const handleDownloadBrandKitZip = async () => {
    setIsZipBuilding(true);
    setKitStatusNote('Bundling 17 SVGs, Hi-DPI PNGs & design tokens...');
    try {
      const pngEntries: Record<string, Uint8Array> = {};
      const keyPngTargets = [
        { id: 'thresh-lockup-dark', w: 944, h: 248, name: 'thresh-lockup-dark-2x.png' },
        { id: 'thresh-lockup-light', w: 944, h: 248, name: 'thresh-lockup-light-2x.png' },
        { id: 'thresh-sticker-diecut', w: 944, h: 248, name: 'thresh-sticker-diecut-2x.png' },
        { id: 'thresh-1ink-stencil', w: 944, h: 248, name: 'thresh-1ink-stencil-2x.png' },
        { id: 'thresh-1ink-stencil-white', w: 944, h: 248, name: 'thresh-1ink-stencil-white-2x.png' },
        { id: 'thresh-icon-square-fullbleed', w: 512, h: 512, name: 'thresh-icon-square-512.png' },
        { id: 'thresh-og-1200x630', w: 1200, h: 630, name: 'thresh-og-1200x630.png' },
      ];

      for (const target of keyPngTargets) {
        const asset = BRAND_ASSET_CATALOG.find((a) => a.id === target.id);
        if (!asset) continue;
        try {
          const pngBlob = await rasterizeSvgToPngBlob(asset.svgMarkup, target.w, target.h);
          pngEntries[target.name] = new Uint8Array(await pngBlob.arrayBuffer());
        } catch {
          // continue cleanly if canvas image decode is unavailable
        }
      }

      const zipBytes = await buildBrandKitZipUint8Array(pngEntries);
      const copyBuffer = new Uint8Array(zipBytes.byteLength);
      copyBuffer.set(zipBytes);
      const zipBlob = new Blob([copyBuffer.buffer], { type: 'application/zip' });
      triggerBlobDownload(zipBlob, 'THRESH-Brand-Kit.zip');
      setKitStatusNote(
        `Downloaded THRESH-Brand-Kit.zip (${Object.keys(pngEntries).length} PNGs + 17 SVGs + JSON tokens).`
      );
    } finally {
      setIsZipBuilding(false);
    }
  };

  return (
    <div id="top" className="ap-shell text-slate-900 dark:text-slate-100">
      <a href="#brand-main" className="ap-skip-link">
        Skip to brand studio content
      </a>

      {/* Header Bar Matching Authenticated Cockpit */}
      <header className="sticky top-0 z-30 pt-2 sm:pt-3 pb-2">
        <div className="ap-container">
          <div className="ap-header-bar rounded-2xl px-3 sm:px-5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 relative overflow-hidden">
            <div className="ap-brand-hairline absolute top-0 left-0 right-0 h-[3px]" />

            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={onExitBrand}
                className="min-h-[44px] sm:min-h-[40px] inline-flex items-center text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-600 dark:focus:ring-lime-400 rounded-lg"
                aria-label={hasActiveWorkspace ? 'Back to THRESH cockpit' : 'Return to THRESH'}
              >
                <AeroPulseLogo size="sm" />
              </button>
              <span className="ap-lane-badge hidden sm:inline-flex shrink-0">
                <span className="ap-lane-badge-inner">BRAND &amp; STYLE GUIDE</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <a
                href="/docs/"
                className="ap-btn-secondary px-3 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Docs</span>
              </a>

              <button
                type="button"
                onClick={onToggleDark}
                aria-label={isDark ? 'Switch to Light Stadium Mode' : 'Switch to Dark Stadium Mode'}
                aria-pressed={isDark}
                className="ap-btn-secondary px-3 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {isDark ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-emerald-800" />}
                <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
              </button>

              <button
                type="button"
                onClick={onExitBrand}
                className="ap-btn-primary px-3.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                {hasActiveWorkspace ? (
                  <>
                    <CaretLeft className="w-3.5 h-3.5" />
                    <span>Back to Cockpit</span>
                  </>
                ) : (
                  <>
                    <span>Enter THRESH</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Framed Stadium Stage */}
      <div className="flex-1 flex flex-col min-w-0 pb-10">
        <div className="flex-1 ap-container pt-2 sm:pt-3 min-w-0 flex flex-col gap-5">
          <main id="brand-main" className="ap-content-stage relative overflow-hidden p-4 sm:p-7 space-y-8 min-w-0" tabIndex={-1}>
            <ThreshBrandWatermark className="w-60 h-52 absolute -right-4 -top-3" />
            {/* Hero First-Viewport Construction Specimen & Brand Kit CTA */}
            <section aria-labelledby="brand-hero-heading" className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                <div className="lg:col-span-6 flex flex-col justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h1
                        id="brand-hero-heading"
                        className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white"
                      >
                        THRESH Brand Studio &amp; Style Guide
                      </h1>
                      <span className="ap-status-prime px-2.5 py-0.5 rounded-full font-mono text-2xs font-bold">
                        PUBLIC · NO LOGIN REQUIRED
                      </span>
                    </div>

                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-w-[65ch]">
                      Official SVG vectors, transparent 1x / 2x / 4x PNG exports, true compound-path 1-ink print stencils, our Stadium Track color scheme, and NCAA/NFHS team co-branding tools — engineered for coaches, meet directors, print shops, press, and API partners.
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={isZipBuilding}
                        onClick={() => void handleDownloadBrandKitZip()}
                        className="ap-btn-primary px-5 py-2.5 min-h-[44px] rounded-xl text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
                      >
                        <DownloadSimple className="w-4 h-4" />
                        <span>
                          {isZipBuilding
                            ? 'Packaging Brand Kit...'
                            : 'Download Complete Brand Kit (.zip)'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowBlueprint((b) => !b)}
                        aria-pressed={showBlueprint}
                        className="ap-btn-secondary px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Crosshair className="w-4 h-4 ap-text-brand" />
                        <span>{showBlueprint ? 'Hide Blueprint Grid' : 'Show Blueprint Grid'}</span>
                      </button>
                    </div>

                    {kitStatusNote ? (
                      <p className="font-mono text-2xs font-semibold ap-telemetry-label">
                        {kitStatusNote}
                      </p>
                    ) : (
                      <p className="font-mono text-2xs text-slate-600 dark:text-slate-400">
                        Includes 17 vector SVGs, crisp PNG lockups, CSS/JSON tokens &amp; print specs
                      </p>
                    )}
                  </div>
                </div>

                {/* Live S2 × W-A Geometric Construction Specimen */}
                <div className="lg:col-span-6 ap-card rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-2xs font-bold uppercase text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5">
                      <Gauge className="w-4 h-4 ap-text-brand" />
                      <span>S2 × W-A Modular Architecture</span>
                    </span>
                    <span className="font-mono text-2xs font-bold ap-telemetry-label">
                      472 × 124 · 0° OPTICAL CALIPER
                    </span>
                  </div>

                  <div
                    className="relative rounded-xl border p-4 sm:p-5 flex items-center justify-center overflow-hidden"
                    style={{
                      backgroundColor: isDark ? '#0B120E' : '#FFFFFF',
                      borderColor: isDark ? '#2B543B' : 'rgba(38, 88, 58, 0.22)',
                    }}
                  >
                    <div className="relative w-full max-w-[472px]">
                      <ThreshFullVectorLockup
                        className="w-full h-auto block"
                        ariaLabel="THRESH official geometric construction specimen"
                      />

                      {showBlueprint && (
                        <svg
                          viewBox="0 0 472 124"
                          fill="none"
                          aria-hidden="true"
                          className="absolute inset-0 w-full h-full pointer-events-none"
                        >
                          {/* 1R Clear-Space Perimeter Frame */}
                          <rect
                            x="2"
                            y="2"
                            width="468"
                            height="120"
                            rx="6"
                            stroke={isDark ? '#38BDF8' : '#0284C7'}
                            strokeOpacity="0.65"
                            strokeWidth="1"
                            strokeDasharray="4 3"
                          />
                          {/* S2 Concentric Chronometer Rings (cx=64.8, cy=63.1, rIn=30.4, rOut=44.1) */}
                          <circle
                            cx="64.8"
                            cy="63.1"
                            r="44.1"
                            stroke={isDark ? '#38BDF8' : '#0284C7'}
                            strokeOpacity="0.45"
                            strokeWidth="0.9"
                            strokeDasharray="3 3"
                          />
                          <circle
                            cx="64.8"
                            cy="63.1"
                            r="30.4"
                            stroke={isDark ? '#38BDF8' : '#0284C7'}
                            strokeOpacity="0.4"
                            strokeWidth="0.8"
                          />
                          <circle
                            cx="64.8"
                            cy="63.1"
                            r="24.5"
                            stroke={isDark ? '#C8FF00' : '#357A00'}
                            strokeOpacity="0.45"
                            strokeWidth="0.7"
                            strokeDasharray="2 2"
                          />
                          {/* Center Crosshair + 315deg Piercing Threshold Breach Axis */}
                          <line
                            x1="64.8"
                            y1="6"
                            x2="64.8"
                            y2="118"
                            stroke={isDark ? '#38BDF8' : '#0284C7'}
                            strokeOpacity="0.5"
                            strokeWidth="0.9"
                          />
                          <line
                            x1="12"
                            y1="63.1"
                            x2="122"
                            y2="63.1"
                            stroke={isDark ? '#38BDF8' : '#0284C7'}
                            strokeOpacity="0.5"
                            strokeWidth="0.9"
                          />
                          {/* Vertical Separation Axis at W-A Threshold Horizon Entry */}
                          <line
                            x1="134"
                            y1="10"
                            x2="134"
                            y2="114"
                            stroke={isDark ? '#FBBF24' : '#D97706'}
                            strokeOpacity="0.85"
                            strokeWidth="1.2"
                            strokeDasharray="3 2"
                          />
                        </svg>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-slate-600 dark:text-slate-400">
                    <span>
                      {showBlueprint
                        ? 'TL-2P1 (60,70) r=[22.2..25, 31..45] 315°∥ · FAV-F 16px · W-A stem=13.5 bar=11.2'
                        : 'Minimum clear space: 0.5× symbol height (TL-2P1 + W-A)'}
                    </span>
                    <span className="ap-telemetry-label">Pure vector paths — zero skew/font distortion</span>
                  </div>
                </div>
              </div>

              {/* Velocity-Sheared -14° Section Navigation Strip (2x2 on 390px, inline on >= sm) */}
              <nav
                aria-label="Brand guide sections"
                className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 pt-1 pb-1"
              >
                {NAV_SECTIONS.map((sec) => {
                  const active = activeNav === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => handleJumpSection(sec.id)}
                      className={`ap-track-tab px-3 sm:px-4 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-bold flex items-center justify-center cursor-pointer transition-colors ${
                        active ? 'ap-nav-volt-active' : 'ap-track-tab-idle'
                      }`}
                    >
                      <span className="ap-track-tab-inner truncate">{sec.label}</span>
                    </button>
                  );
                })}
              </nav>
            </section>

            {/* Section A: Universal Logo & Icon Asset Studio with 7-Surface Stress-Tester */}
            <section id="brand-assets" aria-labelledby="brand-assets-heading" className="space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2
                    id="brand-assets-heading"
                    className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-white"
                  >
                    Universal Logo &amp; Icon Asset Studio
                  </h2>
                  <span className="ap-lane-badge">
                    <span className="ap-lane-badge-inner">17 VECTORS · 1X / 2X / 4X PNG</span>
                  </span>
                </div>

                {/* Category Filter Pills */}
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Asset category filter">
                  {CATEGORY_TABS.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoryFilter(cat.id)}
                      aria-pressed={categoryFilter === cat.id}
                      className={`px-3 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-colors ${
                        categoryFilter === cat.id
                          ? 'ap-nav-volt-active'
                          : 'ap-card-inset text-slate-700 dark:text-slate-200 hover:border-emerald-700/40'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 7-Surface Real-World Stress Tester Switcher */}
              <div className="ap-card rounded-2xl p-3.5 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 ap-text-brand shrink-0" />
                    <span className="font-display text-sm font-bold text-slate-950 dark:text-white">
                      Surface Stress-Tester · Preview Marks Under Real Conditions
                    </span>
                  </div>
                  <span className="font-mono text-2xs text-slate-600 dark:text-slate-400">
                    {BRAND_SURFACES.find((s) => s.id === activeSurface)?.description}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Surface backdrop simulator">
                  {BRAND_SURFACES.map((surface) => {
                    const selected = activeSurface === surface.id;
                    return (
                      <button
                        key={surface.id}
                        type="button"
                        onClick={() => setActiveSurface(surface.id)}
                        aria-pressed={selected}
                        className={`px-3 py-1.5 min-h-[44px] sm:min-h-[38px] rounded-xl inline-flex items-center gap-2 text-xs font-semibold shrink-0 cursor-pointer transition-colors ${
                          selected
                            ? 'ap-pill-active'
                            : 'ap-card-inset text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <span
                          className="w-4 h-4 rounded border border-black/20 dark:border-white/25 shrink-0"
                          style={{ backgroundColor: surface.swatchHex }}
                          aria-hidden="true"
                        />
                        <span>{surface.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Asset Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleAssets.map((asset) => {
                  const effectiveSurface = resolveEffectiveSurfaceForAsset(
                    asset.id,
                    activeSurface,
                    isDark
                  );
                  const legality = evaluateAssetOnBackdrop(asset, activeSurface);
                  const previewDataUrl = `data:image/svg+xml,${encodeURIComponent(asset.svgMarkup)}`;
                  const legalityBadgeClass =
                    legality.status === 'RECOMMENDED'
                      ? 'ap-status-prime'
                      : legality.status === 'CAUTION'
                        ? 'ap-status-caution'
                        : 'ap-status-strained';

                  const isSquare = asset.width === asset.height;
                  const isBanner = asset.id === 'thresh-og-1200x630';

                  return (
                    <article
                      key={asset.id}
                      className={`ap-card rounded-2xl p-4 flex flex-col justify-between gap-3.5 min-w-0 ${
                        isBanner && categoryFilter === 'ALL' ? 'md:col-span-2 xl:col-span-2' : ''
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="min-w-0">
                            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white leading-snug">
                              {asset.title}
                            </h3>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">
                              {asset.subtitle}
                            </p>
                          </div>
                          <span
                            className={`${legalityBadgeClass} px-2.5 py-0.5 rounded-full font-mono text-2xs font-bold shrink-0`}
                          >
                            {legality.badgeLabel}
                          </span>
                        </div>

                        {/* Preview Well on Selected Surface */}
                        <div
                          className="rounded-xl border p-4 h-36 flex items-center justify-center overflow-hidden transition-colors"
                          style={getSurfacePreviewStyle(effectiveSurface)}
                        >
                          <img
                            src={previewDataUrl}
                            alt={`${asset.title} preview on ${activeSurface} backdrop`}
                            className={
                              isBanner
                                ? 'h-full w-auto max-w-full object-contain rounded-md'
                                : isSquare
                                  ? 'h-24 w-24 object-contain'
                                  : 'max-h-20 w-auto max-w-full object-contain'
                            }
                          />
                        </div>

                        <div className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                          <p className="leading-snug">{legality.rationale}</p>
                          <p className="font-mono text-2xs text-slate-500 dark:text-slate-400">
                            {asset.minPhysicalSpec}
                          </p>
                        </div>
                      </div>

                      {/* Download & Copy Action Bar */}
                      <div className="pt-2 border-t border-emerald-950/10 dark:border-emerald-700/25 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDownloadSvg(asset)}
                            className="ap-btn-secondary px-3 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <DownloadSimple className="w-3.5 h-3.5 ap-text-brand" />
                            <span>.SVG</span>
                          </button>

                          {asset.pngSizes.map((sz) => {
                            const key = `${asset.id}-${sz.key}`;
                            const isBusy = busyExportKey === key;
                            return (
                              <button
                                key={sz.key}
                                type="button"
                                disabled={busyExportKey !== null}
                                onClick={() =>
                                  void handleDownloadPng(asset, sz.key, sz.width, sz.height)
                                }
                                title={`Download PNG ${sz.label}`}
                                className="ap-card-inset px-2.5 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg font-mono text-2xs font-bold text-slate-800 dark:text-slate-100 hover:border-emerald-700/45 dark:hover:border-lime-400/50 cursor-pointer"
                              >
                                {isBusy ? '...' : `${sz.key} PNG`}
                              </button>
                            );
                          })}

                          <button
                            type="button"
                            onClick={() => void handleCopySvgMarkup(asset)}
                            className="ap-card-inset px-2.5 py-1.5 min-h-[44px] sm:min-h-[36px] rounded-lg font-mono text-2xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 hover:border-emerald-700/45 dark:hover:border-lime-400/50 cursor-pointer"
                            title="Copy raw inline <svg> markup"
                          >
                            {copiedSvgId === asset.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-lime-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Screen-Print, Plotter & CNC Production Callout */}
              <div className="ap-card-inset rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <SquaresFour className="w-5 h-5 ap-text-brand shrink-0 mt-0.5" />
                  <div className="space-y-0.5 text-xs text-slate-700 dark:text-slate-300">
                    <div className="font-display font-bold text-slate-950 dark:text-white">
                      True Compound-Path 1-Ink Stencils Verified for Print &amp; Cutters
                    </div>
                    <p className="leading-relaxed">
                      All 5 monochrome stencil variants (<code className="font-mono">Obsidian Black</code>, <code className="font-mono">Reversed White</code>, <code className="font-mono">Track Volt</code>, and unframed <code className="font-mono">Gauge Symbols</code>) split gauge arcs mathematically around the needle moat and outline the tick as a closed capsule path — zero fake white strokes, zero masks, and zero plotter self-intersections.
                    </p>
                  </div>
                </div>
                <span className="font-mono text-2xs font-bold ap-telemetry-label shrink-0">
                  Min 0.5&quot; Lockup · 0.35&quot; Symbol
                </span>
              </div>
            </section>

            {/* Section B: 3-Tier Color Map */}
            <BrandColorMapSection isDark={isDark} />

            {/* Section C: Live Team × THRESH Co-Branding Lab */}
            <BrandCobrandLabSection isDark={isDark} />

            {/* Section D: Typography Scale, 0.01s Tabular Demo & Brand Policy */}
            <BrandTypographyAndUsageSection />

            {/* Brand Studio Footer */}
            <footer className="pt-5 border-t border-emerald-900/15 dark:border-[#244331] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2.5">
                <AeroPulseLogo size="sm" />
                <span className="hidden sm:inline font-mono text-2xs">
                  THRESH — Run &amp; Ride Readiness · Stadium Track System
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-medium">
                <a
                  href="/docs/"
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-slate-950 dark:hover:text-white transition-colors"
                >
                  Documentation &amp; Physiology
                </a>
                <a
                  href="/docs/#sec-safesport"
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center hover:text-slate-950 dark:hover:text-white transition-colors"
                >
                  Safe-Sport &amp; Privacy
                </a>
                <button
                  type="button"
                  onClick={onExitBrand}
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center font-bold ap-text-brand hover:underline cursor-pointer"
                >
                  {hasActiveWorkspace ? '← Return to THRESH Cockpit' : 'Enter THRESH →'}
                </button>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
