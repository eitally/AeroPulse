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

  const threshPosterLogoSvg = `<svg style="height:34px;width:auto;display:inline-block;vertical-align:middle;" viewBox="0 0 472 124" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="threshPosterG1" gradientUnits="userSpaceOnUse" x1="-6" y1="0" x2="268" y2="0"><stop offset="0%" stop-color="#0E2619"/><stop offset="38%" stop-color="#185230"/><stop offset="72%" stop-color="#2E801E"/><stop offset="100%" stop-color="${palette.primaryOnLight}"/></linearGradient></defs><g fill="#1C5436"><path d="M 132.6 80.6 L 64 80.6 A 22.6 22.6 0 0 1 53.04 38.23 L 56.53 44.53 A 15.4 15.4 0 0 0 64 73.4 L 134.4 73.4 Z"/><path d="M 129.9 91.6 L 64 91.6 A 33.6 33.6 0 0 1 57.59 25.02 L 58.96 32.09 A 26.4 26.4 0 0 0 64 84.4 L 131.7 84.4 Z"/><path d="M 420.1 102.6 L 64 102.6 A 44.6 44.6 0 1 1 69.44 13.73 L 68.56 20.88 A 37.4 37.4 0 1 0 64 95.4 L 421.9 95.4 Z"/></g><g fill="${palette.primaryOnLight}"><path d="M 55.48 36.91 A 22.75 22.75 0 0 1 86.25 53.27 L 78.92 54.83 A 15.25 15.25 0 0 0 58.29 43.86 Z"/><path d="M 61.65 24.33 A 33.75 33.75 0 0 1 97.01 50.98 L 89.68 52.54 A 26.25 26.25 0 0 0 62.17 31.81 Z"/><path d="M 74.83 14.58 A 44.75 44.75 0 0 1 107.77 48.7 L 100.44 50.26 A 37.25 37.25 0 0 0 73.01 21.86 Z"/><path d="M 118.53 46.41 A 55.75 55.75 0 1 0 64 113.75 H 444 L 438.5 121.8 L 465 110 L 438.5 98.2 L 444 106.25 H 64 A 48.25 48.25 0 1 1 111.2 47.97 Z"/></g><line x1="77.95" y1="56.78" x2="119.79" y2="53.12" stroke="${palette.primaryOnLight}" stroke-width="3.2" stroke-linecap="round"/><path d="M 59.76 54.04 L 99.33 20.12 L 68.24 61.96 Z" fill="${palette.primaryOnLight}" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round" style="paint-order:stroke fill"/><circle cx="64" cy="58" r="9.8" fill="${palette.primaryOnLight}" stroke="#FFFFFF" stroke-width="3.8" style="paint-order:stroke fill"/><circle cx="64" cy="58" r="3.6" fill="#FFFFFF"/><g transform="translate(144, 8) skewX(-14) scale(1.10, 1.29)" fill="url(#threshPosterG1)"><path d="M -6 0 H 39 L 36.2 13.8 H 26 V 64 H 12 V 13.8 H -8.8 Z"/><path d="M 43 0 H 57 V 25.2 H 69 V 0 H 83 V 64 H 69 V 38.4 H 57 V 64 H 43 Z"/><path d="M 90 0 H 118.5 C 128.4 0 133.5 5.8 133.5 16.8 C 133.5 25.4 129.2 31.2 121.6 33.6 L 134.2 64 H 118.8 L 107.6 35.6 H 104 V 64 H 90 Z M 104 11.2 V 24.2 H 115.2 C 118.2 24.2 119.6 22.0 119.6 17.7 C 119.6 13.4 118.2 11.2 115.2 11.2 Z" fill-rule="evenodd" clip-rule="evenodd"/><path d="M 139 0 H 177 L 174.4 13.0 H 153 V 25.4 H 173 L 170.6 37.8 H 153 V 51.0 H 176.5 L 174.0 64 H 139 Z"/><path d="M 181 17.2 C 181 6.4 188.0 0 200.6 0 H 208.6 C 217.8 0 222.5 5.2 222.5 14.2 V 17.5 H 208.6 V 14.4 C 208.6 11.8 206.8 10.6 203.4 10.6 H 199.4 C 196.2 10.6 194.6 12.2 194.6 15.6 C 194.6 19.6 197.4 21.8 209.6 26.2 C 218.8 29.5 222.8 34.8 222.8 45.8 C 222.8 57.6 215.8 64 203.2 64 H 195.2 C 185.8 64 181 58.6 181 49.2 V 45.8 H 194.8 V 49.2 C 194.8 52.0 196.6 53.4 200.0 53.4 H 204.2 C 207.4 53.4 209.0 51.6 209.0 47.6 C 209.0 43.2 206.2 40.8 194.0 36.4 C 184.8 33.0 181 27.6 181 17.2 Z"/><path d="M 228 0 H 242 V 25.2 H 254 V 0 H 268 V 64 H 254 V 38.4 H 242 V 64 H 228 Z"/></g></svg>`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeTextForSafeAttr(brand.name)} — THRESH Join Poster</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F4F7F2; color: #101411; margin: 0; padding: 32px; }
    .sheet { max-width: 720px; margin: 0 auto; background: #FFFFFF; border-radius: 24px; overflow: hidden; border: 2px solid #B8CBBF; box-shadow: 0 12px 32px rgba(16,20,17,0.08); }
    .banner { background: linear-gradient(135deg, ${palette.primaryOnLight} 0%, ${palette.secondaryOnLight} 100%); color: #FFFFFF; padding: 32px 36px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .banner-left { display: flex; align-items: center; gap: 20px; }
    .thresh-pill { background: #FFFFFF; padding: 8px 14px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); flex-shrink: 0; }
    .content { padding: 36px; text-align: center; }
    .qr-box { display: inline-block; padding: 16px; border-radius: 20px; border: 2px solid #C2D5C9; background: #FFFFFF; margin: 16px 0; }
    .code-pill { display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 36px; font-weight: 800; letter-spacing: 0.08em; padding: 12px 28px; border-radius: 16px; background: #ECFDF3; border: 2px dashed ${palette.primaryOnLight}; color: #101411; margin: 10px 0; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; text-align: left; margin-top: 28px; }
    .step { padding: 14px; border-radius: 14px; background: #F4F7F4; border: 1px solid #C2D5C9; font-size: 13px; line-height: 1.45; }
    .step strong { display: block; color: ${palette.primaryOnLight}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    @media print { body { background: #FFFFFF; padding: 0; } .sheet { box-shadow: none; border: 1px solid #C2D5C9; } .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="max-width:720px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:13px;color:#3F4742;">Locker-Room / Team Tent Join Sheet · Ready for 8.5×11&quot; Print</span>
    <button onclick="window.print()" style="padding:10px 18px;border-radius:10px;border:none;background:${palette.primaryOnLight};color:#fff;font-weight:700;cursor:pointer;">Print / Save PDF</button>
  </div>
  <div class="sheet">
    <div class="banner">
      <div class="banner-left">
        ${crestMarkup}
        <div>
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;opacity:0.9;font-weight:700;">${escapeTextForSafeAttr(defaults.orgBadgeLabel)} · THRESH TEAM HUB</div>
          <h1 style="margin:4px 0 4px;font-size:28px;font-weight:800;letter-spacing:-0.02em;">${escapeTextForSafeAttr(brand.name)}</h1>
          <div style="font-size:14px;opacity:0.92;">Coach ${escapeTextForSafeAttr(brand.coachDisplayName)}${brand.mascotOrMotto ? ` · "${escapeTextForSafeAttr(brand.mascotOrMotto)}"` : ''}</div>
        </div>
      </div>
      <div class="thresh-pill">${threshPosterLogoSvg}</div>
    </div>
    <div class="content">
      <div style="font-size:15px;color:#1F3528;font-weight:600;">Scan with your phone camera to join the team roster in 45 seconds:</div>
      <div class="qr-box">${qrSvg}</div>
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#5F6862;font-weight:700;margin-top:4px;">Or enter Team Join Code at ${escapeTextForSafeAttr(joinUrl)}</div>
      <div><span class="code-pill">${escapeTextForSafeAttr(brand.joinCode)}</span></div>
      <div class="steps">
        <div class="step"><strong>1. Scan QR or Open Link</strong>Your school/club profile &amp; squad settings load automatically.</div>
        <div class="step"><strong>2. Sign In With Strava</strong>Authenticate via Strava, choose your workout sync preference, and optionally enter a recent race time.</div>
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
