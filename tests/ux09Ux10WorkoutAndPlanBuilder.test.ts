import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
  ENDURANCE_PLAN_ARCHETYPES,
  generateEnduranceTrainingPlan,
  resolvePlanStartMondayIso,
} from '../src/physiology/cyclingPrescriptionEngine';
import { generatePeriodizedTrackPlan } from '../src/physiology/trackPrescriptionEngine';
import { buildTrackSpeedReserveProfile } from '../src/physiology/trackSpeedReserveEngine';
import { buildErgWorkoutText, buildZwoWorkoutXml } from '../src/utils/workoutExportActions';

const ROOT = process.cwd();

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('UX-09 & UX-10 · Visual Workout Builder, Export Actions & 15-Plan Periodization Engine', () => {
  it('generates distinct sessions across all 7 Cycling archetypes with Indoor FTP cap, 80/20 Polarized split, and >=40% Race-Week Taper', () => {
    const cyclingArchetypes = ENDURANCE_PLAN_ARCHETYPES.filter((a) => a.category === 'CYCLING');
    expect(cyclingArchetypes).toHaveLength(7);

    const week2Titles = new Set<string>();

    for (const arch of cyclingArchetypes) {
      const weeks = generateEnduranceTrainingPlan({
        archetypeId: arch.id,
        startDateIso: '2026-11-23',
        blockWeeks: arch.defaultWeeks,
        selectedWeekdays: [1, 2, 3, 5, 6],
        longDayOffset: 6,
        currentCtl: 58,
        distanceUnit: 'mi',
        athleteProfile: {
          id: 'test-cyc',
          name: 'Test Rider',
          ftp: 300,
          indoorFtp: 270,
          lthr: 172,
          runLthr: 174,
          thresholdPaceSecsPerKm: 255,
          swimCssSecsPer100m: 98,
          weightKg: 70,
          restingHr: 48,
          maxHr: 190,
        } as any,
      });

      expect(weeks).toHaveLength(arch.defaultWeeks);
      week2Titles.add(weeks[1].sessions.map((s) => s.name).join(' | '));

      // Race-Week Taper verification (>= 40% TSS drop from peak non-taper build week)
      const peakBuildTss = Math.max(...weeks.slice(0, -1).map((w) => w.targetTss));
      const raceWeekTss = weeks[weeks.length - 1].targetTss;
      expect(weeks[weeks.length - 1].isTaper).toBe(true);
      expect(raceWeekTss).toBeLessThanOrEqual(peakBuildTss * 0.6);

      if (arch.id === 'CYC_TIME_CRUNCHED_INDOOR') {
        const allText = weeks.flatMap((w) => w.sessions.map((s) => `${s.name} ${s.description}`)).join('\n');
        expect(allText).toContain('270W'); // Uses indoorFtp instead of 300W outdoor FTP
        for (const wk of weeks) {
          for (const sess of wk.sessions) {
            const dow = new Date(`${sess.date}T00:00:00Z`).getUTCDay() || 7;
            if (dow <= 5) {
              expect(sess.plannedDurationSecs).toBeLessThanOrEqual(3600);
            }
          }
        }
      }

      if (arch.id === 'CYC_POLARIZED_BASE') {
        for (const wk of weeks.slice(0, -1)) {
          const z1PlusZ2 = wk.zoneDistributionPct[0] + wk.zoneDistributionPct[1];
          expect(z1PlusZ2).toBeGreaterThanOrEqual(75);
        }
      }

      if (arch.id === 'CYC_GRAVEL_FONDO') {
        expect(weeks[weeks.length - 2].isTaper).toBe(true);
        expect(weeks[weeks.length - 1].isTaper).toBe(true);
      }
    }

    expect(week2Titles.size).toBe(7);
  });

  it('generates all 4 Road Running archetypes with zero % FTP leaks and 2-week Marathon taper', () => {
    const roadArchetypes = ENDURANCE_PLAN_ARCHETYPES.filter((a) => a.category === 'ROAD');
    expect(roadArchetypes).toHaveLength(4);

    for (const arch of roadArchetypes) {
      const weeks = generateEnduranceTrainingPlan({
        archetypeId: arch.id,
        startDateIso: '2026-11-23',
        blockWeeks: arch.defaultWeeks,
        selectedWeekdays: [1, 2, 4, 6],
        longDayOffset: 6,
        currentCtl: 48,
        distanceUnit: 'mi',
      });

      const peakBuildTss = Math.max(...weeks.slice(0, -1).map((w) => w.targetTss));
      const raceWeekTss = weeks[weeks.length - 1].targetTss;
      expect(raceWeekTss).toBeLessThanOrEqual(peakBuildTss * 0.6);

      if (arch.id === 'ROAD_MARATHON') {
        expect(weeks[weeks.length - 2].isTaper).toBe(true);
        expect(weeks[weeks.length - 1].isTaper).toBe(true);
      }

      for (const wk of weeks) {
        for (const sess of wk.sessions) {
          expect(sess.sportCategory).toBe('Running');
          expect(sess.workoutSyntax).not.toMatch(/%\s*FTP|\bFTP\b/i);
          expect(sess.description).not.toMatch(/%\s*FTP|\bFTP\b/i);
          expect(sess.name).not.toMatch(/%\s*FTP|\bFTP\b/i);
        }
      }
    }
  });

  it('resolves Next Monday / This Week / Race Date start anchors and binds custom weekdays cleanly for Track plans', () => {
    expect(
      resolvePlanStartMondayIso({
        anchorMode: 'THIS_WEEK',
        todayIso: '2026-11-18', // Wednesday
        blockWeeks: 8,
      })
    ).toBe('2026-11-16');

    expect(
      resolvePlanStartMondayIso({
        anchorMode: 'NEXT_MONDAY',
        todayIso: '2026-11-18', // Wednesday
        blockWeeks: 8,
      })
    ).toBe('2026-11-23');

    const raceAnchoredStart = resolvePlanStartMondayIso({
      anchorMode: 'RACE_DATE',
      todayIso: '2026-11-18',
      targetRaceDateIso: '2027-02-14', // Sunday of race week
      blockWeeks: 8,
    });
    // Race week starts Monday 2027-02-08; 7 weeks earlier is 2026-12-21
    expect(raceAnchoredStart).toBe('2026-12-21');

    const trackProfile = buildTrackSpeedReserveProfile({
      marks: [{ distanceMeters: 1609.34, durationSecs: 245, eventLabel: '1 Mile', dateIso: '2026-11-10' }],
    });
    const customTrackPlan = generatePeriodizedTrackPlan({
      startDateIso: '2026-11-23',
      blockWeeks: 4,
      eventGroup: '1500_MILE',
      dateProfile: trackProfile,
      selectedWeekdays: [0, 2, 3, 5, 6], // Mon, Wed, Thu, Sat, Sun (5 days)
      longDayOffset: 5, // Saturday long run
    });

    expect(customTrackPlan.weeks[0].sessions).toHaveLength(5);
    expect(customTrackPlan.weeks[0].sessions[0].date).toBe('2026-11-23'); // Monday
    expect(customTrackPlan.weeks[0].sessions.some((s) => s.date === '2026-11-28' && s.name.includes('Long'))).toBe(true);
  });

  it('builds escaped Zwift .ZWO XML and calibrated TrainerRoad .ERG files', () => {
    const zwo = buildZwoWorkoutXml({
      name: 'Thresh "A&B" <Test>',
      sport: 'Cycling',
      workoutSyntax: `- 10m 55% FTP Warmup\nMain Set 3x\n- 6m 95% FTP Threshold\n- 3m 50% FTP Recovery\n- 10m 52% FTP Cooldown`,
      ftpWatts: 280,
      dateIso: '2026-11-24',
    });

    expect(zwo).toContain('<sportType>bike</sportType>');
    expect(zwo).toContain('Thresh &quot;A&amp;B&quot; &lt;Test&gt;');
    expect(zwo).toContain('<Warmup Duration="600"');
    expect(zwo).toContain('<SteadyState Duration="360" Power="0.95" />');
    expect(zwo).toContain('<Cooldown Duration="600"');

    const erg = buildErgWorkoutText({
      name: 'Sweet Spot 4x8',
      sport: 'Cycling',
      workoutSyntax: `- 10m 50% FTP Warmup\n- 8m 90% FTP Work`,
      ftpWatts: 300,
      dateIso: '2026-11-24',
    });

    expect(erg).toContain('FTP = 300');
    expect(erg).toContain('0.00\t150');
    expect(erg).toContain('10.00\t270');
    expect(erg).toContain('18.00\t270');
  });

  it('wires in-place update/undo hooks across CalendarView & GoalsView and passes Impeccable audit with 0 anti-patterns', () => {
    const goalsSrc = readSrc('src/components/GoalsView.tsx');
    expect(goalsSrc).toContain('plan-mode-goal-block');
    expect(goalsSrc).toContain('plan-mode-single-workout');
    expect(goalsSrc).toContain('goals-undo-populated-block');
    expect(goalsSrc).toContain('goals-session-skyline-');
    expect(goalsSrc).toContain('<VisualWorkoutBuilder');

    const calendarSrc = readSrc('src/components/CalendarView.tsx');
    expect(calendarSrc).toContain('calendar-edit-planned-workout');
    expect(calendarSrc).toContain('calendar-clear-plan-block');
    expect(calendarSrc).toContain('calendar-export-zwo');
    expect(calendarSrc).toContain('onUpdatePlannedEvent');

    const detectorOut = execFileSync(
      'node',
      [
        '/Users/elliottally/.gemini/config/plugins/impeccable/skills/impeccable/scripts/detect.mjs',
        'src/components',
      ],
      { encoding: 'utf8' }
    );
    expect(detectorOut).not.toMatch(/anti-patterns found/i);
  });
});
