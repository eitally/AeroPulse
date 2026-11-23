import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

const GOOGLE_FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo:wght@800&family=Barlow+Condensed:wght@800&family=JetBrains+Mono:wght@600;700';

async function loadGoogleFonts() {
  const resp = await fetch(GOOGLE_FONTS_CSS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Google Fonts CSS (${resp.status})`);
  }
  const cssText = await resp.text();
  const faceRegex =
    /@font-face\s*\{[\s\S]*?font-family:\s*'([^']+)';[\s\S]*?font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)/g;

  const fonts = new Map();
  let match;
  while ((match = faceRegex.exec(cssText)) !== null) {
    const [, family, weight, url] = match;
    const key = `${family}:${weight}`;
    const fontResp = await fetch(url);
    if (!fontResp.ok) {
      throw new Error(`Failed to fetch TTF for ${key} (${fontResp.status})`);
    }
    const buf = await fontResp.arrayBuffer();
    fonts.set(key, opentype.parse(buf));
    console.log(`[Outline Gen] Loaded ${key} from ${url} (${buf.byteLength} bytes)`);
  }

  for (const required of [
    'Archivo:800',
    'Barlow Condensed:800',
    'JetBrains Mono:600',
    'JetBrains Mono:700',
  ]) {
    if (!fonts.has(required)) {
      throw new Error(`Missing required font face from Google Fonts: ${required}`);
    }
  }
  return fonts;
}

function fmt(n) {
  const rounded = Number(n.toFixed(2));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function commandsToSvgPath(commands, tx = 0, ty = 0, angleRad = 0) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const mapX = (x, y) => tx + x * cos - y * sin;
  const mapY = (x, y) => ty + x * sin + y * cos;

  const parts = [];
  for (const cmd of commands) {
    if (cmd.type === 'M') {
      parts.push(`M${fmt(mapX(cmd.x, cmd.y))} ${fmt(mapY(cmd.x, cmd.y))}`);
    } else if (cmd.type === 'L') {
      parts.push(`L${fmt(mapX(cmd.x, cmd.y))} ${fmt(mapY(cmd.x, cmd.y))}`);
    } else if (cmd.type === 'Q') {
      parts.push(
        `Q${fmt(mapX(cmd.x1, cmd.y1))} ${fmt(mapY(cmd.x1, cmd.y1))} ${fmt(mapX(cmd.x, cmd.y))} ${fmt(mapY(cmd.x, cmd.y))}`
      );
    } else if (cmd.type === 'C') {
      parts.push(
        `C${fmt(mapX(cmd.x1, cmd.y1))} ${fmt(mapY(cmd.x1, cmd.y1))} ${fmt(mapX(cmd.x2, cmd.y2))} ${fmt(mapY(cmd.x2, cmd.y2))} ${fmt(mapX(cmd.x, cmd.y))} ${fmt(mapY(cmd.x, cmd.y))}`
      );
    } else if (cmd.type === 'Z') {
      parts.push('Z');
    }
  }
  return parts.join('');
}

function textToGlyphs(font, text) {
  return Array.from(text, (ch) => {
    const g = font.charToGlyph(ch);
    if (!/\s/.test(ch) && g.index === 0) {
      throw new Error(`Font ${font.names?.fontFamily?.en || 'unknown'} missing glyph for "${ch}"`);
    }
    return g;
  });
}

function layoutHorizontalText(font, text, { fontSize, letterSpacing = 0, x = 0, y = 0, align = 'left', verticalCenterY = null }) {
  const scale = fontSize / font.unitsPerEm;
  const glyphs = textToGlyphs(font, text);
  const combined = new opentype.Path();

  let cursorX = 0;
  for (let i = 0; i < glyphs.length; i += 1) {
    const glyph = glyphs[i];
    if (i > 0) {
      cursorX += font.getKerningValue(glyphs[i - 1], glyph) * scale + letterSpacing;
    }
    const glyphPath = glyph.getPath(cursorX, 0, fontSize);
    for (const cmd of glyphPath.commands) {
      combined.commands.push(cmd);
    }
    cursorX += glyph.advanceWidth * scale;
  }

  const bb = combined.getBoundingBox();
  const dx =
    align === 'center'
      ? x - (bb.x1 + bb.x2) / 2
      : align === 'right'
        ? x - bb.x2
        : x - bb.x1;
  const dy =
    verticalCenterY !== null
      ? verticalCenterY - (bb.y1 + bb.y2) / 2
      : y;

  const d = commandsToSvgPath(combined.commands, dx, dy, 0);
  const finalBb = {
    x1: Number((bb.x1 + dx).toFixed(1)),
    y1: Number((bb.y1 + dy).toFixed(1)),
    x2: Number((bb.x2 + dx).toFixed(1)),
    y2: Number((bb.y2 + dy).toFixed(1)),
  };
  return { d, bbox: finalBb };
}

function layoutCircularArcText(
  font,
  text,
  { fontSize, letterSpacing = 0, cx, cy, radius, placement }
) {
  const scale = fontSize / font.unitsPerEm;
  const glyphs = textToGlyphs(font, text);

  const offsets = [];
  let cursor = 0;
  for (let i = 0; i < glyphs.length; i += 1) {
    const glyph = glyphs[i];
    if (i > 0) {
      cursor += font.getKerningValue(glyphs[i - 1], glyph) * scale + letterSpacing;
    }
    const adv = glyph.advanceWidth * scale;
    offsets.push({ glyph, adv, centerS: cursor + adv / 2 });
    cursor += adv;
  }
  const totalWidth = cursor;
  const totalAngle = totalWidth / radius;

  const pathParts = [];
  for (const item of offsets) {
    const { glyph, adv, centerS } = item;
    if (!glyph.path || glyph.path.commands.length === 0) continue;

    let theta;
    let rotAngle;
    if (placement === 'top') {
      const startTheta = -Math.PI / 2 - totalAngle / 2;
      theta = startTheta + centerS / radius;
      rotAngle = theta + Math.PI / 2;
    } else {
      // Bottom arc: upright left-to-right counter-clockwise around 6 o'clock (+PI/2)
      const startTheta = Math.PI / 2 + totalAngle / 2;
      theta = startTheta - centerS / radius;
      rotAngle = theta - Math.PI / 2;
    }

    const px = cx + radius * Math.cos(theta);
    const py = cy + radius * Math.sin(theta);
    const glyphPath = glyph.getPath(-adv / 2, 0, fontSize);
    const svgPart = commandsToSvgPath(glyphPath.commands, px, py, rotAngle);
    if (svgPart) {
      pathParts.push(svgPart);
    }
  }

  return {
    d: pathParts.join(' '),
    spanDegrees: Number(((totalAngle * 180) / Math.PI).toFixed(1)),
  };
}

async function main() {
  const fonts = await loadGoogleFonts();
  const archivo800 = fonts.get('Archivo:800');
  const barlow800 = fonts.get('Barlow Condensed:800');
  const mono600 = fonts.get('JetBrains Mono:600');
  const mono700 = fonts.get('JetBrains Mono:700');

  // 1. meetready-sticker-crest (360x360, center 180,180)
  const crestTop = layoutCircularArcText(archivo800, 'MeetReady', {
    fontSize: 24,
    letterSpacing: 3.4,
    cx: 180,
    cy: 180,
    radius: 117,
    placement: 'top',
  });
  const crestBottom = layoutCircularArcText(mono700, 'TRACK · FIELD · XC', {
    fontSize: 15.5,
    letterSpacing: 2.3,
    cx: 180,
    cy: 180,
    radius: 132,
    placement: 'bottom',
  });
  const crestDomain = layoutHorizontalText(mono700, 'meetready.app', {
    fontSize: 13,
    letterSpacing: 0.6,
    x: 180,
    y: 232,
    align: 'center',
  });

  // 2. meetready-sticker-diecut (472x124)
  const diecutDomain = layoutHorizontalText(mono700, 'meetready.app', {
    fontSize: 14,
    letterSpacing: 0.9,
    x: 138,
    y: 104,
    align: 'left',
  });

  // 3. meetready-merch-tee-back (600x440, 2-ink #F6F3EC + #D8FF2A)
  const teeHeadline = layoutHorizontalText(barlow800, 'BUILT FOR MEET DAY.', {
    fontSize: 56,
    letterSpacing: -0.5,
    x: 56,
    y: 224,
    align: 'left',
  });
  const teeSubhead = layoutHorizontalText(mono700, 'RUN. JUMP. THROW. MEET READY.', {
    fontSize: 20,
    letterSpacing: 1.2,
    x: 56,
    y: 274,
    align: 'left',
  });
  const teeFooter = layoutHorizontalText(mono600, 'TRACK · FIELD · XC · meetready.app', {
    fontSize: 17,
    letterSpacing: 1.4,
    x: 56,
    y: 356,
    align: 'left',
  });

  // 4. meetready-banner-10x3-qr (1200x360)
  const bannerHeadline = layoutHorizontalText(barlow800, 'BUILT FOR MEET DAY.', {
    fontSize: 54,
    letterSpacing: -0.6,
    x: 56,
    y: 242,
    align: 'left',
  });
  const bannerPillText = layoutHorizontalText(mono700, 'TRACK · FIELD · XC · meetready.app', {
    fontSize: 17,
    letterSpacing: 1.1,
    x: 279,
    verticalCenterY: 290,
    align: 'center',
  });
  const bannerQrCaption = layoutHorizontalText(mono700, 'SCAN → TRY LIVE DEMO', {
    fontSize: 15,
    letterSpacing: 0.8,
    x: 1020,
    y: 304,
    align: 'center',
  });

  console.log('[Outline Gen] crestTop span deg:', crestTop.spanDegrees);
  console.log('[Outline Gen] crestBottom span deg:', crestBottom.spanDegrees);
  console.log('[Outline Gen] crestDomain bbox:', crestDomain.bbox);
  console.log('[Outline Gen] diecutDomain bbox:', diecutDomain.bbox);
  console.log('[Outline Gen] teeHeadline bbox:', teeHeadline.bbox);
  console.log('[Outline Gen] teeSubhead bbox:', teeSubhead.bbox);
  console.log('[Outline Gen] teeFooter bbox:', teeFooter.bbox);
  console.log('[Outline Gen] bannerHeadline bbox:', bannerHeadline.bbox);
  console.log('[Outline Gen] bannerPillText bbox:', bannerPillText.bbox);
  console.log('[Outline Gen] bannerQrCaption bbox:', bannerQrCaption.bbox);

  const output = `/**
 * Auto-generated outlined SVG vector paths for MeetReady print, sticker, banner, and merch assets.
 * Generated via \`node scripts/generatePrintTextOutlines.mjs\` using opentype.js + Google Fonts TTFs
 * (Archivo 800, Barlow Condensed 800, JetBrains Mono 600/700) — zero runtime <text> font dependency.
 */

export const CREST_TOP_MEETREADY_OUTLINE_PATH =
  ${JSON.stringify(crestTop.d)};

export const CREST_BOTTOM_SUBTITLE_OUTLINE_PATH =
  ${JSON.stringify(crestBottom.d)};

export const CREST_DOMAIN_LABEL_OUTLINE_PATH =
  ${JSON.stringify(crestDomain.d)};

export const DIECUT_DOMAIN_LABEL_OUTLINE_PATH =
  ${JSON.stringify(diecutDomain.d)};

export const TEE_HEADLINE_OUTLINE_PATH =
  ${JSON.stringify(teeHeadline.d)};

export const TEE_SUBHEAD_OUTLINE_PATH =
  ${JSON.stringify(teeSubhead.d)};

export const TEE_FOOTER_OUTLINE_PATH =
  ${JSON.stringify(teeFooter.d)};

export const BANNER_HEADLINE_OUTLINE_PATH =
  ${JSON.stringify(bannerHeadline.d)};

export const BANNER_PILL_TEXT_OUTLINE_PATH =
  ${JSON.stringify(bannerPillText.d)};

export const BANNER_QR_CAPTION_OUTLINE_PATH =
  ${JSON.stringify(bannerQrCaption.d)};
`;

  const outPath = path.resolve(process.cwd(), 'src', 'utils', 'brandPrintOutlines.ts');
  fs.writeFileSync(outPath, output, 'utf8');
  console.log(`[Outline Gen] Wrote ${path.relative(process.cwd(), outPath)} (${output.length} bytes)`);
}

main().catch((err) => {
  console.error('[Outline Gen] FAILED:', err);
  process.exit(1);
});
