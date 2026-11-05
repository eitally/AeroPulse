# AeroPulse — Unified Multi-Sport Physiology, Load, Segments, Goals & AI Coaching PWA

AeroPulse unifies your **Intervals.icu** (including auto-synced **Garmin Connect** daily health & workout telemetry) and **Strava** data into an installable, mobile-ready **Progressive Web App (PWA)** and desktop physiological cockpit. It correlates daily autonomic readiness (HRV, Resting HR, Sleep) with chronic training load (CTL, ATL, TSB), **Outdoor vs. Indoor (Treadmill/Trainer)** activity filtering, **Strava Segment Performance**, **Separate Running & Cycling Annual Mileage Targets**, **Target Race & Performance Goals**, and an interactive **Gemini Health & Fitness Coach**.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Scope & Fork-Ready GitHub Documentation**
> - **Fork-Ready `README.md`, `.env.example` & In-App Setup Guide**:
>   - The repository will include a complete, step-by-step **`README.md`** and documented **`.env.example`** designed for other athletes or developers who fork or clone the GitHub repo:
>     1. **Intervals.icu + Garmin Connect Sync Setup**: How to link Garmin Connect (activities + wellness/HRV/sleep) in Intervals.icu and generate a personal `INTERVALS_API_KEY` and `INTERVALS_ATHLETE_ID` at `https://intervals.icu/settings`.
>     2. **Strava OAuth2 App Setup**: How to create a personal Strava API application at `https://www.strava.com/settings/api`, obtain `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`, and configure the Authorization Callback Domain for Vercel, Cloud Run, or `localhost:3000`.
>     3. **Gemini API Key Setup**: How to configure `GEMINI_API_KEY` in Vercel or local `.env` for the AI Coach and Daily Workout Options Generator.
>     4. **One-Click Vercel / GitHub Deployment Guide**: Step-by-step instructions for importing the forked repository into Vercel and setting environment variables.
> - **Separate Annual Mileage Targets (Running & Cycling)**:
>   - Dedicated YTD mileage pacing trackers for **Running** and **Cycling** (with `mi` / `km` unit toggle), comparing cumulative distance against the pro-rated daily target line (*Ahead / Behind Pace*), required weekly average for the rest of the year, and an **Outdoor vs. Indoor (Treadmill / Trainer)** mileage split bar.
> - **Outdoor vs. Indoor (Treadmill / Smart Trainer) Filter**:
>   - Global and view-level environment selector (`Combined`, `Outdoor Only`, `Indoor: Trainer / Treadmill`) so you can isolate outdoor road/trail efforts, indoor Zwift/trainer/treadmill sessions, or analyze both together.
> - **Strava Segment Performance & Benchmark History**:
>   - Pulls detailed Strava `segment_efforts` (`include_all_efforts=true`) and starred segments, surfacing PR ranks (`1st`, `2nd`, `3rd`), elapsed time, average power (`W` / `W/kg`), pace, heart rate, and grade inside each activity and across historical attempts.

---

## 1. Overview & Core Concept

- **What It Does**: Acts as a single pane of glass over your athletic physiology on both desktop and mobile home screens. By bridging Intervals.icu’s sports-science engine (and its Garmin Connect wellness pipeline) with Strava’s activity & segment telemetry and Gemini’s reasoning engine, it answers five questions every day:
  1. *How recovered is my autonomic nervous system today?* (HRV rMSSD vs. 7-day rolling baseline, RHR, Sleep).
  2. *How is my training load and annual mileage trending toward my Running and Cycling targets?* (Fitness CTL vs. Target Peak CTL, plus YTD Running & Cycling mileage pacing split by Outdoor vs. Trainer/Treadmill).
  3. *How am I performing on key Strava segments and physiological curves?* (Segment PRs, `W/kg` or pace vs. HR on benchmark climbs/routes, and aerobic decoupling).
  4. *What are my best workout options for today?* (3 selectable daily workout prescriptions tailored to your readiness, indoor/outdoor preference, schedule, and sport).
  5. *What does my data say when I ask a specific question?* (Interactive Gemini Coach chat grounded in your live wellness, activities, segments, and goals).

---

## 2. User Experience, Mobile PWA & Visual Design

### Key User Flows
1. **Desktop Top Bar & Mobile Bottom Tab Bar Navigation**:
   - **Desktop (`md:` and up)**: Follows the strict three-zone Top Bar Contract — **AeroPulse** wordmark on the left, five concise single-line navigation links in the center (`Overview`, `Activities`, `Physiology`, `Goals`, `Coach`), and the primary action (`Data Sources` + contextual `Install App` trigger) on the right.
   - **Mobile PWA (`< md`)**: Compact sticky top header with brand wordmark, `Install App` / `Data Sources` trigger, and a fixed thumb-zone **Bottom Tab Bar** (`Overview`, `Activities`, `Physiology`, `Goals`, `Coach`) with `44×44px` minimum touch hitboxes and `<15%` aggregate sticky viewport height.
   - **Global Environment & Unit Filter Bar**: Below the header, users can toggle **Sport** (`All`, `Cycling`, `Running`, `Swim & Multisport`, `Strength`), **Environment** (`Combined`, `Outdoor Only`, `Indoor: Trainer/Treadmill`), and **Distance Units** (`mi` / `km`).
2. **Data Sources & Self-Service Onboarding Modal**:
   - Allows any user who forks or opens the app to connect their own data either via **Environment Variables** (`.env` / Vercel Dashboard) or directly via **In-App Credential Input** (Intervals.icu Athlete ID + API Key and Strava OAuth2 Client ID / Secret or one-click OAuth popup).
   - Displays dynamic, copyable OAuth callback URLs that automatically adapt to whichever domain the fork is hosted on (`window.location.origin/auth/strava/callback`).
3. **Overview View (Readiness, PMC & Annual Mileage Pacing)**:
   - **Morning Readiness Strip**: Displays today's synced Garmin/Intervals.icu wellness metrics—HRV (`ms` + 7-day baseline delta), Resting HR (`bpm`), Sleep Duration & Score, VO2max, and Form (`TSB`)—using tabular numerals and explicit semantic labels (`Optimal`, `Caution`, `Strain`).
   - **Interactive PMC (Fitness, Fatigue & Form Chart + Goal Projection)**: Full-width interactive chart plotting CTL (Fitness), ATL (Fatigue), and TSB (Form) across selectable windows (`14d`, `42d`, `90d`, `180d`), overlaid with your **Target Race Peak CTL** milestone marker.
   - **Annual Running & Cycling Mileage Summary Cards**: Side-by-side YTD progress cards for **Running** and **Cycling** showing current distance vs. annual target, pro-rated pace delta (`+42 mi ahead of schedule`), and the exact **Outdoor vs. Treadmill/Trainer** percentage split.
4. **Activities View (Outdoor/Indoor Explorer, Stream Inspector & Strava Segments)**:
   - **Filterable High-Density Activity Grid / Mobile Tap List**: Lists completed workouts reconciled across Intervals.icu and Strava. Filterable by sport, **Environment (`Combined` | `Outdoor` | `Indoor Trainer/Treadmill`)**, date range, and search query.
   - **Deep Activity Drawer / Mobile Bottom Sheet**: Clicking any activity opens a detailed physiological and segment breakdown:
     - **Time-Series Stream Chart**: Synchronized scrubbing across Power (`W`), Pace (`min/km` or `min/mi`), Heart Rate (`bpm`), Cadence (`rpm/spm`), and Altitude (`m`).
     - **Strava Segment Efforts Table**: Lists all Strava segments from that activity (`segment_efforts`) with PR badges (`PR #1`, `2nd`, `3rd`), distance, average grade (`%`), elapsed time, average power (`W` / `W/kg`) or pace, and average HR.
     - **Aerobic Decoupling & Zones**: First-half vs. second-half Efficiency Factor (`EF`) drift (`Pw:Hr` or `Pa:Hr`) alongside 7-zone Power/HR/Pace distribution bars.
5. **Physiology View (Curves, Benchmark Segments & Wellness Correlations)**:
   - **Critical Power & Pace Duration Curves**: Plots best efforts across durations (`5s`, `1m`, `5m`, `20m`, `60m`) for cycling power (`W` and `W/kg`) and running pace, filterable by **Outdoor vs. Indoor Trainer/Treadmill**.
   - **Benchmark Strava Segments Progression**: Tracks historical efforts across your starred/key Strava segments, comparing time, wattage/pace, and heart rate efficiency across attempts.
   - **Autonomic Recovery vs. Load Correlation**: Visualizes 28-day HRV and Resting HR trends overlaid with daily training load and sleep quality.
6. **Goals View (Annual Mileage Targets, Race Calendar & Performance Milestones)**:
   - **Annual Mileage Targets (Running & Cycling)**: Set independent annual distance targets for **Running** and **Cycling**, with cumulative YTD trajectory charts, pro-rated daily/weekly requirement to hit goal by Dec 31, and a toggleable breakdown of **Outdoor** vs. **Treadmill / Smart Trainer** volume.
   - **Target Race Calendar & Periodization Tracker**: Add, edit, or delete target events (`A-Race`, `B-Race`) with event date, sport, **Target Peak CTL**, and target finish time/power/pace.
   - **Physiological & Segment Goals**: Set targets for Cycling FTP (`W/kg`), Threshold Run Pace, VO2max, or a target time on a specific **Strava Segment**.
7. **AI Coach View (Daily Workout Options Generator + Interactive Gemini Chat)**:
   - **Daily Workout Options Generator**: Select your desired sport, environment (`Outdoor` or `Indoor Trainer/Treadmill`), and duration (`30m`, `45m`, `60m`, `90m+`) and click **Generate Daily Options** to receive **3 structured workout cards** (*Optimal Progression*, *Modulated Aerobic*, *Active Recovery*).
   - **Interactive Health & Fitness Chat with Gemini**: Multi-turn chat interface (`gemini-3.8-flash`) with full live context of your Intervals.icu wellness, CTL/ATL/TSB, Outdoor/Indoor activities, Strava segment PRs, and annual mileage/race goals.

### Visual Identity & Theme
- **Aesthetic Direction**: Precision Sports Science Lab — utilitarian, high-contrast, daylight-legible on mobile, inspired by professional telemetry workbenches.
- **Color Palette (60-30-10 Discipline)**:
  - **60% Dominant Canvas**: Crisp Alabaster (`#F8FAFC`) in Light Mode / Deep Obsidian Slate (`#0B0F17`) in Dark Mode.
  - **30% Structural Surfaces**: Pure White (`#FFFFFF`) / Elevated Slate (`#111827`) with `1px solid` hairline borders (`#E2E8F0` light / `#1E293B` dark).
  - **10% Semantic & Action Accents**:
    - Primary Action & Fitness (CTL): Cobalt Blue (`#2563EB` / `#3B82F6`)
    - Optimal Readiness / On-Track Mileage & PRs: Emerald (`#16A34A` / `#22C55E`)
    - Elevated Fatigue / Pacing Deficit Warning: Amber (`#D97706` / `#F59E0B`)
    - Overreaching / High Strain Alert: Crimson (`#DC2626` / `#EF4444`)
- **Typography & Hierarchy (2+1 Font Rule)**:
  - **Display & Navigation**: `Plus Jakarta Sans` (600/700 weights).
  - **Body Prose & Coaching Chat**: `DM Sans` (400/500 weights).
  - **Telemetry, Tables & Physiological Numerals**: `JetBrains Mono` with `font-variant-numeric: tabular-nums`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Fork-Friendly Dual Configuration (`.env` + Self-Service Setup Guide + `README.md`)**
  - *Chosen Approach*: Ship a thorough `README.md` and `.env.example` documenting every environment variable (`INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `GEMINI_API_KEY`, `APP_URL`) alongside an in-app **Data Sources & Setup Guide** modal that accepts user-supplied Intervals.icu and Strava credentials per session/browser if server `.env` variables aren't pre-populated.
  - *Why*: Anyone who forks the GitHub repository can either configure private environment variables in their Vercel project settings or enter their Intervals.icu API key directly in the UI to get their own Garmin/Intervals.icu/Strava data working in under two minutes.
- **Decision 2: Dual Deployment Architecture (AI Studio Cloud Run + Vercel via GitHub)**
  - *Chosen Approach*: Extract all backend API routes (`/api/intervals/*`, `/api/strava/*`, `/api/coach/*`, `/auth/strava/callback`) into a modular Express router mounted by both `server.ts` (for AI Studio preview) and `/api/index.ts` with `vercel.json` rewrites (for Vercel serverless deployment).
  - *Why*: Lets you develop and preview live in AI Studio while enabling zero-config deployment whenever you or a fork user pushes to GitHub and links the repo in Vercel.
- **Decision 3: Normalized Outdoor vs. Indoor (Treadmill/Trainer) Classification & Strava Segments**
  - *Chosen Approach*: Tag every activity with `environment: 'OUTDOOR' | 'INDOOR'` (`trainer`, `VirtualRide`, `VirtualRun`, `Treadmill`) and enrich Strava activities with `segment_efforts` (`include_all_efforts=true`) and starred segment benchmarks.
  - *Why*: Gives complete control over indoor vs. outdoor mileage accounting while surfacing competitive Strava segment PRs alongside Intervals.icu heart rate and power efficiency.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│               AeroPulse PWA Client (React 19 + Vite + Service Worker)            │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │ Desktop Header / Mobile Bottom Nav:                                        │  │
│  │ [AeroPulse] ── [Overview | Activities | Physiology | Goals | Coach]        │  │
│  │                                          ── [Install PWA] [Data Sources]   │  │
│  ├────────────────────────────────────────────────────────────────────────────┤  │
│  │ Global Filter Bar: [Sport: All/Run/Bike] [Env: Combined | Outdoor | Indoor]│  │
│  └──────┬─────────────────┬──────────────────┬────────────────┬───────────────┘  │
│         │                 │                  │                │                  │
│         ▼                 ▼                  ▼                ▼                  │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────┐ ┌──────────────────────┐  │
│  │ Overview/PMC │ │  Activities   │ │ Physiology &   │ │   AI Coach & Chat    │  │
│  │ • HRV/Sleep  │ │ • Outdoor vs  │ │ Goals/Segments │ │ • 3-Option Daily     │  │
│  │ • CTL/ATL/TSB│ │   Trainer/    │ │ • Annual Run & │ │   Workout Generator  │  │
│  │ • Run & Bike │ │   Treadmill   │ │   Bike Mileage │ │   (Indoor/Outdoor)   │  │
│  │   YTD Mileage│ │ • Strava      │ │ • Starred      │ │ • Multi-Turn Gemini  │  │
│  │   Pacing     │ │   Segments    │ │   Segment PRs  │ │   Health/Fitness Q&A │  │
│  └──────┬───────┘ └───────┬───────┘ └────────┬───────┘ └──────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────┼────────────────────┼──────────────┘
          │                 │                  │                    │
          ▼                 ▼                  ▼                    ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│         Shared Express API Router (server.ts AND Vercel /api/index.ts)           │
│         + README.md & .env.example for GitHub Fork / Self-Hosting Users          │
│                                                                                  │
│  ┌─────────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐  │
│  │ /api/intervals/*        │  │ /api/strava/*        │  │ /api/coach/*        │  │
│  │ • GET /wellness         │  │ • GET /auth/url      │  │ • POST /options     │  │
│  │ • GET /activities       │  │ • GET /auth/callback │  │   (3 Workout Cards) │  │
│  │ • GET /activity/streams │  │ • GET /activities    │  │ • POST /chat        │  │
│  │ • GET /events (Planned) │  │ • GET /segments      │  │   (Multi-Turn Q&A)  │  │
│  └────────────┬────────────┘  └──────────┬───────────┘  └──────────┬──────────┘  │
└───────────────┼──────────────────────────┼─────────────────────────┼─────────────┘
                │                          │                         │
                ▼                          ▼                         ▼
     ┌─────────────────────┐    ┌─────────────────────┐   ┌─────────────────────┐
     │  Intervals.icu API  │    │   Strava API v3     │   │  Google Gemini API  │
     │ (Basic Auth API_KEY)│    │  (OAuth2 Bearer +   │   │ (gemini-3.8-flash)  │
     │ + Garmin Sync Data  │    │   Segment Efforts)  │   │                     │
     └─────────────────────┘    └─────────────────────┘   └─────────────────────┘
```

### Data Model & State
- **`UnifiedActivity`**: `{ id, intervalsId, stravaId, startDateLocal, name, sportCategory, environment: 'OUTDOOR' | 'INDOOR', subType: 'Road' | 'Trail' | 'Gravel' | 'Smart Trainer' | 'Treadmill' | 'Pool' | 'Gym', movingTimeSecs, distanceMeters, elevationGainMeters, avgPower, normalizedPower, intensityFactor, trainingLoad, avgHr, maxHr, aerobicDecouplingPct, efficiencyFactor, zoneSecs, gearName, stravaPrCount, segmentEfforts: StravaSegmentEffort[] }`
- **`StravaSegmentEffort`**: `{ id, segmentId, name, distanceMeters, averageGradePct, elapsedTimeSecs, movingTimeSecs, avgWatts, avgHr, prRank: 1 | 2 | 3 | null, komRank: number | null, startDateLocal }`
- **`AnnualMileageGoal`**: `{ sportCategory: 'Running' | 'Cycling', year: number, targetDistanceMeters: number, ytdOutdoorMeters: number, ytdIndoorMeters: number }`
- **`TargetGoal`**: `{ id, title, type: 'RACE_EVENT' | 'PERFORMANCE_METRIC' | 'SEGMENT_TARGET', sportCategory, targetDate, priority: 'A' | 'B' | 'MILESTONE', targetCtl, currentValue, targetValue, unit, notes }`

### Interactive Component & State Mapping
- **Fork-Ready Onboarding & Credential Resolution**: Server endpoints resolve Intervals.icu and Strava credentials from either server environment variables (`.env` / Vercel) or user-provided headers/session from the **Data Sources** modal, accompanied by a comprehensive `README.md` and `.env.example` for GitHub forkers.
- **Outdoor / Indoor Environment Filter (`Combined` | `Outdoor Only` | `Indoor: Trainer/Treadmill`)**: Filters the activity table, recalculates summary volume/load KPIs, toggles indoor vs. outdoor Critical Power/Pace curves, and highlights indoor vs. outdoor contributions in the Annual Mileage progress bars.
- **Annual Mileage Goal Editor (`Running` & `Cycling`)**: Users can adjust their annual distance target in miles or kilometers for Running and Cycling independently; the app dynamically computes YTD total (`Outdoor + Trainer/Treadmill`), percentage complete, pro-rated status (`Ahead` or `Behind` daily trajectory), and required weekly mileage for the remainder of the calendar year.
- **Strava Segment Inspector & Starred Benchmark Tracker**: Clicking an activity shows its embedded Strava `segment_efforts` with PR badges; clicking any segment opens its historical comparison across previous attempts (time, `W/kg` or pace, and HR).
