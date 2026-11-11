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

  const threshPosterLogoSvg = `<svg style="height:28px;width:auto;display:inline-block;vertical-align:middle;" viewBox="10 6 436 173" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="#111318"><path d="M 417.84 138.5 L 96 138.5 A 46.5 46.5 0 0 1 91.14 45.75 L 92.03 54.21 A 38 38 0 0 0 96 130 L 420.36 130 Z"/><path d="M 414.23 150.7 L 96 150.7 A 58.7 58.7 0 1 1 108.2 34.58 L 106.44 42.9 A 50.2 50.2 0 1 0 96 142.2 L 416.75 142.2 Z"/><path d="M 410.61 162.9 L 96 162.9 A 70.9 70.9 0 1 1 131.45 30.6 L 127.2 37.96 A 62.4 62.4 0 1 0 96 154.4 L 413.13 154.4 Z"/><path d="M 407 175.1 L 96 175.1 A 83.1 83.1 0 1 1 157.76 36.4 L 151.44 42.08 A 74.6 74.6 0 1 0 96 166.6 L 409.52 166.6 Z"/></g><g fill="${palette.primaryOnLight}"><path d="M 97.62 45.53 A 46.5 46.5 0 0 1 142.5 92 L 134 92 A 38 38 0 0 0 97.33 54.02 Z"/><path d="M 116.08 36.84 A 58.7 58.7 0 0 1 154.7 92 L 146.2 92 A 50.2 50.2 0 0 0 113.17 44.83 Z"/><path d="M 139.65 36.13 A 70.9 70.9 0 0 1 166.9 92 L 158.4 92 A 62.4 62.4 0 0 0 134.42 42.83 Z"/><path d="M 164.89 45.53 A 83.1 83.1 0 0 1 179.1 92 L 170.6 92 A 74.6 74.6 0 0 0 157.85 50.28 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 107.89 88.14 A 12.5 12.5 0 1 1 98.6 79.77 L 116.79 65.63 L 120.05 68.57 Z M 100.5 92 A 4.5 4.5 0 1 0 91.5 92 A 4.5 4.5 0 1 0 100.5 92 Z"/></g><g transform="translate(199, 69) skewX(-16.5)"><g transform="translate(3.8, 0)" fill="#111318"><path d="M -8 0 H 30.5 L 28.0 9.6 H 16.8 V 23.6 H 5.8 V 9.6 H -5.2 Z"/><path d="M 32.5 0 H 46.5 V 19.6 H 56.5 V 0 H 67.2 V 23.6 H 35.8 V 6.2 Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M 71.5 0 H 95.8 C 104.2 0 108.8 4.4 108.8 12.2 C 108.8 19.4 104.5 23.2 97.2 23.6 H 74.8 V 6.2 Z M 85.5 8.4 V 16.8 H 94.8 C 97.4 16.8 98.5 15.4 98.5 12.6 C 98.5 9.8 97.4 8.4 94.8 8.4 Z"/><path d="M 112.5 0 H 145.5 L 143.2 9.2 H 126.2 V 19.8 H 141.5 V 23.6 H 115.8 V 6.2 Z"/><path d="M 181.5 13.8 H 171.0 V 11.2 C 171.0 9.2 169.5 8.0 167.0 8.0 H 161.5 C 159.2 8.0 158.0 9.2 158.0 11.5 C 158.0 14.4 159.8 15.8 171.5 19.2 C 175.8 20.5 178.6 22.0 180.2 23.6 H 159.8 C 151.6 21.2 148.0 17.6 148.0 11.5 C 148.0 4.5 153.2 0 161.2 0 H 168.5 C 176.8 0 181.5 4.6 181.5 12.2 Z"/><path d="M 184.2 0 H 198.2 V 19.6 H 208.2 V 0 H 219.0 V 23.6 H 187.5 V 6.2 Z"/></g><g fill="#111318"><path d="M 5.8 29.4 H 16.8 V 54 H 5.8 Z"/><path d="M 35.8 29.4 H 67.2 V 54 H 56.5 V 33.8 H 46.5 V 54 H 35.8 Z"/><path d="M 74.8 29.4 H 85.5 V 54 H 74.8 Z M 89.2 29.4 H 100.5 L 109.5 54 H 98.2 Z"/><path d="M 115.8 29.4 H 141.5 V 32.8 H 126.2 V 44.8 H 145.5 L 143.2 54 H 115.8 Z"/><path d="M 149.8 29.4 H 170.2 C 178.4 31.8 182.0 35.6 182.0 42.0 C 182.0 49.4 176.8 54.0 168.5 54.0 H 161.0 C 152.8 54.0 148.0 49.4 148.0 41.8 V 39.8 H 158.5 V 42.4 C 158.5 44.6 160.0 45.8 162.5 45.8 H 168.0 C 170.5 45.8 171.8 44.6 171.8 42.2 C 171.8 39.2 169.8 37.8 158.2 34.4 C 154.0 33.1 151.4 31.4 149.8 29.4 Z"/><path d="M 187.5 29.4 H 219.0 V 54 H 208.2 V 33.8 H 198.2 V 54 H 187.5 Z"/></g><path d="M -12 24.9 H 226.5 L 222.5 17.5 L 242.5 26.5 L 222.5 35.5 L 226.5 28.1 H -14 Z" fill="${palette.primaryOnLight}"/></g></svg>`;

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
