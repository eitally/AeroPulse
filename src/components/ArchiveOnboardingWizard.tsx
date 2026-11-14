import React, { useRef, useState, useCallback } from 'react';
import {
  UploadSimple,
  X,
  Footprints,
  ArrowRight,
  ArrowsLeftRight,
} from '@phosphor-icons/react';
import { useModalDialog } from '../hooks/useModalDialog';
import {
  importWorkoutFilesOrArchive,
  type ArchiveImportProgress,
  type ArchiveImportResult,
} from '../utils/archiveImporter';
import type { DistanceUnit, UnifiedActivity } from '../types';

export interface ArchiveOnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  existingActivities?: UnifiedActivity[];
  distanceUnit?: DistanceUnit;
  onImportBatch: (activities: UnifiedActivity[]) => void;
  onCompleteOnboarding?: () => void;
}

export function ArchiveOnboardingWizard({
  isOpen,
  onClose,
  existingActivities = [],
  distanceUnit = 'mi',
  onImportBatch,
  onCompleteOnboarding,
}: ArchiveOnboardingWizardProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ArchiveImportProgress | null>(null);
  const [result, setResult] = useState<ArchiveImportResult | null>(null);
  const [recentParsedActivities, setRecentParsedActivities] = useState<UnifiedActivity[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useModalDialog({
    isOpen,
    onClose,
    dialogRef,
  });

  const handleProcessFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setIsProcessing(true);
      setErrorMessage(null);
      setResult(null);
      setProgress(null);
      setRecentParsedActivities([]);

      try {
        const importResult = await importWorkoutFilesOrArchive({
          files,
          existingActivities,
          onProgress: (p) => {
            setProgress({ ...p });
          },
        });

        setResult(importResult);
        setRecentParsedActivities(importResult.importedActivities.slice(-6).reverse());

        if (importResult.importedActivities.length > 0) {
          onImportBatch(importResult.importedActivities);
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to parse one or more files in the archive. Ensure valid .fit, .gpx, or .zip files.'
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [existingActivities, onImportBatch]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      void handleProcessFiles(files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      void handleProcessFiles(files);
    }
  };

  const formatDistance = (meters: number): string => {
    if (distanceUnit === 'mi') {
      const mi = meters / 1609.344;
      return `${mi.toFixed(1)} mi`;
    }
    const km = meters / 1000;
    return `${km.toFixed(1)} km`;
  };

  const formatDuration = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const h = Math.floor(m / 60);
    if (h > 0) {
      return `${h}h ${m % 60}m`;
    }
    return `${m}m ${secs % 60}s`;
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-sm animate-fade-in"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl liquid-glass border border-slate-200/80 dark:border-white/10 shadow-2xl p-5 sm:p-7 space-y-6 focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 dark:border-white/10 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md text-2xs font-mono font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                100% Offline &amp; Zero Approval
              </span>
            </div>
            <h2
              id="archive-wizard-title"
              className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white"
            >
              Import Your Training Archive
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Bring your complete multi-year running and cycling history without waiting for Strava or Garmin API developer keys. All files are unpacked and parsed 100% client-side in your browser.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close archive wizard"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step-by-Step Direct Download Guide */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-2xl liquid-glass-subtle p-3.5 space-y-2 border border-slate-200/60 dark:border-white/5">
            <div className="font-bold ap-text-strava flex items-center justify-between">
              <span>Strava Export</span>
              <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-[#C23800]/10 border border-[#C23800]/25">
                Bulk ZIP
              </span>
            </div>
            <p className="text-2xs text-slate-600 dark:text-slate-400 leading-relaxed">
              1. Open{' '}
              <a
                href="https://www.strava.com/athlete/delete_your_account"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold ap-text-strava hover:opacity-80"
              >
                Strava Account Download ↗
              </a>
              <br />
              2. Under <em>Download an Archive</em>, click <strong>Request Your Archive</strong>.
              <br />
              3. Drop the downloaded <code className="font-mono">.zip</code> below.
            </p>
          </div>

          <div className="rounded-2xl liquid-glass-subtle p-3.5 space-y-2 border border-slate-200/60 dark:border-white/5">
            <div className="font-bold ap-text-brand flex items-center justify-between">
              <span>Garmin Connect</span>
              <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25">
                FIT ZIP
              </span>
            </div>
            <p className="text-2xs text-slate-600 dark:text-slate-400 leading-relaxed">
              1. Visit{' '}
              <a
                href="https://www.garmin.com/en-US/account/datamanagement/exportdata/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold ap-text-brand hover:opacity-80"
              >
                Garmin Data Export ↗
              </a>
              <br />
              2. Click <strong>Export Your Data</strong>.
              <br />
              3. Garmin emails a <code className="font-mono">.zip</code> of all high-resolution <code className="font-mono">.FIT</code> files.
            </p>
          </div>

          <div className="rounded-2xl liquid-glass-subtle p-3.5 space-y-2 border border-slate-200/60 dark:border-white/5">
            <div className="font-bold text-slate-900 dark:text-white flex items-center justify-between">
              <span>Direct USB Cable</span>
              <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Plug &amp; Play
              </span>
            </div>
            <p className="text-2xs text-slate-600 dark:text-slate-400 leading-relaxed">
              1. Connect Garmin / Wahoo watch or Edge computer via USB.
              <br />
              2. Navigate to folder <code className="font-mono text-2xs">GARMIN/ACTIVITY/</code>.
              <br />
              3. Drag individual <code className="font-mono">.FIT</code> files directly below.
            </p>
          </div>
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative rounded-3xl border-2 border-dashed p-6 sm:p-8 text-center transition-all cursor-pointer ${
            isDragging
              ? 'border-[#1C5436] dark:border-[#C8FF00] bg-emerald-500/10 dark:bg-[#C8FF00]/10 scale-[1.01]'
              : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 bg-slate-50/50 dark:bg-black/30'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={isProcessing}
            accept=".fit,.fit.gz,.gpx,.gpx.gz,.tcx,.tcx.gz,.zip"
            onChange={handleFileInputChange}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/30 shadow-sm">
              <UploadSimple className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                {isProcessing
                  ? 'Processing telemetry in background worker…'
                  : isDragging
                    ? 'Release to import archive'
                    : 'Drag & drop training archive (.zip, .fit, .gpx, .tcx)'}
              </div>
              <p className="text-2xs text-slate-500 dark:text-slate-400">
                Supports single files or nested multi-gigabyte bulk export ZIP archives
              </p>
            </div>
            <button
              type="button"
              disabled={isProcessing}
              className="ap-btn-secondary !min-h-[44px] px-5 py-2 text-xs font-bold pointer-events-none"
            >
              Browse Files…
            </button>
          </div>
        </div>

        {/* Live Parsing Progress */}
        {progress && (
          <div className="space-y-2 rounded-2xl liquid-glass-subtle p-4 border border-slate-200/80 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between text-xs font-mono gap-2">
              <span className="ap-text-brand font-semibold truncate max-w-[70%]">
                Reading ({progress.processed} / {progress.total}): {progress.currentFileName}
              </span>
              <span className="text-slate-600 dark:text-slate-400">
                {progress.importedCount} parsed · {progress.skippedCount} skipped
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-[#1C5436] dark:bg-[#C8FF00] transition-all duration-150"
                style={{
                  width: `${Math.min(
                    100,
                    progress.total > 0
                      ? Math.round((progress.processed / progress.total) * 100)
                      : 0
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-2xl ap-status-caution p-4 text-xs flex items-start gap-2.5"
          >
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Parsed Activity Preview */}
        {recentParsedActivities.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                Recently Parsed Telemetry ({result?.importedActivities.length || 0} Total Workouts)
              </h3>
              <span className="text-2xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                ✓ Ready for Baseline Calibration
              </span>
            </div>
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {recentParsedActivities.map((act) => (
                <div
                  key={act.id}
                  className="rounded-xl liquid-glass-subtle p-2.5 flex items-center justify-between text-xs border border-slate-200/60 dark:border-white/5 font-mono"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Footprints className="w-3.5 h-3.5" />
                    </div>
                    <div className="truncate">
                      <div className="font-bold text-slate-900 dark:text-white truncate">
                        {act.name}
                      </div>
                      <div className="text-2xs text-slate-500">
                        {act.startDateLocal.slice(0, 10)} · {act.sportCategory}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-2xs space-y-0.5">
                    <div className="font-bold text-slate-900 dark:text-white">
                      {formatDistance(act.distanceMeters)} · {formatDuration(act.movingTimeSecs)}
                    </div>
                    <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      {act.trainingLoad} TSS
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions & Confirmation */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/80 dark:border-white/10">
          <div className="text-2xs text-slate-500 font-mono">
            {result ? (
              <span>
                Processed {result.totalDiscovered} files ({result.importedActivities.length} imported,{' '}
                {result.skippedFiles.length} skipped)
              </span>
            ) : (
              <span>Works without internet · Dexie.js offline database</span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="ap-btn-secondary !min-h-[44px] px-4 py-2 text-xs font-semibold cursor-pointer"
            >
              {result && result.importedActivities.length > 0 ? 'Close' : 'Cancel'}
            </button>
            {result && result.importedActivities.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCompleteOnboarding?.();
                }}
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#1C5436] hover:bg-[#16422A] dark:bg-[#C8FF00] dark:hover:bg-[#B5EB00] text-white dark:text-[#080A09] text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <span>Enter Cockpit</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
