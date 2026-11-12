import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  ArrowRight,
  Award,
  BarChart3,
  Bike,
  Bot,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Compass,
  Cpu,
  Database,
  Eye,
  FileText,
  Footprints,
  Gauge,
  HeartPulse,
  HelpCircle,
  Layers,
  LineChart,
  Lock,
  Map,
  Radar,
  RefreshCw,
  Scale,
  Search,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Upload,
  Users,
  X,
  Zap,
} from './icons/PhosphorIcons';

export interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (
    tab: 'fitness' | 'calendar' | 'activities' | 'totals' | 'curves' | 'trends' | 'charts'
  ) => void;
  onOpenDataSources: () => void;
  onOpenRosterModal: () => void;
  onOpenProfileModal: () => void;
  onOpenOfficialRaceModal: () => void;
  onOpenAICoach: (prompt?: string) => void;
}

type ChapterId =
  | 'ch1-quickstart'
  | 'ch2-sync'
  | 'ch3-pmc'
  | 'ch4-calendar'
  | 'ch5-activities'
  | 'ch6-lab'
  | 'ch7-coaching'
  | 'ch8-scholastic'
  | 'glossary';

interface GuideFeatureCard {
  id: string;
  chapterId: Exclude<ChapterId, 'glossary'>;
  badge: string;
  badgeColor: string;
  title: string;
  summary: string;
  bullets: string[];
  formulaOrSyntax?: string;
  ctaLabel: string;
  onAction: () => void;
}

interface GlossaryEntry {
  code: string;
  name: string;
  category: 'Load & PMC' | 'Power & Pace' | 'Autonomic & Recovery' | 'Garmin Load Focus';
  formula: string;
  benchmark: string;
  colorHex: string;
  explanation: string;
}

const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  {
    code: 'CTL',
    name: 'Chronic Training Load (Fitness)',
    category: 'Load & PMC',
    formula: 'CTL_t = CTL_{t-1} + (TSS_t - CTL_{t-1}) / 42',
    benchmark: '40–70 Competitive · 75–115+ Elite Endurance',
    colorHex: '#0ea5e9',
    explanation:
      '42-day exponentially weighted moving average (EWMA) of your daily Training Stress Score (TSS). Represents chronic aerobic base and structural durability.',
  },
  {
    code: 'ATL',
    name: 'Acute Training Load (Fatigue)',
    category: 'Load & PMC',
    formula: 'ATL_t = ATL_{t-1} + (TSS_t - ATL_{t-1}) / 7',
    benchmark: '7-day short-term physiological strain',
    colorHex: '#a855f7',
    explanation:
      '7-day EWMA of daily training load. Responds rapidly to high-volume blocks, intervals, and races, quantifying immediate muscular and autonomic fatigue.',
  },
  {
    code: 'TSB',
    name: 'Training Stress Balance (Form)',
    category: 'Load & PMC',
    formula: 'TSB_t = CTL_t - ATL_t',
    benchmark: 'Optimal Build: -10 to -25 · Peak Race Freshness: +5 to +20',
    colorHex: '#10b981',
    explanation:
      'The net balance between long-term Fitness (CTL) and short-term Fatigue (ATL). THRESH plots five distinct Form zones from Transition (> +25) down to High Risk (< -30).',
  },
  {
    code: 'Ramp Rate',
    name: 'Weekly CTL Ramp Rate',
    category: 'Load & PMC',
    formula: 'Ramp_t = CTL_t - CTL_{t-7}',
    benchmark: '+3.0 to +5.5 CTL/wk Productive · > +7.0 CTL/wk Overreach Warning',
    colorHex: '#f59e0b',
    explanation:
      'Measures how quickly your chronic fitness is climbing week-over-week. Sustained ramps above +7.5 CTL/wk elevate injury and autonomic overreaching risk.',
  },
  {
    code: 'Garmin Load Focus',
    name: 'Low Aerobic / High Aerobic / Anaerobic Stack',
    category: 'Garmin Load Focus',
    formula: 'Chronological Per-Activity Load Stack (Z1-Z2 vs Z3-Z4 vs Z5-Z7)',
    benchmark: 'Low Aerobic (#38bdf8) · High Aerobic (#f97316) · Anaerobic (#d946ef)',
    colorHex: '#38bdf8',
    explanation:
      'Each workout is classified into Garmin Training Load Focus categories using time-in-zone, Intensity Factor (IF), Variability Index (VI), and title semantics. Multi-workout days stack chronologically.',
  },
  {
    code: 'NP / IF / TSS',
    name: 'Normalized Power, Intensity Factor & Training Stress',
    category: 'Power & Pace',
    formula: 'NP = [mean(P_{30s}^4)]^{1/4} · IF = NP/FTP · TSS = (t·NP·IF)/(FTP·3600)×100',
    benchmark: 'IF 0.65–0.75 Endurance · 0.85–0.94 Sweet Spot · >=1.00 Threshold/Race',
    colorHex: '#6366f1',
    explanation:
      'Coggan physiological cost model weighting surges to the 4th power (matching blood lactate accumulation curves) and scaling against your Outdoor or Indoor FTP.',
  },
  {
    code: 'EF & Pa:Hr',
    name: 'Efficiency Factor & Aerobic Decoupling',
    category: 'Power & Pace',
    formula: 'EF = NP / HR_{avg} · Decoupling (%) = ((EF_{1st} - EF_{2nd}) / EF_{1st}) × 100',
    benchmark: '< 3.5% Locked-In Aerobic Durability · > 5.0% Cardiac Drift Warning',
    colorHex: '#14b8a6',
    explanation:
      'Quantifies cardiovascular drift between the first and second halves of a steady session. Decoupling under 3.5% confirms strong mitochondrial endurance at that output.',
  },
  {
    code: "CP & W'",
    name: 'Critical Power & Anaerobic Work Capacity',
    category: 'Power & Pace',
    formula: "P(t) = CP + W' / t   |   W'_{bal}(t) = W' - ∫ max(0, P - CP)·exp(-(t-u)/τ) du",
    benchmark: "CP: Asymptotic sustainable ceiling · W': 12–28 kJ matchbook",
    colorHex: '#ec4899',
    explanation:
      "2-parameter Monod-Scherrer hyperbolic model separating your sustainable aerobic ceiling (CP) from your finite supra-threshold battery (W' in kilojoules), tracked at 1Hz via Skiba W' Balance.",
  },
  {
    code: 'VDOT',
    name: 'Daniels Aerobic Running Index & Riegel Predictor',
    category: 'Power & Pace',
    formula: 'T_2 = T_1 × (D_2 / D_1)^{1.06} · Oxygen Cost + %VO2max Sustainability',
    benchmark: 'VDOT 50–60 Sub-Elite · 65–78+ Collegiate / National Class',
    colorHex: '#f97316',
    explanation:
      'Derived from verified Fully Automatic Timing (FAT) track/XC/road results or peak running efforts to project equivalent 800m, 1500m, Mile, 5K, 10K, Half, and Marathon marks.',
  },
  {
    code: 'HRV CV (7d)',
    name: '7-Day Heart Rate Variability Coefficient of Variation',
    category: 'Autonomic & Recovery',
    formula: 'CV_{7d} = (σ_{rMSSD,7d} / μ_{rMSSD,7d}) × 100%',
    benchmark: '2.0%–6.5% Stable Parasympathetic · > 8.5% Autonomic Instability',
    colorHex: '#22c55e',
    explanation:
      'Tracks both your morning rMSSD (ms) relative to your 60-day normal corridor and day-to-day stability (CV%). Used by the Daily Readiness Morphing Engine to modulate workout intensity.',
  },
  {
    code: 'kJ/kg & kcal Durability',
    name: 'Fatigue-Sliced Physiological Durability (10x #2)',
    category: 'Power & Pace',
    formula: 'Retention(%) = MMP_{20m}(@ 30 kJ/kg or 1,500 kcal) / MMP_{20m}(Fresh) × 100%',
    benchmark: '>= 95% Pro-Tour Resilient · 90–94% Well-Conditioned · < 88% Glycogen Fragile',
    colorHex: '#0d9488',
    explanation:
      'Measures how well your 5-minute and 20-minute power or Grade-Adjusted Pace holds up after accumulating 10–40 kJ/kg of mechanical work (Cycling) or 500–2,000 kcal (Running).',
  },
  {
    code: '3-Channel Ortho ACWR',
    name: 'Central, Eccentric Impact & Concentric Torque Load (10x #1)',
    category: 'Autonomic & Recovery',
    formula: 'Impact_ACWR = Impact_{7d} / Impact_{28d}  |  Guardrail >= 1.28x',
    benchmark: '< 1.18x Optimal · 1.18–1.28x Elevated · > 1.28x Zero-Impact Bike/Pool Swap',
    colorHex: '#d97706',
    explanation:
      'Separates systemic cardiorespiratory load from tibial/Achilles eccentric running impact and concentric cycling torque so high impact spikes can be morphed to zero-impact rides before injury.',
  },
  {
    code: 'NCAA Track Index',
    name: 'NCAA Indoor 200m Flat / Banked / Altitude Conversion (v2.3)',
    category: 'Power & Pace',
    formula: 'T_{indexed} = T_{raw} × Factor_{facility} - Allowance_{altitude(>=3000ft)}',
    benchmark: "Men's Mile Flat->Banked ×0.9869 · Women's Mile Flat->Banked ×0.9882",
    colorHex: '#f59e0b',
    explanation:
      'Applies official NCAA turn-radius facility indexing and elevation hypoxia allowances (>= 3,000 ft) to compare indoor flat, banked, and outdoor marks against HS & NCAA D1/D2/D3 standards.',
  },
  {
    code: '1Hz No-Lap Detector',
    name: 'Unstructured Interval Bimodal Hysteresis Detector (v2.3)',
    category: 'Power & Pace',
    formula: 'Entry = min(Ref_{LT}, P_{50} + 0.42(P_{92} - P_{50})) · Exit = 0.88 × Entry',
    benchmark: 'Recovers >= 18s work reps (200m–3200m) when athlete forgot to press Lap',
    colorHex: '#3b82f6',
    explanation:
      'Scans 5-second smoothed 1Hz velocity or power streams using empirical quantile hysteresis to extract true WORK and float reps even when the watch Lap button was never pressed.',
  },
];

export const UserGuideModal: React.FC<UserGuideModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
  onOpenDataSources,
  onOpenRosterModal,
  onOpenProfileModal,
  onOpenOfficialRaceModal,
  onOpenAICoach,
}) => {
  const [activeChapter, setActiveChapter] = useState<ChapterId>('ch1-quickstart');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [completedChecklist, setCompletedChecklist] = useState<Record<string, boolean>>({
    step1: false,
    step2: false,
    step3: false,
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const triggerAndClose = (callback: () => void) => {
    onClose();
    callback();
  };

  const chapters: {
    id: ChapterId;
    number: string;
    shortTitle: string;
    fullTitle: string;
    subtitle: string;
    icon: React.ComponentType<any>;
    accentClass: string;
  }[] = [
    {
      id: 'ch1-quickstart',
      number: '01',
      shortTitle: 'Quick Start & Vision',
      fullTitle: 'Ch 1 · Quick Start & Why THRESH',
      subtitle:
        'How THRESH unifies Intervals.icu physiological rigor, daily readiness morphing, and multi-source telemetry.',
      icon: Sparkles,
      accentClass: 'text-sky-500 bg-sky-500/12 border-sky-500/30',
    },
    {
      id: 'ch2-sync',
      number: '02',
      shortTitle: 'Strava, Sync & .FIT',
      fullTitle: 'Ch 2 · Strava Sign-In, Sync Windows & Optional Add-Ons',
      subtitle:
        'Sign in with Strava identity, choose what syncs (90d / 6mo / All / Identity Only), optionally add Garmin Connect or Intervals.icu sleep/HRV, or drop .FIT files.',
      icon: Database,
      accentClass: 'text-orange-500 bg-orange-500/12 border-orange-500/30',
    },
    {
      id: 'ch3-pmc',
      number: '03',
      shortTitle: 'PMC & Garmin Load',
      fullTitle: 'Ch 3 · Fitness (CTL), Fatigue (ATL), Form & Garmin Load Focus',
      subtitle:
        'Master the Banister Performance Management Chart, Form (TSB) zones, Ramp Rate, and Daily Stacked Garmin Load Focus bars.',
      icon: HeartPulse,
      accentClass: 'text-emerald-500 bg-emerald-500/12 border-emerald-500/30',
    },
    {
      id: 'ch4-calendar',
      number: '04',
      shortTitle: 'Calendar & Builder',
      fullTitle: 'Ch 4 · Training Calendar, Effort Skylines & Block Builder',
      subtitle:
        'Navigate the 8-column training calendar, Effort Zone Skylines (Z1–Z6), Intervals-syntax Workout Builder, and 3:1 Periodized Block Generator.',
      icon: Calendar,
      accentClass: 'text-indigo-500 bg-indigo-500/12 border-indigo-500/30',
    },
    {
      id: 'ch5-activities',
      number: '05',
      shortTitle: '1Hz Streams & Map',
      fullTitle: 'Ch 5 · Activity Inspector, 1Hz Streams & Route Segments',
      subtitle:
        "Inspect 1Hz Power/HR/Pace/Cadence/W' Balance streams, Aerobic Decoupling (Pa:Hr), GPS segments, and Side-by-Side Workout Overlays.",
      icon: Activity,
      accentClass: 'text-cyan-500 bg-cyan-500/12 border-cyan-500/30',
    },
    {
      id: 'ch6-lab',
      number: '06',
      shortTitle: 'Lab, Curves & Goals',
      fullTitle: 'Ch 6 · Lab & Goals: Power/Pace Curves, Biometrics & Benchmarks',
      subtitle:
        "Explore CP & W' hyperbolic modeling, 6-axis phenotype radar, 7d HRV CV, EF vs. Decoupling quadrants, VDOT predictor, and 2-Athlete Comparator.",
      icon: LineChart,
      accentClass: 'text-fuchsia-500 bg-fuchsia-500/12 border-fuchsia-500/30',
    },
    {
      id: 'ch7-coaching',
      number: '07',
      shortTitle: 'Roster, Privacy & AI',
      fullTitle: 'Ch 7 · Coaching Roster, 6:00 AM Triage, Privacy Shield & Gemini AI',
      subtitle:
        'Manage Coach-Edit vs. Friend-View connections, 6:00 AM Exception Triage, Clean-Room Privacy Shield, and the Gemini AI Coach.',
      icon: Bot,
      accentClass: 'text-amber-500 bg-amber-500/12 border-amber-500/30',
    },
    {
      id: 'ch8-scholastic',
      number: '08',
      shortTitle: 'HS & College Pack',
      fullTitle: 'Ch 8 · High School & Collegiate Team Pack (v2.3)',
      subtitle:
        'Auto-scaled VDOT Pacing Pods, Watchless Split Pad, NCAA Track Indexing, Recruiting Standards, Safe-Sport Shield, Shin BSI Guardrail & 20h CARA Audit.',
      icon: Trophy,
      accentClass: 'text-emerald-500 bg-emerald-500/12 border-emerald-500/30',
    },
    {
      id: 'glossary',
      number: '09',
      shortTitle: 'Physiology Glossary',
      fullTitle: 'Interactive Physiological Glossary & Color Legend',
      subtitle:
        "Complete mathematical formulas, physiological benchmarks, and color codes for CTL, ATL, TSB, Durability, Ortho ACWR, NCAA Index, CP/W', VDOT, and HRV CV.",
      icon: HelpCircle,
      accentClass: 'text-teal-500 bg-teal-500/12 border-teal-500/30',
    },
  ];

  const featureCards: GuideFeatureCard[] = useMemo(
    () => [
      // Chapter 1
      {
        id: 'c1-1',
        chapterId: 'ch1-quickstart',
        badge: 'PILLAR 1 · INTERVALS.ICU RIGOR',
        badgeColor: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25',
        title: 'Banister Impulse-Response & Critical Power Physics',
        summary:
          "THRESH computes true 42-day CTL, 7-day ATL, Form (TSB), Monod-Scherrer Critical Power (CP) & W' anaerobic battery, and first-vs-second-half Aerobic Decoupling (Pa:Hr).",
        bullets: [
          'Separate Outdoor vs. Indoor/Smart-Trainer FTP, LTHR, and 7-zone tables.',
          'Interactive ECharts PMC with brush zoom, custom date windows (7D to ALL), and milestone pins.',
          '14-Day Autonomic Readiness Ledger correlating HRV rMSSD, Resting HR, and Sleep Score.',
        ],
        formulaOrSyntax: 'TSB_t = CTL_{t-1} - ATL_{t-1}  |  P(t) = CP + W′ / t',
        ctaLabel: 'Try It Live: Open Load & Readiness →',
        onAction: () => triggerAndClose(() => onNavigateTab('fitness')),
      },
      {
        id: 'c1-2',
        chapterId: 'ch1-quickstart',
        badge: 'PILLAR 2 · RUNNA / TRAINERROAD ADAPTIVITY',
        badgeColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
        title: 'Closed-Loop Daily Readiness Workout Morphing',
        summary:
          'Static training plans break when life stress, poor sleep, or autonomic suppression hits. THRESH evaluates your morning HRV, RHR, and TSB to morph today’s workout in one click.',
        bullets: [
          'Green (Optimal): Preserves full VO2max / Threshold interval prescription.',
          'Amber (Modulated -15% Load): Downshifts Z5/Z4 repeats into controlled Sweet Spot / Tempo.',
          'Red (Strain Recovery): Converts high-strain days into 45m Z1/Z2 parasympathetic flush.',
        ],
        formulaOrSyntax: '- 15m 60% FTP\n- 4x8m 90% FTP / 3m 55% FTP\n- 10m 50% FTP',
        ctaLabel: 'Try It Live: Launch Gemini AI Coach →',
        onAction: () =>
          triggerAndClose(() =>
            onOpenAICoach(
              'Analyze my current CTL, ATL, TSB, and 7-day HRV trend and recommend today’s optimal workout.'
            )
          ),
      },
      {
        id: 'c1-3',
        chapterId: 'ch1-quickstart',
        badge: 'PILLAR 3 · STRAVA & OFFICIAL FAT RACE INTEL',
        badgeColor: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/25',
        title: 'GPS Segment PRs, Modality Split & Official Track/XC Marks',
        summary:
          'Combines Strava GPS polylines and segment leaderboards with verified 0.01s Fully Automatic Timing (FAT) track/road/XC race results.',
        bullets: [
          'Instant global filter for Combined vs. Outdoor Only vs. Virtual/Trainer workouts.',
          'Interactive Leaflet route maps with color-coded power/HR/grade segment overlays.',
          'Log official Athletic.net, TFRRS, MileSplit, and RunSignup marks with VDOT calculation.',
        ],
        ctaLabel: 'Try It Live: Log Official Race Result →',
        onAction: () => triggerAndClose(() => onOpenOfficialRaceModal()),
      },

      // Chapter 2
      {
        id: 'c2-1',
        chapterId: 'ch2-sync',
        badge: 'STEP 1 & 2 · STRAVA IDENTITY + SYNC CHOICE',
        badgeColor: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/25',
        title: 'Strava Sign-In, Explicit Sync Window & Optional Sleep/HRV Add-Ons',
        summary:
          'Strava handles your THRESH identity across every device with zero passwords. Right after authenticating, you explicitly choose what syncs from Strava—and optionally add Garmin Connect or Intervals.icu later.',
        bullets: [
          'Choose Last 90 Days (Recommended), Last 6 Months, Full Archive, or Identity Only (0 workouts imported).',
          'Optional Secondary Connections: Garmin Connect and Intervals.icu supply overnight HRV & Sleep Score whenever you want, but are never required.',
          'Smart ±5-minute multi-source deduplicator merges workouts without double-counting TSS, while automatic token rotation keeps your session signed in across devices.',
        ],
        ctaLabel: 'Try It Live: Open Data Sources & Sync Policy →',
        onAction: () => triggerAndClose(() => onOpenDataSources()),
      },
      {
        id: 'c2-2',
        chapterId: 'ch2-sync',
        badge: '1HZ BINARY PARSER & DEXIE ARCHIVE',
        badgeColor: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25',
        title: 'Drag-and-Drop .FIT / .GPX / .TCX Import & Local IndexedDB Backup',
        summary:
          'Drop raw Garmin/Wahoo/Zwift files directly into the browser. A dedicated Web Worker parses 1Hz streams off the main thread and stores them permanently in IndexedDB.',
        bullets: [
          'Zero-latency 1Hz stream extraction (Watts, Heart Rate, Velocity, Cadence, Altitude, Lat/Lng).',
          "Computes NP, IF, TSS, 7-zone buckets, Skiba W' Balance, and Mean Maximal Power curves locally.",
          'One-click JSON Archive Export & Import ensures your historical database survives any deployment.',
        ],
        ctaLabel: 'Try It Live: Import .FIT or Manage Archive →',
        onAction: () => triggerAndClose(() => onOpenDataSources()),
      },
      {
        id: 'c2-3',
        chapterId: 'ch2-sync',
        badge: 'ATHLETE THRESHOLDS & ZONES',
        badgeColor: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
        title: 'Calibrating Outdoor FTP, Indoor FTP, LTHR & Threshold Pace',
        summary:
          'Keep your 7-zone Coggan Power and Friel LTHR tables accurate across both outdoor road/track sessions and indoor smart-trainer/treadmill workouts.',
        bullets: [
          "Configure separate Outdoor FTP (W), Indoor FTP (W), W' (J), Pmax (W), and Running Critical Power.",
          'Live zone preview automatically recalculates wattage and BPM boundaries as you type.',
          'Syncs directly from Intervals.icu sportSettings or saves custom local overrides.',
        ],
        ctaLabel: 'Try It Live: Edit Athlete Profile & Zones →',
        onAction: () => triggerAndClose(() => onOpenProfileModal()),
      },

      // Chapter 3
      {
        id: 'c3-1',
        chapterId: 'ch3-pmc',
        badge: 'BANISTER IMPULSE-RESPONSE PMC',
        badgeColor: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25',
        title: 'Reading Fitness (CTL), Fatigue (ATL) & Form (TSB) Zones',
        summary:
          'The upper canvas of the PMC tracks your 42-day Fitness (cyan line), 7-day Fatigue (purple line), and Future Planned Workout projections (dashed trajectory).',
        bullets: [
          'Optimal Training Zone (TSB -10 to -25, Emerald): Productive overload where chronic fitness grows fastest.',
          'Fresh / Race Ready Zone (TSB +5 to +25, Blue): Fatigue has shed faster than fitness during a taper.',
          'High Risk / Overreaching (TSB < -30, Red): Excessive acute strain; schedule a recovery microcycle.',
        ],
        formulaOrSyntax: 'CTL_t = CTL_{t-1} + (TSS_t - CTL_{t-1})/42  |  ATL_t = ATL_{t-1} + (TSS_t - ATL_{t-1})/7',
        ctaLabel: 'Try It Live: Inspect Interactive PMC →',
        onAction: () => triggerAndClose(() => onNavigateTab('fitness')),
      },
      {
        id: 'c3-2',
        chapterId: 'ch3-pmc',
        badge: 'GARMIN TRAINING LOAD FOCUS STACK',
        badgeColor: 'text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/25',
        title: 'Daily Stacked Garmin Load Focus Bars (Low / High / Anaerobic)',
        summary:
          'Every daily load bar on the PMC is segmented by workout and color-coded by its physiological stimulus—even when you perform two or three workouts on the same day.',
        bullets: [
          'Low Aerobic (#38bdf8 Cyan): Z1–Z2 Recovery, Endurance Base, Warmups, and Cooldowns.',
          'High Aerobic (#f97316 Orange): Z3–Z4 Tempo, Sweet Spot, Lactate Threshold, and Marathon Pace.',
          'Anaerobic (#d946ef Magenta): Z5–Z7 VO2max repeats, Track 200m–800m intervals, Sprints, and Crit/Zwift Races.',
          'Multi-Activity Stacking: Morning, afternoon, and evening sessions stack chronologically from bottom to top; hover any day to inspect each individual workout’s load and focus badge.',
        ],
        formulaOrSyntax: 'Stack(day) = ∑_{i=1..k} Segment(Activity_i, FocusColor_i, Load_i)',
        ctaLabel: 'Try It Live: Hover Stacked Load Bars →',
        onAction: () => triggerAndClose(() => onNavigateTab('fitness')),
      },
      {
        id: 'c3-3',
        chapterId: 'ch3-pmc',
        badge: 'RAMP RATE & MILESTONE PINS',
        badgeColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
        title: '7-Day CTL Ramp Rate Sub-Chart & Breakthrough Badges',
        summary:
          'Switch the lower sub-chart between Form (TSB) and Weekly Ramp Rate (CTL/wk), and toggle interactive breakthrough pins on the main curve.',
        bullets: [
          'Target +3.0 to +5.5 CTL/wk during build blocks; > +7.0 CTL/wk triggers an overreach alert.',
          'Milestone Pins highlight eFTP breakthroughs, Official Race PRs, and Peak Power marks directly on the timeline.',
          'Click any activity in the tooltip or milestone bar to jump straight into the 1Hz Activity Inspector.',
        ],
        ctaLabel: 'Try It Live: View Ramp Rate & Milestones →',
        onAction: () => triggerAndClose(() => onNavigateTab('fitness')),
      },

      // Chapter 4
      {
        id: 'c4-1',
        chapterId: 'ch4-calendar',
        badge: '8-COLUMN TRAINING CALENDAR',
        badgeColor: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
        title: 'Effort Zone Skylines (Z1–Z6) & Weekly Load Compliance',
        summary:
          'The 8-column desktop layout displays Monday–Sunday cells alongside a dedicated Weekly Summary Ledger comparing completed vs. planned TSS, duration, and distance.',
        bullets: [
          'Each completed or planned card renders a miniature Z1–Z6 Effort Skyline bar chart proportional to step duration and zone height.',
          'Inline readiness indicators show morning HRV rMSSD and TSB directly inside each calendar day header.',
          'Click any completed workout to inspect 1Hz telemetry, or click "+ Plan" on any date to prescribe a session.',
        ],
        ctaLabel: 'Try It Live: Open Training Calendar →',
        onAction: () => triggerAndClose(() => onNavigateTab('calendar')),
      },
      {
        id: 'c4-2',
        chapterId: 'ch4-calendar',
        badge: 'INTERVALS-SYNTAX WORKOUT BUILDER',
        badgeColor: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25',
        title: 'Plain-Text Structured Workout Parser & Auto-TSS Estimator',
        summary:
          'Write workouts using clean Intervals.icu plain-text shorthand and watch the visual Effort Skyline, total duration, and estimated TSS update on every keystroke.',
        bullets: [
          'Supports percentage FTP (`- 20m 90% FTP`), watt targets (`- 5m 310W`), zone codes (`- 45m Z2`), and nested repeats (`4x8m 105% FTP / 4m 50% FTP`).',
          'One-click preset templates for Sweet Spot Base, VO2max 30/30s, Threshold Over-Unders, and Track 400m Repeats.',
          'Project planned workouts onto the PMC to preview your future CTL and Form on race day.',
        ],
        formulaOrSyntax: '- 15m 60% FTP\n- 5x4m 112% FTP / 3m 50% FTP\n- 10m 55% FTP',
        ctaLabel: 'Try It Live: Build a Structured Workout →',
        onAction: () => triggerAndClose(() => onNavigateTab('calendar')),
      },
      {
        id: 'c4-3',
        chapterId: 'ch4-calendar',
        badge: 'MESOCYCLE BLOCK GENERATOR',
        badgeColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
        title: 'Multi-Week 3:1 Periodized Training Block & Taper Builder',
        summary:
          'Generate a complete 4-to-8-week polarized or sweet-spot training block anchored to your A-Race date with automatic progressive overload and recovery weeks.',
        bullets: [
          'Applies a physiological 3:1 loading rhythm (3 progressive build weeks followed by 1 deload week at -30% volume).',
          'Final 10–14 days automatically transition into a race taper that preserves high-intensity openers while shedding ATL.',
          'Pushes the entire mesocycle to your calendar (or a coached athlete’s calendar) in one transaction.',
        ],
        ctaLabel: 'Try It Live: Generate Periodized Block →',
        onAction: () => triggerAndClose(() => onNavigateTab('calendar')),
      },

      // Chapter 5
      {
        id: 'c5-1',
        chapterId: 'ch5-activities',
        badge: '4-WORKSPACE ACTIVITY LOG',
        badgeColor: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/25',
        title: '1Hz Telemetry Canvas, Lap Table & Aerobic Decoupling (Pa:Hr)',
        summary:
          'Inspect second-by-second Power, Heart Rate, Pace, Cadence, Grade, and Skiba W’ Balance traces with synchronized crosshair scrubbing and brush zoom.',
        bullets: [
          'Automatic work/recovery interval detection showing average watts, NP, HR, stride length, and per-lap decoupling.',
          'First-Half vs. Second-Half Efficiency Factor (EF) audit flags cardiac drift when Pa:Hr exceeds 5.0%.',
          '7-Zone Power, Heart Rate, and Pace distribution histograms with exact time-in-zone percentages.',
        ],
        formulaOrSyntax: 'Pa:Hr (%) = ((EF_{1st Half} - EF_{2nd Half}) / EF_{1st Half}) × 100',
        ctaLabel: 'Try It Live: Open Activity Inspector →',
        onAction: () => triggerAndClose(() => onNavigateTab('activities')),
      },
      {
        id: 'c5-2',
        chapterId: 'ch5-activities',
        badge: 'GPS ROUTE MAP & SEGMENT PRS',
        badgeColor: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/25',
        title: 'Interactive Leaflet Route Map, Segment Leaderboard & Multi-Workout Overlay',
        summary:
          'Switch seamlessly between the Activity Log, full-bleed GPS Route Explorer, Strava Segment PR matrix, and 2-Workout Overlay Comparator.',
        bullets: [
          'Color-code GPS tracks by Power Zone, Heart Rate Zone, or Grade % and click any Strava segment to zoom to its exact lat/lng bounds.',
          'Benchmark Segment History tracks your elapsed time, W/kg, and HR progression across repeat ascents or track loops.',
          'Compare 2 Workouts mode overlays any two historical sessions on a normalized time/distance axis.',
        ],
        ctaLabel: 'Try It Live: Explore Routes & Segments →',
        onAction: () => triggerAndClose(() => onNavigateTab('activities')),
      },

      // Chapter 6
      {
        id: 'c6-1',
        chapterId: 'ch6-lab',
        badge: 'POWER & PACE CURVES (CP / W′)',
        badgeColor: 'text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/25',
        title: 'Mean Maximal Power/Pace Envelope & 6-Axis Phenotype Radar',
        summary:
          'Compare Outdoor, Indoor, and All-Time Season Best power/pace curves from 5 seconds to 3 hours alongside a 6-axis physiological phenotype radar.',
        bullets: [
          "Solves the Monod-Scherrer hyperbolic equation to isolate Critical Power (CP) and anaerobic work capacity (W' in kJ).",
          '6-Axis Radar benchmarks Neuromuscular 5s, Anaerobic 1m, VO2max 5m, Threshold 20m, Stamina 60m, and Durability.',
          'Toggle between absolute Watts, relative W/kg, and Running Pace (min/km or min/mi).',
        ],
        ctaLabel: 'Try It Live: Open Power & Pace Curves →',
        onAction: () => triggerAndClose(() => onNavigateTab('curves')),
      },
      {
        id: 'c6-2',
        chapterId: 'ch6-lab',
        badge: 'BIOMETRICS & GOALS',
        badgeColor: 'text-teal-600 dark:text-teal-400 bg-teal-500/10 border-teal-500/25',
        title: '7d HRV CV, EF vs. Decoupling Quadrant, VDOT Predictor & Custom Lab',
        summary:
          'Monitor long-term autonomic stability in Biometrics, track annual mileage & gear wear in Goals & Totals, or build dual-metric regressions in Benchmarks.',
        bullets: [
          'Biometrics Tab: 60-day HRV normal corridor, 7-day HRV Coefficient of Variation (CV%), Sleep Debt, and EF vs. Pa:Hr scatter quadrant.',
          'Goals & Totals Tab: Independent Running & Cycling annual distance pacing, VDOT + Riegel race equivalency table, and shoe/bike drivetrain wear alerts.',
          'Benchmarks Tab: 2-Athlete Side-by-Side Comparator and Custom Dual-Axis Time-Series / Scatter Chart Builder.',
        ],
        ctaLabel: 'Try It Live: Open Biometrics & Trends →',
        onAction: () => triggerAndClose(() => onNavigateTab('trends')),
      },

      // Chapter 7
      {
        id: 'c7-1',
        chapterId: 'ch7-coaching',
        badge: 'COACHING ROSTER & PRIVACY SHIELD',
        badgeColor: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
        title: 'Coach-Edit vs. Friend-View Connections & Strava Compliance Shield',
        summary:
          'Connect with coaches, teammates, or training partners using invite codes while retaining granular control over your wellness, PMC, and GPS route visibility.',
        bullets: [
          'COACH_EDIT Role: Allows trusted coaches to inspect your readiness and push structured workouts or multi-week blocks directly to your calendar.',
          'FRIEND_VIEW Role: Read-only peer benchmarking for dual-athlete radar and PMC comparisons.',
          'Strava Compliance Shield: Automatically redacts raw Strava-only GPS coordinates for third-party viewers while preserving aggregate load and official FAT race marks.',
        ],
        ctaLabel: 'Try It Live: Open Roster & Privacy Settings →',
        onAction: () => triggerAndClose(() => onOpenRosterModal()),
      },
      {
        id: 'c7-2',
        chapterId: 'ch7-coaching',
        badge: 'GEMINI AI TRAINING COACH',
        badgeColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
        title: 'Context-Aware AI Workout Generator & Physiological Chat',
        summary:
          'Powered by Google Gemini and grounded in your live CTL/ATL/TSB, 14-day HRV ledger, recent decoupling, and upcoming A-Race milestones.',
        bullets: [
          'Generates 3 daily workout tiers (Optimal Progression, Modulated Aerobic, Active Recovery) with one-click Calendar push.',
          'Multi-turn physiological chat cites your exact metrics (`CTL`, `TSB`, `HRV rMSSD`, `eFTP`, `VDOT`) in every answer.',
          'Works seamlessly in both Live Gemini API mode and deterministic offline physiological fallback mode.',
        ],
        ctaLabel: 'Try It Live: Open Gemini AI Coach Drawer →',
        onAction: () => triggerAndClose(() => onOpenAICoach()),
      },

      // Chapter 8: High School & Collegiate Team Pack (v2.3)
      {
        id: 'c8-0',
        chapterId: 'ch8-scholastic',
        badge: 'TEAM ONBOARDING · QR, CSV & SHARING TIERS',
        badgeColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
        title: 'School & Club Workspace Studio, Locker-Room QR Posters & Athlete Sharing Tiers',
        summary:
          'Create a branded High School, Collegiate, or Club workspace in 60 seconds or join an existing team via 6-character Team Code or /join/<slug> magic link using Strava Sign-In.',
        bullets: [
          'Print Locker-Room QR Sheets or import a roster CSV (Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark); THRESH auto-matches athletes when they sign in with Strava.',
          'Athletes choose their Coach Sharing Tier during onboarding: Readiness & Training Summary (Recommended), Full Coach Telemetry, or Load Only.',
          'High School programs default U18 Safe-Sport Weight Shield ON; Collegiate rosters preserve adult visibility while auditing NCAA 20-Hour CARA caps.',
        ],
        ctaLabel: 'Try It Live: Open Team Studio & Roster →',
        onAction: () => triggerAndClose(() => onOpenRosterModal()),
      },
      {
        id: 'c8-1',
        chapterId: 'ch8-scholastic',
        badge: 'AUTO-SCALED SQUAD PACING PODS',
        badgeColor: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
        title: 'VDOT Pacing Pod Generator, Printable Clipboard Sheet & Watchless Split Pad',
        summary:
          'Write one team workout once: THRESH clusters your varsity and developmental squad into Pods A–D (±2s/400m) with exact 200m–1600m splits and a live 0.01s Spikes-On Split Stopwatch.',
        bullets: [
          'Auto-calculates 200m, 400m, 800m, 1000m, and 1600m target splits across Easy, Marathon, Threshold/CV, VO2max, and Mile Repetition intensities.',
          '1-Click Push to Pod schedules the auto-scaled workout directly onto every coached athlete’s calendar in that pod.',
          'Trackside Watchless Split Pad lets coaches or managers tap 0.01s splits for athletes racing or repping in spikes without GPS watches.',
        ],
        ctaLabel: 'Try It Live: Open HS & College Coach Deck →',
        onAction: () => triggerAndClose(() => onOpenRosterModal()),
      },
      {
        id: 'c8-2',
        chapterId: 'ch8-scholastic',
        badge: 'NCAA TRACK INDEXING & RECRUITING',
        badgeColor: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 border-sky-500/25',
        title: 'Official NCAA Flat/Banked/Altitude Track Converter & Recruiting Matrix',
        summary:
          'Converts indoor 200m flat, 200m banked, and 400m outdoor track marks with official NCAA multipliers and altitude allowances (>= 3,000 ft), plus live recruiting standard bars.',
        bullets: [
          'Supports Men’s and Women’s standards across 800m, 1500m, 1600m, Mile, 3000m, 3200m, 5000m, and 10000m.',
          'Displays exact seconds-to-qualify and progress bars for HS State, HS Nationals, NCAA D3, NCAA D2, NCAA D1 Walk-On, and NCAA D1 Scholarship.',
          'Includes 10x #6 GPS-to-Official Chip/FAT Rubber-Banding and shareable THV-... Verified Race Passports.',
        ],
        ctaLabel: 'Try It Live: Open NCAA Converter & Race Logger →',
        onAction: () => triggerAndClose(() => onOpenOfficialRaceModal()),
      },
      {
        id: 'c8-3',
        chapterId: 'ch8-scholastic',
        badge: 'SAFE-SPORT, BSI GUARDRAIL & 20H CARA',
        badgeColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
        title: 'Safe-Sport Weight Shield, Shin BSI / Ferritin Check-In & Cross-Training Miles',
        summary:
          'Protects student-athletes from RED-S and Bone Stress Injuries (BSI) while translating training-room cross-training into virtual running miles.',
        bullets: [
          'Safe-Sport Mode masks body weight (kg/lbs) and W/kg across student-athlete views while keeping power/pace zones calibrated.',
          '5-Second Student-Athlete Check-In flags focal shin/metatarsal bone pain (>= 2/3), low serum ferritin (< 30 ng/mL), and Midterm/Finals exam stress.',
          'Converts Aqua Jogging, AlterG, Elliptical, Arc Trainer, and Spin Bike minutes + RPE into Virtual Running Miles and audits NCAA 20-Hour CARA caps.',
        ],
        ctaLabel: 'Try It Live: Open Student-Athlete Check-In →',
        onAction: () => triggerAndClose(() => onNavigateTab('fitness')),
      },
      {
        id: 'c8-4',
        chapterId: 'ch8-scholastic',
        badge: 'FORGOT-TO-LAP 1HZ REP RECOVERY',
        badgeColor: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
        title: '1Hz Unstructured Track & Fartlek Interval Auto-Detection',
        summary:
          'Recovers crisp WORK and float reps from 1Hz velocity or power streams even when the athlete forgot to press the watch Lap button.',
        bullets: [
          'Bimodal quantile hysteresis detector extracts work reps down to 18s (capturing fast 200m repeats) and overrides 1-mile auto-laps.',
          'Snaps standard track distances (~200m, ~400m, ~800m, ~1000m, ~1600m) automatically.',
          'Click any recovered rep in the Activity Inspector to zoom the 1Hz stream canvas to that exact window.',
        ],
        ctaLabel: 'Try It Live: Open Activity Inspector →',
        onAction: () => triggerAndClose(() => onNavigateTab('activities')),
      },
    ],
    []
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredFeatureCards = useMemo(() => {
    if (!normalizedQuery) {
      return featureCards.filter((card) => card.chapterId === activeChapter);
    }
    return featureCards.filter(
      (card) =>
        card.title.toLowerCase().includes(normalizedQuery) ||
        card.summary.toLowerCase().includes(normalizedQuery) ||
        card.badge.toLowerCase().includes(normalizedQuery) ||
        card.bullets.some((b) => b.toLowerCase().includes(normalizedQuery)) ||
        (card.formulaOrSyntax && card.formulaOrSyntax.toLowerCase().includes(normalizedQuery))
    );
  }, [featureCards, activeChapter, normalizedQuery]);

  const filteredGlossary = useMemo(() => {
    if (!normalizedQuery) return GLOSSARY_ENTRIES;
    return GLOSSARY_ENTRIES.filter(
      (g) =>
        g.code.toLowerCase().includes(normalizedQuery) ||
        g.name.toLowerCase().includes(normalizedQuery) ||
        g.category.toLowerCase().includes(normalizedQuery) ||
        g.explanation.toLowerCase().includes(normalizedQuery) ||
        g.formula.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery]);

  if (!isOpen) return null;

  const activeChapterMeta = chapters.find((c) => c.id === activeChapter) || chapters[0];

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-md p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="thresh-user-guide-title"
    >
      <div
        className="liquid-glass w-full max-w-6xl rounded-t-3xl sm:rounded-3xl border border-slate-200/80 dark:border-slate-800/90 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[88vh] text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header + Search Bar */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/75 dark:bg-slate-900/75 backdrop-blur-xl flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[#101411] text-[#C8FF00] dark:bg-[#C8FF00] dark:text-[#080A09] flex items-center justify-center shadow-md shrink-0">
                <HelpCircle className="w-5 h-5" weight="duotone" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full ap-status-info font-semibold">
                    Interactive Manual & Physiology Reference
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 hidden sm:inline">
                    Press ESC to close
                  </span>
                </div>
                <h2
                  id="thresh-user-guide-title"
                  className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white truncate mt-0.5"
                >
                  THRESH Stadium Track Edition — Interactive User Guide
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors shrink-0"
              aria-label="Close User Guide"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Real-Time Search Input + Quick Jump Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search any metric, workflow, or formula (e.g., Garmin Load Focus, CTL, Pa:Hr, W', Strava, Block Builder)..."
                className="w-full pl-9 pr-20 py-2 rounded-xl text-xs sm:text-sm bg-slate-100/90 dark:bg-slate-950/80 border border-slate-300/80 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
              <a
                href="/docs/index.html"
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#101411] text-[#C8FF00] dark:bg-[#C8FF00] dark:text-[#080A09] whitespace-nowrap transition-colors"
              >
                Open Online Docs (/docs) ↗
              </a>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveChapter('ch8-scholastic');
                }}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/25 whitespace-nowrap transition-colors"
              >
                HS &amp; College Pack
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveChapter('ch3-pmc');
                }}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/25 whitespace-nowrap transition-colors"
              >
                Garmin Load Stack
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setActiveChapter('glossary');
                }}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-teal-500/10 hover:bg-teal-500/20 text-teal-600 dark:text-teal-400 border border-teal-500/25 whitespace-nowrap transition-colors"
              >
                Formulas &amp; Glossary ({GLOSSARY_ENTRIES.length})
              </button>
            </div>
          </div>

          {/* Mobile Horizontal Chapter Pill Strip (< md) */}
          <div className="flex md:hidden items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
            {chapters.map((ch) => {
              const Icon = ch.icon;
              const isSelected = !normalizedQuery && activeChapter === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setActiveChapter(ch.id);
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap border transition-all ${
                    isSelected
                      ? 'bg-sky-500 text-white border-sky-400 shadow-sm'
                      : 'bg-slate-100/80 dark:bg-slate-900/70 text-slate-600 dark:text-slate-400 border-slate-200/70 dark:border-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {ch.number}. {ch.shortTitle}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Body: Left Chapter Rail (Desktop) + Right Scrollable Content */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Desktop Sidebar Navigation */}
          <aside className="hidden md:flex md:w-72 lg:w-80 shrink-0 border-r border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/45 flex-col justify-between p-3 overflow-y-auto">
            <div className="space-y-1">
              <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                9 Chapters &amp; Physiology Reference
              </div>
              {chapters.map((ch) => {
                const Icon = ch.icon;
                const isSelected = !normalizedQuery && activeChapter === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setActiveChapter(ch.id);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-start gap-2.5 border ${
                      isSelected
                        ? 'liquid-capsule-active border-sky-500/40 dark:border-sky-500/40 text-slate-900 dark:text-white shadow-sm'
                        : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${ch.accentClass}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          CH {ch.number}
                        </span>
                        {isSelected && <ChevronRight className="w-3.5 h-3.5 text-sky-500" />}
                      </div>
                      <div className="text-xs font-semibold truncate">{ch.shortTitle}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Sidebar Quick Launch Box */}
            <div className="mt-4 p-3 rounded-2xl liquid-glass-subtle space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Zap className="w-4 h-4 text-amber-500" />
                <span>Instant Live Shortcuts</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Jump straight from this guide to any modal or workspace:
              </p>
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => triggerAndClose(() => onOpenDataSources())}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-slate-200/70 dark:bg-slate-800/80 hover:bg-sky-500/20 text-slate-700 dark:text-slate-200 truncate text-center transition-colors"
                >
                  Data Sync
                </button>
                <button
                  type="button"
                  onClick={() => triggerAndClose(() => onOpenProfileModal())}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-slate-200/70 dark:bg-slate-800/80 hover:bg-sky-500/20 text-slate-700 dark:text-slate-200 truncate text-center transition-colors"
                >
                  FTP & Zones
                </button>
                <button
                  type="button"
                  onClick={() => triggerAndClose(() => onOpenRosterModal())}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-slate-200/70 dark:bg-slate-800/80 hover:bg-sky-500/20 text-slate-700 dark:text-slate-200 truncate text-center transition-colors"
                >
                  Coach Roster
                </button>
                <button
                  type="button"
                  onClick={() => triggerAndClose(() => onOpenAICoach())}
                  className="px-2 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 truncate text-center transition-colors"
                >
                  AI Coach
                </button>
              </div>
            </div>
          </aside>

          {/* Right Scrollable Chapter Content Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-white/40 dark:bg-slate-950/20">
            {/* Search Results Banner when searchQuery is non-empty */}
            {normalizedQuery ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Search Results for “{searchQuery}”
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Found {filteredFeatureCards.length} workflow guides and{' '}
                      {filteredGlossary.length} physiological glossary entries
                    </p>
                  </div>
                </div>

                {filteredFeatureCards.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Matching Workflows & Chapters
                    </h4>
                    <div className="grid grid-cols-1 gap-4">
                      {filteredFeatureCards.map((card) => (
                        <div
                          key={card.id}
                          className="p-4 rounded-2xl liquid-glass-subtle border border-slate-200/80 dark:border-slate-800/80 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full border font-semibold ${card.badgeColor}`}
                            >
                              {card.badge}
                            </span>
                            <button
                              type="button"
                              onClick={card.onAction}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-sm transition-colors"
                            >
                              <span>{card.ctaLabel}</span>
                            </button>
                          </div>
                          <h5 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                            {card.title}
                          </h5>
                          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                            {card.summary}
                          </p>
                          <ul className="space-y-1.5">
                            {card.bullets.map((b, i) => (
                              <li
                                key={i}
                                className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredGlossary.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Matching Physiological Glossary & Formulas
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredGlossary.map((entry) => (
                        <div
                          key={entry.code}
                          className="p-3.5 rounded-2xl liquid-glass-subtle border border-slate-200/80 dark:border-slate-800/80 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: entry.colorHex }}
                              />
                              <span className="font-mono font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                                {entry.code}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {entry.category}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {entry.name}
                          </div>
                          <div className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-sky-300 font-mono text-[11px] overflow-x-auto">
                            {entry.formula}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                            {entry.explanation}
                          </p>
                          <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                            Target: {entry.benchmark}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {filteredFeatureCards.length === 0 && filteredGlossary.length === 0 && (
                  <div className="p-8 text-center rounded-2xl liquid-glass-subtle">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      No chapters or physiological terms matched “{searchQuery}”.
                    </p>
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="mt-3 px-4 py-1.5 rounded-xl text-xs font-semibold bg-sky-500 text-white"
                    >
                      Reset Search
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Chapter Hero Header */}
                <div className="p-4 sm:p-5 rounded-2xl liquid-glass-subtle border border-slate-200/80 dark:border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                        Chapter {activeChapterMeta.number} of 09
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        THRESH Telemetry & Coaching Manual
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                      {activeChapterMeta.fullTitle}
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
                      {activeChapterMeta.subtitle}
                    </p>
                  </div>
                </div>

                {/* Chapter 1 Interactive 3-Step Onboarding Checklist */}
                {activeChapter === 'ch1-quickstart' && (
                  <div className="p-4 sm:p-5 rounded-2xl border border-sky-500/30 bg-sky-500/5 space-y-3.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-sky-500" />
                        <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider font-mono text-sky-600 dark:text-sky-400">
                          Interactive 3-Step Quick Start Checklist
                        </h4>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {Object.values(completedChecklist).filter(Boolean).length} / 3 Completed
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3.5 rounded-xl liquid-glass-subtle flex flex-col justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold uppercase text-orange-500">
                              Step 1 · Data Ingest
                            </span>
                            <input
                              type="checkbox"
                              checked={completedChecklist.step1}
                              onChange={(e) =>
                                setCompletedChecklist((prev) => ({
                                  ...prev,
                                  step1: e.target.checked,
                                }))
                              }
                              className="rounded border-slate-400 text-sky-500 focus:ring-sky-500"
                              aria-label="Mark Step 1 Complete"
                            />
                          </div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white">
                            Choose Strava Sync Window or Add Optional Sleep
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                            Pick 90d / 6mo / Full Strava history, optionally connect Garmin or Intervals.icu, or drop .FIT files.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => triggerAndClose(() => onOpenDataSources())}
                          className="w-full py-1.5 px-2.5 rounded-lg text-xs font-semibold bg-orange-500/15 hover:bg-orange-500/25 text-orange-600 dark:text-orange-400 border border-orange-500/30 flex items-center justify-center gap-1 transition-colors"
                        >
                          <span>Open Data Sources</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="p-3.5 rounded-xl liquid-glass-subtle flex flex-col justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold uppercase text-sky-500">
                              Step 2 · Thresholds
                            </span>
                            <input
                              type="checkbox"
                              checked={completedChecklist.step2}
                              onChange={(e) =>
                                setCompletedChecklist((prev) => ({
                                  ...prev,
                                  step2: e.target.checked,
                                }))
                              }
                              className="rounded border-slate-400 text-sky-500 focus:ring-sky-500"
                              aria-label="Mark Step 2 Complete"
                            />
                          </div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white">
                            Verify Outdoor/Indoor FTP & LTHR Zones
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                            Calibrate Cycling FTP, Smart-Trainer FTP, W&apos;, and Running Threshold Pace.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => triggerAndClose(() => onOpenProfileModal())}
                          className="w-full py-1.5 px-2.5 rounded-lg text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-600 dark:text-sky-400 border border-sky-500/30 flex items-center justify-center gap-1 transition-colors"
                        >
                          <span>Calibrate Athlete Zones</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="p-3.5 rounded-xl liquid-glass-subtle flex flex-col justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold uppercase text-emerald-500">
                              Step 3 · Daily Morphing
                            </span>
                            <input
                              type="checkbox"
                              checked={completedChecklist.step3}
                              onChange={(e) =>
                                setCompletedChecklist((prev) => ({
                                  ...prev,
                                  step3: e.target.checked,
                                }))
                              }
                              className="rounded border-slate-400 text-sky-500 focus:ring-sky-500"
                              aria-label="Mark Step 3 Complete"
                            />
                          </div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white">
                            Inspect PMC & Morph Today&apos;s Workout
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                            Review your 14-day HRV readiness ledger and sync today&apos;s adapted session.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => triggerAndClose(() => onNavigateTab('fitness'))}
                          className="w-full py-1.5 px-2.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center gap-1 transition-colors"
                        >
                          <span>Go to Load & Readiness</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chapter 3 Visual Legend for Garmin Load Focus & TSB Form Zones */}
                {activeChapter === 'ch3-pmc' && (
                  <div className="p-4 sm:p-5 rounded-2xl liquid-glass-subtle border border-slate-200/80 dark:border-slate-800/80 space-y-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h4 className="text-xs font-mono uppercase tracking-wider font-bold text-slate-700 dark:text-slate-200">
                        Visual Color Legend · Garmin Load Focus Stacked Bars & Form (TSB) Zones
                      </h4>
                      <span className="text-[11px] font-mono text-slate-500">
                        Multi-workout days stack chronologically (AM → PM)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl border border-sky-500/30 bg-sky-500/10 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3.5 h-3.5 rounded-sm shrink-0"
                            style={{ backgroundColor: '#38bdf8' }}
                          />
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            Low Aerobic · #38bdf8
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          Z1–Z2 Recovery, Endurance Base, Easy Shakeouts, Warmups, and Cooldowns (IF &lt; 0.80).
                        </p>
                      </div>

                      <div className="p-3 rounded-xl border border-orange-500/30 bg-orange-500/10 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3.5 h-3.5 rounded-sm shrink-0"
                            style={{ backgroundColor: '#f97316' }}
                          />
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            High Aerobic · #f97316
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          Z3–Z4 Tempo, Sweet Spot (88–94% FTP), Lactate Threshold, and Cruise Intervals.
                        </p>
                      </div>

                      <div className="p-3 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3.5 h-3.5 rounded-sm shrink-0"
                            style={{ backgroundColor: '#d946ef' }}
                          />
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            Anaerobic · #d946ef
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          Z5–Z7 VO2max Repeats, Track 200m–800m Intervals, Sprints, and Crit/Zwift Races.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Feature Cards for Chapters 1–7 */}
                {activeChapter !== 'glossary' && (
                  <div className="grid grid-cols-1 gap-4">
                    {filteredFeatureCards.map((card) => (
                      <div
                        key={card.id}
                        className="p-4 sm:p-5 rounded-2xl liquid-glass-subtle border border-slate-200/80 dark:border-slate-800/80 space-y-3.5 transition-all hover:border-sky-500/40"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span
                            className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full border font-semibold ${card.badgeColor}`}
                          >
                            {card.badge}
                          </span>
                          <button
                            type="button"
                            onClick={card.onAction}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-sm transition-colors cursor-pointer"
                          >
                            <span>{card.ctaLabel}</span>
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                            {card.title}
                          </h4>
                          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                            {card.summary}
                          </p>
                        </div>

                        {card.formulaOrSyntax && (
                          <pre className="px-3.5 py-2.5 rounded-xl bg-slate-900 text-sky-300 font-mono text-[11px] sm:text-xs overflow-x-auto border border-slate-800">
                            {card.formulaOrSyntax}
                          </pre>
                        )}

                        <ul className="space-y-1.5 pt-1">
                          {card.bullets.map((bullet, idx) => (
                            <li
                              key={idx}
                              className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"
                            >
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {/* Chapter 8: Interactive Physiological Glossary & Color Legend */}
                {activeChapter === 'glossary' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {GLOSSARY_ENTRIES.map((entry) => (
                        <div
                          key={entry.code}
                          className="p-4 rounded-2xl liquid-glass-subtle border border-slate-200/80 dark:border-slate-800/80 space-y-2.5 flex flex-col justify-between"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                                  style={{ backgroundColor: entry.colorHex }}
                                />
                                <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                                  {entry.code}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {entry.category}
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {entry.name}
                            </div>
                            <div className="px-3 py-1.5 rounded-lg bg-slate-900 text-sky-300 font-mono text-[11px] overflow-x-auto border border-slate-800">
                              {entry.formula}
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                              {entry.explanation}
                            </p>
                          </div>
                          <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                            Benchmark: {entry.benchmark}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Bottom Footer with Chapter Prev/Next Controls */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200/80 dark:border-slate-800/80 bg-white/75 dark:bg-slate-900/75 backdrop-blur-xl flex items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
            Docs Suite: <code className="text-sky-600 dark:text-sky-400">docs/USER_GUIDE.md</code> ·{' '}
            <code className="text-sky-600 dark:text-sky-400">docs/PHYSIOLOGY_AND_METRICS.md</code> ·{' '}
            <code className="text-sky-600 dark:text-sky-400">docs/DESIGN_SYSTEM.md</code>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const idx = chapters.findIndex((c) => c.id === activeChapter);
                const nextIdx = (idx + 1) % chapters.length;
                setSearchQuery('');
                setActiveChapter(chapters[nextIdx].id);
              }}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors"
            >
              Next Chapter →
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-white shadow-sm transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
