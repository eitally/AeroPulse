import {
  computeAccessibleTeamPalette,
  getOrgTypeSafeguardingDefaults,
} from '../physiology/teamOnboardingEngine';
import type { TeamBrandConfig } from '../types';

export { computeAccessibleTeamPalette };

export function escapeTextForSafeAttr(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Pure-TypeScript ISO/IEC 18004 Scannable QR Code SVG Generator (Versions 1–6, EC-L)
// Zero external dependencies; works offline in locker-room print sheets & modals.
// ============================================================================

interface QrVersionSpec {
  version: number;
  dataCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocks: number;
  alignmentCoord?: number;
}

const QR_VERSION_L_SPECS: QrVersionSpec[] = [
  { version: 1, dataCodewords: 19, ecCodewordsPerBlock: 7, numBlocks: 1 },
  { version: 2, dataCodewords: 34, ecCodewordsPerBlock: 10, numBlocks: 1, alignmentCoord: 18 },
  { version: 3, dataCodewords: 55, ecCodewordsPerBlock: 15, numBlocks: 1, alignmentCoord: 22 },
  { version: 4, dataCodewords: 80, ecCodewordsPerBlock: 20, numBlocks: 1, alignmentCoord: 26 },
  { version: 5, dataCodewords: 108, ecCodewordsPerBlock: 26, numBlocks: 1, alignmentCoord: 30 },
  { version: 6, dataCodewords: 136, ecCodewordsPerBlock: 18, numBlocks: 2, alignmentCoord: 34 },
];

function gfMul(x: number, y: number): number {
  let r = 0;
  let a = x;
  let b = y;
  for (let i = 7; i >= 0; i--) {
    r = (r << 1) ^ ((r >>> 7) * 0x11d);
    r ^= ((b >>> i) & 1) * a;
  }
  return r;
}

function reedSolomonComputeRemainder(data: number[], degree: number): number[] {
  // Build generator polynomial (x - 2^0)(x - 2^1)...(x - 2^(degree-1))
  let gen = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], root);
    }
    gen = next;
    root = gfMul(root, 0x02);
  }

  const result = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < degree; i++) {
      result[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return result;
}

function computeFormatBitsEcLevelL(mask: number): number {
  // EC Level L = 0b01
  const data = (0b01 << 3) | (mask & 0b111);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

export function generateQrMatrix(text: string): boolean[][] {
  const utf8 = Array.from(new TextEncoder().encode(text));
  // Pick smallest QR version (1..6) whose byte capacity >= utf8.length
  const spec =
    QR_VERSION_L_SPECS.find((s) => s.dataCodewords - 2 >= utf8.length) ||
    QR_VERSION_L_SPECS[QR_VERSION_L_SPECS.length - 1];

  const maxPayload = spec.dataCodewords - 2;
  const payload = utf8.slice(0, maxPayload);

  // Bitstream: Mode 0100 (Byte), 8-bit length, payload bytes, terminator, pad 0xEC/0x11
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);

  const capacityBits = spec.dataCodewords * 8;
  const termLen = Math.min(4, capacityBits - bits.length);
  pushBits(0, termLen);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataWords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataWords.push(byte);
  }
  let padToggle = true;
  while (dataWords.length < spec.dataCodewords) {
    dataWords.push(padToggle ? 0xec : 0x11);
    padToggle = !padToggle;
  }

  // Interleave blocks + Reed-Solomon parity
  const blockLen = spec.dataCodewords / spec.numBlocks;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < spec.numBlocks; b++) {
    const slice = dataWords.slice(b * blockLen, (b + 1) * blockLen);
    dataBlocks.push(slice);
    ecBlocks.push(reedSolomonComputeRemainder(slice, spec.ecCodewordsPerBlock));
  }

  const finalCodewords: number[] = [];
  for (let i = 0; i < blockLen; i++) {
    for (let b = 0; b < spec.numBlocks; b++) finalCodewords.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) finalCodewords.push(ecBlocks[b][i]);
  }

  const size = 17 + 4 * spec.version;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  };

  // Finder patterns + separators
  const drawFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (onRing || inCenter));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment pattern (for versions 2..6 at bottom-right)
  if (spec.alignmentCoord) {
    const ac = spec.alignmentCoord;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        setFunctionModule(ac + dr, ac + dc, dist !== 1);
      }
    }
  }

  // Reserve format info modules & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFunction[8][i] = true;
      isFunction[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8][size - 1 - i] = true;
    isFunction[size - 1 - i][8] = true;
  }
  setFunctionModule(size - 8, 8, true); // Dark module

  // Zigzag upward/downward codeword placement
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunction[r][c] && bitIdx < totalBits) {
          const byte = finalCodewords[bitIdx >>> 3];
          const dark = ((byte >>> (7 - (bitIdx & 7))) & 1) !== 0;
          // Apply Mask 0: (r + c) % 2 === 0
          modules[r][c] = (r + c) % 2 === 0 ? !dark : dark;
          bitIdx++;
        } else if (!isFunction[r][c]) {
          modules[r][c] = (r + c) % 2 === 0;
        }
      }
    }
  }

  // Write format bits for EC-L + Mask 0
  const fmt = computeFormatBitsEcLevelL(0);
  const getFmtBit = (i: number) => ((fmt >>> i) & 1) !== 0;

  // Top-left format copy
  for (let i = 0; i <= 5; i++) modules[8][i] = getFmtBit(14 - i);
  modules[8][7] = getFmtBit(8);
  modules[8][8] = getFmtBit(7);
  modules[7][8] = getFmtBit(6);
  for (let i = 0; i <= 5; i++) modules[5 - i][8] = getFmtBit(5 - i);

  // Split bottom-left & top-right format copy
  for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = getFmtBit(14 - i);
  for (let i = 0; i < 8; i++) modules[8][size - 8 + i] = getFmtBit(7 - i);

  return modules;
}

export function generateQrCodeSvgMarkup(
  text: string,
  darkHex = '#111318',
  pixelSize = 180
): string {
  const matrix = generateQrMatrix(text);
  const quiet = 3;
  const total = matrix.length + quiet * 2;
  const paths: string[] = [];

  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) {
        paths.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
      }
    }
  }

  const safeColor = /^#[0-9a-fA-F]{3,6}$/.test(darkHex) ? darkHex : '#111318';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges" role="img" aria-label="Team Join QR Code"><rect width="${total}" height="${total}" fill="#FFFFFF"/><path d="${paths.join('')}" fill="${safeColor}"/></svg>`;
}

export function openPrintableTeamPosterWindow(
  brand: TeamBrandConfig,
  joinUrl: string
): void {
  if (typeof window === 'undefined') return;
  const palette = computeAccessibleTeamPalette(brand.primaryHex, brand.secondaryHex);
  const defaults = getOrgTypeSafeguardingDefaults(brand.orgType);
  const qrSvg = generateQrCodeSvgMarkup(joinUrl, palette.primaryOnLight, 260);
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
    ? `<div style="margin-top:20px;padding:12px 16px;border-radius:12px;background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;font-size:13px;font-weight:600;">
         Safe-Sport Youth Privacy Active: Body weight &amp; W/kg are hidden by default. Optional Strava imports remain strictly private.
       </div>`
    : '';

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeTextForSafeAttr(brand.name)} — THRESH Join Poster</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F7F6F2; color: #111318; margin: 0; padding: 32px; }
    .sheet { max-width: 720px; margin: 0 auto; background: #FFFFFF; border-radius: 24px; overflow: hidden; border: 2px solid #E5E7EB; box-shadow: 0 12px 32px rgba(0,0,0,0.06); }
    .banner { background: linear-gradient(135deg, ${palette.primaryOnLight} 0%, ${palette.secondaryOnLight} 100%); color: #FFFFFF; padding: 32px 36px; display: flex; align-items: center; gap: 20px; }
    .content { padding: 36px; text-align: center; }
    .qr-box { display: inline-block; padding: 16px; border-radius: 20px; border: 2px solid #E5E7EB; background: #FFFFFF; margin: 16px 0; }
    .code-pill { display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 36px; font-weight: 800; letter-spacing: 0.08em; padding: 12px 28px; border-radius: 16px; background: #F3F4F6; border: 2px dashed ${palette.primaryOnLight}; color: #111318; margin: 10px 0; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: left; margin-top: 28px; }
    .step { padding: 14px; border-radius: 14px; background: #F9FAFB; border: 1px solid #E5E7EB; font-size: 13px; line-height: 1.45; }
    .step strong { display: block; color: ${palette.primaryOnLight}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    @media print { body { background: #FFFFFF; padding: 0; } .sheet { box-shadow: none; border: 1px solid #D1D5DB; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="max-width:720px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:13px;color:#525866;">Locker-Room / Team Tent Join Sheet · Ready for 8.5×11&quot; Print</span>
    <button onclick="window.print()" style="padding:10px 18px;border-radius:10px;border:none;background:${palette.primaryOnLight};color:#fff;font-weight:700;cursor:pointer;">Print / Save PDF</button>
  </div>
  <div class="sheet">
    <div class="banner">
      ${crestMarkup}
      <div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;opacity:0.9;font-weight:700;">${escapeTextForSafeAttr(defaults.orgBadgeLabel)} · THRESH TEAM HUB</div>
        <h1 style="margin:4px 0 4px;font-size:28px;font-weight:800;letter-spacing:-0.02em;">${escapeTextForSafeAttr(brand.name)}</h1>
        <div style="font-size:14px;opacity:0.92;">Coach ${escapeTextForSafeAttr(brand.coachDisplayName)}${brand.mascotOrMotto ? ` · "${escapeTextForSafeAttr(brand.mascotOrMotto)}"` : ''}</div>
      </div>
    </div>
    <div class="content">
      <div style="font-size:15px;color:#374151;font-weight:600;">Scan with your phone camera to join the team roster in 45 seconds:</div>
      <div class="qr-box">${qrSvg}</div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;font-weight:700;margin-top:4px;">Or enter Team Join Code at ${escapeTextForSafeAttr(joinUrl)}</div>
      <div><span class="code-pill">${escapeTextForSafeAttr(brand.joinCode)}</span></div>
      <div class="steps">
        <div class="step"><strong>1. Scan QR or Open Link</strong>Your school/club profile &amp; squad settings load automatically.</div>
        <div class="step"><strong>2. Confirm Name &amp; PR</strong>Connect Garmin/Intervals or enter 1 recent race time (no GPS watch required).</div>
        <div class="step"><strong>3. Check Morning Brief</strong>Wake up to your 7-day Productive Training verdict &amp; coach workouts.</div>
      </div>
      ${safeSportNote}
    </div>
  </div>
</body>
</html>`;

  const popup = window.open('', '_blank', 'noopener,noreferrer,width=840,height=920');
  if (popup) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  }
}
