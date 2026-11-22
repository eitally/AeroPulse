import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  BRAND_ASSET_CATALOG,
  buildBrandKitZipUint8Array,
  buildTeamCobrandLockupSvg,
  evaluateAssetOnBackdrop,
} from '../src/utils/brandAssetEngine';
import { isBrandStudioLocation } from '../src/utils/brandRoute';
import { SACRED_ZONES_SPECTRUM } from '../src/data/brandStyleGuideData';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(filePath: string): { width: number; height: number } {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  // IHDR chunk starts at byte 8 (length:4, type "IHDR":4, width:4, height:4)
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe('BRD-01 Brand Studio, True Compound Stencils & Asset Exporter', () => {
  it('matches zero-auth /brand and #brand locations cleanly without stealing other routes', () => {
    expect(isBrandStudioLocation('/brand', '')).toBe(true);
    expect(isBrandStudioLocation('/brand/', '')).toBe(true);
    expect(isBrandStudioLocation('/', '#brand')).toBe(true);
    expect(isBrandStudioLocation('', '#brand')).toBe(true);
    expect(isBrandStudioLocation('/join/paly', '')).toBe(false);
    expect(isBrandStudioLocation('/brand-other', '')).toBe(false);
    expect(isBrandStudioLocation('/', '#stopwatch')).toBe(false);
  });

  it('ships all 17 canonical vectors with unique IDs and namespaced gradient IDs', () => {
    expect(BRAND_ASSET_CATALOG).toHaveLength(17);

    const seenIds = new Set<string>();
    const seenGradientIds = new Set<string>();

    for (const asset of BRAND_ASSET_CATALOG) {
      expect(seenIds.has(asset.id)).toBe(false);
      seenIds.add(asset.id);

      expect(asset.svgMarkup.startsWith('<svg ')).toBe(true);
      expect(asset.svgMarkup.endsWith('</svg>')).toBe(true);
      expect(asset.svgMarkup).toContain(`viewBox="${asset.viewBox}"`);

      // Never collide on generic gradient id="g1"
      expect(asset.svgMarkup).not.toContain('id="g1"');

      const gradMatches = [...asset.svgMarkup.matchAll(/id="(meetready-grad-[^"]+)"/g)];
      for (const m of gradMatches) {
        const gid = m[1];
        expect(seenGradientIds.has(gid)).toBe(false);
        seenGradientIds.add(gid);
      }
    }
  });

  it('enforces true boolean compound-path knockouts on all 5 1-ink stencils (zero fake strokes or masks)', () => {
    const oneInkIds = [
      'meetready-1ink-stencil',
      'meetready-1ink-stencil-white',
      'meetready-1ink-stencil-volt',
      'meetready-gauge-symbol-1ink-black',
      'meetready-gauge-symbol-1ink-white',
    ];

    for (const id of oneInkIds) {
      const asset = BRAND_ASSET_CATALOG.find((a) => a.id === id);
      expect(asset).toBeDefined();
      const svg = asset!.svgMarkup;

      expect(svg).not.toMatch(/\sstroke=/i);
      expect(svg).not.toContain('paint-order');
      expect(svg).not.toContain('<mask');
      expect(svg).toContain('fill-rule="evenodd"');

      if (
        id === 'meetready-1ink-stencil' ||
        id === 'meetready-1ink-stencil-volt' ||
        id === 'meetready-gauge-symbol-1ink-black'
      ) {
        expect(svg).not.toMatch(/#FFFFFF|#fff\b/i);
      }
      if (id === 'meetready-1ink-stencil-white' || id === 'meetready-gauge-symbol-1ink-white') {
        expect(svg).not.toMatch(/#101411|#000000|#000\b/i);
      }
    }
  });

  it('matches all 17 generated SVGs and 8 PNGs on disk in public/brand/ with exact pixel dimensions', () => {
    const brandDir = path.resolve(process.cwd(), 'public', 'brand');

    for (const asset of BRAND_ASSET_CATALOG) {
      const svgDisk = path.join(brandDir, `${asset.id}.svg`);
      expect(fs.existsSync(svgDisk)).toBe(true);
      expect(fs.readFileSync(svgDisk, 'utf8')).toBe(asset.svgMarkup);
    }

    const expectedPngs: Array<{ file: string; width: number; height: number }> = [
      { file: 'meetready-og-1200x630.png', width: 1200, height: 630 },
      { file: 'meetready-lockup-dark-2x.png', width: 944, height: 248 },
      { file: 'meetready-lockup-light-2x.png', width: 944, height: 248 },
      { file: 'meetready-sticker-diecut-2x.png', width: 944, height: 248 },
      { file: 'meetready-1ink-stencil-2x.png', width: 944, height: 248 },
      { file: 'meetready-1ink-stencil-white-2x.png', width: 944, height: 248 },
      { file: 'meetready-icon-square-512.png', width: 512, height: 512 },
      { file: 'meetready-icon-square-1024.png', width: 1024, height: 1024 },
    ];

    for (const item of expectedPngs) {
      const fullPath = path.join(brandDir, item.file);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(readPngDimensions(fullPath)).toEqual({
        width: item.width,
        height: item.height,
      });
    }
  });

  it('evaluates surface legality correctly across copier, chalk, obsidian & sunlit photo backdrops', () => {
    const darkLockup = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-lockup-dark')!;
    const blackStencil = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-1ink-stencil')!;
    const whiteStencil = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-1ink-stencil-white')!;
    const sticker = BRAND_ASSET_CATALOG.find((a) => a.id === 'meetready-sticker-diecut')!;

    expect(evaluateAssetOnBackdrop(darkLockup, 'bw-copier').status).toBe('AVOID');
    expect(evaluateAssetOnBackdrop(blackStencil, 'bw-copier').status).toBe('RECOMMENDED');
    expect(evaluateAssetOnBackdrop(whiteStencil, 'chalk').status).toBe('AVOID');
    expect(evaluateAssetOnBackdrop(whiteStencil, 'photo-night').status).toBe('RECOMMENDED');
    expect(evaluateAssetOnBackdrop(sticker, 'photo-sunlit').status).toBe('RECOMMENDED');
  });

  it('generates contrast-clamped & XSS-safe Team x MeetReady co-brand SVGs without mutating Z1-Z6', () => {
    const cobrandLight = buildTeamCobrandLockupSvg({
      shortName: '<script>&"XC"',
      monogram: 'N&X',
      primaryHex: '#FACC15', // Pale yellow must clamp darker for WCAG AA on light background
      secondaryHex: '#090D16',
      variant: 'light',
    });

    expect(cobrandLight).toContain('<svg ');
    expect(cobrandLight).not.toContain('<script>');
    expect(cobrandLight).toContain('&lt;script&gt;&amp;&quot;XC&quot;');
    // Light clamped primary should never emit raw un-clamped #FACC15
    expect(cobrandLight.toUpperCase()).not.toContain('#FACC15');

    const cobrandOneInk = buildTeamCobrandLockupSvg({
      shortName: 'NORTHSIDE XC',
      monogram: 'NX',
      primaryHex: '#1E3A8A',
      secondaryHex: '#CA8A04',
      variant: '1ink-white',
    });
    expect(cobrandOneInk).not.toContain('#101411');
    expect(cobrandOneInk).toContain('#FFFFFF');

    // Canonical Sacred Zones list stays intact
    expect(SACRED_ZONES_SPECTRUM.map((z) => z.hex)).toEqual([
      '#94A3B8',
      '#0D9488',
      '#D97706',
      '#EA580C',
      '#DC2626',
      '#7C3AED',
    ]);
  });

  it('packages all 17 SVGs, tokens JSON, and permissions guide into a valid fflate ZIP', async () => {
    const bytes = await buildBrandKitZipUint8Array({
      'sample-test.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(bytes.byteLength).toBeGreaterThan(8000);

    const unpacked = unzipSync(bytes);
    expect(unpacked['BRAND_USAGE_AND_PERMISSIONS.md']).toBeDefined();
    expect(unpacked['tokens/meetready-design-tokens.json']).toBeDefined();
    expect(unpacked['png/sample-test.png']).toBeDefined();

    const parsedTokens = JSON.parse(strFromU8(unpacked['tokens/meetready-design-tokens.json']));
    expect(parsedTokens.name).toBe('MeetReady');
    expect(parsedTokens.sacredPhysiology.lockedAgainstCoBranding).toBe(true);

    for (const asset of BRAND_ASSET_CATALOG) {
      const entry = unpacked[`svg/${asset.id}.svg`];
      expect(entry).toBeDefined();
      expect(strFromU8(entry)).toBe(asset.svgMarkup);
    }
  });
});
