import { getOrgTypeSafeguardingDefaults } from '../physiology/teamOnboardingEngine';
import { formatTrackMark } from '../physiology/scholasticEngine';
import {
  buildBreakLaneMSymbolInnerSvg,
  buildMeetReadyWordmarkInnerSvg,
} from './brandVectors';
import { generateQrCodeSvgMarkup, generateQrMatrix } from './qrCodeSvg';
import { computeAccessibleTeamPalette, escapeTextForSafeAttr } from './teamPalette';
import type { TeamBrandConfig, VdotTrainingPod } from '../types';

export {
  computeAccessibleTeamPalette,
  escapeTextForSafeAttr,
  generateQrCodeSvgMarkup,
  generateQrMatrix,
};

function triggerHtmlBlobDownload(html: string, filename: string): boolean {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore revoke failures
      }
    }, 1000);
    return true;
  } catch {
    return false;
  }
}

export function openPrintableTeamPosterWindow(
  brand: TeamBrandConfig,
  joinUrl: string
): boolean {
  if (typeof window === 'undefined') return false;
  const palette = computeAccessibleTeamPalette(brand.primaryHex, brand.secondaryHex);
  const defaults = getOrgTypeSafeguardingDefaults(brand.orgType);
  // Force high-contrast pure black ink (#080A09) on white with EC-M error correction for reliable locker-room/copier scanning
  const qrSvg = generateQrCodeSvgMarkup(joinUrl, '#080A09', 260);
  const initials = (brand.shortName || brand.name || 'TM')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const crestMarkup = brand.logoDataUrl
    ? `<img src="${escapeTextForSafeAttr(brand.logoDataUrl)}" alt="Crest" style="width:72px;height:72px;border-radius:16px;object-fit:contain;background:#fff;padding:6px;border:2px solid rgba(255,255,255,0.35);" />`
    : `<div style="width:72px;height:72px;border-radius:16px;background:rgba(255,255,255,0.16);border:2px solid rgba(255,255,255,0.4);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:28px;color:#fff;letter-spacing:-0.03em;">${escapeTextForSafeAttr(initials)}</div>`;

  const safeSportNote = brand.defaultSafeSportShield
    ? `<div style="margin-top:20px;padding:12px 16px;border-radius:12px;background:#E7F3EC;border:1px solid #B6D9C4;color:#1E4D36;font-size:13px;font-weight:600;">
         SafeSport Youth Privacy Active: Body weight &amp; BMI are hidden by default. Optional Strava imports remain strictly private.
       </div>`
    : '';

  const meetReadyPosterLogoSvg = `<svg style="height:34px;width:auto;display:inline-block;vertical-align:middle;" viewBox="0 0 472 124" fill="none" xmlns="http://www.w3.org/2000/svg">${buildBreakLaneMSymbolInnerSvg('#121413', palette.primaryOnLight)}${buildMeetReadyWordmarkInnerSvg('#121413')}</svg>`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeTextForSafeAttr(brand.name)} — MeetReady Join Poster</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=JetBrains+Mono:wght@600;800&display=swap" rel="stylesheet" />
  <style>
    body { font-family: 'Archivo', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; background: #F6F3EC; color: #121413; margin: 0; padding: 32px; }
    .sheet { max-width: 720px; margin: 0 auto; background: #FFFFFF; border-radius: 24px; overflow: hidden; border: 2px solid rgba(18, 20, 19, 0.22); box-shadow: 0 12px 32px rgba(18, 20, 19, 0.08); }
    .banner { background: linear-gradient(135deg, ${palette.primaryOnLight} 0%, ${palette.secondaryOnLight} 100%); color: #FFFFFF; padding: 32px 36px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .banner-left { display: flex; align-items: center; gap: 20px; }
    .meetready-pill { background: #FFFFFF; padding: 8px 14px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); flex-shrink: 0; }
    .content { padding: 36px; text-align: center; }
    .qr-box { display: inline-block; padding: 16px; border-radius: 20px; border: 2px solid rgba(18, 20, 19, 0.18); background: #FFFFFF; margin: 16px 0; }
    .code-pill { display: inline-block; font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace; font-size: 36px; font-weight: 800; letter-spacing: 0.08em; padding: 12px 28px; border-radius: 16px; background: #EDE9DF; border: 2px dashed ${palette.primaryOnLight}; color: #121413; margin: 10px 0; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: left; margin-top: 28px; }
    .step { padding: 14px; border-radius: 14px; background: #EDE9DF; border: 1px solid rgba(18, 20, 19, 0.16); font-size: 13px; line-height: 1.45; }
    .step strong { display: block; color: ${palette.primaryOnLight}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .viral-foot { margin-top: 18px; padding-top: 12px; border-top: 1px solid rgba(18, 20, 19, 0.16); font-size: 12px; color: #57544D; font-weight: 600; }
    @media print { body { background: #FFFFFF; padding: 0; } .sheet { box-shadow: none; border: 1px solid rgba(18, 20, 19, 0.22); } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="max-width:720px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:13px;color:#57544D;">Locker-Room / Team Tent Join Sheet · Ready for 8.5×11&quot; Print</span>
    <button onclick="window.print()" style="padding:10px 18px;border-radius:10px;border:none;background:${palette.primaryOnLight};color:#fff;font-weight:700;cursor:pointer;">Print / Save PDF</button>
  </div>
  <div class="sheet">
    <div class="banner">
      <div class="banner-left">
        ${crestMarkup}
        <div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;opacity:0.9;font-weight:700;">${escapeTextForSafeAttr(defaults.orgBadgeLabel)} · MeetReady TEAM HUB</div>
          <h1 style="margin:4px 0 4px;font-size:28px;font-weight:800;letter-spacing:-0.02em;">${escapeTextForSafeAttr(brand.name)}</h1>
          <div style="font-size:14px;opacity:0.92;">Coach ${escapeTextForSafeAttr(brand.coachDisplayName)}${brand.mascotOrMotto ? ` · "${escapeTextForSafeAttr(brand.mascotOrMotto)}"` : ''}</div>
        </div>
      </div>
      <div class="meetready-pill">${meetReadyPosterLogoSvg}</div>
    </div>
    <div class="content">
      <div style="font-size:15px;color:#121413;font-weight:600;">Scan with your phone camera to join the team roster in 45 seconds:</div>
      <div class="qr-box">${qrSvg}</div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#57544D;font-weight:700;margin-top:4px;">Or visit meetready.app → tap &ldquo;Team Code&rdquo;</div>
      <div><span class="code-pill">${escapeTextForSafeAttr(brand.joinCode)}</span></div>
      <div class="steps">
        <div class="step"><strong>1. Scan QR or Open Link</strong>Your school/club profile &amp; squad settings load automatically.</div>
        <div class="step"><strong>2. Sign In With Google or Email</strong>Use your school Google account or email (no GPS watch or Strava required) and add a recent PR or mark.</div>
        <div class="step"><strong>3. Check Daily Practice</strong>See your workout pace group, track splits, field marks, and readiness check-in.</div>
      </div>
      ${safeSportNote}
      <div class="viral-foot">Coaching another Track, Field or XC program? Free Founding Season Pilot at <strong>meetready.app</strong></div>
    </div>
  </div>
</body>
</html>`;

  const popup = window.open('', '_blank', 'width=840,height=920');
  if (!popup) {
    const safeSlug = (brand.slug || brand.shortName || 'team')
      .replace(/[^A-Za-z0-9_-]/g, '-')
      .toLowerCase();
    triggerHtmlBlobDownload(html, `meetready-${safeSlug}-join-poster.html`);
    return false;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  try {
    popup.opener = null;
  } catch {
    // ignore read-only opener implementations
  }
  try {
    popup.focus?.();
  } catch {
    // ignore focus errors
  }
  return true;
}

export interface PrintablePodClipboardParams {
  workoutTitle: string;
  dateStr: string;
  repDistanceMeters: number;
  repCount: number;
  recoveryLabel: string;
  pods: VdotTrainingPod[];
  teamName?: string;
}

/**
 * Generates self-contained 4-up landscape clipboard HTML (`@page { size: landscape }`)
 * for trackside coaches: Pod A–D split tables (`200m–1600m`), Pursuit offsets, and Rep 1..N blank boxes.
 */
export function buildPrintablePodClipboardHtml(params: PrintablePodClipboardParams): string {
  const {
    workoutTitle,
    dateStr,
    repDistanceMeters,
    repCount,
    recoveryLabel,
    pods,
    teamName = 'MeetReady Squad',
  } = params;

  const clipboardViralQrSvg = generateQrCodeSvgMarkup(
    'https://meetready.app/go/clipboard',
    '#080A09',
    62
  );
  const repCols = Math.max(1, Math.min(8, Math.round(repCount || 4)));
  const repHeaders = Array.from({ length: repCols }, (_, i) => `<th>R${i + 1}</th>`).join('');
  const emptyBoxes = Array.from({ length: repCols }, () => '<td class="rep-box"></td>').join('');

  const podCards = (pods || []).map((pod) => {
    const targetSplit =
      pod.targetRepSplitSecs ??
      Number(((pod.targetPaceSecsPerKm / 1000) * Math.max(150, repDistanceMeters)).toFixed(1));
    const vdotSpan =
      pod.minVdot === pod.maxVdot ? `${pod.centerVdot}` : `${pod.minVdot}–${pod.maxVdot}`;
    const pursuitOffset =
      typeof pod.pursuitStaggerOffsetSecs === 'number'
        ? `+${pod.pursuitStaggerOffsetSecs.toFixed(1)}s Pursuit`
        : 'Mass Start';

    const splitCells = [
      { lbl: '200m', val: pod.splitsSecs.split200m },
      { lbl: '300m', val: pod.splitsSecs.split300m ?? Number((pod.splitsSecs.split200m * 1.5).toFixed(1)) },
      { lbl: '400m', val: pod.splitsSecs.split400m },
      { lbl: '600m', val: pod.splitsSecs.split600m ?? Number((pod.splitsSecs.split400m * 1.5).toFixed(1)) },
      { lbl: '800m', val: pod.splitsSecs.split800m },
      { lbl: '1000m', val: pod.splitsSecs.split1000m },
      { lbl: '1600m', val: pod.splitsSecs.split1600m },
    ]
      .map(
        (c) =>
          `<div class="split-cell"><span class="split-lbl">${c.lbl}</span><span class="split-val">${escapeTextForSafeAttr(
            formatTrackMark(c.val, 1)
          )}</span></div>`
      )
      .join('');

    const athleteRows = pod.athletes
      .map(
        (ath) =>
          `<tr><td class="ath-name">${escapeTextForSafeAttr(ath.name)} <span class="ath-vdot">(${ath.vdot})</span></td>${emptyBoxes}</tr>`
      )
      .join('');

    return `<section class="pod-card">
      <header class="pod-head">
        <div>
          <div class="pod-title">${escapeTextForSafeAttr(pod.podName)}</div>
          <div class="pod-meta">VDOT ${escapeTextForSafeAttr(vdotSpan)} · ${escapeTextForSafeAttr(pursuitOffset)}</div>
        </div>
        <div class="target-pill">
          <span class="target-lbl">${repDistanceMeters}m TARGET</span>
          <span class="target-val">${escapeTextForSafeAttr(formatTrackMark(targetSplit, 1))}</span>
        </div>
      </header>
      <div class="split-grid">${splitCells}</div>
      <table class="rep-table">
        <thead><tr><th>Athlete</th>${repHeaders}</tr></thead>
        <tbody>${athleteRows}</tbody>
      </table>
    </section>`;
  });

  const podPages: string[] = [];
  for (let i = 0; i < podCards.length; i += 4) {
    const chunk = podCards.slice(i, i + 4).join('');
    const breakStyle = i > 0 ? ' style="page-break-before: always;"' : '';
    podPages.push(`<main class="pod-grid"${breakStyle}>${chunk}</main>`);
  }
  if (podPages.length === 0) {
    podPages.push('<main class="pod-grid"></main>');
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeTextForSafeAttr(teamName)} — Trackside Pod Clipboard (${escapeTextForSafeAttr(dateStr)})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=JetBrains+Mono:wght@600;800&display=swap" rel="stylesheet" />
  <style>
    @page { size: landscape; margin: 0.35in; }
    * { box-sizing: border-box; }
    body { font-family: 'Archivo', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; margin: 0; padding: 14px; background: #F6F3EC; color: #121413; }
    .banner { background: #121413; color: #F6F3EC; border-bottom: 3px solid #B83A24; border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .banner h1 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
    .banner-meta { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; font-size: 11px; font-weight: 700; opacity: 0.95; }
    .pod-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .pod-card { background: #FFFFFF; border: 1.5px solid rgba(18, 20, 19, 0.22); border-radius: 10px; padding: 10px; break-inside: avoid; }
    .pod-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-bottom: 1px solid #EDE9DF; padding-bottom: 6px; margin-bottom: 6px; }
    .pod-title { font-size: 13px; font-weight: 800; color: #B83A24; }
    .pod-meta { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: #57544D; font-weight: 600; }
    .target-pill { background: #B83A24; color: #F6F3EC; border-radius: 8px; padding: 4px 8px; text-align: right; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; }
    .target-lbl { display: block; font-size: 11px; letter-spacing: 0.04em; opacity: 0.92; }
    .target-val { display: block; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .split-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 7px; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; font-variant-numeric: tabular-nums; }
    .split-cell { background: #EDE9DF; border: 1px solid rgba(18, 20, 19, 0.14); border-radius: 6px; padding: 3px 4px; text-align: center; }
    .split-lbl { display: block; font-size: 11px; color: #57544D; font-weight: 600; }
    .split-val { display: block; font-size: 11px; color: #121413; font-weight: 800; }
    .rep-table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; font-variant-numeric: tabular-nums; }
    .rep-table th { text-align: center; font-size: 11px; color: #57544D; border-bottom: 1px solid rgba(18, 20, 19, 0.22); padding: 2px 3px; }
    .rep-table th:first-child { text-align: left; }
    .rep-table td { border-bottom: 1px solid #EDE9DF; padding: 3px; }
    .ath-name { font-family: 'Archivo', sans-serif; font-weight: 700; color: #121413; white-space: nowrap; }
    .ath-vdot { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; font-weight: 600; color: #57544D; font-size: 11px; }
    .rep-box { border-left: 1px solid rgba(18, 20, 19, 0.22); min-width: 28px; height: 20px; }
    .sheet-footer { margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(18, 20, 19, 0.22); display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: #57544D; font-weight: 600; }
    .no-print { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    @media print { body { background: #FFFFFF; padding: 0; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    <span style="font-size:12px;color:#57544D;font-weight:600;">4-Up Landscape Trackside Clipboard · Ready to Print</span>
    <button onclick="window.print()" style="padding:8px 14px;border-radius:8px;border:none;background:#B83A24;color:#F6F3EC;font-weight:700;cursor:pointer;">Print Clipboard Sheet</button>
  </div>
  <div class="banner">
    <div>
      <h1>${escapeTextForSafeAttr(teamName)} — ${escapeTextForSafeAttr(workoutTitle)}</h1>
    </div>
    <div class="banner-meta">${escapeTextForSafeAttr(dateStr)} · ${repCount} × ${repDistanceMeters}m · Rest: ${escapeTextForSafeAttr(recoveryLabel)}</div>
  </div>
  ${podPages.join('')}
  <footer class="sheet-footer">
    <div>
      <div>Auto-scaled Pace Pods, Field Marks &amp; Offline Splits · MeetReady</div>
      <div style="font-size:11px;opacity:0.88;margin-top:2px;">Every mark. Every mile. Meet ready. · meetready.app</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;text-align:right;">
      <div style="font-size:11px;line-height:1.25;">Scan for Free<br/>Coach Demo</div>
      <div style="border:1px solid rgba(18, 20, 19, 0.22);border-radius:6px;padding:2px;background:#FFFFFF;line-height:0;">${clipboardViralQrSvg}</div>
    </div>
  </footer>
</body>
</html>`;
}

export function openPrintablePodClipboardWindow(params: PrintablePodClipboardParams): boolean {
  if (typeof window === 'undefined') return false;
  const html = buildPrintablePodClipboardHtml(params);
  const popup = window.open('', '_blank', 'width=1060,height=780');
  if (!popup) {
    const safeDate = (params.dateStr || 'workout').replace(/[^A-Za-z0-9_-]/g, '-');
    return triggerHtmlBlobDownload(html, `meetready-pod-clipboard-${safeDate}.html`);
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  try {
    popup.opener = null;
  } catch {
    // ignore read-only opener implementations
  }
  try {
    popup.focus?.();
  } catch {
    // ignore focus errors
  }
  return true;
}
