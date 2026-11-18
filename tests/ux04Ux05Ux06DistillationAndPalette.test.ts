import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readComponent(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('UX-04, UX-05 & UX-06 Simplification, Deduplication & Palette Compliance', () => {
  it('UX-04: replaces academic/internal jargon with plain-English UI copy across Track, Stopwatch, Header & Teams', () => {
    const progPanel = readComponent('src/components/track/TrackProgressionAndCalibrationPanel.tsx');
    expect(progPanel).toContain('Outlier Review');
    expect(progPanel).toContain('Estimated Critical Speed');
    expect(progPanel).toContain('Recommended Threshold Pace');
    expect(progPanel).toContain('Update Pace Zones');
    expect(progPanel).toContain('Pace Calibration &amp; Flagged Workouts');
    expect(progPanel).not.toContain('Posterior Threshold Pace');
    expect(progPanel).not.toContain('>Apply Posterior<');

    const stopwatch = readComponent('src/components/TracksideStopwatchView.tsx');
    expect(stopwatch).toContain('Saved on Device (Offline Ready)');
    expect(stopwatch).toContain('Heat + Humidity Alert (Hadley Index');
    expect(stopwatch).toContain('Finish Order Queue');
    expect(stopwatch).not.toContain('Offline-Safe IndexedDB / Local');
    expect(stopwatch).not.toContain('FIFO Queue');

    const header = readComponent('src/components/CockpitHeader.tsx');
    expect(header).toContain("effectiveAthleteProfile.primarySport === 'Running'");
    expect(header).toContain('Profile, Thresholds &amp; Zones');
    expect(header).not.toContain('Trackside Split Stopwatch (0.01s)');

    const teamPanel = readComponent('src/components/TeamManagementPanel.tsx');
    expect(teamPanel).not.toContain('Branded Invites (Resend)');
    expect(teamPanel).not.toContain('· Resend ✓');
  });

  it('UX-04 & UX-05: gates scholastic check-in copy by context, defaults calendar wellness off, and uses sport-aware Calendar presets', () => {
    const fitnessView = readComponent('src/components/FitnessHealthView.tsx');
    expect(fitnessView).toContain('isStudentContext');
    expect(fitnessView).toContain('Life / Work Stress');
    expect(fitnessView).toContain('School / Exam Stress');
    expect(fitnessView).not.toContain('DualAthleteComparator');
    expect(fitnessView).not.toContain('AthletePerformanceRadar');
    expect(fitnessView).not.toContain('Split View');
    expect(fitnessView).toContain('<UPlotPMCDashboard');

    const calendarView = readComponent('src/components/CalendarView.tsx');
    expect(calendarView).toContain('const [showCellWellness, setShowCellWellness] = useState<boolean>(false)');
    expect(calendarView).toContain('Daily Wellness (HRV / Sleep)');
    expect(calendarView).toContain('calendar-open-block-builder');
    expect(calendarView).toContain('<VisualWorkoutBuilder');

    const visualBuilder = readComponent('src/components/VisualWorkoutBuilder.tsx');
    expect(visualBuilder).toContain("builderSport === 'Running'");
    expect(visualBuilder).toContain('Track 800m / Mile (6x400m)');
  });

  it('UX-06: deduplicates Roster stopwatch, organizes Activity Inspector into 3 clean tabs with 1 HR zone chart, and wires real Lab AI coach prompt', () => {
    const rosterModal = readComponent('src/components/AthleteRosterModal.tsx');
    expect(rosterModal).toContain('roster-open-stopwatch-btn');
    expect(rosterModal).toContain('Teammate (View Only)');
    expect(rosterModal).not.toContain('renderTracksideSplitPad');
    expect(rosterModal).not.toContain('TRACKSIDE_PAD');
    expect(rosterModal).not.toContain('<code className="ap-text-brand">FRIEND_VIEW</code>');

    const activitiesView = readComponent('src/components/ActivitiesView.tsx');
    expect(activitiesView).toContain('activity-inspector-tabs');
    expect(activitiesView).toContain("useState<'SUMMARY' | 'STREAMS' | 'SPLITS_ZONES'>");
    expect(activitiesView).toContain("label: 'Streams & Map'");
    expect(activitiesView).toContain("label: 'Splits & Zones'");
    expect(activitiesView).not.toContain('Solid Bar = Actual Time in Zone');

    const physiologyView = readComponent('src/components/PhysiologyView.tsx');
    expect(physiologyView).not.toContain('NOOP_COACH_PROMPT');

    const router = readComponent('src/components/WorkspaceRouter.tsx');
    expect(router).toContain('ap-nav-volt-active');
    expect(router).toContain('onOpenCoachWithPrompt={handleOpenCoachWithPrompt}');
  });

  it('UX-06: passes Impeccable DESIGN.md color detector with 0 off-palette chart or map hexes', () => {
    const detectorPath =
      '/Users/elliottally/.gemini/config/plugins/impeccable/skills/impeccable/scripts/detect.mjs';
    if (!fs.existsSync(detectorPath)) {
      return;
    }
    const output = execFileSync(
      'node',
      [detectorPath, path.join(ROOT, 'src/components')],
      { encoding: 'utf8' }
    );
    expect(output).not.toMatch(/anti-patterns found/i);
  });
});
