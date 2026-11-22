import React, { useMemo, useState } from 'react';
import type { VerifiedRacePassport } from '../../types';
import {
  batchGenerateStopwatchRacePassports,
  convertHandTimeToNfhsFat,
} from '../../physiology/trackMeetAndRelayEngine';
import { formatPace } from '../../utils/formatters';
import { Check, CheckCircle2, Copy, ShieldCheck, Trophy } from '../icons/PhosphorIcons';

export interface TimedRaceFinisherInput {
  runnerId: string;
  runnerName: string;
  netTotalSecs: number;
  lapSplitsSecs: number[];
}

export interface TracksideMeetPassportPanelProps {
  sessionTitle: string;
  eventLabel: string;
  eventDistanceMeters: number;
  finishers: TimedRaceFinisherInput[];
}

export const TracksideMeetPassportPanel: React.FC<TracksideMeetPassportPanelProps> = ({
  sessionTitle,
  eventLabel,
  eventDistanceMeters,
  finishers,
}) => {
  const [isHandTimedNfhs, setIsHandTimedNfhs] = useState<boolean>(true);
  const [mintedPassports, setMintedPassports] = useState<VerifiedRacePassport[]>([]);
  const [copiedHashes, setCopiedHashes] = useState<boolean>(false);

  const previewSample = useMemo(() => {
    if (finishers.length === 0) return null;
    const first = finishers[0];
    return isHandTimedNfhs
      ? convertHandTimeToNfhsFat(first.netTotalSecs, eventDistanceMeters || 1600)
      : null;
  }, [finishers, isHandTimedNfhs, eventDistanceMeters]);

  const handleMintPassports = () => {
    if (finishers.length === 0) return;
    const generated = batchGenerateStopwatchRacePassports({
      sessionTitle,
      eventLabel,
      eventDistanceMeters: eventDistanceMeters || 1600,
      isHandTimed: isHandTimedNfhs,
      finishers,
    });
    setMintedPassports(generated);
  };

  const handleCopySummary = async () => {
    if (mintedPassports.length === 0) return;
    const lines = mintedPassports.map(
      (p) =>
        `${p.verificationHash} | ${p.athleteName} | ${p.eventLabel} | ${p.displayOfficialTime} | VDOT ${p.vdotScore.toFixed(1)}`
    );
    await navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    setCopiedHashes(true);
    window.setTimeout(() => setCopiedHashes(false), 2500);
  };

  return (
    <div
      data-testid="stopwatch-passport-panel"
      className="rounded-xl ap-card-inset p-3.5 space-y-3 border border-emerald-900/15 dark:border-ap-edge"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="w-4 h-4 ap-text-brand shrink-0" weight="duotone" />
          <span className="text-xs font-bold text-slate-900 dark:text-white">
            Official Hand-Time Rounding &amp; Race Passports
          </span>
          {previewSample && (
            <span className="px-2 py-0.5 rounded ap-status-info font-mono text-2xs font-bold tabular-nums">
              {previewSample.ruleLabel}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-2 px-3 rounded-xl bg-white dark:bg-ap-carbon border border-emerald-900/15 dark:border-ap-frame text-xs font-mono font-semibold text-slate-800 dark:text-slate-100 cursor-pointer">
            <input
              type="checkbox"
              data-testid="stopwatch-nfhs-hand-toggle"
              checked={isHandTimedNfhs}
              onChange={(e) => setIsHandTimedNfhs(e.target.checked)}
              className="accent-[#65A30D] w-4 h-4"
            />
            <span>Hand-Time Rounding (+0.24s)</span>
          </label>

          <button
            type="button"
            data-testid="stopwatch-mint-passports-btn"
            disabled={finishers.length === 0}
            onClick={handleMintPassports}
            className="min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 rounded-xl bg-ap-obsidian hover:bg-[#242826] text-ap-chalk dark:bg-ap-volt dark:text-ap-obsidian border border-ap-frame text-xs font-bold disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
          >
            <Trophy className="w-4 h-4 shrink-0" weight="duotone" />
            <span>
              Mint Verified Passports ({finishers.length})
            </span>
          </button>
        </div>
      </div>

      {mintedPassports.length > 0 && (
        <div data-testid="minted-passports-list" className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-2xs font-mono font-bold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" weight="bold" />
              <span>
                Minted {mintedPassports.length} Verified {mintedPassports.length === 1 ? 'Passport' : 'Passports'}
              </span>
            </span>

            <button
              type="button"
              onClick={handleCopySummary}
              className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1 px-2.5 rounded-lg ap-card text-2xs font-mono font-bold text-slate-800 dark:text-slate-100 cursor-pointer"
            >
              {copiedHashes ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" weight="bold" />
              ) : (
                <Copy className="w-3.5 h-3.5" weight="duotone" />
              )}
              <span>{copiedHashes ? 'Copied Passports' : 'Copy THV Hashes'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {mintedPassports.map((p) => (
              <div
                key={`${p.verificationHash}-${p.athleteName}`}
                className="rounded-xl bg-white dark:bg-ap-carbon border border-emerald-900/15 dark:border-ap-edge px-3 py-2.5 flex items-center justify-between gap-3 text-xs font-mono tabular-nums"
              >
                <div className="min-w-0">
                  <div className="font-sans font-bold text-slate-900 dark:text-white truncate">
                    {p.athleteName}
                  </div>
                  <div className="text-2xs ap-text-brand font-bold">
                    {p.verificationHash} · VDOT {p.vdotScore.toFixed(1)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-extrabold text-sm text-slate-900 dark:text-white">
                    {p.displayOfficialTime}
                  </div>
                  <div className="text-2xs text-slate-600 dark:text-slate-300">
                    {formatPace(p.certifiedPaceSecsPerKm, 'km')} · GPS {p.gpsDriftPct > 0 ? `+${p.gpsDriftPct}%` : `${p.gpsDriftPct}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
