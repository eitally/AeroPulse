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

  const threshPosterLogoSvg = `<svg style="height:32px;width:auto;display:inline-block;vertical-align:middle;" viewBox="0 -2 458 196" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="#101411"><path d="M 438.4 143 L 98 143 A 47 47 0 0 1 91.46 49.46 L 92.99 60.35 A 36 36 0 0 0 98 132 L 441.65 132 Z"/><path d="M 433.6 159.2 L 98 159.2 A 63.2 63.2 0 1 1 108.97 33.76 L 107.06 44.59 A 52.2 52.2 0 1 0 98 148.2 L 436.86 148.2 Z"/><path d="M 428.8 175.4 L 98 175.4 A 79.4 79.4 0 1 1 135.28 25.89 L 130.11 35.61 A 68.4 68.4 0 1 0 98 164.4 L 432.06 164.4 Z"/><path d="M 424 191.6 L 98 191.6 A 95.6 95.6 0 1 1 166.77 29.59 L 158.86 37.23 A 84.6 84.6 0 1 0 98 180.6 L 427.26 180.6 Z"/></g><g fill="${palette.primaryOnLight}"><path d="M 99.64 49.03 A 47 47 0 0 1 145 96 L 134 96 A 36 36 0 0 0 99.26 60.02 Z"/><path d="M 119.62 36.61 A 63.2 63.2 0 0 1 161.2 96 L 150.2 96 A 52.2 52.2 0 0 0 115.85 46.95 Z"/><path d="M 146.88 33.43 A 79.4 79.4 0 0 1 177.4 96 L 166.4 96 A 68.4 68.4 0 0 0 140.11 42.1 Z"/><path d="M 177.26 42.54 A 95.6 95.6 0 0 1 193.6 96 L 182.6 96 A 84.6 84.6 0 0 0 168.14 48.69 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 112.3 91.47 A 15 15 0 1 1 101.01 81.3 L 118.28 69.59 L 122.15 73.07 Z M 103.2 96 A 5.2 5.2 0 1 0 92.8 96 A 5.2 5.2 0 1 0 103.2 96 Z"/></g><g transform="translate(208, 66) skewX(-16.5) scale(1.06)"><g transform="translate(3.8, 0)" fill="#101411"><path d="M -8 0 H 31.2 L 28.6 10.2 H 17.4 V 22.8 H 5.4 V 10.2 H -5.2 Z"/><path d="M 32.5 0 H 47.0 V 19.2 H 56.2 V 0 H 67.6 V 22.8 H 35.6 V 6.2 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 71.5 0 H 96.2 C 104.8 0 109.4 4.4 109.4 12.0 C 109.4 19.0 105.0 22.6 97.6 22.8 H 74.6 V 6.2 Z M 86.2 8.4 V 16.4 H 95.0 C 97.6 16.4 98.8 15.0 98.8 12.4 C 98.8 9.8 97.6 8.4 95.0 8.4 Z"/><path d="M 112.5 0 H 146.0 L 143.6 9.6 H 126.8 V 19.2 H 142.0 V 22.8 H 115.6 V 6.2 Z"/><path d="M 182.0 13.6 H 171.0 V 11.2 C 171.0 9.2 169.5 8.0 167.0 8.0 H 161.5 C 159.2 8.0 158.0 9.2 158.0 11.5 C 158.0 14.2 159.8 15.6 171.5 18.8 C 175.8 20.0 178.6 21.4 180.2 22.8 H 159.8 C 151.6 20.6 148.0 17.2 148.0 11.5 C 148.0 4.5 153.2 0 161.2 0 H 168.8 C 177.2 0 182.0 4.6 182.0 12.0 Z"/><path d="M 184.2 0 H 198.6 V 19.2 H 208.0 V 0 H 219.4 V 22.8 H 187.4 V 6.2 Z"/></g><g fill="#101411"><path d="M 5.4 30.2 H 17.4 V 54 H 5.4 Z"/><path d="M 35.6 30.2 H 67.6 V 54 H 56.2 V 34.4 H 47.0 V 54 H 35.6 Z"/><path d="M 74.6 30.2 H 86.2 V 54 H 74.6 Z M 89.4 30.2 H 101.2 L 110.2 54 H 98.4 Z"/><path d="M 115.6 30.2 H 142.0 V 33.6 H 126.8 V 44.4 H 146.0 L 143.6 54 H 115.6 Z"/><path d="M 149.8 30.2 H 170.2 C 178.4 32.4 182.2 36.0 182.2 42.2 C 182.2 49.4 177.0 54.0 168.6 54.0 H 161.0 C 152.8 54.0 148.0 49.4 148.0 41.8 V 39.8 H 158.8 V 42.4 C 158.8 44.6 160.2 45.8 162.8 45.8 H 168.0 C 170.5 45.8 171.8 44.6 171.8 42.2 C 171.8 39.4 169.8 38.0 158.2 34.8 C 154.0 33.6 151.4 32.0 149.8 30.2 Z"/><path d="M 187.4 30.2 H 219.4 V 54 H 208.0 V 34.4 H 198.6 V 54 H 187.4 Z"/></g><path d="M -12 24.1 H 224.2 L 219.5 15.2 L 238.8 26.5 L 219.5 37.8 L 224.2 28.9 H -14 Z" fill="${palette.primaryOnLight}"/></g></svg>`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeTextForSafeAttr(brand.name)} — THRESH Join Poster</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F7F6F2; color: #111318; margin: 0; padding: 32px; }
    .sheet { max-width: 720px; margin: 0 auto; background: #FFFFFF; border-radius: 24px; overflow: hidden; border: 2px solid #E5E7EB; box-shadow: 0 12px 32px rgba(0,0,0,0.06); }
    .banner { background: linear-gradient(135deg, ${palette.primaryOnLight} 0%, ${palette.secondaryOnLight} 100%); color: #FFFFFF; padding: 32px 36px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
    .banner-left { display: flex; align-items: center; gap: 20px; }
    .thresh-pill { background: #FFFFFF; padding: 8px 14px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); flex-shrink: 0; }
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
