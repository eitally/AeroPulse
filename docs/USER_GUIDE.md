# THRESH — Complete Interactive User Manual

Welcome to the **THRESH (`#1 Stadium Track` Edition)** User Guide. You can also access an interactive, searchable version of this guide directly inside the application at any time by clicking the **`?` (User Guide)** icon in the top navigation bar or visiting `/docs/index.html`.

---

## Table of Contents

1. [Chapter 1: Quick Start, Strava Onboarding & Why THRESH](#chapter-1-quick-start-strava-onboarding--why-thresh)
2. [Chapter 2: Strava Sync Policy, Optional Garmin / Intervals.icu & `.FIT` Import](#chapter-2-strava-sync-policy-optional-garmin--intervalsicu--fit-import)
3. [Chapter 3: Fitness (`CTL`), Fatigue (`ATL`), Form & Garmin Load Focus](#chapter-3-fitness-ctl-fatigue-atl-form--garmin-load-focus)
4. [Chapter 4: Training Calendar, Effort Skylines & Block Builder](#chapter-4-training-calendar-effort-skylines--block-builder)
5. [Chapter 5: Activity Inspector, 1Hz Streams & Route Segments](#chapter-5-activity-inspector-1hz-streams--route-segments)
6. [Chapter 6: Lab & Goals: Power/Pace Curves, Biometrics & Benchmarks](#chapter-6-lab--goals-powerpace-curves-biometrics--benchmarks)
7. [Chapter 7: Teams, Coaching Roster, Privacy Shield & Gemini AI Coach](#chapter-7-teams-coaching-roster-privacy-shield--gemini-ai-coach)
8. [Chapter 8: High School & Collegiate Team Pack (`v2.3`)](#chapter-8--horizon-13--v23-high-school--collegiate-workflows)

---

## Chapter 1: Quick Start, Strava Onboarding & Why THRESH

### The Three Pillars of THRESH
THRESH eliminates the fragmentation between physiological analysis platforms, adaptive workout planners, and school/club team hubs:
1. **Intervals.icu Physiological Rigor**: True Banister impulse-response modeling (`42d CTL`, `7d ATL`, `TSB`), Monod-Scherrer Critical Power (`CP`) & Anaerobic Work Capacity (`W'`), Skiba 1Hz `W' Balance`, two-pass calibrated running `rTSS`, and first-vs-second-half Aerobic Decoupling (`Pa:Hr`).
2. **Closed-Loop Daily Adaptivity**: Daily morning readiness evaluation (`HRV rMSSD`, `Resting HR`, `Sleep Score`, `TSB`) that morphs today's scheduled workout between **Optimal Progression**, **Modulated Aerobic (`-15%` load)**, and **Active Recovery**—plus **Weekly Training Git-Diffs** and **3-Channel Orthopedic Guardrails**.
3. **Strava Identity, Official FAT Race Intelligence & Team Hub**: Universal Strava OAuth sign-in, full-bleed Leaflet GPS route maps, Strava segment PR leaderboards, verified `0.01s` Fully Automatic Timing (`FAT`) track/road/XC race logging with Daniels `VDOT` projections, and branded High School / Collegiate / Club team workspaces.

### 3-Step New User Onboarding Flow
1. **Step 1 — Continue With Strava (Primary Identity)**:
   - Sign in with one click using **Continue With Strava** (zero passwords to remember, cross-device session persistence).
   - Joining a school or club team? Scan your coach's QR poster (`/join/<slug>`) or expand **Have a Team Join Code?** on the welcome screen to preview your team before authenticating.
   - **Read-Only Pledge**: THRESH never posts to your Strava feed or edits your activities.
2. **Step 2 — Choose What Syncs From Strava**:
   - **Last 90 Days (Recommended)**: Fast 42-day `CTL`, 7-day `ATL`, and Form (`TSB`) calibration.
   - **Last 6 Months** or **Full Archive**: Deeper historical `CP/W'` and seasonal durability curves.
   - **Identity Only (No Workouts)**: Uses Strava strictly for sign-in and imports zero workouts.
   - Confirm your **Primary Sport** (`Running`, `Cycling`, `Both`), **Units** (`mi / lbs` or `km / kg`, auto-detected from Strava), optional **Recent Race / Power Seed Mark** (e.g., `18:45 5K`, `10:15 3200m`, `280W 20m`), and—if joining a team—your **Coach Data Sharing Tier**.
3. **Step 3 — Add Overnight Sleep & HRV (100% Optional)**:
   - Optionally connect **Garmin Connect** or **Intervals.icu** now—or skip straight into your workspace and add them anytime later in **Data Sources**.

---

## Chapter 2: Strava Sync Policy, Optional Garmin / Intervals.icu & `.FIT` Import

### 1. Managing Your Strava Sync Window & Account
1. Click the **Connection Status Pill** in the top navigation bar to open **Data Sources & Telemetry Sync**.
2. Under **Strava — Primary Identity**, you can change your sync window (`Last 90d`, `Last 6 Months`, `Full Archive`, `Identity Only`), toggle bike/shoe gear & athlete profile sync, trigger an immediate sync, or click **Sign Out** to clear local telemetry on shared computers.
3. If you unchecked `View data about your activities` on Strava's consent screen, THRESH detects the missing `activity:read` scope and provides a 1-click **Re-Authorize Activity Scope** button.

### 2. Optional Secondary Connections: Garmin Connect & Intervals.icu
Garmin Connect and Intervals.icu are **never mandatory**—they are optional add-ons that enrich THRESH with overnight autonomic wellness:
- **Garmin Connect (Optional Add-On)**: Sign in directly with your Garmin Connect email/password (including 2FA support) or paste a Personal API Token to sync overnight `HRV rMSSD`, `Sleep Score`, `Resting HR`, and `VO2max`. Disconnect Garmin independently anytime without signing out of THRESH.
- **Intervals.icu (Optional Add-On)**: Paste your Athlete ID (or `0`) and API Key from **Intervals.icu → Settings → Developer Settings** to sync historical `CTL/ATL`, `eFTP`, `W'`, and structured calendar workouts.
- **Smart Multi-Source Deduplication**: Workouts synced from Strava, Garmin, and Intervals.icu within `±5 minutes` are merged into a single clean activity card so Training Load (`TSS`) is never double-counted.

### 3. Local 1Hz `.FIT` / `.GPX` / `.TCX` / `.ZIP` Drag-and-Drop Parser
- Drag `.fit`, `.fit.gz`, `.gpx`, `.tcx`, or bulk `.zip` archives directly into the **Drop Zone** inside **Data Sources** (or **Activities**).
- A background **Web Worker** extracts 1Hz telemetry records, computes Normalized Power (`NP`), Intensity Factor (`IF`), Training Stress Score (`TSS`), 7-zone distributions, and Peak Power/Pace curves, and stores the binary stream in **Browser IndexedDB (Dexie)**.

### 4. Logging Official `0.01s` FAT Race Results (`VDOT`)
- Click **Account Menu → Log Official Race (FAT)** (or **Log Official Race** in **Goals & Totals**).
- Record verified results from **Athletic.net**, **TFRRS**, **MileSplit**, **RunSignup**, or **Official FAT** (`800m` through `Marathon`).
- THRESH calculates your **Daniels VDOT score**, converts NCAA indoor flat/banked/altitude marks, and pins a gold **Race PR Milestone** onto your PMC.

### 5. Local IndexedDB Archive Export & Restore
- Inside **Data Sources → Local Telemetry Archive**, click **Export Full JSON Backup** or **Import JSON Backup** anytime.

---

## Chapter 3: Fitness (`CTL`), Fatigue (`ATL`), Form & Garmin Load Focus

### 1. Reading the Interactive Performance Management Chart (PMC)
Located on the **Today / Fitness** tab, the dual-canvas ECharts PMC plots:
- **Fitness (`CTL` — Cyan Line + Area, `#0ea5e9`)**: Your 42-day exponentially weighted moving average of daily TSS.
- **Fatigue (`ATL` — Purple Line, `#a855f7`)**: Your 7-day exponentially weighted moving average of daily TSS.
- **Future Planned Projection (Dashed Lines)**: Extends your `CTL`, `ATL`, and `TSB` forward across all scheduled workouts on your Training Calendar.
- **Honest Day-1 Calibration**: Brand-new accounts with zero workouts start cleanly in `CALIBRATING` state without synthetic fitness or resting HR numbers.

### 2. Form (`TSB = CTL - ATL`) Zones
- **Transition / Detraining (`> +25`, Amber)**: Extended rest; risk of losing peak aerobic adaptations.
- **Fresh / Race Ready (`+5 to +25`, Sky Blue)**: Fatigue has dissipated while Fitness remains high—ideal for **A-Race** execution.
- **Grey Zone (`-10 to +5`, Slate)**: Maintenance load or transitional microcycle.
- **Optimal Training (`-10 to -25`, Emerald Green)**: Productive overload corridor where `CTL` climbs sustainably.
- **High Risk / Overreaching (`< -30`, Rose Red)**: Excessive acute fatigue; schedule a recovery microcycle.

### 3. Daily Stacked Garmin Load Focus Bars
Every day's training load is rendered as a **vertical bar stacked chronologically by activity**:
- **Low Aerobic (`#38bdf8` Cyan)**: Z1–Z2 Recovery, Endurance Base, Easy Runs/Spins, Warmups, and Cooldowns.
- **High Aerobic (`#f97316` Orange)**: Z3–Z4 Tempo, Sweet Spot (`88–94% FTP`), Lactate Threshold, and Marathon/Half-Marathon Pace.
- **Anaerobic (`#d946ef` Magenta)**: Z5–Z7 VO2max intervals, Track repeats (`200m`–`800m`), Sprints, Microbursts, and Crit/Zwift Races.

---

## Chapter 4: Training Calendar, Effort Skylines & Block Builder

1. **8-Column Desktop Calendar & Weekly Ledger**: Displays `Monday`–`Sunday` columns plus a **Weekly Summary Column** comparing Completed vs. Planned Load (`TSS`), Moving Time, Distance, and 7-Zone distribution.
2. **Effort Zone Skylines (`Z1`–`Z6`)**: Proportional visual bar chart of workout steps colored by canonical effort zone.
3. **Sport-Aware Structured Workout Builder**: Supports both Cycling (`% FTP`, `Watts`) and Running (`% Pace`, calibrated `/km` or `/mi` pace & `LTHR` zones).
4. **Multi-Week `3:1` Periodized Training Block Generator**: Generates 4-to-8-week polarized, pyramidal, or threshold blocks with automatic deload weeks and race tapers.

---

## Chapter 5: Activity Inspector, 1Hz Streams & Route Segments

Switch between four sub-workspaces in **Activities**:
1. **`Activity Log` & 1Hz Stream Inspector**: Synchronized 1Hz Power, Heart Rate, Pace, Cadence, Altitude, and Skiba `W'` Balance with drag-to-zoom slice metrics, 30s Post-Workout Debrief, and the **1Hz No-Lap Unstructured Rep Detector**.
2. **`GPS Route Map`**: Interactive Leaflet map with Power, HR, and Grade % polyline coloring.
3. **`Segment PRs`**: Strava Segment Effort matrix with Gold/Silver/Bronze PR medals and repeat-attempt progression.
4. **`Compare 2 Workouts`**: Side-by-side 1Hz overlay of any two sessions.

---

## Chapter 6: Lab & Goals: Power/Pace Curves, Biometrics & Benchmarks

1. **`Goals & Totals`**: Independent Running & Cycling annual distance trackers, VDOT / Riegel race predictor, Course & Fueling Race Simulator, and shoe/bike wear alerts.
2. **`Power & Pace`**: Mean Maximal Power (`MMP`) & Critical Pace curves (`CP` + `W'`), `0–40 kJ/kg` & `0–2,000 kcal` Fatigue-Sliced Durability, and 6-Axis Phenotype Radar.
3. **`Biometrics`**: 60-day HRV corridor, 7-day HRV `CV%`, Sleep Debt, and Efficiency Factor (`EF`) vs. Aerobic Decoupling (`Pa:Hr`) quadrant.
4. **`Benchmarks`**: 2-Athlete Comparator and Custom Dual-Metric Regression Lab.

---

## Chapter 7: Teams, Coaching Roster, Privacy Shield & Gemini AI Coach

### 1. Joining or Creating a School / Club Team (`+ Team`)
- Click **`+ Team`** in the top header (or open **Teams, Bulk Invites & Coaching Hub**):
  - **Join a School or Club Team**: Enter a 6-character Team Join Code (e.g., `PAXC-26`) or open your coach's `/join/<slug>` link.
  - **Create a Coach & Team Workspace**: Choose High School, Collegiate, Running Club, Cycling Club, or Private Squad; configure school colors & crest; print Locker-Room QR sheets; and import athletes via `.CSV` (`Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark`).
- **Coach Data Sharing Tiers**: Athletes choose `SUMMARY_ONLY` (shares readiness & CTL/ATL/TSB), `FULL_STREAMS` (shares full workouts & allows coach calendar edits), or `LOAD_ONLY`.

### 2. Granular Privacy Controls & Clean-Room Strava Firewall
- Configure independent visibility (`ALL_CONNECTIONS`, `COACHES_ONLY`, `PRIVATE`) for Wellness, PMC/Zones, and GPS Routes.
- THRESH's server-side **Clean-Room Firewall** automatically strips third-party Strava-only raw tracks from multi-user teammate views and AI prompts.

### 3. Context-Aware Google Gemini AI Coach
- Generates 3 daily workout tiers (**Optimal**, **Modulated `-15%`**, **Active Recovery**) with 1-click Calendar push and multi-turn physiological chat.

---

## Chapter 8 · Horizon 1–3 & v2.3 High School / Collegiate Workflows

- **3-Channel Orthopedic Strip (`10x #1`) & Weekly Training Git-Diff (`10x #3`)** on **Today / Fitness**.
- **Fatigue-Sliced `0–40 kJ/kg` & `0–2,000 kcal` Durability (`10x #2`)** on **Curves**.
- **Course Physics & Carb/Sodium Race Simulator (`10x #4`)** on **Goals & Totals**.
- **GPS Rubber-Banding, `THV-...` Verified Passports (`10x #6`) & NCAA Track Converter** in **Log Official Race Result**.
- **VDOT Pacing Pods (Pods A–D), Watchless Split Stopwatch & NCAA 20-Hour CARA Audit** in **HS & College Coach Deck** (see [docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md](SCHOLASTIC_AND_COLLEGIATE_GUIDE.md)).
