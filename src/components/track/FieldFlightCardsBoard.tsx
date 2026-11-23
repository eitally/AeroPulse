import React, { useState } from 'react';
import {
  Award,
  ChevronRight,
  Plus,
  Users,
  Waves,
  X,
} from '../icons/PhosphorIcons';
import {
  formatFieldMark,
  formatFieldMarkDual,
  getFieldEventSpec,
  isWindReadingLegal,
  parseFieldMarkToMeters,
  type HorizontalFlightStanding,
  type VerticalFlightStanding,
} from '../../physiology/fieldEventsEngine';
import type {
  CoachEventGroup,
  DistanceUnit,
  FieldEventCode,
  FieldTrialEntry,
} from '../../types';

export interface FlightAthleteOption {
  id: string;
  membershipId?: string;
  name: string;
  eventGroup?: CoachEventGroup | null;
  squadGroup?: string;
  isWalkOn?: boolean;
}

export interface HorizontalTrialDraft {
  raw: string;
  windRaw: string;
  outcome: 'MARK' | 'FOUL' | 'PASS';
  round?: 'PRELIM' | 'FINAL';
}

export interface AthleteFlightSummaryView {
  athleteId: string;
  bestMarkMeters: number | null;
  bestWindLegalMeters: number | null;
  bestMarkWindMps?: number;
  isWindAidedBest: boolean;
  placeRank: number | null;
  advancedToFinals: boolean;
  isNoHeight?: boolean;
  isEliminated?: boolean;
  attemptsSummaryChips: string[];
  multiPoints?: number;
}

export interface FieldFlightCardsBoardProps {
  eventCode: FieldEventCode;
  unit: DistanceUnit;
  flightName: string;
  onChangeFlightName: (name: string) => void;
  flightRoster: FlightAthleteOption[];
  eligibleRoster: FlightAthleteOption[];
  activeAthleteId: string;
  onSelectActiveAthlete: (id: string) => void;
  onAdvanceRotation: () => void;
  onToggleAthleteInFlight: (athlete: FlightAthleteOption) => void;
  onAddWalkOn: (name: string) => void;
  athleteSummariesById: Map<string, AthleteFlightSummaryView>;
  isFinalsMode: boolean;
  finalsCutSize: 8 | 9;
  onChangeFinalsCutSize: (size: 8 | 9) => void;
  onCutToFinals: () => void;
  onReturnToPrelims: () => void;
  activeTrials: HorizontalTrialDraft[];
  onChangeTrial: (
    idx: number,
    patch: Partial<HorizontalTrialDraft>
  ) => void;
  onAddTrial: () => void;
  horizontalStandings: HorizontalFlightStanding[];
  verticalStandings: VerticalFlightStanding[];
}

export const FieldFlightCardsBoard: React.FC<FieldFlightCardsBoardProps> = ({
  eventCode,
  unit,
  flightName,
  onChangeFlightName,
  flightRoster,
  eligibleRoster,
  activeAthleteId,
  onSelectActiveAthlete,
  onAdvanceRotation,
  onToggleAthleteInFlight,
  onAddWalkOn,
  athleteSummariesById,
  isFinalsMode,
  finalsCutSize,
  onChangeFinalsCutSize,
  onCutToFinals,
  onReturnToPrelims,
  activeTrials,
  onChangeTrial,
  onAddTrial,
  horizontalStandings,
}) => {
  const spec = getFieldEventSpec(eventCode);
  const showWindInputs = eventCode === 'LJ' || eventCode === 'TJ';
  const showHorizontalDeck = spec.mode === 'HORIZONTAL' || spec.mode === 'THROW';

  const [showRosterPicker, setShowRosterPicker] = useState<boolean>(false);
  const [walkOnName, setWalkOnName] = useState<string>('');

  const flightIds = new Set(flightRoster.map((a) => a.id));
  const activeIdx = flightRoster.findIndex((a) => a.id === activeAthleteId);
  const activeAthlete =
    (activeIdx >= 0 ? flightRoster[activeIdx] : flightRoster[0]) || null;

  const findOnDeckAthlete = (): FlightAthleteOption | null => {
    if (flightRoster.length <= 1) return null;
    for (let offset = 1; offset < flightRoster.length; offset += 1) {
      const candidate = flightRoster[(Math.max(0, activeIdx) + offset) % flightRoster.length];
      const summary = athleteSummariesById.get(candidate.id);
      if (!summary?.isEliminated) return candidate;
    }
    return null;
  };
  const onDeckAthlete = findOnDeckAthlete();
  const activeSummary = activeAthlete
    ? athleteSummariesById.get(activeAthlete.id)
    : undefined;

  const handleWalkOnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = walkOnName.trim();
    if (!trimmed) return;
    onAddWalkOn(trimmed);
    setWalkOnName('');
  };

  return (
    <div className="space-y-3">
      {/* Flight Header & Controls Bar */}
      <div className="rounded-xl bg-ap-carbon border border-ap-edge p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select active flight"
              data-testid="field-flight-select"
              value={flightName}
              onChange={(e) => onChangeFlightName(e.target.value)}
              className="min-h-[44px] sm:min-h-[34px] rounded-xl bg-ap-obsidian border border-ap-edge px-2.5 text-xs font-mono font-bold text-ap-chalk"
            >
              <option value="Flight A">Flight A</option>
              <option value="Flight B">Flight B</option>
              <option value="Finals Flight">Finals Flight</option>
            </select>

            <button
              type="button"
              data-testid="field-flight-roster-toggle"
              onClick={() => setShowRosterPicker((v) => !v)}
              aria-expanded={showRosterPicker}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl bg-ap-turf border border-ap-edge text-xs font-mono font-bold text-ap-chalk inline-flex items-center gap-1.5 cursor-pointer hover:border-ap-volt/60"
            >
              <Users className="w-3.5 h-3.5 text-ap-volt" />
              <span>Flight Roster ({flightRoster.length})</span>
            </button>

            {showHorizontalDeck && (
              <div className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-ap-obsidian border border-ap-edge p-0.5 text-2xs font-mono max-w-full">
                <button
                  type="button"
                  onClick={onReturnToPrelims}
                  className={`min-h-[40px] sm:min-h-[30px] px-2.5 rounded-lg font-bold cursor-pointer ${
                    !isFinalsMode ? 'bg-ap-volt text-ap-obsidian' : 'text-ap-muted-dark'
                  }`}
                >
                  Prelims (3)
                </button>
                <button
                  type="button"
                  data-testid="field-cut-finals-btn"
                  onClick={onCutToFinals}
                  className={`min-h-[40px] sm:min-h-[30px] px-2.5 rounded-lg font-bold cursor-pointer ${
                    isFinalsMode ? 'bg-ap-volt text-ap-obsidian' : 'text-ap-chalk hover:text-ap-volt'
                  }`}
                >
                  Cut Top {finalsCutSize} → Finals (+3)
                </button>
                <select
                  aria-label="Finals qualifier count"
                  value={finalsCutSize}
                  onChange={(e) => onChangeFinalsCutSize(Number(e.target.value) === 9 ? 9 : 8)}
                  className="bg-transparent text-ap-chalk px-1.5 py-1 font-bold focus:outline-none"
                >
                  <option value={8} className="bg-ap-obsidian">Top 8</option>
                  <option value={9} className="bg-ap-obsidian">Top 9</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            {onDeckAthlete && (
              <span className="text-2xs text-ap-muted-dark">
                On Deck: <strong className="text-ap-chalk">{onDeckAthlete.name}</strong>
              </span>
            )}
            <button
              type="button"
              data-testid="field-next-athlete-btn"
              onClick={onAdvanceRotation}
              disabled={flightRoster.length <= 1}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl bg-ap-clay text-white font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <span>Next Athlete</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Collapsible Flight Roster Picker + Walk-On Add */}
        {showRosterPicker && (
          <div
            data-testid="field-flight-roster-picker"
            className="rounded-xl bg-ap-obsidian border border-ap-edge p-3 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-2xs font-mono uppercase tracking-wider text-ap-muted-dark">
                Check Athletes Into {flightName} (up to 16)
              </span>
              <button
                type="button"
                aria-label="Close roster picker"
                onClick={() => setShowRosterPicker(false)}
                className="min-h-[36px] px-2 rounded-lg text-ap-muted-dark hover:text-ap-chalk cursor-pointer inline-flex items-center gap-1 text-2xs font-mono"
              >
                <X className="w-3.5 h-3.5" /> Done
              </button>
            </div>

            {eligibleRoster.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {eligibleRoster.map((ath) => {
                  const checked = flightIds.has(ath.id);
                  return (
                    <label
                      key={ath.id}
                      className={`min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg border text-xs flex items-center justify-between gap-2 cursor-pointer ${
                        checked
                          ? 'bg-ap-turf border-ap-volt/60 text-ap-chalk'
                          : 'bg-ap-carbon border-ap-edge text-ap-muted-dark'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleAthleteInFlight(ath)}
                          className="accent-lime-400"
                        />
                        <span className="truncate font-semibold">{ath.name}</span>
                      </span>
                      {ath.eventGroup && (
                        <span className="text-2xs font-mono shrink-0">{ath.eventGroup}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            <form onSubmit={handleWalkOnSubmit} className="flex flex-wrap gap-2">
              <input
                type="text"
                data-testid="field-walkon-name-input"
                value={walkOnName}
                onChange={(e) => setWalkOnName(e.target.value)}
                placeholder="Add walk-on athlete name…"
                className="flex-1 min-w-[180px] min-h-[44px] sm:min-h-[38px] rounded-xl bg-ap-carbon border border-ap-edge px-3 text-xs text-ap-chalk"
              />
              <button
                type="submit"
                data-testid="field-walkon-add-btn"
                className="min-h-[44px] sm:min-h-[38px] px-3.5 rounded-xl bg-ap-volt text-ap-obsidian font-mono font-extrabold text-xs inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Walk-On
              </button>
            </form>
          </div>
        )}

        {/* Rotating Multi-Athlete Flight Cards */}
        <div
          data-testid="field-flight-cards-grid"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 max-h-[240px] overflow-y-auto sm:max-h-none sm:overflow-visible pr-0.5 sm:pr-0"
        >
          {flightRoster.map((ath) => {
            const isUpNow = activeAthlete?.id === ath.id;
            const isOnDeck = onDeckAthlete?.id === ath.id;
            const sum = athleteSummariesById.get(ath.id);
            const bestText =
              spec.mode === 'MULTI' && typeof sum?.multiPoints === 'number' && sum.multiPoints > 0
                ? `${sum.multiPoints} pts`
                : sum?.bestMarkMeters
                  ? formatFieldMark(sum.bestMarkMeters, unit)
                  : sum?.isNoHeight
                    ? 'NH'
                    : '—';

            return (
              <button
                key={ath.id}
                type="button"
                data-testid={`field-flight-card-${ath.id}`}
                onClick={() => onSelectActiveAthlete(ath.id)}
                className={`text-left rounded-xl p-2.5 border transition-colors cursor-pointer space-y-1 min-w-0 ${
                  isUpNow
                    ? 'bg-ap-obsidian border-ap-volt ring-1 ring-ap-volt/60'
                    : 'bg-ap-turf border-ap-edge hover:border-ap-volt/40'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-bold text-ap-chalk truncate">
                    {ath.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {isUpNow && (
                      <span className="px-1.5 py-0.5 rounded bg-ap-volt text-ap-obsidian font-mono text-2xs font-extrabold">
                        UP NOW
                      </span>
                    )}
                    {!isUpNow && isOnDeck && (
                      <span className="px-1.5 py-0.5 rounded bg-ap-clay text-white font-mono text-2xs font-bold">
                        ON DECK
                      </span>
                    )}
                    {sum?.isEliminated && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-mono text-2xs font-bold">
                        {sum.isNoHeight ? 'NH' : 'OUT'}
                      </span>
                    )}
                    {sum?.advancedToFinals && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-2xs font-bold">
                        FINALS
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-2xs font-mono">
                  <span className="font-extrabold text-ap-volt tabular-nums">
                    {sum?.placeRank ? `#${sum.placeRank} · ` : ''}
                    {bestText}
                  </span>
                  {sum?.bestMarkMeters && showWindInputs && typeof sum.bestMarkWindMps === 'number' && (
                    <span
                      className={`px-1.5 py-0.2 rounded tabular-nums ${
                        sum.isWindAidedBest
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {sum.bestMarkWindMps > 0 ? '+' : ''}
                      {sum.bestMarkWindMps.toFixed(1)}
                      {sum.isWindAidedBest ? 'w' : ' m/s'}
                    </span>
                  )}
                </div>

                {sum && sum.attemptsSummaryChips.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {sum.attemptsSummaryChips.slice(0, 6).map((chip, chipIdx) => (
                      <span
                        key={chipIdx}
                        className="px-1.5 py-0.5 rounded bg-ap-carbon border border-ap-edge text-2xs font-mono text-ap-muted-dark tabular-nums"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Athlete Horizontal / Throws Trials Deck */}
      {showHorizontalDeck && activeAthlete && (
        <div className="rounded-xl bg-ap-carbon border border-ap-edge p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded bg-ap-volt text-ap-obsidian font-mono text-2xs font-extrabold">
                UP NOW
              </span>
              <span className="text-xs sm:text-sm font-extrabold text-ap-chalk truncate">
                {activeAthlete.name} · {spec.label}
              </span>
              {activeSummary?.bestMarkMeters && showWindInputs && (
                <span
                  data-testid="field-active-wind-badge"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono text-2xs font-bold ${
                    activeSummary.isWindAidedBest
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  <Waves className="w-3 h-3" />
                  {activeSummary.isWindAidedBest && typeof activeSummary.bestMarkWindMps === 'number'
                    ? `${activeSummary.bestMarkWindMps > 0 ? '+' : ''}${activeSummary.bestMarkWindMps.toFixed(1)}w Wind-Aided`
                    : typeof activeSummary.bestMarkWindMps === 'number'
                      ? `${activeSummary.bestMarkWindMps > 0 ? '+' : ''}${activeSummary.bestMarkWindMps.toFixed(1)} m/s Wind-Legal`
                      : 'Wind-Legal'}
                </span>
              )}
            </div>
            {activeTrials.length < 6 && (
              <button
                type="button"
                data-testid="field-add-trial-btn"
                onClick={onAddTrial}
                className="min-h-[44px] sm:min-h-[34px] px-3 py-1 rounded-xl bg-ap-turf border border-ap-edge text-xs font-mono font-bold text-ap-volt inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Trial
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {activeTrials.map((t, idx) => {
              const parsedMeters =
                t.outcome === 'MARK' ? parseFieldMarkToMeters(t.raw) : null;
              const parsedWind =
                t.windRaw.trim() !== '' && Number.isFinite(Number(t.windRaw.trim()))
                  ? Number(t.windRaw.trim())
                  : undefined;
              const windLegal = isWindReadingLegal(parsedWind);
              const roundLabel = idx >= 3 || t.round === 'FINAL' ? 'FINAL' : 'PRELIM';

              return (
                <div
                  key={idx}
                  className="rounded-xl bg-ap-obsidian border border-ap-edge p-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-2xs font-mono">
                    <span className="font-bold text-ap-volt">
                      TRIAL {idx + 1} · {roundLabel}
                    </span>
                    {parsedMeters !== null && (
                      <span className="text-ap-chalk tabular-nums">
                        {formatFieldMarkDual(parsedMeters)}
                      </span>
                    )}
                  </div>

                  <div className={showWindInputs ? 'grid grid-cols-3 gap-1.5' : ''}>
                    <input
                      type="text"
                      data-testid={`field-trial-input-${idx}`}
                      disabled={t.outcome !== 'MARK'}
                      value={t.outcome === 'MARK' ? t.raw : t.outcome}
                      onChange={(e) =>
                        onChangeTrial(idx, { raw: e.target.value, outcome: 'MARK' })
                      }
                      placeholder={
                        unit === 'km'
                          ? spec.mode === 'THROW'
                            ? '13.46m'
                            : '6.55m'
                          : spec.mode === 'THROW'
                            ? "44' 2\" or 13.46m"
                            : "21' 6\" or 6.55m"
                      }
                      className={`${
                        showWindInputs ? 'col-span-2' : 'w-full'
                      } min-h-[44px] rounded-lg bg-ap-carbon border border-ap-edge px-2.5 font-mono text-sm font-bold text-ap-chalk disabled:opacity-50`}
                    />
                    {showWindInputs && (
                      <input
                        type="text"
                        inputMode="decimal"
                        data-testid={`field-trial-wind-${idx}`}
                        aria-label={`Trial ${idx + 1} wind m/s`}
                        disabled={t.outcome !== 'MARK'}
                        value={t.windRaw}
                        onChange={(e) =>
                          onChangeTrial(idx, { windRaw: e.target.value })
                        }
                        placeholder="m/s +1.4"
                        className={`min-h-[44px] rounded-lg bg-ap-carbon border px-2 font-mono text-xs font-bold tabular-nums disabled:opacity-50 ${
                          parsedWind !== undefined && !windLegal
                            ? 'border-amber-500 text-amber-300'
                            : 'border-ap-edge text-ap-chalk'
                        }`}
                      />
                    )}
                  </div>

                  <div className="flex gap-1.5 font-mono text-2xs">
                    {(['MARK', 'FOUL', 'PASS'] as const).map((out) => (
                      <button
                        key={out}
                        type="button"
                        data-testid={`field-trial-${out.toLowerCase()}-${idx}`}
                        onClick={() => onChangeTrial(idx, { outcome: out })}
                        className={`flex-1 min-h-[44px] sm:min-h-[34px] rounded-lg font-bold cursor-pointer ${
                          t.outcome === out
                            ? out === 'FOUL'
                              ? 'bg-rose-600 text-white'
                              : 'bg-ap-volt text-ap-obsidian'
                            : 'bg-ap-turf text-ap-muted-dark border border-ap-edge'
                        }`}
                      >
                        {out === 'FOUL' ? 'Foul (X)' : out === 'PASS' ? 'Pass (-)' : 'Mark'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {horizontalStandings.some((s) => !s.isNoMark) && (
            <div className="pt-2 border-t border-ap-edge space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono text-ap-muted-dark uppercase tracking-wider">
                <span className="inline-flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-ap-volt" />
                  Live {flightName} Standings (Tiebreaker Applied)
                </span>
                {isFinalsMode && (
                  <span className="text-emerald-300 font-bold">
                    Finals Reverse Prelim Order Active
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5 text-xs font-mono">
                {horizontalStandings
                  .filter((s) => !s.isNoMark)
                  .map((s) => (
                    <div
                      key={s.athleteId}
                      className="rounded-lg bg-ap-obsidian border border-ap-edge px-2.5 py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="truncate text-ap-chalk">
                        <strong className="text-ap-volt">#{s.placeRank}</strong>{' '}
                        {s.athleteName}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-ap-chalk">
                        {s.bestMarkMeters ? formatFieldMark(s.bestMarkMeters, unit) : '—'}
                        {s.isWindAidedBest ? 'w' : ''}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export function formatTrialChip(entry: FieldTrialEntry, unit: DistanceUnit): string {
  if (entry.outcome === 'FOUL') return 'X';
  if (entry.outcome === 'PASS') return '-';
  if (entry.outcome === 'CLEAR') return 'O';
  if (entry.outcome === 'MISS') return 'X';
  if (typeof entry.markMeters === 'number' && entry.markMeters > 0) {
    return formatFieldMark(entry.markMeters, unit);
  }
  return 'MARK';
}
