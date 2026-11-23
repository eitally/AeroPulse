import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from '../icons/PhosphorIcons';
import {
  ALL_MEET_DAY_EVENTS,
  applyDelayToMeetTimeString,
  formatOfficialLaneOrHip,
  parseExternalHeatSheetForRoster,
  serializeMeetEntriesToPacketEntries,
  type ExternalHeatSheetParseResult,
  type MeetEntryRecord,
  type MeetGenderDivision,
} from '../../physiology/meetDayOpsEngine';
import type { TeamMembershipRecord } from '../../types';

export interface ExternalHeatSheetImportPanelProps {
  entries: MeetEntryRecord[];
  memberships: TeamMembershipRecord[];
  onApplyImportedAssignments: (params: {
    parseResult: ExternalHeatSheetParseResult;
    mode: 'MERGE_PRESERVE_CLERK' | 'REPLACE_ALL_ASSIGNMENTS';
    overwriteClerkOverrides: boolean;
  }) => void;
  onClose?: () => void;
}

export const ExternalHeatSheetImportPanel: React.FC<ExternalHeatSheetImportPanelProps> = ({
  entries,
  memberships,
  onApplyImportedAssignments,
  onClose,
}) => {
  const [rawText, setRawText] = useState<string>('');
  const [overwriteClerkOverrides, setOverwriteClerkOverrides] = useState<boolean>(false);

  const packetEntries = useMemo(() => serializeMeetEntriesToPacketEntries(entries), [entries]);

  const parseResult = useMemo(
    () => parseExternalHeatSheetForRoster(rawText, packetEntries, memberships),
    [rawText, packetEntries, memberships]
  );

  const entryById = useMemo(
    () => new Map(entries.map((e) => [e.id, e])),
    [entries]
  );

  const clerkOverrideCountTotal = useMemo(
    () => entries.filter((e) => e.assignmentSource === 'CLERK_OVERRIDE').length,
    [entries]
  );

  const matchedClerkOverrideCount = useMemo(() => {
    const seenIds = new Set<string>();
    for (const m of parseResult.matchedAssignments) {
      if (m.matchedEntryId) {
        const existing = entryById.get(m.matchedEntryId);
        if (existing?.assignmentSource === 'CLERK_OVERRIDE') {
          seenIds.add(existing.id);
        }
      }
    }
    return seenIds.size;
  }, [parseResult.matchedAssignments, entryById]);

  const preservedClerkCount = overwriteClerkOverrides
    ? 0
    : Math.max(matchedClerkOverrideCount, clerkOverrideCountTotal);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRawText(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      data-testid="external-heat-sheet-import-panel"
      className="rounded-xl ap-card-inset p-3.5 space-y-3 border border-ap-frame/20 dark:border-ap-edge-dark"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardPaste className="w-4 h-4 ap-text-brand shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xs font-extrabold tracking-tight text-ap-ink dark:text-ap-chalk">
              Import Official Heat Sheet / Flight Program (Hy-Tek, AthleticLIVE, FinishLynx .evt)
            </h3>
            <p className="text-2xs text-ap-muted dark:text-ap-muted-dark">
              Paste Friday-night meet programs or upload a <span className="font-mono">lynx.evt</span> file to match your roster onto official heats, lanes, boxes/hips, flights &amp; call times.
            </p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label="Close External Heat Sheet Importer"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-lg border border-ap-frame/15 dark:border-ap-edge-dark inline-flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="external-heat-sheet-textarea"
            className="text-2xs font-mono uppercase text-ap-muted dark:text-ap-muted-dark font-semibold"
          >
            Paste Heat / Flight Sheet Text
          </label>
          <label className="ap-btn-secondary !min-h-[36px] px-2.5 py-1 text-2xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload .evt / .txt</span>
            <input
              type="file"
              accept=".txt,.evt,.csv,.htm,.html"
              onChange={handleFileUpload}
              className="sr-only"
            />
          </label>
        </div>

        <textarea
          id="external-heat-sheet-textarea"
          data-testid="external-heat-sheet-textarea"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={5}
          placeholder={`Event 4 Boys 100 Meter Dash Varsity\nHeat 2 (Starts 10:15 AM)\n  4  Carter, Devon   12  Willow Glen   10.94\n\nOr AthleticLIVE / lynx.evt:\n12,1,2,Girls 1600m Varsity,2:15 PM\n,3,412,Chen,Maya,Willow Glen`}
          className="w-full rounded-lg border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon p-2.5 font-mono text-2xs text-ap-ink dark:text-ap-chalk focus:outline-none focus:ring-2 focus:ring-ap-clay/50"
        />
      </div>

      {rawText.trim().length > 0 && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/75 dark:bg-ap-carbon/80 px-3 py-2 border border-ap-frame/15 dark:border-ap-edge-dark">
            <div className="flex flex-wrap items-center gap-2 text-2xs font-mono">
              <span className="px-2 py-0.5 rounded bg-ap-clay/15 dark:bg-ap-volt/15 text-ap-clay dark:text-ap-volt font-bold">
                {parseResult.detectedSource === 'IMPORTED_ATHLETICLIVE'
                  ? 'AthleticLIVE / Athletic.net'
                  : 'Hy-Tek / FinishLynx'}
              </span>
              <span
                data-testid="external-import-matched-count"
                className="font-bold text-ap-ink dark:text-ap-chalk"
              >
                {parseResult.matchedAssignments.length} matched slot
                {parseResult.matchedAssignments.length === 1 ? '' : 's'}
              </span>
              {clerkOverrideCountTotal > 0 && (
                <span
                  data-testid="external-import-preserved-clerk-count"
                  className="px-2 py-0.5 rounded ap-status-caution font-bold"
                >
                  {overwriteClerkOverrides
                    ? `${clerkOverrideCountTotal} Clerk Override(s) will be overwritten`
                    : `${preservedClerkCount} Clerk Override(s) preserved`}
                </span>
              )}
            </div>

            <label className="inline-flex items-center gap-1.5 text-2xs font-mono cursor-pointer">
              <input
                type="checkbox"
                data-testid="external-import-overwrite-clerk"
                checked={overwriteClerkOverrides}
                onChange={(e) => setOverwriteClerkOverrides(e.target.checked)}
                className="accent-[#B83A24]"
              />
              <span>Overwrite Clerk Overrides</span>
            </label>
          </div>

          {parseResult.matchedAssignments.length > 0 ? (
            <div className="max-h-44 overflow-y-auto space-y-1 font-mono text-2xs">
              {parseResult.matchedAssignments.map((item, idx) => {
                const existing = item.matchedEntryId
                  ? entryById.get(item.matchedEntryId)
                  : undefined;
                const willPreserveClerk =
                  existing?.assignmentSource === 'CLERK_OVERRIDE' && !overwriteClerkOverrides;
                const slotText =
                  item.officialFlight !== undefined
                    ? `Flight ${item.officialFlight}${item.officialOrder ? ` #${item.officialOrder}` : ''}`
                    : `Heat ${item.officialHeat || '?'}${item.officialLaneOrHip ? ` · ${item.officialLaneOrHip}` : ''}`;
                return (
                  <div
                    key={`${item.lineNumber}-${item.athleteName}-${item.eventCode}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 dark:bg-ap-carbon/70 px-2.5 py-1.5 border border-ap-frame/10 dark:border-ap-edge-dark"
                  >
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="font-sans font-bold text-ap-ink dark:text-ap-chalk">
                        {item.athleteName}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-ap-clay/10 dark:bg-ap-volt/10 text-ap-clay dark:text-ap-volt font-bold">
                        {item.eventCode}
                      </span>
                      <span className="font-semibold">{slotText}</span>
                      {item.checkInCallTime && (
                        <span className="text-ap-muted dark:text-ap-muted-dark">
                          Call {item.checkInCallTime}
                        </span>
                      )}
                      {item.eventStartTime && (
                        <span className="text-ap-muted dark:text-ap-muted-dark">
                          Start {item.eventStartTime}
                        </span>
                      )}
                      {item.bibNumber && (
                        <span className="text-ap-muted dark:text-ap-muted-dark">
                          #{item.bibNumber}
                        </span>
                      )}
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        willPreserveClerk
                          ? 'ap-status-caution'
                          : item.matchedEntryId
                            ? 'ap-status-prime'
                            : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                      }`}
                    >
                      {willPreserveClerk
                        ? 'Keep Clerk Override'
                        : item.matchedEntryId
                          ? 'Update Entry'
                          : 'Add Entry'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg ap-status-caution px-3 py-2 flex items-center gap-2 text-2xs font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                No roster athletes matched yet. Verify athlete names match your team roster or entries.
              </span>
            </div>
          )}

          {parseResult.unmatchedLines.length > 0 && (
            <details className="text-2xs font-mono text-ap-muted dark:text-ap-muted-dark">
              <summary className="cursor-pointer select-none font-semibold">
                {parseResult.unmatchedLines.length} non-roster / opponent line
                {parseResult.unmatchedLines.length === 1 ? '' : 's'} skipped
              </summary>
              <div className="mt-1 max-h-24 overflow-y-auto rounded bg-white/50 dark:bg-ap-carbon/50 p-2 space-y-0.5">
                {parseResult.unmatchedLines.slice(0, 20).map((ul, i) => (
                  <div key={i} className="truncate">
                    {ul}
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              data-testid="external-import-merge-btn"
              disabled={parseResult.matchedAssignments.length === 0}
              onClick={() =>
                onApplyImportedAssignments({
                  parseResult,
                  mode: 'MERGE_PRESERVE_CLERK',
                  overwriteClerkOverrides,
                })
              }
              className="ap-btn-primary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Apply Safe Merge ({parseResult.matchedAssignments.length})
            </button>
            <button
              type="button"
              data-testid="external-import-replace-btn"
              disabled={parseResult.matchedAssignments.length === 0}
              onClick={() =>
                onApplyImportedAssignments({
                  parseResult,
                  mode: 'REPLACE_ALL_ASSIGNMENTS',
                  overwriteClerkOverrides,
                })
              }
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Replace Assignments
            </button>
            <button
              type="button"
              onClick={() => setRawText('')}
              className="ap-btn-secondary !min-h-[44px] sm:!min-h-[36px] px-3 py-1.5 text-xs font-semibold cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export interface MeetDayEntryRowProps {
  entry: MeetEntryRecord;
  availableDivisions: string[];
  isInjured: boolean;
  isClerkOpen: boolean;
  meetDelayMinutes: number;
  onToggleClerk: () => void;
  onUpdate: (patch: Partial<MeetEntryRecord>) => void;
  onRemove: () => void;
}

export const MeetDayEntryRow: React.FC<MeetDayEntryRowProps> = ({
  entry,
  availableDivisions,
  isInjured,
  isClerkOpen,
  meetDelayMinutes,
  onToggleClerk,
  onUpdate,
  onRemove,
}) => {
  const isField = ALL_MEET_DAY_EVENTS.find((ev) => ev.code === entry.eventCode)?.category === 'FIELD';
  const slotChip = isField
    ? entry.officialFlight
      ? `F${entry.officialFlight}${entry.officialOrder ? ` #${entry.officialOrder}` : ''}`
      : ''
    : entry.officialHeat || entry.officialLaneOrHip
      ? [
          entry.officialHeat ? `H${entry.officialHeat}` : '',
          entry.officialLaneOrHip ? formatOfficialLaneOrHip(entry.eventCode, entry.officialLaneOrHip) : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';
  const delayedStart = applyDelayToMeetTimeString(entry.eventStartTime, meetDelayMinutes);

  return (
    <div className={`rounded-xl ap-card-inset px-3 py-2 space-y-2 font-mono ${entry.scratched ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-1.5">
          <span className={`font-bold text-ap-ink dark:text-ap-chalk font-sans ${entry.scratched ? 'line-through' : ''}`}>
            {entry.athleteName}
          </span>
          {entry.scratched && <span className="px-1.5 py-0.5 rounded ap-status-strained font-bold text-2xs">SCRATCHED</span>}
          {entry.isAlternate && <span className="px-1.5 py-0.5 rounded ap-status-caution font-bold text-2xs">ALT</span>}
          {isInjured && (
            <span data-testid={`meet-entry-injured-${entry.athleteId}`} className="px-1.5 py-0.5 rounded ap-status-strained font-bold text-2xs">
              [INJURED — AT RTP]
            </span>
          )}
          <select
            aria-label={`Gender for ${entry.athleteName} ${entry.eventCode}`}
            value={entry.genderDivision || 'M'}
            onChange={(e) => onUpdate({ genderDivision: e.target.value as MeetGenderDivision })}
            className="min-h-[30px] rounded-md border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 text-2xs font-bold"
          >
            <option value="M">Boys</option>
            <option value="F">Girls</option>
            <option value="NONBINARY">NB</option>
          </select>
          <select
            aria-label={`Division for ${entry.athleteName} ${entry.eventCode}`}
            value={entry.division || 'Varsity'}
            onChange={(e) => onUpdate({ division: e.target.value })}
            className="min-h-[30px] rounded-md border border-ap-frame/20 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-1.5 text-2xs"
          >
            {availableDivisions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="px-1.5 py-0.5 rounded bg-ap-clay/15 dark:bg-ap-volt/15 text-ap-clay dark:text-ap-volt font-bold">
            {entry.eventCode}
            {entry.relayTeamCode ? ` (${entry.relayTeamCode}${entry.relayLegOrder ? ` #${entry.relayLegOrder}` : ''})` : ''}
          </span>
          <span className="text-ap-muted dark:text-ap-muted-dark">Seed: {entry.seedMark}</span>
          {slotChip && (
            <span className={`px-1.5 py-0.5 rounded text-2xs font-bold ${entry.assignmentSource === 'CLERK_OVERRIDE' ? 'ap-status-caution' : 'ap-status-prime'}`}>
              {slotChip}{delayedStart ? ` · ${delayedStart}` : ''}{entry.assignmentSource === 'CLERK_OVERRIDE' ? ' (Clerk)' : ''}
            </span>
          )}
        </div>

        <div className="inline-flex items-center gap-1 shrink-0">
          <button
            type="button"
            data-testid={`meet-entry-clerk-btn-${entry.id}`}
            aria-expanded={isClerkOpen}
            onClick={onToggleClerk}
            className="min-h-[34px] px-2 rounded-lg border border-ap-frame/20 dark:border-ap-edge-dark bg-white/80 dark:bg-ap-carbon text-2xs font-bold inline-flex items-center gap-1 cursor-pointer"
          >
            <SlidersHorizontal className="w-3 h-3" /><span>Clerk</span>
          </button>
          <button
            type="button"
            data-testid={`meet-entry-scratch-${entry.id}`}
            aria-pressed={Boolean(entry.scratched)}
            onClick={() => onUpdate({ scratched: !entry.scratched })}
            className={`min-h-[34px] px-2 rounded-lg border text-2xs font-bold cursor-pointer ${entry.scratched ? 'ap-status-strained border-rose-400/50' : 'border-ap-frame/20 dark:border-ap-edge-dark bg-white/80 dark:bg-ap-carbon'}`}
          >
            {entry.scratched ? 'Unscratch' : 'Scratch'}
          </button>
          <button
            type="button"
            aria-label={`Remove ${entry.athleteName} ${entry.eventCode}`}
            onClick={onRemove}
            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-rose-500 hover:text-rose-400 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isClerkOpen && (
        <div data-testid={`meet-entry-clerk-panel-${entry.id}`} className="pt-2 border-t border-ap-frame/15 dark:border-ap-edge-dark grid grid-cols-2 sm:grid-cols-5 gap-2 text-2xs">
          <label className="space-y-0.5">
            <span className="block text-ap-muted dark:text-ap-muted-dark">{isField ? 'Official Flight' : 'Official Heat'}</span>
            <input
              type="number" min={1} max={99} data-testid={`clerk-heat-input-${entry.id}`} placeholder="1"
              value={isField ? entry.officialFlight ?? '' : entry.officialHeat ?? ''}
              onChange={(e) => {
                const val = e.target.value ? Math.max(1, Number(e.target.value)) : undefined;
                onUpdate({ ...(isField ? { officialFlight: val } : { officialHeat: val }), assignmentSource: 'CLERK_OVERRIDE' });
              }}
              className="w-full min-h-[34px] rounded-md border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2"
            />
          </label>
          <label className="space-y-0.5">
            <span className="block text-ap-muted dark:text-ap-muted-dark">{isField ? 'Flight Order #' : 'Lane / Box / Hip'}</span>
            <input
              type="text" data-testid={`clerk-lane-input-${entry.id}`} placeholder={isField ? '3' : 'Lane 4 / Hip 2'}
              value={isField ? (entry.officialOrder !== undefined ? String(entry.officialOrder) : '') : entry.officialLaneOrHip || ''}
              onChange={(e) => {
                const raw = e.target.value;
                onUpdate({
                  ...(isField ? { officialOrder: raw ? Math.max(1, Number(raw)) || undefined : undefined } : { officialLaneOrHip: raw }),
                  assignmentSource: 'CLERK_OVERRIDE',
                });
              }}
              className="w-full min-h-[34px] rounded-md border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2"
            />
          </label>
          <label className="space-y-0.5">
            <span className="block text-ap-muted dark:text-ap-muted-dark">Start Time</span>
            <input
              type="text" data-testid={`clerk-start-input-${entry.id}`} placeholder="2:15 PM"
              value={entry.eventStartTime || ''}
              onChange={(e) => onUpdate({ eventStartTime: e.target.value, assignmentSource: 'CLERK_OVERRIDE' })}
              className="w-full min-h-[34px] rounded-md border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2"
            />
          </label>
          <label className="space-y-0.5">
            <span className="block text-ap-muted dark:text-ap-muted-dark">Check-in Call</span>
            <input
              type="text" placeholder="1:55 PM"
              value={entry.checkInCallTime || ''}
              onChange={(e) => onUpdate({ checkInCallTime: e.target.value, assignmentSource: 'CLERK_OVERRIDE' })}
              className="w-full min-h-[34px] rounded-md border border-ap-frame/25 dark:border-ap-edge-dark bg-white dark:bg-ap-carbon px-2"
            />
          </label>
          <div className="flex items-end gap-2">
            <label className="inline-flex items-center gap-1 min-h-[34px] cursor-pointer">
              <input
                type="checkbox" checked={Boolean(entry.isAlternate)} className="accent-[#B83A24]"
                onChange={(e) => onUpdate({ isAlternate: e.target.checked })}
              />
              <span>Alt</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
