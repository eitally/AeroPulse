import { parseWorkoutSteps } from './workoutParser.ts';
import { getLocalDateIso } from '../physiology/stravaLoadCalibration.ts';
import {
  formatMmSs,
  type ComputedSharedStepPreview,
  type ComputedSharedWorkoutPreview,
  type SharedWorkoutPayload,
} from './shareWorkoutRoute.ts';

export * from './shareWorkoutRoute.ts';

export function computeSharedWorkoutPreview(opts: {
  payload: SharedWorkoutPayload;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  unit: 'mi' | 'km';
}): ComputedSharedWorkoutPreview {
  const safeFtp = Math.max(80, Math.min(600, Math.round(opts.ftpWatts || 260)));
  const safeThresholdPaceKm = Math.max(
    130,
    Math.min(540, Math.round(opts.thresholdPaceSecsPerKm || 245))
  );
  const parsed = opts.payload.workoutSyntax
    ? parseWorkoutSteps(opts.payload.workoutSyntax, safeThresholdPaceKm)
    : [];

  const stepsRaw =
    parsed.length > 0
      ? parsed
      : [
          {
            label: opts.payload.title || 'Main Session',
            durationMins: Math.round((opts.payload.plannedDurationSecs || 2700) / 60),
            durationSecs: opts.payload.plannedDurationSecs || 2700,
            intensityPct: 80,
            zone: 3 as const,
            zoneCode: 'Z3' as const,
            zoneColor: '#D97706',
            stepKind: 'work' as const,
          },
        ];

  let totalDurationSecs = 0;
  let weightedLoadSum = 0;

  const steps: ComputedSharedStepPreview[] = stepsRaw.map((st, idx) => {
    const durSecs = Math.max(15, Math.round(st.durationSecs || st.durationMins * 60 || 300));
    totalDurationSecs += durSecs;
    const pct = Math.max(40, Math.min(200, Math.round(st.intensityPct || 75)));
    weightedLoadSum += (durSecs / 3600) * Math.pow(pct / 100, 2) * 100;

    const durationLabel =
      'distanceMeters' in st && typeof st.distanceMeters === 'number' && st.distanceMeters >= 100
        ? `${Math.round(st.distanceMeters)}m`
        : durSecs >= 60
          ? `${Math.round(durSecs / 60)}m`
          : `${durSecs}s`;

    let prescribedTargetLabel = `${pct}% Effort`;
    let repSplitLabel: string | undefined;

    if (opts.payload.sport === 'Cycling') {
      const watts = Math.round((safeFtp * pct) / 100);
      prescribedTargetLabel = `${watts} W (${pct}% FTP)`;
    } else if (opts.payload.sport === 'Running') {
      const pacePerKm =
        'targetPaceSecsPerKm' in st && typeof st.targetPaceSecsPerKm === 'number'
          ? st.targetPaceSecsPerKm
          : Math.round(safeThresholdPaceKm * (100 / Math.max(45, pct)));
      const unitPace = opts.unit === 'mi' ? pacePerKm * 1.609344 : pacePerKm;
      prescribedTargetLabel = `${formatMmSs(unitPace)}/${opts.unit}`;
      if ('distanceMeters' in st && typeof st.distanceMeters === 'number' && st.distanceMeters >= 100) {
        const repSecs = (pacePerKm / 1000) * st.distanceMeters;
        repSplitLabel = `${formatMmSs(repSecs)} / ${Math.round(st.distanceMeters)}m`;
      }
    }

    return {
      index: idx + 1,
      label: st.label || `Step ${idx + 1}`,
      stepKind: st.stepKind || 'work',
      durationSecs: durSecs,
      durationLabel,
      intensityPct: pct,
      prescribedTargetLabel,
      ...(repSplitLabel ? { repSplitLabel } : {}),
      colorHex: st.zoneColor || '#1C5436',
    };
  });

  return {
    totalDurationSecs,
    estimatedLoad: opts.payload.plannedLoad ?? Math.max(12, Math.round(weightedLoadSum)),
    steps,
  };
}

export function sharedWorkoutToPlannedEventInput(
  payload: SharedWorkoutPayload,
  opts: {
    ftpWatts: number;
    thresholdPaceSecsPerKm: number;
    unit?: 'mi' | 'km';
    dateIso?: string;
  }
) {
  const preview = computeSharedWorkoutPreview({
    payload,
    ftpWatts: opts.ftpWatts,
    thresholdPaceSecsPerKm: opts.thresholdPaceSecsPerKm,
    unit: opts.unit || payload.defaultUnit || 'mi',
  });
  const date =
    opts.dateIso ||
    payload.date ||
    getLocalDateIso();

  return {
    date,
    name: payload.title,
    sportCategory: payload.sport,
    environmentPreference: 'FLEXIBLE' as const,
    plannedDurationSecs: payload.plannedDurationSecs || preview.totalDurationSecs || 3600,
    plannedLoad: payload.plannedLoad ?? preview.estimatedLoad,
    workoutSyntax:
      payload.workoutSyntax ||
      `- 10m 62% Effort Warmup\n- ${Math.max(15, Math.round((payload.plannedDurationSecs || 2700) / 60) - 20)}m 85% Effort Main Set\n- 10m 55% Effort Cooldown`,
    description:
      payload.description ||
      (payload.teamName ? `Shared from ${payload.teamName} on MeetReady` : 'Imported from MeetReady Share Link'),
    replaceExistingDate: false,
  };
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/**
 * Generates a 1080x1350 Clean-Room portrait PNG workout or #stopwatch split card
 * containing exclusively first-party prescription/stopwatch data (CMP-01 safe).
 */
export async function renderShareCardPngBlob(opts: {
  payload: SharedWorkoutPayload;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  unit: 'mi' | 'km';
}): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const { payload, ftpWatts, thresholdPaceSecsPerKm, unit } = opts;
  const preview = computeSharedWorkoutPreview({
    payload,
    ftpWatts,
    thresholdPaceSecsPerKm,
    unit,
  });

  // 1. Track Asphalt Architectural Canvas + Subtle Mondo Clay Glow
  ctx.fillStyle = '#121413';
  ctx.fillRect(0, 0, 1080, 1350);

  const grad = ctx.createRadialGradient(880, 160, 40, 880, 160, 620);
  grad.addColorStop(0, 'rgba(184, 58, 36, 0.28)');
  grad.addColorStop(1, 'rgba(18, 20, 19, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1080, 1350);

  // Subtle 1px inner border
  ctx.strokeStyle = 'rgba(246, 243, 236, 0.16)';
  ctx.lineWidth = 2;
  drawRoundedRectPath(ctx, 44, 44, 992, 1262, 24);
  ctx.stroke();

  // 2. Top Header: Velocity Chevron M Emblem + MeetReady Wordmark + Category Pill
  ctx.fillStyle = '#1A1D1B';
  drawRoundedRectPath(ctx, 84, 88, 224, 48, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(246, 243, 236, 0.28)';
  ctx.lineWidth = 1.5;
  drawRoundedRectPath(ctx, 84, 88, 224, 48, 24);
  ctx.stroke();

  // Draw crisp flat 2-ink Velocity Chevron M at (103, 98), scale 0.24
  ctx.save();
  ctx.translate(103, 98);
  ctx.scale(0.24, 0.24);
  ctx.fillStyle = '#F6F3EC';
  ctx.beginPath();
  ctx.moveTo(6, 106); ctx.lineTo(34, 22); ctx.lineTo(52, 22); ctx.lineTo(60.5, 47.5); ctx.lineTo(51, 76); ctx.lineTo(43, 52); ctx.lineTo(25, 106); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#D8FF2A';
  ctx.beginPath();
  ctx.moveTo(48, 106); ctx.lineTo(76, 22); ctx.lineTo(94, 22); ctx.lineTo(122, 106); ctx.lineTo(103, 106); ctx.lineTo(85, 52); ctx.lineTo(67, 106); ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#F6F3EC';
  ctx.font = '800 22px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('MeetReady', 142, 113);

  const badgeText =
    payload.kind === 'STOPWATCH'
      ? '#STOPWATCH SPLITS'
      : `${payload.sport.toUpperCase()} PRESCRIPTION`;
  ctx.fillStyle = 'rgba(216, 255, 42, 0.14)';
  drawRoundedRectPath(ctx, 730, 88, 266, 48, 24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(216, 255, 42, 0.45)';
  ctx.lineWidth = 1.5;
  drawRoundedRectPath(ctx, 730, 88, 266, 48, 24);
  ctx.stroke();
  ctx.fillStyle = '#D8FF2A';
  ctx.font = '700 18px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText(badgeText, 756, 112);

  // 3. Title + Subheader
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '800 54px system-ui, -apple-system, sans-serif';
  const titleLines = wrapLines(ctx, payload.title, 912);
  let y = 176;
  for (const line of titleLines) {
    ctx.fillText(line, 84, y);
    y += 64;
  }

  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 24px system-ui, -apple-system, sans-serif';
  const subParts = [
    payload.teamName || 'Track, Field & XC Session',
    payload.date || getLocalDateIso(),
    payload.authorLabel ? `By ${payload.authorLabel}` : null,
  ].filter(Boolean);
  ctx.fillText(subParts.join('  ·  '), 84, y + 10);
  y += 62;

  // 4. Three Summary Metric Boxes
  const boxW = 290;
  const gap = 21;
  const durationMins = Math.max(1, Math.round(preview.totalDurationSecs / 60));
  const summaryStats =
    payload.kind === 'STOPWATCH' && payload.splits
      ? [
          { label: 'REPS LOGGED', value: `${payload.splits.length}` },
          { label: 'FIRST MARK', value: payload.splits[0]?.lapTime || '--:--' },
          { label: 'ANCHOR PACE', value: payload.splits[0]?.paceOrPower || `-${unit}` },
        ]
      : [
          { label: 'DURATION', value: `${durationMins} min` },
          { label: 'TARGET LOAD', value: `${preview.estimatedLoad} LOAD` },
          {
            label: payload.sport === 'Cycling' ? 'ANCHOR FTP' : 'THRESHOLD',
            value:
              payload.sport === 'Cycling'
                ? `${Math.round(ftpWatts)} W`
                : `${formatMmSs(
                    unit === 'mi' ? thresholdPaceSecsPerKm * 1.609344 : thresholdPaceSecsPerKm
                  )}/${unit}`,
          },
        ];

  summaryStats.forEach((stat, idx) => {
    const bx = 84 + idx * (boxW + gap);
    ctx.fillStyle = '#111A15';
    drawRoundedRectPath(ctx, bx, y, boxW, 128, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = '700 17px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(stat.label, bx + 24, y + 24);

    ctx.fillStyle = idx === 2 ? '#D8FF2A' : '#FFFFFF';
    ctx.font = '800 38px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText(stat.value, bx + 24, y + 60);
  });

  y += 164;

  // 5. Interval Visual Bars or Split Table
  if (payload.kind === 'STOPWATCH' && payload.splits && payload.splits.length > 0) {
    ctx.fillStyle = '#E2E8F0';
    ctx.font = '700 20px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText('TRACKSIDE STOPWATCH SPLITS', 84, y);
    y += 40;

    const visibleSplits = payload.splits.slice(0, 9);
    visibleSplits.forEach((row, idx) => {
      const ry = y + idx * 72;
      ctx.fillStyle = idx % 2 === 0 ? '#1A1D1B' : '#151816';
      drawRoundedRectPath(ctx, 84, ry, 912, 60, 14);
      ctx.fill();

      ctx.fillStyle = '#F6F3EC';
      ctx.font = '600 23px system-ui, -apple-system, sans-serif';
      ctx.fillText(row.label.slice(0, 32), 110, ry + 16);

      ctx.fillStyle = '#D8FF2A';
      ctx.font = '700 24px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(row.lapTime, 620, ry + 16);

      if (row.paceOrPower) {
        ctx.fillStyle = '#A39E93';
        ctx.font = '500 20px ui-monospace, SFMono-Regular, monospace';
        ctx.fillText(row.paceOrPower, 790, ry + 18);
      }
    });
  } else {
    // Visual zone bar chart
    ctx.fillStyle = '#1A1D1B';
    drawRoundedRectPath(ctx, 84, y, 912, 168, 22);
    ctx.fill();

    const totalSecs = Math.max(60, preview.totalDurationSecs);
    let barX = 112;
    const usableW = 856;
    const baseLineY = y + 142;

    for (const st of preview.steps) {
      const segW = Math.max(8, (st.durationSecs / totalSecs) * usableW - 3);
      const heightRatio = Math.max(0.24, Math.min(1, st.intensityPct / 135));
      const barH = Math.round(heightRatio * 108);
      ctx.fillStyle = st.colorHex || '#B83A24';
      drawRoundedRectPath(ctx, barX, baseLineY - barH, segW, barH, 6);
      ctx.fill();
      barX += segW + 3;
      if (barX > 965) break;
    }

    y += 200;
    ctx.fillStyle = '#F6F3EC';
    ctx.font = '700 19px ui-monospace, SFMono-Regular, monospace';
    ctx.fillText('STRUCTURED INTERVAL BREAKDOWN', 84, y);
    y += 38;

    const rows = preview.steps.slice(0, 7);
    rows.forEach((st, idx) => {
      const ry = y + idx * 68;
      ctx.fillStyle = idx % 2 === 0 ? '#1A1D1B' : '#151816';
      drawRoundedRectPath(ctx, 84, ry, 912, 56, 14);
      ctx.fill();

      ctx.fillStyle = st.colorHex || '#B83A24';
      drawRoundedRectPath(ctx, 102, ry + 14, 10, 28, 5);
      ctx.fill();

      ctx.fillStyle = '#F6F3EC';
      ctx.font = '600 22px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${st.durationLabel} · ${st.label}`.slice(0, 38), 130, ry + 14);

      ctx.fillStyle = '#D8FF2A';
      ctx.font = '700 22px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(st.prescribedTargetLabel, 690, ry + 15);
    });
  }

  // 6. Clean Footer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(84, 1218, 912, 2);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 20px ui-monospace, SFMono-Regular, monospace';
  ctx.fillText('Built for Meet Day  ·  meetready.app', 84, 1244);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function downloadShareCardPng(opts: {
  payload: SharedWorkoutPayload;
  ftpWatts: number;
  thresholdPaceSecsPerKm: number;
  unit: 'mi' | 'km';
}): Promise<boolean> {
  const blob = await renderShareCardPngBlob(opts);
  if (!blob || typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const slug =
    opts.payload.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'meetready-card';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meetready-${opts.payload.kind === 'STOPWATCH' ? 'stopwatch-' : ''}${slug}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
