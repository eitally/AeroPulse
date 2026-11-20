import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeAccessibleTeamPalette as paletteDirect,
  contrastRatio,
} from '../src/utils/teamPalette';
import { computeAccessibleTeamPalette as paletteReexport } from '../src/physiology/teamOnboardingEngine';
import { fuseWearableStreamWithStopwatchSplits as fuseDirect } from '../src/utils/stopwatchWearableFusion';
import { fuseWearableStreamWithStopwatchSplits as fuseReexport } from '../src/utils/stopwatchActivitySynthesizer';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Track 6: Dead-Code Removal, Bundle Diet & WCAG AA Contrast Polish', () => {
  it('removes dead unreferenced component files DualAthleteComparator and EChartsPMCDashboard', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/components/DualAthleteComparator.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'src/components/charts/EChartsPMCDashboard.tsx'))).toBe(false);
    const uplotSrc = readSrc('src/components/charts/UPlotPMCDashboard.tsx');
    expect(uplotSrc).not.toContain('EChartsPMCDashboard');
  });

  it('keeps eager telemetryStorage, AeroPulseLogo, TracksideLiveHeaderPill, App, and cloudSync decoupled from heavy lazy modules', () => {
    const telemetrySrc = readSrc('src/utils/telemetryStorage.ts');
    const logoSrc = readSrc('src/components/AeroPulseLogo.tsx');
    const brandAssetSrc = readSrc('src/utils/brandAssetEngine.ts');
    const teamBrandDomSrc = readSrc('src/utils/teamBrandDom.ts');
    const pillSrc = readSrc('src/components/TracksideLiveHeaderPill.tsx');
    const appSrc = readSrc('src/App.tsx');
    const cloudSyncSrc = readSrc('src/hooks/useAthleteCloudSync.ts');

    expect(telemetrySrc).toContain('./stopwatchWearableFusion');
    expect(telemetrySrc).not.toContain('stopwatchActivitySynthesizer');

    expect(logoSrc).toContain('../utils/teamPalette');
    expect(logoSrc).not.toContain('teamOnboardingEngine');

    expect(brandAssetSrc).toContain('./teamPalette.ts');
    expect(brandAssetSrc).not.toContain('teamOnboardingEngine');
    expect(brandAssetSrc).not.toContain('teamQrHelper');

    expect(teamBrandDomSrc).toContain('./teamPalette');
    expect(teamBrandDomSrc).not.toContain('teamQrHelper');

    expect(pillSrc).not.toContain('useTracksideStopwatch');
    expect(pillSrc).not.toContain('scholasticEngine');

    expect(appSrc).toContain("from './utils/shareWorkoutRoute'");
    expect(appSrc).not.toMatch(/from\s+['"]\.\/utils\/shareWorkoutEngine['"]/);

    expect(cloudSyncSrc).toContain("from '../utils/shareWorkoutRoute.ts'");
    expect(cloudSyncSrc).not.toMatch(/from\s+['"]\.\.\/utils\/shareWorkoutEngine(?:\.ts)?['"]/);
  });

  it('preserves 100% API compatibility on teamPalette and stopwatchWearableFusion re-exports & >=4.5:1 WCAG AA contrast', () => {
    expect(paletteDirect).toBe(paletteReexport);
    expect(fuseDirect).toBe(fuseReexport);

    const pal = paletteDirect('#FACC15', '#38BDF8');
    expect(contrastRatio(pal.primaryOnLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(pal.primaryOnDark, '#15231B')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(pal.secondaryOnLight, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(pal.secondaryOnDark, '#15231B')).toBeGreaterThanOrEqual(4.5);
  });

  it('prevents bare light-mode pastel -400 text classes across audited WCAG AA components', () => {
    const cleanedComponents = [
      'src/components/AthletePerformanceRadar.tsx',
      'src/components/AthleteProfileModal.tsx',
      'src/components/CockpitStageBanners.tsx',
      'src/components/auth/AuthOnboardingStepTwo.tsx',
      'src/components/charts/UPlotPMCDashboard.tsx',
      'src/components/charts/UPlotStreamChart.tsx',
      'src/components/InteractiveRouteMap.tsx',
      'src/components/DataSourcesModal.tsx',
      'src/components/BrandSystemInteractiveSections.tsx',
      'src/components/FitnessHealthView.tsx',
    ];

    for (const rel of cleanedComponents) {
      const lines = readSrc(rel).split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(
          /(?:^|[\s'"`])(text-(?:emerald|amber|sky|indigo|orange|purple)-400)\b/
        );
        if (m) {
          expect(
            line,
            `${rel}:${i + 1} has bare ${m[1]} without dark: prefix`
          ).toContain(`dark:${m[1]}`);
        }
      }
    }
  });
});
