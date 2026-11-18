import React from 'react';

export interface ZoneBarDatum {
  zoneCode: string;
  durationPct: number;
  heightPct: number;
  colorHex: string;
}

const LOCKED_ZONE_HEX: Record<string, string> = {
  Z1: '#0D9488',
  Z2: '#059669',
  Z3: '#0284C7',
  Z4: '#D97706',
  Z5: '#EA580C',
  Z6: '#DC2626',
  FR: '#7C3AED',
};

function resolveZoneHex(code: string): string {
  const clean = (code || '').toUpperCase().trim();
  if (clean.startsWith('Z1') || clean === 'E') return LOCKED_ZONE_HEX.Z1;
  if (clean.startsWith('Z2') || clean === 'SUB_T') return LOCKED_ZONE_HEX.Z2;
  if (clean.startsWith('Z3') || clean === 'CV' || clean === 'T') return LOCKED_ZONE_HEX.Z3;
  if (clean.startsWith('Z4')) return LOCKED_ZONE_HEX.Z4;
  if (clean.startsWith('Z5') || clean === 'I') return LOCKED_ZONE_HEX.Z5;
  if (clean.startsWith('Z6') || clean === 'R' || clean === 'FR') return LOCKED_ZONE_HEX.Z6;
  return LOCKED_ZONE_HEX.Z2;
}

/**
 * 1A. Pre-login compact 3-cell visual capability strip (Load Curve, Zone Morph, 0.01s Splits).
 */
export const LoginCapabilitySparkStrip: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`grid grid-cols-3 gap-2 ${className}`}>
    <div className="rounded-xl ap-card-inset px-2.5 py-2 flex items-center gap-2">
      <svg viewBox="0 0 36 16" className="w-9 h-4 shrink-0" aria-hidden="true">
        <path
          d="M 2 13 C 9 12, 13 9, 19 8 C 25 7, 29 4, 34 3"
          fill="none"
          stroke="#059669"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M 2 14 L 11 10 L 18 11 L 26 6 L 34 5"
          fill="none"
          stroke="#D97706"
          strokeWidth="1.5"
          strokeDasharray="2 2"
          strokeLinecap="round"
        />
      </svg>
      <div className="min-w-0">
        <div className="text-2xs font-bold text-[#101411] dark:text-[#F4F7F4] truncate">
          Load Curve
        </div>
      </div>
    </div>

    <div className="rounded-xl ap-card-inset px-2.5 py-2 flex items-center gap-2">
      <svg viewBox="0 0 36 16" className="w-9 h-4 shrink-0" aria-hidden="true">
        <rect x="2" y="10" width="5" height="5" rx="1" fill="#0D9488" />
        <rect x="9" y="7" width="6" height="8" rx="1" fill="#059669" />
        <rect x="17" y="4" width="5" height="11" rx="1" fill="#D97706" />
        <rect x="24" y="2" width="5" height="13" rx="1" fill="#EA580C" />
        <rect x="31" y="9" width="4" height="6" rx="1" fill="#0D9488" />
      </svg>
      <div className="min-w-0">
        <div className="text-2xs font-bold text-[#101411] dark:text-[#F4F7F4] truncate">
          Zone Morph
        </div>
      </div>
    </div>

    <div className="rounded-xl ap-card-inset px-2.5 py-2 flex items-center gap-2">
      <svg viewBox="0 0 36 16" className="w-9 h-4 shrink-0" aria-hidden="true">
        <rect x="1" y="2" width="34" height="12" rx="3" fill="#0B120E" stroke="#2B5B3F" strokeWidth="1" />
        <line x1="7" y1="8" x2="14" y2="8" stroke="#C8FF00" strokeWidth="2" strokeLinecap="round" />
        <circle cx="20" cy="8" r="2" fill="#C8FF00" />
        <circle cx="28" cy="8" r="2" fill="#56BA00" />
      </svg>
      <div className="min-w-0">
        <div className="text-2xs font-bold text-[#101411] dark:text-[#F4F7F4] truncate">
          0.01s Splits
        </div>
      </div>
    </div>
  </div>
);

/**
 * 1B. Step-2 Strava sync horizon graphic comparing 90d initial backfill vs 365d seasonal depth.
 */
export const SyncScopeTimelineBar: React.FC<{ days?: 90 | 365 }> = ({ days = 90 }) => (
  <div className="rounded-xl ap-card-inset px-3 py-2 flex items-center justify-between gap-3">
    <svg viewBox="0 0 180 14" className="flex-1 h-3.5 max-w-[200px]" aria-hidden="true">
      <rect x="2" y="4" width="176" height="6" rx="3" fill="#E3ECE5" />
      <rect
        x="2"
        y="4"
        width={days >= 365 ? '176' : '46'}
        height="6"
        rx="3"
        fill="#1C5436"
      />
      <circle cx="48" cy="7" r="2.5" fill="#C8FF00" stroke="#101411" strokeWidth="1" />
      {days >= 365 && (
        <circle cx="176" cy="7" r="2.5" fill="#C8FF00" stroke="#101411" strokeWidth="1" />
      )}
    </svg>
    <span className="font-mono text-2xs font-bold text-[#1C5436] dark:text-[#C8FF00] whitespace-nowrap">
      {days >= 365 ? '365d Archive' : '90d Fast Sync'}
    </span>
  </div>
);

/**
 * 2. Compact 64x10 corridor bullet gauge for overnight HRV, RHR, Sleep, or Form/CTL.
 */
export const VitalsCorridorBulletRow: React.FC<{
  valuePct: number;
  bandStartPct?: number;
  bandWidthPct?: number;
  tone?: 'prime' | 'caution' | 'strained' | 'info';
}> = ({
  valuePct,
  bandStartPct = 28,
  bandWidthPct = 44,
  tone = 'prime',
}) => {
  const clamped = Math.max(6, Math.min(94, valuePct));
  const dotColor =
    tone === 'strained'
      ? '#DC2626'
      : tone === 'caution'
        ? '#D97706'
        : tone === 'info'
          ? '#0284C7'
          : '#059669';

  return (
    <svg viewBox="0 0 64 10" className="w-16 h-2.5 shrink-0" aria-hidden="true">
      <rect x="1" y="3" width="62" height="4" rx="2" fill="#E3ECE5" />
      <rect
        x={(bandStartPct / 100) * 62 + 1}
        y="2"
        width={Math.max(8, (bandWidthPct / 100) * 62)}
        height="6"
        rx="2"
        fill="#0D9488"
        fillOpacity="0.28"
      />
      <circle
        cx={(clamped / 100) * 62 + 1}
        cy="5"
        r="3.2"
        fill={dotColor}
        stroke="#FFFFFF"
        strokeWidth="1"
      />
    </svg>
  );
};

/**
 * 3. Ghost-Overlay Diff Skyline comparing scheduled dashed outline against morphed Z1-Z6 bars.
 */
export const GhostDiffSkyline: React.FC<{
  baselineHeightsPct: number[];
  morphedBars: Array<{ heightPct: number; zoneCode: string; label?: string }>;
  className?: string;
}> = ({ baselineHeightsPct, morphedBars, className = '' }) => {
  const count = Math.max(1, morphedBars.length);
  const w = 240;
  const h = 48;
  const slotW = w / count;

  const outlinePoints = baselineHeightsPct
    .slice(0, count)
    .map((pct, i) => {
      const x = Number(((i + 0.5) * slotW).toFixed(1));
      const y = Number((h - 4 - (Math.max(8, Math.min(100, pct)) / 100) * (h - 10)).toFixed(1));
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`w-full h-12 ${className}`}
      role="img"
      aria-label="Scheduled outline vs adapted zone skyline"
    >
      {morphedBars.map((bar, i) => {
        const barH = Math.max(4, (Math.max(8, Math.min(100, bar.heightPct)) / 100) * (h - 10));
        const x = Number((i * slotW + 1).toFixed(1));
        const bw = Math.max(3, Number((slotW - 2).toFixed(1)));
        const y = Number((h - 3 - barH).toFixed(1));
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={bw}
            height={barH}
            rx="1.5"
            fill={resolveZoneHex(bar.zoneCode)}
            fillOpacity="0.88"
          />
        );
      })}
      {outlinePoints && (
        <polyline
          points={outlinePoints}
          fill="none"
          stroke="#101411"
          strokeWidth="1.5"
          strokeDasharray="3 2"
          strokeOpacity="0.7"
        />
      )}
    </svg>
  );
};

/**
 * 4. Compact Bracketed Interval Tape (syntax-aware SVG skyline).
 */
export const BracketedIntervalTape: React.FC<{
  workoutSyntax?: string;
  compact?: boolean;
  className?: string;
}> = ({ workoutSyntax = '', compact = false, className = '' }) => {
  const segments = React.useMemo<Array<{ flex: number; height: number; hex: string }>>(() => {
    const lines = workoutSyntax
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      return [
        { flex: 2, height: 35, hex: LOCKED_ZONE_HEX.Z1 },
        { flex: 3, height: 55, hex: LOCKED_ZONE_HEX.Z2 },
        { flex: 2, height: 78, hex: LOCKED_ZONE_HEX.Z4 },
        { flex: 1, height: 30, hex: LOCKED_ZONE_HEX.Z1 },
        { flex: 2, height: 78, hex: LOCKED_ZONE_HEX.Z4 },
        { flex: 2, height: 35, hex: LOCKED_ZONE_HEX.Z1 },
      ];
    }

    const bars: Array<{ flex: number; height: number; hex: string }> = [];
    let currentRepeat = 1;
    for (const line of lines) {
      const repMatch = line.match(/(\d+)\s*x\b/i);
      if (!line.startsWith('-') && repMatch) {
        currentRepeat = Math.max(1, Math.min(8, Number(repMatch[1]) || 1));
        continue;
      }
      if (!line.startsWith('-')) continue;
      const pctMatch = line.match(/(\d+)\s*%/);
      const pct = pctMatch ? Number(pctMatch[1]) : 72;
      const isWarmOrCool = /warm|cool|easy|recovery|jog|walk|rest/i.test(line);
      const zone = isWarmOrCool
        ? 'Z1'
        : pct >= 115
          ? 'Z6'
          : pct >= 103
            ? 'Z5'
            : pct >= 92
              ? 'Z4'
              : pct >= 78
                ? 'Z3'
                : 'Z2';
      const height = isWarmOrCool
        ? 30
        : zone === 'Z6'
          ? 96
          : zone === 'Z5'
            ? 84
            : zone === 'Z4'
              ? 70
              : zone === 'Z3'
                ? 54
                : 40;
      const count = isWarmOrCool && currentRepeat === 1 ? 1 : Math.min(4, currentRepeat);
      for (let r = 0; r < count; r++) {
        bars.push({ flex: isWarmOrCool ? 1.5 : 2, height, hex: resolveZoneHex(zone) });
      }
      if (!line.toLowerCase().includes('recover')) {
        currentRepeat = Math.max(1, currentRepeat);
      }
    }
    return bars.length > 0 ? bars.slice(0, 14) : [{ flex: 1, height: 48, hex: LOCKED_ZONE_HEX.Z2 }];
  }, [workoutSyntax]);

  const totalFlex = segments.reduce((acc, s) => acc + s.flex, 0) || 1;
  const width = 220;
  const height = compact ? 22 : 36;
  let cursorX = 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${compact ? 'h-5' : 'h-9'} ${className}`}
      aria-hidden="true"
    >
      {segments.map((seg, i) => {
        const segW = Math.max(4, (seg.flex / totalFlex) * (width - 2) - 2);
        const segH = Math.max(4, (seg.height / 100) * (height - 4));
        const x = Number(cursorX.toFixed(1));
        const y = Number((height - segH - 1).toFixed(1));
        cursorX += segW + 2;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Number(segW.toFixed(1))}
            height={Number(segH.toFixed(1))}
            rx="1.5"
            fill={seg.hex}
          />
        );
      })}
    </svg>
  );
};

/**
 * 5. Pod Stagger Lane Matrix showing synchronized wave stagger across training pods.
 */
export const PodStaggerLaneMatrix: React.FC<{
  pods: Array<{ podLabel: string; offsetSecs: number }>;
}> = ({ pods }) => {
  const maxOffset = Math.max(20, ...pods.map((p) => p.offsetSecs));
  return (
    <svg
      viewBox="0 0 220 44"
      className="w-full h-11"
      role="img"
      aria-label="Staggered pod release lanes"
    >
      {pods.slice(0, 3).map((pod, idx) => {
        const y = 5 + idx * 13;
        const startX = 48 + Math.round((pod.offsetSecs / maxOffset) * 58);
        const barColor =
          idx === 0 ? '#1C5436' : idx === 1 ? '#0D9488' : '#0284C7';
        return (
          <g key={pod.podLabel}>
            <text
              x="2"
              y={y + 8}
              fontSize="8"
              fontWeight="700"
              fill="#43584B"
              fontFamily="monospace"
            >
              {pod.podLabel.slice(0, 7)}
            </text>
            <rect x="48" y={y + 1} width="166" height="8" rx="4" fill="#E3ECE5" />
            <rect
              x={startX}
              y={y + 1}
              width={Math.max(36, 214 - startX)}
              height="8"
              rx="4"
              fill={barColor}
            />
          </g>
        );
      })}
    </svg>
  );
};

/**
 * 6A. 6-bar archetype weekly progression sparkline for Goal cards.
 */
export const ArchetypeProgressionSparkline: React.FC<{
  levels?: number[];
  active?: boolean;
}> = ({ levels = [42, 55, 68, 76, 86, 48], active = false }) => {
  const maxVal = Math.max(1, ...levels);
  return (
    <svg viewBox="0 0 56 18" className="w-14 h-4 shrink-0" aria-hidden="true">
      {levels.slice(0, 6).map((v, idx) => {
        const bh = Math.max(3, Math.round((v / maxVal) * 14));
        const isTaper = idx === 5 && v < levels[4];
        const fill = active
          ? '#56BA00'
          : isTaper
            ? '#0D9488'
            : '#1C5436';
        return (
          <rect
            key={idx}
            x={2 + idx * 9}
            y={16 - bh}
            width="6"
            height={bh}
            rx="1"
            fill={fill}
            fillOpacity={isTaper ? 0.7 : 0.9}
          />
        );
      })}
    </svg>
  );
};

/**
 * 6B. Publish window bracket showing 1W / 2W / Full release slices over the planned block.
 */
export const PublishWindowTimelineBracket: React.FC<{
  totalWeeks: number;
  cadence: 'FULL_BLOCK' | 'ROLLING_2W' | 'ROLLING_1W';
}> = ({ totalWeeks, cadence }) => {
  const releaseWeeks =
    cadence === 'ROLLING_1W' ? 1 : cadence === 'ROLLING_2W' ? 2 : totalWeeks;
  const pct = Math.max(8, Math.min(100, Math.round((releaseWeeks / Math.max(1, totalWeeks)) * 100)));
  return (
    <div className="flex items-center gap-2 text-2xs font-mono text-[#43584B] dark:text-[#93A39A]">
      <svg viewBox="0 0 120 12" className="w-28 h-3 shrink-0" aria-hidden="true">
        <rect x="1" y="4" width="118" height="4" rx="2" fill="#E3ECE5" />
        <rect
          x="1"
          y="3"
          width={Math.max(10, Math.round((pct / 100) * 118))}
          height="6"
          rx="3"
          fill="#56BA00"
        />
      </svg>
      <span>
        {releaseWeeks}/{totalWeeks}w queued
      </span>
    </div>
  );
};

/**
 * 7A. Segmented Spiked-Meter capacity strip for ortho-spike-budget-tile.
 */
export const SpikeBudgetSegmentedMeter: React.FC<{
  usedMeters: number;
  capMeters: number;
}> = ({ usedMeters, capMeters }) => {
  const ratio = capMeters > 0 ? usedMeters / capMeters : 0;
  const activeSegments = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return (
    <svg viewBox="0 0 120 8" className="w-full h-2 mt-1.5" aria-hidden="true">
      {Array.from({ length: 10 }, (_, idx) => {
        const filled = idx < activeSegments;
        const fill = !filled
          ? '#E3ECE5'
          : idx >= 8
            ? '#DC2626'
            : idx >= 6
              ? '#D97706'
              : '#059669';
        return (
          <rect
            key={idx}
            x={idx * 12}
            y="1"
            width="9.5"
            height="6"
            rx="1.5"
            fill={fill}
          />
        );
      })}
    </svg>
  );
};

/**
 * 7B. 3-Channel ACWR Bullet Strip (Cardio, Impact, Torque) with 0.8-1.3x sweet-spot band.
 */
export const AcwrThreeChannelBullets: React.FC<{
  cardioAcwr: number;
  impactAcwr: number;
  torqueAcwr: number;
}> = ({ cardioAcwr, impactAcwr, torqueAcwr }) => {
  const rows = [
    { label: 'Cardio', val: cardioAcwr, hex: '#0D9488' },
    { label: 'Impact', val: impactAcwr, hex: '#EA580C' },
    { label: 'Torque', val: torqueAcwr, hex: '#0284C7' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 pt-1.5">
      {rows.map((r) => {
        const pct = Math.max(6, Math.min(94, ((r.val - 0.4) / 1.4) * 100));
        return (
          <div key={r.label} className="space-y-0.5">
            <div className="flex items-center justify-between font-mono text-2xs text-[#43584B] dark:text-[#93A39A]">
              <span>{r.label}</span>
              <span className="font-bold text-[#101411] dark:text-[#F4F7F4]">
                {r.val.toFixed(2)}x
              </span>
            </div>
            <svg viewBox="0 0 60 8" className="w-full h-2" aria-hidden="true">
              <rect x="0" y="2" width="60" height="4" rx="2" fill="#E3ECE5" />
              <rect x="17" y="1" width="21" height="6" rx="1.5" fill="#059669" fillOpacity="0.22" />
              <circle cx={(pct / 100) * 58 + 1} cy="4" r="2.8" fill={r.hex} />
            </svg>
          </div>
        );
      })}
    </div>
  );
};

/**
 * 8A. 7-day compliance dots for Squad Triage rows.
 */
export const Adherence7dDots: React.FC<{
  completedCount?: number;
  hasPainFlag?: boolean;
}> = ({ completedCount = 5, hasPainFlag = false }) => {
  const count = Math.max(0, Math.min(7, completedCount));
  return (
    <svg viewBox="0 0 64 10" className="w-16 h-2.5 shrink-0" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => {
        const isLastFlag = hasPainFlag && i === 6;
        const fill = isLastFlag
          ? '#DC2626'
          : i < count
            ? '#059669'
            : '#C8D8CE';
        return <circle key={i} cx={5 + i * 9} cy="5" r="3" fill={fill} />;
      })}
    </svg>
  );
};

/**
 * 8B. Mini split-trend SVG sparkline rendered on TracksideStopwatch runner cards (>= 2 splits).
 */
export const SplitTrendSparkline: React.FC<{ splitsSecs: number[] }> = ({ splitsSecs }) => {
  if (splitsSecs.length < 2) return null;
  const recent = splitsSecs.slice(-6);
  const minVal = Math.min(...recent);
  const maxVal = Math.max(...recent);
  const span = Math.max(0.4, maxVal - minVal);
  const pts = recent
    .map((s, idx) => {
      const x = Number((2 + (idx / Math.max(1, recent.length - 1)) * 44).toFixed(1));
      const y = Number((13 - ((maxVal - s) / span) * 10).toFixed(1));
      return `${x},${y}`;
    })
    .join(' ');
  const delta = recent[recent.length - 1] - recent[0];
  const stroke = delta < -0.4 ? '#0284C7' : delta > 1.0 ? '#D97706' : '#059669';
  return (
    <svg viewBox="0 0 48 16" className="w-12 h-4 shrink-0" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
