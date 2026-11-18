import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTeamFaviconDataUri } from '../src/utils/teamBrandDom';
import {
  FAV_F_SHIELD_T_PATH,
  S2_ARROW_NEEDLE_PATH,
  S2_PINE_ARC_PATH,
  S2_VOLT_ARC_PATH,
} from '../src/utils/brandVectors';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('UX-01 & BRD-03 · TL-2P1 Parallel-Breach Track-Lane × W-A Lockup & FAV-F 16px Favicon', () => {
  const root = process.cwd();

  it('ships TL-2P1 collinear 315-degree parallel breach + inside track lane in brandVectors.ts', () => {
    // Inner track lane present in both Pine and Volt compound paths
    expect(S2_PINE_ARC_PATH).toContain('M 42.32 87.68 A 25 25');
    expect(S2_VOLT_ARC_PATH).toContain('M 83.19 60.67 A 25 25');
    // Collinear 315° parallel chord endpoints on outer & inner Pine walls (dx === dy)
    expect(S2_PINE_ARC_PATH).toContain('84.13 31.99 L 73.87 42.27');
    expect(S2_VOLT_ARC_PATH).toContain('M 97.99 45.87');
    expect(S2_VOLT_ARC_PATH).toContain('87.73 56.13');
    // Center pinhole + +2.5px extended arrow tip preserved
    expect(S2_ARROW_NEEDLE_PATH).toContain('108.44 21.56');
    expect(S2_ARROW_NEEDLE_PATH).toContain('A 3.8 3.8 0 1 0 56.20 70.00');
  });

  it('ships the dedicated 32x32 FAV-F High-Vis Volt Shield in public/icon.svg (crisp at 16px)', () => {
    const svg = fs.readFileSync(path.join(root, 'public', 'icon.svg'), 'utf8');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('fill="#C8FF00"');
    expect(svg).toContain('fill="#080A09"');
    expect(svg).toContain(FAV_F_SHIELD_T_PATH);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain('paint-order:stroke fill');
  });

  it('links cache-busted v=5 FAV-F favicon and apple-touch-icon across app and docs HTML', () => {
    const appHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const docsHtml = fs.readFileSync(path.join(root, 'public', 'docs', 'index.html'), 'utf8');

    expect(appHtml).toContain('href="/icon.svg?v=5"');
    expect(appHtml).toContain('href="/apple-touch-icon.png?v=5"');
    expect(docsHtml).toContain('href="/icon.svg?v=5"');
  });

  it('builds dynamic team favicons using the 32x32 FAV-F Volt Shield geometry with encoded team palette', () => {
    const dataUri = buildTeamFaviconDataUri('#1E3A8A', '#FFFFFF', '#0F172A');
    expect(dataUri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(dataUri).toContain('viewBox%3D%220%200%2032%2032%22');
    expect(dataUri).toContain('%231E3A8A');
    expect(dataUri).toContain('%23FFFFFF');
    expect(dataUri).toContain('%230F172A');
    expect(dataUri).not.toContain('viewBox%3D%220%200%20128%20128%22');
  });

  it('provides regenerated PWA & Apple Touch PNG icons with exact pixel dimensions', () => {
    const expected: Array<{ file: string; width: number; height: number }> = [
      { file: 'apple-touch-icon.png', width: 180, height: 180 },
      { file: 'pwa-192x192.png', width: 192, height: 192 },
      { file: 'pwa-512x512.png', width: 512, height: 512 },
      { file: 'pwa-maskable-512x512.png', width: 512, height: 512 },
    ];

    for (const item of expected) {
      const dims = readPngDimensions(path.join(root, 'public', item.file));
      expect(dims).toEqual({ width: item.width, height: item.height });
    }
  });

  it('exports decoupled ThreshMark + ThreshWordmark with high-contrast tokens and zero interior watermarks', () => {
    const logoSrc = fs.readFileSync(path.join(root, 'src', 'components', 'AeroPulseLogo.tsx'), 'utf8');
    expect(logoSrc).toContain('export const ThreshMark');
    expect(logoSrc).toContain('export const ThreshWordmark');
    expect(logoSrc).toContain('--thresh-volt:#357A00');
    expect(logoSrc).toContain('--thresh-ink:#101411');
    expect(logoSrc).toContain('--thresh-ink:#F4F7F4');
    expect(logoSrc).not.toContain('skewX(-14) scale(1.10, 1.29)');
    expect(logoSrc).toContain('viewBox="0 0 32 32"');

    const footerSrc = fs.readFileSync(path.join(root, 'src', 'components', 'CockpitFooter.tsx'), 'utf8');
    expect(footerSrc).toContain('surface="on-dark"');

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
