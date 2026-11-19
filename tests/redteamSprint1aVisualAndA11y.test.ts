import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { INTERVALS_EFFORT_ZONES, ZONE_META } from '../src/utils/workoutParser';

describe('Sprint 1 Wave 1A — Design System, WCAG AA Ink Tokens & Component Layering (RT-16, RT-23, RT-25)', () => {
  it('exposes AA inkClass utility tokens across all 6 physiological zones in INTERVALS_EFFORT_ZONES and ZONE_META', () => {
    expect(INTERVALS_EFFORT_ZONES).toHaveLength(6);
    for (const z of INTERVALS_EFFORT_ZONES) {
      expect(z.inkClass).toBeTruthy();
      expect(ZONE_META[z.code].inkClass).toBe(z.inkClass);
    }
    expect(ZONE_META.Z3.inkClass).toBe('ap-ink-amber');
    expect(ZONE_META.Z4.inkClass).toBe('ap-ink-vermilion');
  });

  it('defines theme-aware global :focus-visible rules, AA ink tokens, .ap-btn-pine, .ap-touch, and @layer components button wrapping in src/index.css', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toContain('a:focus-visible,');
    expect(css).toContain('outline: 2px solid #1c5436;');
    expect(css).toContain('outline-color: #c8ff00;');
    expect(css).toContain('outline-color: #d4ff33;');
    expect(css).toContain('outline-color: #fbbf24;');
    expect(css).toContain('.ap-btn-pine');
    expect(css).toContain('.ap-ink-amber');
    expect(css).toContain('.ap-ink-sky');
    expect(css).toContain('.ap-touch');
    expect(css).toContain('.ap-touch-row');
    expect(css).toContain('@layer components');
    expect(css).toContain('min-height: 2.75rem');

    // .ap-btn-secondary must live inside @layer components so utility display classes like `hidden sm:inline-flex` win
    const layerIdx = css.lastIndexOf('@layer components');
    const secondaryBtnIdx = css.indexOf('.ap-btn-secondary {');
    expect(layerIdx).toBeGreaterThan(-1);
    expect(secondaryBtnIdx).toBeGreaterThan(layerIdx);
  });

  it('registers all Wave 1A AA palette colors in DESIGN.md frontmatter', () => {
    const designMd = fs.readFileSync(path.join(process.cwd(), 'DESIGN.md'), 'utf8');
    for (const hex of [
      '#047857',
      '#0369A1',
      '#0F766E',
      '#9A3412',
      '#92400E',
      '#BE123C',
      '#6D28D9',
      '#33463A',
      '#16422A',
    ]) {
      expect(designMd).toContain(hex);
    }
  });
});
