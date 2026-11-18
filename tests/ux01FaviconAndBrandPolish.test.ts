import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTeamFaviconDataUri } from '../src/utils/teamBrandDom';

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

describe('UX-01 & BRD-02 · S2 Redline Breach × W-A Threshold Horizon Modular Brand, Favicon & PWA Icons', () => {
  const root = process.cwd();

  it('ships the unified 32x32 S2 Redline Breach squircle in public/icon.svg (true evenodd knockout)', () => {
    const svg = fs.readFileSync(path.join(root, 'public', 'icon.svg'), 'utf8');
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('fill="#0B1911"');
    expect(svg).toContain('stroke="#399663"');
    expect(svg).toContain('fill="#C8FF00"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain('paint-order:stroke fill');
  });

  it('links favicon and apple-touch-icon across app and docs HTML', () => {
    const appHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const docsHtml = fs.readFileSync(path.join(root, 'public', 'docs', 'index.html'), 'utf8');

    expect(appHtml).toContain('href="/icon.svg?v=4"');
    expect(appHtml).toContain('href="/apple-touch-icon.png?v=4"');
    expect(docsHtml).toContain('href="/icon.svg?v=4"');
  });

  it('builds dynamic team favicons using the 32x32 S2 Redline Breach geometry with encoded team palette', () => {
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
