import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTeamFaviconDataUri } from '../src/utils/teamBrandDom';
import {
  BREAK_LANE_M_ARROW_PATH,
  BREAK_LANE_M_LANES_PATH,
  FAV_M_ARROW_PATH,
  FAV_M_LANES_PATH,
  FAV_M_SINGLE_INK_PATH,
  MEETREADY_WORDMARK_OUTLINE_PATH,
} from '../src/utils/brandVectors';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngMetadata(filePath: string): { width: number; height: number; colorType: number } {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
  };
}

describe('UX-01 & BRD-03 · 1B-Pro Break-Lane M Vector Lockup & 32px Favicon', () => {
  const root = process.cwd();

  it('ships flat 2-ink Velocity Chevron M and outlined wordmark paths in brandVectors.ts', () => {
    expect(BREAK_LANE_M_LANES_PATH.length).toBeGreaterThan(40);
    expect(BREAK_LANE_M_ARROW_PATH.length).toBeGreaterThan(40);
    expect(MEETREADY_WORDMARK_OUTLINE_PATH.length).toBeGreaterThan(1000);
    expect(FAV_M_LANES_PATH).toContain('M 3.24 25.24');
    expect(FAV_M_ARROW_PATH).toContain('28.76 25.24');
  });

  it('ships the unified 32x32 Velocity Chevron M favicon in public/icon.svg (crisp at 16px)', () => {
    const svg = fs.readFileSync(path.join(root, 'public', 'icon.svg'), 'utf8');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('fill="#121413"');
    expect(svg).toContain('fill="#F6F3EC"');
    expect(svg).toContain('fill="#D8FF2A"');
    expect(svg).toContain(FAV_M_LANES_PATH);
    expect(svg).toContain(FAV_M_ARROW_PATH);
    expect(svg).not.toMatch(/<(linearGradient|radialGradient)/i);
    expect(svg).not.toContain('paint-order:stroke fill');
  });

  it('links cache-busted v=7 favicon and apple-touch-icon across app and docs HTML', () => {
    const appHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const docsHtml = fs.readFileSync(path.join(root, 'public', 'docs', 'index.html'), 'utf8');

    expect(appHtml).toContain('href="/icon.svg?v=7"');
    expect(appHtml).toContain('href="/apple-touch-icon.png?v=7"');
    expect(docsHtml).toContain('href="/icon.svg?v=7"');
  });

  it('builds dynamic team favicons using the 32x32 Break-Lane M geometry with encoded team palette', () => {
    const dataUri = buildTeamFaviconDataUri('#1E3A8A', '#FFFFFF', '#0F172A');
    expect(dataUri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(dataUri).toContain('viewBox%3D%220%200%2032%2032%22');
    expect(dataUri).toContain('%231E3A8A');
    expect(dataUri).toContain('%23FFFFFF');
    expect(dataUri).toContain('%230F172A');
    expect(decodeURIComponent(dataUri)).toContain(FAV_M_SINGLE_INK_PATH);
    expect(dataUri).not.toContain('viewBox%3D%220%200%20128%20128%22');
  });

  it('provides regenerated opaque RGB PWA & Apple Touch PNG icons with exact pixel dimensions', () => {
    const expected: Array<{ file: string; width: number; height: number; colorType: number }> = [
      { file: 'apple-touch-icon.png', width: 180, height: 180, colorType: 2 },
      { file: 'pwa-192x192.png', width: 192, height: 192, colorType: 2 },
      { file: 'pwa-512x512.png', width: 512, height: 512, colorType: 2 },
      { file: 'pwa-maskable-512x512.png', width: 512, height: 512, colorType: 2 },
    ];

    for (const item of expected) {
      const meta = readPngMetadata(path.join(root, 'public', item.file));
      expect(meta).toEqual({
        width: item.width,
        height: item.height,
        colorType: item.colorType,
      });
    }
  });

  it('exports decoupled ThreshMark + ThreshWordmark with high-contrast tokens, outlined paths, and zero interior watermarks', () => {
    const logoSrc = fs.readFileSync(path.join(root, 'src', 'components', 'AeroPulseLogo.tsx'), 'utf8');
    expect(logoSrc).toContain('export const ThreshMark');
    expect(logoSrc).toContain('export const ThreshWordmark');
    expect(logoSrc).toContain('--thresh-pine:#121413');
    expect(logoSrc).toContain('--thresh-pine:#F6F3EC');
    expect(logoSrc).toContain('--thresh-volt:#B83A24');
    expect(logoSrc).toContain('--thresh-volt:#D8FF2A');
    expect(logoSrc).toContain('--thresh-ink:#121413');
    expect(logoSrc).toContain('--thresh-ink:#F6F3EC');
    expect(logoSrc).toContain('MEETREADY_WORDMARK_OUTLINE_PATH');
    expect(logoSrc).not.toMatch(/<text\s+/i);
    expect(logoSrc).not.toContain('skewX(-14) scale(1.10, 1.29)');
    expect(logoSrc).toContain('viewBox="0 0 32 32"');

    const footerSrc = fs.readFileSync(path.join(root, 'src', 'components', 'CockpitFooter.tsx'), 'utf8');
    expect(footerSrc).toContain('surface="auto"');

    const heroSrc = fs.readFileSync(
      path.join(root, 'src', 'components', 'CircadianFirstTouchHero.tsx'),
      'utf8'
    );
    const morphSrc = fs.readFileSync(
      path.join(root, 'src', 'components', 'ReadinessMorphingCard.tsx'),
      'utf8'
    );
    expect(heroSrc).not.toContain('ThreshBrandWatermark');
    expect(morphSrc).not.toContain('ThreshBrandWatermark');
  });
});
