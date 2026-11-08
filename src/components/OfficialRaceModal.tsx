import React, { useMemo, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ClipboardPaste,
  ExternalLink,
  Flame,
  Gauge,
  Globe,
  Plus,
  Sparkles,
  Timer,
  Trophy,
  X,
  Zap,
} from "./icons/PhosphorIcons";
import {
  AthleteProfile,
  DistanceUnit,
  OfficialRacePlatform,
  OfficialTrackSurface,
  UnifiedActivity,
} from '../types';
import { formatPace } from '../utils/formatters';
import {
  computeJackDanielsVdot,
  computeOfficialRaceTrainingLoad,
  deriveThresholdPaceSecsPerKmFromVdot,
  formatFatTime,
  generateDefaultLapSplits,
  OFFICIAL_RACE_EVENTS,
  ParsedOfficialRaceCandidate,
  parseFatTimeString,
  parseOfficialResultsTextDeterministically,
  SAMPLE_OFFICIAL_TRACK_SEASON_TEXT,
  synthesizeOfficialRaceActivity,
} from '../utils/officialRaceSynthesizer';

interface OfficialRaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  athleteProfile?: AthleteProfile;
  distanceUnit: DistanceUnit;
  existingOfficialRaces: UnifiedActivity[];
  onImportOfficialRaces: (activities: UnifiedActivity[]) => void;
  onSaveProfileOverride?: (updatedProfile: AthleteProfile) => Promise<void>;
}

export const OfficialRaceModal: React.FC<OfficialRaceModalProps> = ({
  isOpen,
  onClose,
  athleteProfile,
  distanceUnit,
  existingOfficialRaces,
  onImportOfficialRaces,
  onSaveProfileOverride,
}) => {
  const [activeTab, setActiveTab] = useState<'IMPORT_PARSE' | 'QUICK_FAT_LOGGER'>('IMPORT_PARSE');

  // Tab 1: Athletic.net / TFRRS / MileSplit URL & Paste Importer State
  const [profileOrMeetUrl, setProfileOrMeetUrl] = useState<string>('');
  const [rawPasteText, setRawPasteText] = useState<string>(SAMPLE_OFFICIAL_TRACK_SEASON_TEXT);
  const [isParsingRemote, setIsParsingRemote] = useState<boolean>(false);
  const [parseStatusNote, setParseStatusNote] = useState<string | null>(
    'Loaded sample Athletic.net & TFRRS track/XC season results. Paste your own profile URL or result table rows anytime.'
  );
  const [parsedCandidates, setParsedCandidates] = useState<ParsedOfficialRaceCandidate[]>(() =>
    parseOfficialResultsTextDeterministically(SAMPLE_OFFICIAL_TRACK_SEASON_TEXT)
  );
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(() =>
    parseOfficialResultsTextDeterministically(SAMPLE_OFFICIAL_TRACK_SEASON_TEXT).map((c) => c.id)
  );
  const [importSuccessBanner, setImportSuccessBanner] = useState<string | null>(null);

  // Tab 2: Quick Watchless FAT Track Race Logger State
  const [quickEventLabel, setQuickEventLabel] = useState<string>('800m');
  const [quickFatTimeInput, setQuickFatTimeInput] = useState<string>('1:55.84');
  const [quickDate, setQuickDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [quickMeetName, setQuickMeetName] = useState<string>('Bay Area Track Club Twilight');
  const [quickPlatform, setQuickPlatform] = useState<OfficialRacePlatform>('Athletic.net');
  const [quickTrackType, setQuickTrackType] = useState<OfficialTrackSurface>('OUTDOOR_400M');
  const [quickPlaceFinish, setQuickPlaceFinish] = useState<string>('1st (Final)');
  const [quickWindReading, setQuickWindReading] = useState<string>('+0.8 m/s');
  const [quickSplitDistance, setQuickSplitDistance] = useState<200 | 400 | 1000>(400);
  const [quickSplitsInput, setQuickSplitsInput] = useState<string>('56.82, 59.02');
  const [quickIncludeWarmup, setQuickIncludeWarmup] = useState<boolean>(true);

  const selectedQuickEventDef = useMemo(
    () =>
      OFFICIAL_RACE_EVENTS.find((e) => e.label === quickEventLabel) || OFFICIAL_RACE_EVENTS[1],
    [quickEventLabel]
  );

  // Synchronize default FAT time & lap splits when switching event preset in Quick Logger
  const handleSelectQuickEvent = (label: string) => {
    setQuickEventLabel(label);
    const def = OFFICIAL_RACE_EVENTS.find((e) => e.label === label);
    if (!def) return;
    setQuickSplitDistance(def.defaultSplitMeters);

    const presetTimes: Record<string, { time: string; splits: string; surface: OfficialTrackSurface }> = {
      '400m': { time: '50.84', splits: '24.60, 26.24', surface: 'OUTDOOR_400M' },
      '800m': { time: '1:55.84', splits: '56.82, 59.02', surface: 'OUTDOOR_400M' },
      '1500m': { time: '3:56.84', splits: '46.80, 63.40, 64.10, 62.54', surface: 'OUTDOOR_400M' },
      '1600m': { time: '4:16.42', splits: '63.10, 64.85, 65.22, 63.25', surface: 'OUTDOOR_400M' },
      '1 Mile': { time: '4:18.05', splits: '64.10, 65.10, 65.45, 63.40', surface: 'INDOOR_BANKED_200M' },
      '3000m': { time: '8:34.20', splits: '68.5, 69.0, 69.2, 69.1, 68.8, 68.4, 67.2, 54.0', surface: 'INDOOR_BANKED_200M' },
      '3200m': { time: '9:18.60', splits: '68.4, 70.1, 70.5, 70.8, 70.6, 70.2, 69.8, 68.2', surface: 'OUTDOOR_400M' },
      '5000m': { time: '14:52.40', splits: '2:58.0, 2:59.5, 3:00.2, 2:59.1, 2:55.6', surface: 'OUTDOOR_400M' },
      '10000m': { time: '31:15.80', splits: '3:07, 3:08, 3:08, 3:08, 3:09, 3:08, 3:08, 3:07, 3:07, 3:05.8', surface: 'OUTDOOR_400M' },
      'XC 5K': { time: '15:34.20', splits: '3:02.4, 3:08.1, 3:09.5, 3:08.8, 3:05.4', surface: 'XC_COURSE' },
      'Road 5K': { time: '15:18.50', splits: '3:02.0, 3:04.5, 3:05.0, 3:04.2, 3:02.8', surface: 'ROAD' },
      'Half Marathon': { time: '1:12:45.00', splits: '17:12, 17:15, 17:14, 17:10, 3:54', surface: 'ROAD' },
    };
    const preset = presetTimes[label];
    if (preset) {
      setQuickFatTimeInput(preset.time);
      setQuickSplitsInput(preset.splits);
      setQuickTrackType(preset.surface);
    }
  };

  // Parse Quick Logger preview metrics
  const quickRaceAnalytics = useMemo(() => {
    const fatTimeSecs = parseFatTimeString(quickFatTimeInput);
    const distMeters = selectedQuickEventDef.distanceMeters;
    const rawSplits = quickSplitsInput
      .split(/[,\s]+/)
      .map((s) => parseFatTimeString(s))
      .filter((n) => n > 5 && n < 2400);

    const splits =
      rawSplits.length > 0
        ? rawSplits
        : generateDefaultLapSplits(distMeters, fatTimeSecs, quickSplitDistance);

    const vdot = computeJackDanielsVdot(distMeters, fatTimeSecs);
    const derivedThresholdPaceSecsKm = deriveThresholdPaceSecsPerKmFromVdot(vdot);
    const tssLoad = computeOfficialRaceTrainingLoad(distMeters, fatTimeSecs, quickIncludeWarmup);
    const avg400mSecs = fatTimeSecs > 0 ? Number(((fatTimeSecs / distMeters) * 400).toFixed(2)) : 0;

    const halfIdx = Math.ceil(splits.length / 2);
    const firstHalfAvg =
      splits.slice(0, halfIdx).reduce((s, v) => s + v, 0) / Math.max(1, halfIdx);
    const secondHalfAvg =
      splits.length > halfIdx
        ? splits.slice(halfIdx).reduce((s, v) => s + v, 0) / (splits.length - halfIdx)
        : firstHalfAvg;
    const splitDiffSecs = Number((secondHalfAvg - firstHalfAvg).toFixed(2));
    const finalLapKickDeltaSecs =
      splits.length >= 2
        ? Number((splits[splits.length - 1] - firstHalfAvg).toFixed(2))
        : 0;

    return {
      fatTimeSecs,
      displayFat: formatFatTime(fatTimeSecs),
      splits,
      vdot,
      derivedThresholdPaceSecsKm,
      tssLoad,
      avg400mSecs,
      splitDiffSecs,
      finalLapKickDeltaSecs,
    };
  }, [
    quickFatTimeInput,
    selectedQuickEventDef,
    quickSplitsInput,
    quickSplitDistance,
    quickIncludeWarmup,
  ]);

  if (!isOpen) return null;

  const handleParseUrlOrText = async () => {
    setIsParsingRemote(true);
    setImportSuccessBanner(null);
    setParseStatusNote(null);

    try {
      // First run deterministic local parser
      const localMatches = parseOfficialResultsTextDeterministically(
        rawPasteText,
        profileOrMeetUrl
      );

      // Also call server-side /api/races/parse if URL or complex text is provided
      const resp = await fetch('/api/races/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: profileOrMeetUrl.trim() || undefined,
          rawText: rawPasteText.trim() || undefined,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.races) && data.races.length > 0) {
          const normalized: ParsedOfficialRaceCandidate[] = data.races
            .map((r: any, idx: number) => {
              const eventLabel = String(r.eventLabel || '800m');
              const def =
                OFFICIAL_RACE_EVENTS.find(
                  (e) => e.label.toLowerCase() === eventLabel.toLowerCase()
                ) || OFFICIAL_RACE_EVENTS[1];
              const fatSecs =
                Number(r.fatTimeSecs) > 0
                  ? Number(r.fatTimeSecs)
                  : parseFatTimeString(String(r.displayFatTime || ''));
              const splitDist = def.defaultSplitMeters;
              const splits =
                Array.isArray(r.lapSplitsSecs) && r.lapSplitsSecs.length > 0
                  ? r.lapSplitsSecs.map((n: any) => Number(n)).filter((n: number) => n > 5)
                  : generateDefaultLapSplits(
                      Number(r.eventDistanceMeters || def.distanceMeters),
                      fatSecs,
                      splitDist
                    );
              return {
                id: `srv-race-${Date.now()}-${idx}`,
                date: String(r.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
                meetName: String(r.meetName || 'Official Track & Field Meet'),
                eventLabel: def.label,
                eventDistanceMeters: Number(r.eventDistanceMeters || def.distanceMeters),
                fatTimeSecs: fatSecs,
                displayFatTime: formatFatTime(fatSecs),
                platform: (['Athletic.net', 'TFRRS', 'MileSplit', 'RunSignup', 'Official FAT'].includes(
                  r.platform
                )
                  ? r.platform
                  : 'Athletic.net') as OfficialRacePlatform,
                trackType: (['OUTDOOR_400M', 'INDOOR_BANKED_200M', 'INDOOR_FLAT_200M', 'XC_COURSE', 'ROAD'].includes(
                  r.trackType
                )
                  ? r.trackType
                  : 'OUTDOOR_400M') as OfficialTrackSurface,
                placeFinish: r.placeFinish ? String(r.placeFinish) : 'Official Result',
                windReading: r.windReading ? String(r.windReading) : undefined,
                lapSplitDistanceMeters: splitDist,
                lapSplitsSecs: splits,
                includeWarmupCooldown: true,
                sourceUrl: profileOrMeetUrl.trim() || undefined,
              };
            })
            .filter((c: ParsedOfficialRaceCandidate) => c.fatTimeSecs > 20);

          if (normalized.length > 0) {
            setParsedCandidates(normalized);
            setSelectedCandidateIds(normalized.map((c) => c.id));
            setParseStatusNote(
              `Extracted ${normalized.length} official race results (${
                data.fetchNote || 'Verified FAT timing & splits'
              }).`
            );
            return;
          }
        }
      }

      setParsedCandidates(localMatches);
      setSelectedCandidateIds(localMatches.map((c) => c.id));
      setParseStatusNote(
        localMatches.length > 0
          ? `Extracted ${localMatches.length} official watchless race marks with FAT timing and lap splits.`
          : 'No valid race rows detected. Ensure each line includes an event (e.g. 800m, 1600m, 5K) and time (e.g. 1:56.38).'
      );
    } catch {
      const fallback = parseOfficialResultsTextDeterministically(rawPasteText, profileOrMeetUrl);
      setParsedCandidates(fallback);
      setSelectedCandidateIds(fallback.map((c) => c.id));
    } finally {
      setIsParsingRemote(false);
    }
  };

  const handleToggleCandidate = (id: string) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleImportSelectedCandidates = async () => {
    const selected = parsedCandidates.filter((c) => selectedCandidateIds.includes(c.id));
    if (selected.length === 0) return;

    const lthr = athleteProfile?.runLthr || athleteProfile?.lthr || 172;
    const maxHr = athleteProfile?.runMaxHr || athleteProfile?.maxHr || 192;
    const synthesized = selected.map((c) => synthesizeOfficialRaceActivity(c, lthr, maxHr));

    onImportOfficialRaces(synthesized);
    setImportSuccessBanner(
      `Imported ${synthesized.length} official watchless race${
        synthesized.length === 1 ? '' : 's'
      } to your Training Calendar, Activity Log & Track PR Trophy Matrix!`
    );
  };

  const handleSaveQuickFatRace = () => {
    if (quickRaceAnalytics.fatTimeSecs <= 20) return;
    const candidate: ParsedOfficialRaceCandidate = {
      id: `fat-quick-${Date.now()}`,
      date: quickDate,
      meetName: quickMeetName.trim() || 'Official Track & Field Meet',
      eventLabel: selectedQuickEventDef.label,
      eventDistanceMeters: selectedQuickEventDef.distanceMeters,
      fatTimeSecs: quickRaceAnalytics.fatTimeSecs,
      displayFatTime: quickRaceAnalytics.displayFat,
      platform: quickPlatform,
      trackType: quickTrackType,
      placeFinish: quickPlaceFinish.trim() || undefined,
      windReading: quickWindReading.trim() || undefined,
      lapSplitDistanceMeters: quickSplitDistance,
      lapSplitsSecs: quickRaceAnalytics.splits,
      includeWarmupCooldown: quickIncludeWarmup,
    };

    const lthr = athleteProfile?.runLthr || athleteProfile?.lthr || 172;
    const maxHr = athleteProfile?.runMaxHr || athleteProfile?.maxHr || 192;
    const activity = synthesizeOfficialRaceActivity(candidate, lthr, maxHr);

    onImportOfficialRaces([activity]);
    setImportSuccessBanner(
      `Logged ${candidate.eventLabel} (${candidate.displayFatTime} FAT at ${candidate.meetName}) with ${candidate.lapSplitsSecs.length} lap splits (${activity.trainingLoad} TSS) to Calendar & Trophy Matrix!`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-6">
      <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl liquid-glass border border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 font-semibold">
              <Trophy className="w-3.5 h-3.5" />
              <span>Official Race &amp; Track Result Importer</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              Log Official Race Results
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Import official timing (<span className="font-mono">0.01s</span>) race marks when racing without a GPS watch (e.g., 800m, 1500m, 1600m/Mile, 3200m, XC, road races) to update your Training Load, Lap Splits, VDOT, and Personal Records.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            title="Close Official Race Importer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Segmented Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('IMPORT_PARSE')}
                className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'IMPORT_PARSE'
                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Import from URL or Table</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('QUICK_FAT_LOGGER')}
                className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === 'QUICK_FAT_LOGGER'
                    ? 'bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Timer className="w-3.5 h-3.5" />
                <span>Log Track / Road Race (Splits)</span>
              </button>
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {existingOfficialRaces.length} Official Race{existingOfficialRaces.length === 1 ? '' : 's'} in Archive
            </div>
          </div>

          {importSuccessBanner && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{importSuccessBanner}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[32px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap"
              >
                Done &amp; View Results
              </button>
            </div>
          )}

          {/* TAB 1: URL FETCHER + TABLE PASTE PARSER */}
          {activeTab === 'IMPORT_PARSE' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    1. Paste Public Profile / Meet URL or Copy-Paste Result Rows
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRawPasteText(SAMPLE_OFFICIAL_TRACK_SEASON_TEXT);
                      const matches = parseOfficialResultsTextDeterministically(
                        SAMPLE_OFFICIAL_TRACK_SEASON_TEXT
                      );
                      setParsedCandidates(matches);
                      setSelectedCandidateIds(matches.map((m) => m.id));
                      setParseStatusNote(
                        'Loaded sample middle-distance season (800m, 1500m, 1600m, 3200m, XC 5K).'
                      );
                    }}
                    className="min-h-[32px] px-3 py-1 rounded-lg border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    Load Sample Track Season
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Athletic.net, TFRRS, MileSplit, or RunSignup URL (Optional)
                    </label>
                    <input
                      type="url"
                      value={profileOrMeetUrl}
                      onChange={(e) => setProfileOrMeetUrl(e.target.value)}
                      placeholder="https://www.athletic.net/TrackAndField/Athlete.aspx?AID=... or https://www.tfrrs.org/athletes/..."
                      className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleParseUrlOrText}
                      disabled={isParsingRemote}
                      className="w-full min-h-[38px] px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      <span>{isParsingRemote ? 'Parsing Official Marks...' : 'Fetch & Parse Official Results'}</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Paste Copied Table Rows or Meet Results Text (Works even when TFRRS / MileSplit blocks bots)
                  </label>
                  <textarea
                    rows={5}
                    value={rawPasteText}
                    onChange={(e) => setRawPasteText(e.target.value)}
                    placeholder="Paste rows from Athletic.net, TFRRS, MileSplit, or FinishLynx results (e.g. 2026-10-24 | Twilight Meet | 800m | 1:56.38a | Splits: 56.92, 59.46)"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>

                {parseStatusNote && (
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    {parseStatusNote}
                  </div>
                )}
              </div>

              {/* Parsed Results Verification Table */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    2. Verify Extracted Watchless Races &amp; Synthesized Physiological Load ({selectedCandidateIds.length} of {parsedCandidates.length} selected)
                  </div>
                  <button
                    type="button"
                    onClick={handleImportSelectedCandidates}
                    disabled={selectedCandidateIds.length === 0}
                    className="min-h-[36px] px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Trophy className="w-3.5 h-3.5" />
                    <span>Import {selectedCandidateIds.length} Official Race{selectedCandidateIds.length === 1 ? '' : 's'} to AeroPulse</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3">Import</th>
                        <th className="py-2.5 px-3">Date &amp; Source</th>
                        <th className="py-2.5 px-3">Meet &amp; Place</th>
                        <th className="py-2.5 px-3">Event</th>
                        <th className="py-2.5 px-3 text-right">Official FAT</th>
                        <th className="py-2.5 px-3">Lap Splits</th>
                        <th className="py-2.5 px-3 text-right">VDOT</th>
                        <th className="py-2.5 px-3 text-right">Synthesized TSS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs">
                      {parsedCandidates.map((cand) => {
                        const isChecked = selectedCandidateIds.includes(cand.id);
                        const vdot = computeJackDanielsVdot(
                          cand.eventDistanceMeters,
                          cand.fatTimeSecs
                        );
                        const load = computeOfficialRaceTrainingLoad(
                          cand.eventDistanceMeters,
                          cand.fatTimeSecs,
                          cand.includeWarmupCooldown
                        );
                        return (
                          <tr
                            key={cand.id}
                            onClick={() => handleToggleCandidate(cand.id)}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-900/50 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleCandidate(cand.id)}
                                className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                              />
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {cand.date}
                              </div>
                              <div className="text-[11px] text-amber-600 dark:text-amber-400">
                                {cand.platform}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">
                                {cand.meetName}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {cand.placeFinish || 'Official Finisher'} ·{' '}
                                {cand.trackType === 'INDOOR_BANKED_200M'
                                  ? '200m Banked Indoor'
                                  : cand.trackType === 'XC_COURSE'
                                    ? 'XC Course'
                                    : '400m Outdoor Track'}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {cand.eventLabel}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums whitespace-nowrap">
                              {cand.displayFatTime}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                              {cand.lapSplitsSecs.map((s) => formatFatTime(s)).join(' · ')}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {vdot.toFixed(1)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-blue-600 dark:text-sky-400 tabular-nums whitespace-nowrap">
                              {load} TSS
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: QUICK WATCHLESS FAT TRACK RACE LOGGER WITH 200M/400M SPLITS */}
          {activeTab === 'QUICK_FAT_LOGGER' && (
            <div className="space-y-4">
              {/* Distance Quick-Select Buttons */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Select Official Track, XC, or Road Event Distance
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {OFFICIAL_RACE_EVENTS.map((ev) => {
                    const active = ev.label === quickEventLabel;
                    return (
                      <button
                        key={ev.label}
                        type="button"
                        onClick={() => handleSelectQuickEvent(ev.label)}
                        className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-amber-500 text-slate-950 font-bold'
                            : 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-amber-500/50'
                        }`}
                      >
                        {ev.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Official FAT Finish Time (<span className="font-mono">MM:SS.xx</span> or <span className="font-mono">SS.xx</span>)
                  </label>
                  <input
                    type="text"
                    value={quickFatTimeInput}
                    onChange={(e) => setQuickFatTimeInput(e.target.value)}
                    placeholder="1:55.84"
                    className="w-full min-h-[40px] rounded-lg border border-amber-500/50 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm font-mono font-bold text-amber-600 dark:text-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Meet Name
                  </label>
                  <input
                    type="text"
                    value={quickMeetName}
                    onChange={(e) => setQuickMeetName(e.target.value)}
                    placeholder="Stanford Invitational / State Finals"
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Race Date
                  </label>
                  <input
                    type="date"
                    value={quickDate}
                    onChange={(e) => setQuickDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Timing Source / Platform
                  </label>
                  <select
                    value={quickPlatform}
                    onChange={(e) => setQuickPlatform(e.target.value as OfficialRacePlatform)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="Athletic.net">Athletic.net</option>
                    <option value="TFRRS">TFRRS (Collegiate)</option>
                    <option value="MileSplit">MileSplit</option>
                    <option value="RunSignup">RunSignup</option>
                    <option value="Official FAT">Official FinishLynx FAT</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                    Track Surface / Environment
                  </label>
                  <select
                    value={quickTrackType}
                    onChange={(e) => setQuickTrackType(e.target.value as OfficialTrackSurface)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="OUTDOOR_400M">400m Outdoor Track</option>
                    <option value="INDOOR_BANKED_200M">200m Banked Indoor Track</option>
                    <option value="INDOOR_FLAT_200M">200m Flat Indoor Track</option>
                    <option value="XC_COURSE">Cross Country (XC) Course</option>
                    <option value="ROAD">Certified Road Course</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Place / Heat
                    </label>
                    <input
                      type="text"
                      value={quickPlaceFinish}
                      onChange={(e) => setQuickPlaceFinish(e.target.value)}
                      placeholder="1st (Final)"
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Wind (Optional)
                    </label>
                    <input
                      type="text"
                      value={quickWindReading}
                      onChange={(e) => setQuickWindReading(e.target.value)}
                      placeholder="+0.8 m/s"
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Lap Splits Input + Live Pacing Skyline */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Lap Splits Analyzer ({quickSplitDistance}m Intervals)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Enter comma-separated lap splits (e.g., <span className="font-mono">56.82, 59.02</span> for 800m or <span className="font-mono">63.1, 64.8, 65.2, 63.3</span> for 1600m) to synthesize your race velocity curve.
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg p-0.5 bg-slate-200/70 dark:bg-slate-800">
                    {([200, 400, 1000] as const).map((dist) => (
                      <button
                        key={dist}
                        type="button"
                        onClick={() => setQuickSplitDistance(dist)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-colors ${
                          quickSplitDistance === dist
                            ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {dist}m Splits
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="text"
                  value={quickSplitsInput}
                  onChange={(e) => setQuickSplitsInput(e.target.value)}
                  placeholder="56.82, 59.02"
                  className="w-full min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                />

                {/* Visual Lap Split Skyline Bars */}
                {quickRaceAnalytics.splits.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 pt-1">
                    {quickRaceAnalytics.splits.map((lapSecs, idx) => {
                      const avgLap =
                        quickRaceAnalytics.splits.reduce((s, v) => s + v, 0) /
                        quickRaceAnalytics.splits.length;
                      const deltaVsAvg = lapSecs - avgLap;
                      const isFastLap = deltaVsAvg <= -0.15;
                      return (
                        <div
                          key={idx}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-2.5"
                        >
                          <div className="text-[10px] text-slate-500 font-mono">
                            Lap {idx + 1} ({quickSplitDistance}m)
                          </div>
                          <div className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                            {formatFatTime(lapSecs)}
                          </div>
                          <div
                            className={`text-[10px] font-mono tabular-nums mt-0.5 ${
                              isFastLap
                                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                : deltaVsAvg > 0.6
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-500'
                            }`}
                          >
                            {deltaVsAvg > 0 ? `+${deltaVsAvg.toFixed(2)}s` : `${deltaVsAvg.toFixed(2)}s`} vs avg
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Synthesized Physiological Summary Strip */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums">
                    <span>
                      <strong className="text-slate-700 dark:text-slate-300">Avg 400m:</strong>{' '}
                      <span className="text-amber-600 dark:text-amber-400 font-bold">
                        {quickRaceAnalytics.avg400mSecs}s
                      </span>
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="text-slate-700 dark:text-slate-300">Race VDOT:</strong>{' '}
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                        {quickRaceAnalytics.vdot.toFixed(1)}
                      </span>
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="text-slate-700 dark:text-slate-300">Implied T-Pace:</strong>{' '}
                      <span className="text-blue-600 dark:text-sky-400 font-bold">
                        {formatPace(quickRaceAnalytics.derivedThresholdPaceSecsKm, distanceUnit)}
                      </span>
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="text-slate-700 dark:text-slate-300">Pacing Split:</strong>{' '}
                      <span
                        className={
                          quickRaceAnalytics.splitDiffSecs <= 0
                            ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                            : 'text-amber-600 dark:text-amber-400 font-bold'
                        }
                      >
                        {quickRaceAnalytics.splitDiffSecs <= 0
                          ? `Negative Split (${quickRaceAnalytics.splitDiffSecs}s)`
                          : `Positive Differential (+${quickRaceAnalytics.splitDiffSecs}s)`}
                      </span>
                    </span>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={quickIncludeWarmup}
                      onChange={(e) => setQuickIncludeWarmup(e.target.checked)}
                      className="rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                    />
                    <span>Include Race-Day Warmup &amp; Cooldown (+32 TSS / 3.5 mi)</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleSaveQuickFatRace}
                  className="min-h-[40px] px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center gap-2"
                >
                  <Trophy className="w-4 h-4" />
                  <span>
                    Save {selectedQuickEventDef.label} ({quickRaceAnalytics.displayFat} FAT ·{' '}
                    {quickRaceAnalytics.tssLoad} TSS) to Calendar &amp; Trophy Matrix
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
