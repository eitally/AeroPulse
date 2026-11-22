import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  CalendarPlus,
  Check,
  Copy,
  Download,
  Footprints,
  Moon,
  ShareNetwork,
  Sparkles,
  Sun,
  Timer,
} from './icons/PhosphorIcons';
import { AeroPulseLogo } from './AeroPulseLogo';
import type { DistanceUnit } from '../types';
import {
  buildShareWorkoutUrl,
  computeSharedWorkoutPreview,
  downloadShareCardPng,
  formatMmSs,
  stashPendingSharedWorkout,
  type SharedWorkoutPayload,
} from '../utils/shareWorkoutEngine';
import {
  exportWorkoutAsErg,
  exportWorkoutAsFit,
  exportWorkoutAsZwo,
} from '../utils/workoutExportActions';

export interface ShareWorkoutPageProps {
  sharedWorkout: SharedWorkoutPayload | null;
  isDark: boolean;
  onToggleDark: () => void;
  hasActiveWorkspace: boolean;
  initialFtpWatts?: number;
  initialThresholdPaceSecsPerKm?: number;
  initialUnit?: DistanceUnit;
  onImportToWorkspace: (
    payload: SharedWorkoutPayload,
    ftpWatts: number,
    thresholdPaceSecsPerKm: number,
    unit: DistanceUnit
  ) => Promise<void> | void;
  onExitToSignIn: () => void;
  onExitToWorkspace: () => void;
}

function parsePaceStringToSecsPerKm(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [mStr, sStr] = trimmed.split(':');
    const mins = Number(mStr);
    const secs = Number(sStr);
    if (secs >= 0 && secs < 60) {
      const total = mins * 60 + secs;
      if (total >= 120 && total <= 540) return total;
    }
    return null;
  }
  const num = Number(trimmed);
  if (Number.isFinite(num) && num >= 120 && num <= 540) {
    return Math.round(num);
  }
  return null;
}

export const ShareWorkoutPage: React.FC<ShareWorkoutPageProps> = ({
  sharedWorkout,
  isDark,
  onToggleDark,
  hasActiveWorkspace,
  initialFtpWatts,
  initialThresholdPaceSecsPerKm,
  initialUnit,
  onImportToWorkspace,
  onExitToSignIn,
  onExitToWorkspace,
}) => {
  const [ftpWatts, setFtpWatts] = useState<number>(
    Math.round(sharedWorkout?.referenceFtpWatts || initialFtpWatts || 260)
  );
  const defaultPaceSecs = Math.round(
    sharedWorkout?.referenceThresholdPaceSecsPerKm || initialThresholdPaceSecsPerKm || 245
  );
  const [thresholdPaceSecsPerKm, setThresholdPaceSecsPerKm] = useState<number>(defaultPaceSecs);
  const [paceInput, setPaceInput] = useState<string>(() => formatMmSs(defaultPaceSecs));
  const [unit, setUnit] = useState<DistanceUnit>(
    sharedWorkout?.defaultUnit || initialUnit || 'mi'
  );
  const [copiedLink, setCopiedLink] = useState(false);
  const [isDownloadingPng, setIsDownloadingPng] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!sharedWorkout) return null;
    return computeSharedWorkoutPreview({
      payload: sharedWorkout,
      ftpWatts,
      thresholdPaceSecsPerKm,
      unit,
    });
  }, [sharedWorkout, ftpWatts, thresholdPaceSecsPerKm, unit]);

  const shareUrl = useMemo(
    () => (sharedWorkout ? buildShareWorkoutUrl(sharedWorkout) : ''),
    [sharedWorkout]
  );

  const handlePaceTextChange = (val: string) => {
    setPaceInput(val);
    const parsed = parsePaceStringToSecsPerKm(val);
    if (parsed !== null) {
      setThresholdPaceSecsPerKm(parsed);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedLink(true);
    setStatusNotice('Share link copied to clipboard.');
    window.setTimeout(() => setCopiedLink(false), 2400);
  };

  const handleDownloadPng = async () => {
    if (!sharedWorkout) return;
    setIsDownloadingPng(true);
    try {
      const ok = await downloadShareCardPng({
        payload: sharedWorkout,
        ftpWatts,
        thresholdPaceSecsPerKm,
        unit,
      });
      setStatusNotice(
        ok
          ? 'Downloaded 1080×1350 Clean-Room PNG card.'
          : 'PNG export is not available in this environment.'
      );
    } finally {
      setIsDownloadingPng(false);
    }
  };

  const handleAddToCalendar = async () => {
    if (!sharedWorkout) return;
    if (hasActiveWorkspace) {
      setIsImporting(true);
      try {
        await onImportToWorkspace(sharedWorkout, ftpWatts, thresholdPaceSecsPerKm, unit);
      } finally {
        setIsImporting(false);
      }
      return;
    }
    stashPendingSharedWorkout({
      ...sharedWorkout,
      defaultUnit: unit,
      referenceFtpWatts: ftpWatts,
      referenceThresholdPaceSecsPerKm: thresholdPaceSecsPerKm,
    });
    onExitToSignIn();
  };

  const handleExportFit = () => {
    if (!sharedWorkout?.workoutSyntax) return;
    exportWorkoutAsFit({
      name: sharedWorkout.title,
      sport: sharedWorkout.sport,
      workoutSyntax: sharedWorkout.workoutSyntax,
      ftpWatts,
      lthrBpm: 168,
      thresholdPaceSecsPerKm,
      dateIso: sharedWorkout.date,
    });
    setStatusNotice(`Downloaded Garmin .FIT calibrated to ${sharedWorkout.sport === 'Cycling' ? `${ftpWatts}W FTP` : `${formatMmSs(thresholdPaceSecsPerKm)}/km`}.`);
  };

  const handleExportZwo = () => {
    if (!sharedWorkout?.workoutSyntax) return;
    exportWorkoutAsZwo({
      name: sharedWorkout.title,
      sport: sharedWorkout.sport,
      workoutSyntax: sharedWorkout.workoutSyntax,
      description: sharedWorkout.description || sharedWorkout.title,
      ftpWatts,
      thresholdPaceSecsPerKm,
      dateIso: sharedWorkout.date,
    });
    setStatusNotice('Downloaded Zwift .ZWO workout file.');
  };

  const handleExportErg = () => {
    if (!sharedWorkout?.workoutSyntax) return;
    exportWorkoutAsErg({
      name: sharedWorkout.title,
      sport: sharedWorkout.sport,
      workoutSyntax: sharedWorkout.workoutSyntax,
      ftpWatts,
      thresholdPaceSecsPerKm,
      dateIso: sharedWorkout.date,
    });
    setStatusNotice(`Downloaded .ERG file scaled to ${ftpWatts}W FTP.`);
  };

  return (
    <div className="min-h-screen ap-page text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-ap-frame/20 dark:border-white/10 bg-white dark:bg-[#0D110F]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AeroPulseLogo size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-mono font-bold uppercase tracking-wider bg-ap-cobalt/10 text-ap-cobalt dark:bg-ap-volt/15 dark:text-ap-volt">
                  {sharedWorkout?.kind === 'STOPWATCH' ? '#stopwatch splits' : 'Workout Share'}
                </span>
              </div>
              <p className="text-2xs text-slate-600 dark:text-slate-400 truncate">
                Dial splits to your PR · Save or share
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              data-testid="share-theme-toggle"
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl ap-card-inset text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={hasActiveWorkspace ? onExitToWorkspace : onExitToSignIn}
              data-testid="share-back-btn"
              className="min-h-[44px] px-3.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{hasActiveWorkspace ? 'Back to Workspace' : 'Open MeetReady'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        {!sharedWorkout || !preview ? (
          <section className="ap-card rounded-2xl p-6 sm:p-8 text-center space-y-4">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Shared Workout Link Incomplete
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto">
              This share URL does not contain a valid Clean-Room workout payload. Ask your coach or teammate for an updated link.
            </p>
            <div>
              <button
                type="button"
                onClick={hasActiveWorkspace ? onExitToWorkspace : onExitToSignIn}
                className="min-h-[44px] px-5 py-2 rounded-xl ap-btn-primary text-xs font-semibold cursor-pointer"
              >
                Return to MeetReady
              </button>
            </div>
          </section>
        ) : (
          <>
            {/* Hero Summary & Viral Import CTA */}
            <section
              data-testid="share-workout-hero"
              className="ap-card rounded-2xl p-5 sm:p-6 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-mono font-bold bg-ap-cobalt text-white dark:bg-ap-volt dark:text-ap-obsidian">
                      {sharedWorkout.sport === 'Cycling' ? (
                        <Bike className="w-3.5 h-3.5" />
                      ) : sharedWorkout.kind === 'STOPWATCH' ? (
                        <Timer className="w-3.5 h-3.5" />
                      ) : (
                        <Footprints className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {sharedWorkout.kind === 'STOPWATCH'
                          ? '#STOPWATCH CARD'
                          : sharedWorkout.sport.toUpperCase()}
                      </span>
                    </span>
                    {sharedWorkout.teamName && (
                      <span className="px-2.5 py-1 rounded-full text-2xs font-semibold bg-stone-100 dark:bg-white/10 text-slate-700 dark:text-slate-200">
                        {sharedWorkout.teamName}
                      </span>
                    )}
                    {sharedWorkout.date && (
                      <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                        {sharedWorkout.date}
                      </span>
                    )}
                  </div>

                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
                    {sharedWorkout.title}
                  </h1>

                  {(sharedWorkout.description || sharedWorkout.authorLabel) && (
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                      {sharedWorkout.description}
                      {sharedWorkout.authorLabel ? ` — Shared by ${sharedWorkout.authorLabel}` : ''}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap sm:flex-col items-stretch sm:items-end gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="share-add-to-calendar-btn"
                    disabled={isImporting}
                    onClick={handleAddToCalendar}
                    className="min-h-[44px] px-4 py-2 rounded-xl ap-btn-primary text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
                  >
                    <CalendarPlus className="w-4 h-4 shrink-0" />
                    <span>
                      {isImporting
                        ? 'Adding to Calendar...'
                        : hasActiveWorkspace
                          ? 'Add to My MeetReady Calendar'
                          : 'Add to My MeetReady Calendar (Free)'}
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="share-download-png-btn"
                      disabled={isDownloadingPng}
                      onClick={handleDownloadPng}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-55"
                    >
                      <ShareNetwork className="w-4 h-4" />
                      <span>{isDownloadingPng ? 'Rendering PNG...' : 'Download PNG Card'}</span>
                    </button>

                    <button
                      type="button"
                      data-testid="share-copy-link-btn"
                      onClick={handleCopyLink}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-xl ap-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedLink ? (
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {statusNotice && (
                <div
                  role="status"
                  className="rounded-xl ap-status-prime px-4 py-2.5 text-xs font-semibold"
                >
                  {statusNotice}
                </div>
              )}

              {/* Interactive Split Recalculator Bar */}
              <div className="rounded-xl ap-card-inset p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                    <Sparkles className="w-4 h-4 ap-text-brand" />
                    <span>Dial Splits to Your Threshold (Zero Sign-In Required)</span>
                  </div>
                  <div
                    role="group"
                    aria-label="Preview distance unit"
                    className="inline-flex items-center gap-1 p-0.5 rounded-lg liquid-capsule-track"
                  >
                    <button
                      type="button"
                      data-testid="share-unit-mi"
                      aria-pressed={unit === 'mi'}
                      onClick={() => setUnit('mi')}
                      className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-md text-xs font-mono font-bold cursor-pointer ${
                        unit === 'mi'
                          ? 'ap-nav-volt-active'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      mi
                    </button>
                    <button
                      type="button"
                      data-testid="share-unit-km"
                      aria-pressed={unit === 'km'}
                      onClick={() => setUnit('km')}
                      className={`min-h-[44px] sm:min-h-[34px] px-3 rounded-md text-xs font-mono font-bold cursor-pointer ${
                        unit === 'km'
                          ? 'ap-nav-volt-active'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      km
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {sharedWorkout.sport === 'Cycling' ? (
                    <div className="space-y-1">
                      <label
                        htmlFor="share-ftp-input"
                        className="block text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400"
                      >
                        Your FTP (Watts)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="share-ftp-input"
                          data-testid="share-ftp-input"
                          type="number"
                          min={80}
                          max={600}
                          value={ftpWatts}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n >= 80 && n <= 600) {
                              setFtpWatts(Math.round(n));
                            }
                          }}
                          className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#101814] px-3 text-sm font-mono font-bold tabular-nums text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => setFtpWatts((f) => Math.max(80, f - 10))}
                          className="min-h-[44px] px-3 rounded-xl ap-btn-secondary text-xs font-mono font-bold cursor-pointer"
                        >
                          -10
                        </button>
                        <button
                          type="button"
                          onClick={() => setFtpWatts((f) => Math.min(600, f + 10))}
                          className="min-h-[44px] px-3 rounded-xl ap-btn-secondary text-xs font-mono font-bold cursor-pointer"
                        >
                          +10
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label
                        htmlFor="share-pace-input"
                        className="block text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400"
                      >
                        Threshold Pace (mm:ss /km)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="share-pace-input"
                          data-testid="share-pace-input"
                          type="text"
                          value={paceInput}
                          onChange={(e) => handlePaceTextChange(e.target.value)}
                          placeholder="4:05"
                          className="w-full min-h-[44px] rounded-xl border border-stone-300 dark:border-slate-700 bg-white dark:bg-[#101814] px-3 text-sm font-mono font-bold tabular-nums text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = Math.max(130, thresholdPaceSecsPerKm - 5);
                            setThresholdPaceSecsPerKm(next);
                            setPaceInput(formatMmSs(next));
                          }}
                          className="min-h-[44px] px-3 rounded-xl ap-btn-secondary text-xs font-mono font-bold cursor-pointer"
                        >
                          Faster
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl bg-white dark:bg-[#101814] border border-stone-200 dark:border-white/10 px-3.5 py-2.5 flex flex-col justify-center">
                    <span className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      {sharedWorkout.kind === 'STOPWATCH' ? 'Logged Marks' : 'Total Duration'}
                    </span>
                    <span className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white">
                      {sharedWorkout.kind === 'STOPWATCH' && sharedWorkout.splits
                        ? `${sharedWorkout.splits.length} entries`
                        : `${Math.max(1, Math.round(preview.totalDurationSecs / 60))} min`}
                    </span>
                  </div>

                  <div className="rounded-xl bg-white dark:bg-[#101814] border border-stone-200 dark:border-white/10 px-3.5 py-2.5 flex flex-col justify-center">
                    <span className="text-2xs font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      {sharedWorkout.sport === 'Cycling' ? 'Scaled Target' : 'Estimated Load'}
                    </span>
                    <span className="text-lg font-extrabold font-mono tabular-nums ap-text-brand">
                      {sharedWorkout.kind === 'STOPWATCH'
                        ? sharedWorkout.splits?.[0]?.lapTime || '--:--'
                        : `${preview.estimatedLoad} LOAD`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Interval Structure Bar Chart + Live Recalculated Splits */}
              {sharedWorkout.kind === 'STOPWATCH' && sharedWorkout.splits ? (
                <div className="space-y-2.5" data-testid="share-stopwatch-splits">
                  <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Recorded #stopwatch Splits
                  </h2>
                  <div className="space-y-2">
                    {sharedWorkout.splits.map((row, idx) => (
                      <div
                        key={`${row.label}-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl ap-card-inset px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white">
                            {row.label}
                          </div>
                          {row.cumulativeTime && (
                            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">
                              Cumulative: {row.cumulativeTime}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 font-mono">
                          {row.paceOrPower && (
                            <span className="text-xs text-slate-600 dark:text-slate-300">
                              {row.paceOrPower}
                            </span>
                          )}
                          <span className="text-sm font-bold tabular-nums text-ap-cobalt dark:text-ap-volt">
                            {row.lapTime}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Proportional Zone Bars */}
                  <div
                    className="h-24 rounded-xl bg-slate-900 dark:bg-[#0B120E] p-3 flex items-end gap-1"
                    aria-hidden="true"
                  >
                    {preview.steps.map((st) => {
                      const pctW = Math.max(
                        4,
                        (st.durationSecs / Math.max(60, preview.totalDurationSecs)) * 100
                      );
                      const pctH = Math.max(22, Math.min(100, Math.round((st.intensityPct / 135) * 100)));
                      return (
                        <div
                          key={st.index}
                          style={{
                            width: `${pctW}%`,
                            height: `${pctH}%`,
                            backgroundColor: st.colorHex,
                          }}
                          className="rounded-t-md transition-all"
                          title={`${st.durationLabel} ${st.label} — ${st.prescribedTargetLabel}`}
                        />
                      );
                    })}
                  </div>

                  {/* Step-by-Step Split Preview */}
                  <div className="space-y-2" data-testid="share-steps-list">
                    <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      Calibrated Interval Splits
                    </h2>
                    {preview.steps.map((st) => (
                      <div
                        key={st.index}
                        data-testid={`share-step-row-${st.index}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl ap-card-inset px-3.5 py-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-2.5 h-6 rounded-full shrink-0"
                            style={{ backgroundColor: st.colorHex }}
                          />
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {st.durationLabel} · {st.label}
                            </div>
                            <div className="text-2xs font-mono text-slate-600 dark:text-slate-400">
                              {st.intensityPct}% effort
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono shrink-0">
                          <div className="text-xs sm:text-sm font-bold tabular-nums text-ap-cobalt dark:text-ap-volt">
                            {st.prescribedTargetLabel}
                          </div>
                          {st.repSplitLabel && (
                            <div className="text-2xs text-slate-600 dark:text-slate-300 tabular-nums">
                              Target rep: {st.repSplitLabel}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Direct Device Export Strip */}
              {sharedWorkout.workoutSyntax && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-stone-200 dark:border-white/10">
                  <span className="text-2xs font-mono text-slate-600 dark:text-slate-400">
                    Export calibrated workout file directly:
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="share-export-fit-btn"
                      onClick={handleExportFit}
                      className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg ap-btn-secondary text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>.FIT</span>
                    </button>
                    <button
                      type="button"
                      data-testid="share-export-zwo-btn"
                      onClick={handleExportZwo}
                      className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg ap-btn-secondary text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>.ZWO</span>
                    </button>
                    {sharedWorkout.sport === 'Cycling' && (
                      <button
                        type="button"
                        data-testid="share-export-erg-btn"
                        onClick={handleExportErg}
                        className="min-h-[44px] sm:min-h-[36px] px-3 rounded-lg ap-btn-secondary text-2xs font-mono font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>.ERG</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default ShareWorkoutPage;
