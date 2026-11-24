import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSampleDemoCoachSquad } from '../src/data/sampleDemoData';
import {
  computeGearClosetSummaries,
  doesActivityMatchGear,
  readSavedActivityQuickLogs,
} from '../src/utils/gearClosetUtils';
import { VisualWorkoutBuilder } from '../src/components/VisualWorkoutBuilder';
import { ShoeSpikeClosetSection } from '../src/components/goals/ShoeSpikeClosetSection';
import { DistrictAdOverviewModal } from '../src/components/coach/DistrictAdOverviewModal';
import {
  buildMultiDayClearanceCsv,
  AthleticTrainerInjuryHub,
} from '../src/components/coach/AthleticTrainerInjuryHub';
import {
  TeamBrandingStudioForm,
  isAllowedRasterCrestFile,
  sanitizeCrestPreviewDataUrl,
} from '../src/components/team/TeamBrandingStudioForm';
import { openPrintableMeetDayPacketWindow } from '../src/physiology/meetDayOpsEngine';
import {
  buildClientDistrictOverviewFromTeams,
  openPrintableDistrictAdSummaryWindow,
} from '../src/utils/districtAdOverviewHelper';
import { computeAccessibleTeamPalette } from '../src/physiology/teamOnboardingEngine';
import { resolveBillingCheckoutActivation } from '../src/hooks/useBillingReturnNotice';
import { STORAGE_KEYS } from '../src/utils/storageKeys';
import type {
  AthleteGearItem,
  TeamSummaryWithRole,
  UnifiedActivity,
  WorkoutQuickLog,
} from '../src/types';

const ROOT = process.cwd();

function makeActivity(overrides: Partial<UnifiedActivity> = {}): UnifiedActivity {
  return {
    id: 'act-mee15-1',
    name: 'Morning Track Threshold',
    sportCategory: 'Running',
    subType: 'Track',
    environment: 'OUTDOOR',
    startDateLocal: '2026-11-22T07:30:00',
    movingTimeSecs: 2400,
    distanceMeters: 10000,
    elevationGainMeters: 15,
    trainingLoad: 68,
    avgHr: 162,
    maxHr: 178,
    efficiencyFactor: 1.54,
    firstHalfEf: 1.56,
    secondHalfEf: 1.52,
    aerobicDecouplingPct: 2.5,
    intensityFactor: 0.91,
    variabilityIndex: 1.02,
    stravaPrCount: 0,
    segmentEfforts: [],
    sourceBadges: ['Strava'],
    zoneSecs: { hr: [120, 900, 720, 540, 120, 0, 0] },
    ...overrides,
  };
}

describe('MEE-15: Post-launch P2 UI & polish sweep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('1. rolls up ActivityInspectorModal quick-log shoe selections (switch & clear) into ShoeSpikeClosetSection mileage totals', () => {
    const peg: AthleteGearItem = {
      id: 'shoe-peg',
      name: 'Pegasus 41',
      type: 'SHOE',
      distanceMeters: 16093, // 10 mi baseline
      maxRecommendedMeters: 724205,
      primary: true,
      footwearClass: 'DAILY_TRAINER',
    };
    const spike: AthleteGearItem = {
      id: 'shoe-spike',
      name: 'Dragonfly 2',
      type: 'SHOE',
      distanceMeters: 0,
      maxRecommendedMeters: 128748,
      primary: false,
      footwearClass: 'CARBON_SUPER_SPIKE',
    };

    const actWithDefaultPeg = makeActivity({
      id: 'act-shoe-swap',
      distanceMeters: 8047, // ~5 mi
      gearId: peg.id,
      gearName: peg.name,
    });

    // Quick-log override switches activity from Pegasus -> Dragonfly 2
    const switchedQuickLogs: Record<string, WorkoutQuickLog> = {
      'act-shoe-swap': {
        rpe: 7,
        feelRating: 'STRONG',
        gearId: spike.id,
        gearName: spike.name,
        loggedAt: '2026-11-22T09:00:00Z',
      },
    };
    expect(doesActivityMatchGear(actWithDefaultPeg, peg, switchedQuickLogs['act-shoe-swap'])).toBe(false);
    expect(doesActivityMatchGear(actWithDefaultPeg, spike, switchedQuickLogs['act-shoe-swap'])).toBe(true);

    const switchedSummaries = computeGearClosetSummaries(
      [peg, spike],
      [actWithDefaultPeg],
      switchedQuickLogs
    );
    expect(switchedSummaries.find((s) => s.item.id === peg.id)?.matchedActivityCount).toBe(0);
    expect(switchedSummaries.find((s) => s.item.id === spike.id)?.matchedActivityCount).toBe(1);
    expect(switchedSummaries.find((s) => s.item.id === spike.id)?.totalMeters).toBe(8047);

    // Clearing the shoe picker sets gearId: '', gearName: '' -> removes from all shoes
    const clearedQuickLogs: Record<string, WorkoutQuickLog> = {
      'act-shoe-swap': {
        rpe: 6,
        feelRating: 'NORMAL',
        gearId: '',
        gearName: '',
        loggedAt: '2026-11-22T09:05:00Z',
      },
    };
    const clearedSummaries = computeGearClosetSummaries(
      [peg, spike],
      [actWithDefaultPeg],
      clearedQuickLogs
    );
    expect(clearedSummaries.every((s) => s.matchedActivityCount === 0)).toBe(true);

    // ShoeSpikeClosetSection picks up localStorage quick logs automatically
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k: string) =>
        k === STORAGE_KEYS.QUICK_LOGS ? JSON.stringify(switchedQuickLogs) : null
      ),
    });
    expect(Object.keys(readSavedActivityQuickLogs())).toEqual(['act-shoe-swap']);

    const closetHtml = renderToStaticMarkup(
      React.createElement(ShoeSpikeClosetSection, {
        gearItems: [peg, spike],
        activities: [actWithDefaultPeg],
        distanceUnit: 'mi',
        onSaveGearItems: () => {},
      })
    );
    expect(closetHtml).toContain('Base 0.0 mi + 5.0 mi (1 logged)');
  });

  it('2. renders Save to Library inside VisualWorkoutBuilder for staff coaches and hides it for athletes', () => {
    const squad = buildSampleDemoCoachSquad('2026-11-22');

    const coachHtml = renderToStaticMarkup(
      React.createElement(VisualWorkoutBuilder, {
        dateIso: '2026-11-23',
        defaultSport: 'Running',
        distanceUnit: 'mi',
        activeTeam: squad,
        onSave: () => {},
      })
    );
    expect(coachHtml).toContain('data-testid="visual-builder-save-library-btn"');
    expect(coachHtml).toContain('Save to Library');

    const athleteTeam: TeamSummaryWithRole = { ...squad, myRole: 'ATHLETE' };
    const athleteHtml = renderToStaticMarkup(
      React.createElement(VisualWorkoutBuilder, {
        dateIso: '2026-11-23',
        defaultSport: 'Running',
        distanceUnit: 'mi',
        activeTeam: athleteTeam,
        onSave: () => {},
      })
    );
    expect(athleteHtml).not.toContain('data-testid="visual-builder-save-library-btn"');
  });

  it('3a. removes all lingering py-0.2 utility classes across src/', () => {
    const matches: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) {
          if (fs.readFileSync(full, 'utf8').includes('py-0.2')) {
            matches.push(path.relative(ROOT, full));
          }
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(matches).toEqual([]);
  });

  it('3b. falls back to offline Blob .html download when print popups are blocked in meetDayOpsEngine & districtAdOverviewHelper', () => {
    const createdBlobs: Array<{ parts: BlobPart[]; type: string }> = [];
    const anchors: Array<{ href: string; download: string; clicked: boolean; removed: boolean }> = [];

    class MockBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        createdBlobs.push({ parts, type: options?.type ?? '' });
      }
    }

    vi.stubGlobal('window', { open: vi.fn(() => null) });
    vi.stubGlobal('Blob', MockBlob);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-offline-html'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => {
        const rec = { href: '', download: '', clicked: false, removed: false };
        anchors.push(rec);
        return {
          set href(v: string) {
            rec.href = v;
          },
          set download(v: string) {
            rec.download = v;
          },
          style: { display: '' },
          click: () => {
            rec.clicked = true;
          },
          remove: () => {
            rec.removed = true;
          },
        };
      }),
    });

    const meetOk = openPrintableMeetDayPacketWindow({
      teamName: 'Willow Glen HS XC',
      meetTitle: 'CCS Finals',
      entries: [],
    });
    expect(meetOk).toBe(false);

    const squad = buildSampleDemoCoachSquad('2026-11-22');
    const report = buildClientDistrictOverviewFromTeams([squad], { todayIso: '2026-11-22' });
    const adOk = openPrintableDistrictAdSummaryWindow(report);
    expect(adOk).toBe(false);

    expect(createdBlobs).toHaveLength(2);
    expect(createdBlobs[0].type).toBe('text/html;charset=utf-8');
    expect(createdBlobs[1].type).toBe('text/html;charset=utf-8');
    expect(anchors).toHaveLength(2);
    expect(anchors[0].download).toBe('ccs-finals.html');
    expect(anchors[1].download).toContain('ad-summary');
    expect(anchors.every((a) => a.clicked && a.removed)).toBe(true);

    const modalHtml = renderToStaticMarkup(
      React.createElement(DistrictAdOverviewModal, {
        isOpen: true,
        onClose: () => {},
        myTeams: [squad],
        activeTeamId: squad.brand.teamId,
        isSampleDemoMode: true,
        onSelectActiveTeam: () => {},
      })
    );
    expect(modalHtml).toContain('data-testid="district-print-summary-btn"');
  });

  it('3c. blocks SVG crest uploads and SVG data URL previews in TeamBrandingStudioForm', () => {
    expect(isAllowedRasterCrestFile({ type: 'image/svg+xml', name: 'crest.svg' })).toBe(false);
    expect(isAllowedRasterCrestFile({ type: '', name: 'crest.SVG' })).toBe(false);
    expect(isAllowedRasterCrestFile({ type: 'image/png', name: 'crest.png' })).toBe(true);
    expect(isAllowedRasterCrestFile({ type: 'image/webp', name: 'crest.webp' })).toBe(true);

    expect(sanitizeCrestPreviewDataUrl('data:image/svg+xml,<svg/>')).toBeUndefined();
    expect(sanitizeCrestPreviewDataUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBeUndefined();
    const validPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    expect(sanitizeCrestPreviewDataUrl(validPng)).toBe(validPng);

    const squad = buildSampleDemoCoachSquad('2026-11-22');
    const palette = computeAccessibleTeamPalette(squad.brand.primaryHex, squad.brand.secondaryHex);
    const svgCrest = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+';
    const html = renderToStaticMarkup(
      React.createElement(TeamBrandingStudioForm, {
        formId: 'svg-block-test',
        studioMode: 'EDIT',
        activeTeamName: squad.brand.name,
        orgType: 'HIGH_SCHOOL',
        onOrgTypeChange: () => {},
        teamName: squad.brand.name,
        setTeamName: () => {},
        shortName: squad.brand.shortName,
        setShortName: () => {},
        derivedShortName: 'WGHS',
        districtName: '',
        setDistrictName: () => {},
        coachDisplayName: 'Coach',
        setCoachDisplayName: () => {},
        primaryHex: squad.brand.primaryHex,
        setPrimaryHex: () => {},
        secondaryHex: squad.brand.secondaryHex,
        setSecondaryHex: () => {},
        logoDataUrl: svgCrest,
        setLogoDataUrl: () => {},
        defaultSafeSportShield: true,
        setDefaultSafeSportShield: () => {},
        enableParentGuardianCc: true,
        setEnableParentGuardianCc: () => {},
        showAdvancedBranding: true,
        setShowAdvancedBranding: () => {},
        isSavingStudio: false,
        previewBrand: { ...squad.brand, logoDataUrl: svgCrest },
        livePalette: palette,
        lightRatio: '5.5',
        darkRatio: '4.6',
        onSubmit: () => {},
        onCancel: () => {},
        onErrorMessage: () => {},
      })
    );
    expect(html).not.toContain('image/svg+xml');
    expect(html).not.toContain('PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+');
  });

  it('4a. matches exact checkout teamId during ?billing=success polling for multi-school District ADs', () => {
    const baseSquad = buildSampleDemoCoachSquad('2026-11-22');
    const schoolA: TeamSummaryWithRole = {
      ...baseSquad,
      brand: { ...baseSquad.brand, teamId: 'team_school_a', name: 'School A Track' },
      billing: { planCode: 'HS_250', status: 'ACTIVE_PAID' },
    };
    const schoolB: TeamSummaryWithRole = {
      ...baseSquad,
      brand: { ...baseSquad.brand, teamId: 'team_school_b', name: 'School B Track' },
      billing: { planCode: 'FREE_FOUNDING', status: 'PILOT' },
    };

    // When targetTeamId is School B (still PILOT), School A being ACTIVE_PAID must NOT short-circuit
    const pendingB = resolveBillingCheckoutActivation([schoolA, schoolB], 'team_school_b');
    expect(pendingB.activated).toBe(false);
    expect(pendingB.matchedTeam?.brand.teamId).toBe('team_school_b');

    // Once School B transitions to ACTIVE_PAID, exact match returns activated: true
    const paidSchoolB: TeamSummaryWithRole = {
      ...schoolB,
      billing: { planCode: 'HS_250', status: 'ACTIVE_PAID' },
    };
    const activeB = resolveBillingCheckoutActivation([schoolA, paidSchoolB], 'team_school_b');
    expect(activeB.activated).toBe(true);
    expect(activeB.matchedTeam?.brand.name).toBe('School B Track');
  });

  it('4b. exports multi-day AT clearance CSV with attendance join, formula safety, and zero clinical notes', () => {
    const squad = buildSampleDemoCoachSquad('2026-11-22');
    const csv = buildMultiDayClearanceCsv({
      cases: [
        {
          id: 'case-1',
          teamId: squad.brand.teamId,
          membershipId: 'demo-mem-ath-02',
          athleteName: '=CMD("evil")',
          bodyRegion: 'SHIN',
          severity: 'MODERATE',
          rtpStage: 'MODIFIED',
          restrictions: 'No track spikes',
          coachGuidance: '35m pool flush',
          privateClinicalNotes: 'CONFIDENTIAL_AT_PALPATION_DO_NOT_EXPORT',
          createdAt: '2026-11-20T14:00:00Z',
          updatedAt: '2026-11-22T15:00:00Z',
          updatedByName: 'AT Rivera',
        },
      ],
      teamName: 'WGHS XC',
      endDateIso: '2026-11-22',
      windowDays: 3,
      attendanceByDate: {
        '2026-11-20': {
          'demo-mem-ath-02': {
            date: '2026-11-20',
            membershipId: 'demo-mem-ath-02',
            status: 'EXCUSED',
            updatedAt: '2026-11-20T15:00:00Z',
          },
        },
        '2026-11-21': {
          'demo-mem-ath-02': {
            date: '2026-11-21',
            membershipId: 'demo-mem-ath-02',
            status: 'INJURED_MODIFIED',
            updatedAt: '2026-11-21T15:00:00Z',
          },
        },
        '2026-11-22': {
          'demo-mem-ath-02': {
            date: '2026-11-22',
            membershipId: 'demo-mem-ath-02',
            status: 'INJURED_MODIFIED',
            updatedAt: '2026-11-22T15:00:00Z',
          },
        },
      },
    });

    const lines = csv.split('\n');
    expect(lines).toHaveLength(4); // header + 3 days (Nov 20, 21, 22)
    expect(lines[0]).toContain('"Attendance Status"');
    expect(lines[1]).toContain('"2026-11-20"');
    expect(lines[1]).toContain('"EXCUSED"');
    expect(lines[2]).toContain('"2026-11-21"');
    expect(lines[3]).toContain('"2026-11-22"');
    expect(csv).toContain("'=CMD");
    expect(csv).not.toContain('CONFIDENTIAL_AT_PALPATION_DO_NOT_EXPORT');

    const hubHtml = renderToStaticMarkup(
      React.createElement(AthleticTrainerInjuryHub, {
        isOpen: true,
        inline: true,
        onClose: () => {},
        activeTeam: squad,
        myTeams: [squad],
        isSampleDemoMode: true,
        onTeamsUpdated: () => {},
      })
    );
    expect(hubHtml).toContain('data-testid="injury-hub-clearance-range-select"');
    expect(hubHtml).toContain('7-Day Log');
    expect(hubHtml).toContain('30-Day Log');
  });
});
