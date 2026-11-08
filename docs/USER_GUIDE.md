# AeroPulse — Complete Interactive User Manual

Welcome to the **AeroPulse Editorial Endurance Lab** User Guide. You can also access an interactive, searchable version of this guide directly inside the application at any time by clicking the **`?` (User Guide)** icon in the top navigation bar.

---

## Table of Contents

1. [Chapter 1: Quick Start & Why AeroPulse](#chapter-1-quick-start--why-aeropulse)
2. [Chapter 2: Data Sync, Strava OAuth & `.FIT` Import](#chapter-2-data-sync-strava-oauth--fit-import)
3. [Chapter 3: Fitness (`CTL`), Fatigue (`ATL`), Form & Garmin Load Focus](#chapter-3-fitness-ctl-fatigue-atl-form--garmin-load-focus)
4. [Chapter 4: Training Calendar, Effort Skylines & Block Builder](#chapter-4-training-calendar-effort-skylines--block-builder)
5. [Chapter 5: Activity Inspector, 1Hz Streams & Route Segments](#chapter-5-activity-inspector-1hz-streams--route-segments)
6. [Chapter 6: Lab & Goals: Power/Pace Curves, Biometrics & Benchmarks](#chapter-6-lab--goals-powerpace-curves-biometrics--benchmarks)
7. [Chapter 7: Coaching Roster, Privacy Shield & Gemini AI Coach](#chapter-7-coaching-roster-privacy-shield--gemini-ai-coach)

---

## Chapter 1: Quick Start & Why AeroPulse

### The Three Pillars of AeroPulse
AeroPulse was engineered to eliminate the fragmentation between physiological analysis platforms, adaptive workout planners, and GPS segment trackers:
1. **Intervals.icu Physiological Rigor**: True Banister impulse-response modeling (`42d CTL`, `7d ATL`, `TSB`), Monod-Scherrer Critical Power (`CP`) & Anaerobic Work Capacity (`W'`), Skiba 1Hz `W' Balance`, and first-vs-second-half Aerobic Decoupling (`Pa:Hr`).
2. **Runna / TrainerRoad Closed-Loop Adaptivity**: Daily morning autonomic readiness evaluation (`HRV rMSSD`, `Resting HR`, `Sleep Score`, `TSB`) that morphs today's scheduled workout between **Optimal Progression**, **Modulated Aerobic (`-15%` load)**, and **Active Recovery**.
3. **Strava & Official FAT Race Intelligence**: Full-bleed Leaflet GPS route maps, Strava segment PR leaderboards, global **Outdoor vs. Virtual/Trainer** modality filtering, and verified `0.01s` Fully Automatic Timing (`FAT`) track/road/XC race logging with Daniels `VDOT` projections.

### 3-Step Quick Start Checklist
1. **Step 1 — Ingest Your Data**: Click the **Data Sync** status pill in the top header to connect **Strava OAuth**, link **Intervals.icu + Garmin Connect**, or drag-and-drop `.FIT` / `.GPX` / `.TCX` workout files.
2. **Step 2 — Calibrate Thresholds & Zones**: Open the **Account Menu → Athlete Profile & Thresholds** modal to verify your **Outdoor FTP**, **Indoor/Smart-Trainer FTP**, **`W'`**, **Cycling/Running LTHR**, and **Threshold Run Pace**.
3. **Step 3 — Review Readiness & Morph Today's Session**: Navigate to **Load & Readiness** (`Tab 1`) to inspect your Performance Management Chart (`PMC`), hover your **Daily Stacked Garmin Load Focus bars**, and sync today's readiness-adjusted workout to your calendar.

---

## Chapter 2: Data Sync, Strava OAuth & `.FIT` Import

### 1. Connecting Strava OAuth (Streams, GPS Routes, Segments & Gear)
1. Click the **Connection Status Pill** in the top navigation bar to open the **Data Sources & Telemetry Sync** modal.
2. Under **Strava OAuth v3**, enter your personal `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` (or use pre-configured server environment keys) and click **Authorize with Strava**.
3. Upon redirect, AeroPulse automatically fetches your historical activities, decodes summary polylines, hydrates 1Hz streams (`watts`, `heartrate`, `velocity_smooth`, `cadence`, `altitude`, `latlng`), extracts **Strava Segment Efforts** (`PR #1/#2/#3`, KOM rank, grade %), and imports your bikes/shoes.
4. Refresh tokens rotate automatically and persist locally so your session stays active across browser restarts.

### 2. Connecting Intervals.icu & Garmin Connect Wellness
1. In [https://intervals.icu](https://intervals.icu), enable **Garmin Connect** wellness and activity sync, then copy your personal API key under **Settings → Developer Settings**.
2. Paste your **Athlete ID** (or `0`) and **API Key** into AeroPulse's **Data Sources** modal and click **Connect & Sync**.
3. AeroPulse merges Intervals.icu's authoritative daily wellness records (`HRV rMSSD`, `Resting HR`, `Sleep Score`, `VO2max`, `Weight`, `eFTP`) with your Strava workouts using a **non-destructive ±5-minute timestamp deduplicator**.

### 3. Local 1Hz `.FIT` / `.GPX` / `.TCX` Drag-and-Drop Parser
- Drag one or more `.fit`, `.gpx`, or `.tcx` files directly into the **Drop Zone** inside the **Data Sources** modal (or the **Activities** workspace).
- A background **Web Worker** extracts 1Hz telemetry records, computes Normalized Power (`NP`), Intensity Factor (`IF`), Training Stress Score (`TSS`), 7-zone distributions, and Peak Power/Pace curves, and stores the binary stream in **Browser IndexedDB (Dexie)**.

### 4. Logging Official `0.01s` FAT Race Results (`VDOT`)
- Click **Account Menu → Log Official Race (FAT)** (or the **Log Official Race** button in **Goals & Totals**).
- Record verified results from **Athletic.net**, **TFRRS**, **MileSplit**, **RunSignup**, or **Official FAT** (`800m`, `1500m`, `1 Mile`, `3200m`, `5000m`, `10,000m`, `Half Marathon`, `Marathon`).
- AeroPulse calculates your exact **Daniels VDOT score**, stores lap splits, and pins a gold **Race PR Milestone** onto your PMC.

### 5. Local IndexedDB Archive Export & Restore
- Inside **Data Sources → Local Telemetry Archive**, click **Export Full JSON Backup** to download a complete snapshot of your wellness days, activities, 1Hz streams, planned workouts, and custom thresholds.
- Click **Import JSON Backup** at any time to restore or migrate your database across devices.

---

## Chapter 3: Fitness (`CTL`), Fatigue (`ATL`), Form & Garmin Load Focus

### 1. Reading the Interactive Performance Management Chart (PMC)
Located at the top of the **Load & Readiness** tab, the dual-canvas ECharts PMC plots:
- **Fitness (`CTL` — Cyan Line + Area, `#0ea5e9`)**: Your 42-day exponentially weighted moving average of daily TSS.
- **Fatigue (`ATL` — Purple Line, `#a855f7`)**: Your 7-day exponentially weighted moving average of daily TSS.
- **Future Planned Projection (Dashed Lines)**: Extends your `CTL`, `ATL`, and `TSB` forward across all scheduled workouts on your Training Calendar.

### 2. Form (`TSB = CTL - ATL`) Zones
The lower synchronized canvas displays **Form (`TSB`)** across five physiological zones:
- **Transition / Detraining (`> +25`, Amber)**: Extended rest; risk of losing peak aerobic adaptations.
- **Fresh / Race Ready (`+5 to +25`, Sky Blue)**: Fatigue has dissipated while Fitness remains high—ideal for **A-Race** execution.
- **Grey Zone (`-10 to +5`, Slate)**: Maintenance load or transitional microcycle.
- **Optimal Training (`-10 to -25`, Emerald Green)**: Sweet-spot overload corridor where `CTL` climbs productively without autonomic breakdown.
- **High Risk / Overreaching (`< -30`, Rose Red)**: Excessive acute fatigue; high injury or sympathetic/parasympathetic overreaching risk.

### 3. Daily Stacked Garmin Load Focus Bars
On the upper PMC canvas, every day's training load is rendered as a **vertical bar stacked chronologically by activity**:
- **Low Aerobic (`#38bdf8` Cyan)**: Z1–Z2 Recovery, Endurance Base, Easy Runs/Spins, Warmups, and Cooldowns.
- **High Aerobic (`#f97316` Orange)**: Z3–Z4 Tempo, Sweet Spot (`88–94% FTP`), Lactate Threshold, and Marathon/Half-Marathon Pace.
- **Anaerobic (`#d946ef` Magenta)**: Z5–Z7 VO2max intervals, Track repeats (`200m`–`800m`), Sprints, Microbursts (`30/30s`, `40/20s`), and Crit/Zwift Races.
- **Chronological Multi-Activity Stacking**: When you complete multiple sessions on the same day (e.g., a `15m Warmup` + `Track 1500m Race` + `15m Cooldown`, or an `AM Easy Run` + `PM Sweet Spot Ride`), AeroPulse sorts them chronologically from bottom to top (`AM` at the base, `PM` at the top) and colors each segment by its own Garmin Load Focus. Hovering the day's bar opens an itemized breakdown of every segment, its individual TSS, and its focus badge.

### 4. Weekly Ramp Rate (`CTL/wk`) & Milestone Pins
- Use the sub-chart switcher (`Form (TSB)` vs. `Ramp Rate (CTL/wk)`) to audit your 7-day `CTL` velocity. Aim for **`+3.0` to `+5.5 CTL/wk`** during build blocks.
- Toggle **Milestones** in the chart toolbar to show or hide **eFTP Breakthroughs**, **Official Race PRs**, and **Power/Benchmark PRs** pinned directly onto your fitness timeline.

---

## Chapter 4: Training Calendar, Effort Skylines & Block Builder

### 1. The 8-Column Desktop Calendar & Weekly Ledger
- On desktop viewports, the **Calendar** tab renders `Monday` through `Sunday` columns plus an **8th Weekly Summary Column** on the right.
- Each week's summary column tracks **Completed vs. Planned Load (TSS)**, **Moving Time**, **Total Distance**, **7-Zone Distribution Bar**, and a **Compliance Progress Bar**.
- Each day cell displays morning **HRV (`rMSSD`)** and **Form (`TSB`)** badges alongside completed workouts and planned prescriptions.

### 2. Reading Effort Zone Skylines (`Z1`–`Z6`)
- Every workout card features a horizontal **Effort Skyline** where each block's width represents step duration and height/color represents physiological zone (`Z1` Sky, `Z2` Emerald, `Z3` Amber, `Z4` Orange, `Z5` Rose, `Z6` Purple).

### 3. Intervals-Syntax Structured Workout Builder
Click **+ Plan** on any calendar date (or click **Build Workout** in the calendar header) to open the **Structured Workout Builder**:
- Write or edit steps using plain-text shorthand:
  ```text
  - 15m 60% FTP
  - 4x8m 92% FTP / 3m 55% FTP
  - 10m 50% FTP
  ```
- As you type, AeroPulse parses the steps in real time, renders the interactive **Effort Skyline**, calculates total duration, and estimates **Planned TSS** from your active FTP/LTHR.

### 4. Multi-Week `3:1` Periodized Training Block Generator
- Click **Generate Training Block** in the Calendar toolbar to build a 4-to-8-week mesocycle.
- Select your **Primary Sport** (`Cycling`, `Running`, or `Multisport`), **Training Philosophy** (`Polarized 80/20`, `Sweet Spot / Threshold`, or `Pyramidal`), **Weekly Volume Hours**, and **Target A-Race Date**.
- AeroPulse schedules three progressive overload weeks (`+8%` load/wk) followed by one recovery deload week (`-30%` load), automatically inserting a **10-to-14-day Race Taper** prior to your target event.

---

## Chapter 5: Activity Inspector, 1Hz Streams & Route Segments

The **Activities** tab provides four specialized sub-workspaces selectable via the top segmented bar:

### 1. `Activity Log` & 1Hz Stream Inspector
- Filter workouts by **Sport** (`All`, `Cycling`, `Running`, `Swimming`, `Strength`), **Modality** (`Combined`, `Outdoor Only`, `Virtual / Trainer`), or search keyword.
- Select any workout to inspect its synchronized **1Hz Telemetry Canvas**:
  - **Power (`Watts`)**, **Heart Rate (`bpm`)**, **Velocity / Pace (`min/km` or `min/mi`)**, **Cadence (`rpm`/`spm`)**, **Altitude (`m`)**, and **Skiba `W'` Balance (`kJ`)**.
  - Drag across any interval on the chart to zoom in and inspect average power, Normalized Power (`NP`), Heart Rate, and **Aerobic Decoupling (`Pa:Hr %`)** for that exact selection.
- Review the **Detected Intervals / Laps Table** and **7-Zone Power / HR / Pace Histograms** below the chart.

### 2. `GPS Route Map`
- Displays all outdoor workouts on an interactive **Leaflet Map** with support for **OpenStreetMap**, **Thunderforest Cycle/Outdoors**, and **Mapbox** tile layers.
- Toggle polyline coloring between **Power Zone**, **Heart Rate Zone**, and **Elevation Grade %**.

### 3. `Segment PRs`
- Aggregates all **Strava Segment Efforts** across your cycling climbs and running loops.
- Highlights **Gold (`PR #1`)**, **Silver (`PR #2`)**, and **Bronze (`PR #3`)** medals, average grade, elapsed time, `W/kg`, and multi-attempt progression charts.

### 4. `Compare 2 Workouts`
- Select any two workouts (e.g., an outdoor road climb vs. an indoor Zwift race, or two editions of the same threshold session 6 weeks apart) to overlay their 1Hz Power, Heart Rate, and `W'` Balance traces side-by-side.

---

## Chapter 6: Lab & Goals: Power/Pace Curves, Biometrics & Benchmarks

Click **Lab & Goals** in the top navigation dock to switch between four deep-analysis sub-tabs:

1. **`Goals & Totals`**:
   - **Independent Annual Mileage Trackers**: Separate year-to-date distance gauges for **Running** and **Cycling** with pro-rated daily schedule deltas (*Ahead / Behind Pace*), required weekly volume for the rest of the year, and Outdoor vs. Indoor split bars.
   - **Target Race Calendar & VDOT / Riegel Race Predictor**: Projects equivalent race times across `800m`, `1500m`, `Mile`, `3200m`, `5K`, `10K`, `Half Marathon`, and `Marathon` from your verified FAT marks or peak threshold efforts.
   - **Equipment & Gear Wear Ledger**: Tracks cumulative mileage on your road/gravel/TT bikes and running shoes with automated maintenance/replacement alerts at `80%` and `100%` lifespan.
2. **`Power & Pace`**:
   - **Mean Maximal Power (`MMP`) & Critical Pace Curves**: Plots `5s` to `3h` envelopes comparing **Outdoor Only**, **Indoor / Smart Trainer**, and **Season Best** curves alongside the hyperbolic **Monod-Scherrer `CP` + `W'`** fit.
   - **6-Axis Athlete Phenotype Radar**: Benchmarks your **Neuromuscular (`5s`)**, **Anaerobic (`1m`)**, **VO2max (`5m`)**, **Threshold (`20m`)**, **Stamina (`60m`)**, and **Durability (`Pa:Hr`)** percentiles to classify your phenotype (*All-Rounder*, *Time Trialist / Diesel*, *Climber*, *Puncheur*, or *Sprinter*).
3. **`Biometrics`**:
   - Tracks **Morning HRV (`rMSSD`)** against your 7-day rolling baseline and 60-day normal corridor, **7-Day HRV Coefficient of Variation (`CV%`)**, **Resting HR**, **Sleep Score & 7d Sleep Debt**, and the **Efficiency Factor (`EF`) vs. Aerobic Decoupling (`Pa:Hr`)** scatter quadrant.
4. **`Benchmarks`**:
   - **2-Athlete Comparator**: Overlay your `PMC`, `6-Axis Phenotype Radar`, `Power/Pace Curves`, and `VDOT` against any connected teammate or coached athlete.
   - **Custom Dual-Metric Chart Lab**: Build custom time-series or linear-regression scatter plots pairing any two of 27 physiological and workout metrics across rolling `7d`, `14d`, `28d`, `42d`, or `90d` windows.

---

## Chapter 7: Coaching Roster, Privacy Shield & Gemini AI Coach

### 1. Managing Coach-Edit vs. Friend-View Connections
1. Click the **Roster Switcher** pill (`Viewing: Self`) in the top header or open **Account Menu → Coaching Roster & Privacy**.
2. Share your unique **AeroPulse Invite Code** or enter a teammate/coach code to establish a link:
   - **`COACH_EDIT`**: Grants a coach permission to inspect your readiness ledger and push structured workouts or multi-week blocks directly onto your Training Calendar.
   - **`FRIEND_VIEW`**: Read-only peer connection for side-by-side radar and benchmark comparisons.
3. Use the **Active Athlete Switcher** in the header to inspect a connected athlete's dashboard (complete with a prominent banner indicating whose telemetry is active and a one-click **Return to Self** button).

### 2. Granular Privacy Controls & Strava Compliance Shield
Inside the **Privacy & Data Governance** tab of the Roster Modal, you control three independent visibility tiers (`ALL_CONNECTIONS`, `COACHES_ONLY`, `PRIVATE`) for:
- **Wellness & Autonomic Biometrics** (`HRV`, `RHR`, `Sleep`, `Weight`)
- **Performance Management & Zones** (`CTL`, `ATL`, `TSB`, `FTP`, `Power/Pace Curves`)
- **GPS Route Maps & Polylines**
- **Strava API Compliance Shield**: When enabled (default `ON`), raw Strava-sourced GPS tracks and Strava-exclusive activity streams are automatically redacted when viewed by third-party connections, while preserving derived physiological load (`CTL`/`ATL`) and verified public FAT race marks.

### 3. Context-Aware Google Gemini AI Coach
Click the **AI Coach** button in the top navigation bar (or any **"Ask AI Coach"** button inside a chart card) to open the slide-over **Gemini Coaching Drawer**:
- **3-Option Daily Workout Generator**: Generates three structured workouts tailored to your live `TSB`, `HRV`, available duration (`30m`–`180m`), and environment (`Outdoor` vs. `Indoor`):
  1. **Optimal Progression** (Full target stimulus)
  2. **Modulated Aerobic** (`-15%` intensity/load adjustment)
  3. **Active Recovery** (Parasympathetic Z1/Z2 flush)
- Click **Push to Calendar** on any option to schedule it immediately with full structured steps and Effort Skyline preview.
- **Multi-Turn Physiological Chat**: Ask questions about your taper timing, decoupling drift, or threshold progression; every response cites your live physiological tokens (`CTL`, `ATL`, `TSB`, `HRV rMSSD`, `eFTP`, `VDOT`).
