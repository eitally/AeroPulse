# MeetReady — Complete Interactive User Manual

Welcome to the **MeetReady (Mondo Clay & Stadium Chalk Edition)** User Guide. You can also access an interactive, searchable version of this guide directly inside the application at any time by clicking the **`?` (User Guide)** icon in the top navigation bar or visiting `/docs/index.html`.

---

## Table of Contents

1. [Chapter 1: Quick Start, Strava Onboarding & Why MeetReady](#chapter-1-quick-start-strava-onboarding--why-meetready)
2. [Chapter 2: Strava Sync Policy, Optional Garmin / Intervals.icu & `.FIT` Import](#chapter-2-strava-sync-policy-optional-garmin--intervalsicu--fit-import)
3. [Chapter 3: Fitness (`CTL`), Fatigue (`ATL`), Form & Garmin Load Focus](#chapter-3-fitness-ctl-fatigue-atl-form--garmin-load-focus)
4. [Chapter 4: Training Calendar, Effort Skylines & Block Builder](#chapter-4-training-calendar-effort-skylines--block-builder)
5. [Chapter 5: Activity Inspector, 1Hz Streams & Route Segments](#chapter-5-activity-inspector-1hz-streams--route-segments)
6. [Chapter 6: Lab & Goals: Power/Pace Curves, Biometrics & Benchmarks](#chapter-6-lab--goals-powerpace-curves-biometrics--benchmarks)
7. [Chapter 7: Teams, Coaching Roster, Privacy Shield & Gemini AI Coach](#chapter-7-teams-coaching-roster-privacy-shield--gemini-ai-coach)
16. [Chapter 8: Scholastic, Collegiate & Family Workflows](#chapter-8-scholastic-collegiate--family-workflows)

---

## Chapter 1: Quick Start, Strava Onboarding & Why MeetReady

### The Three Pillars of MeetReady
MeetReady eliminates the fragmentation between physiological analysis platforms, adaptive workout planners, and school/club team hubs:
1. **Intervals.icu Physiological Rigor**: True Banister impulse-response modeling (`42d CTL`, `7d ATL`, `TSB`), Monod-Scherrer Critical Power (`CP`) & Anaerobic Work Capacity (`W'`), Skiba 1Hz `W' Balance`, two-pass calibrated running `rTSS`, and first-vs-second-half Aerobic Decoupling (`Pa:Hr`).
2. **Closed-Loop Daily Adaptivity**: Daily morning readiness evaluation (`HRV rMSSD`, `Resting HR`, `Sleep Score`, `TSB`) that morphs today's scheduled workout between **Optimal Progression**, **Modulated Aerobic (`-15%` load)**, and **Active Recovery**—plus the **Plan vs. Actual Ledger** and **3-Channel Orthopedic Guardrails**.
3. **Strava Identity, Official FAT Race Intelligence & Team Hub**: Universal Strava OAuth sign-in, full-bleed Leaflet GPS route maps, Strava segment PR leaderboards, verified `0.01s` Fully Automatic Timing (`FAT`) track/road/XC race logging with Daniels `VDOT` projections, and branded High School / Collegiate / Club team workspaces.

### 3-Step New User Onboarding Flow
1. **Step 1 — Sign In (`Google`, `Passkey`, `Magic Link`, `Email OTP`, or Optional `Strava`)**:
   - Sign in with Google, a biometric WebAuthn Passkey, an email Magic Link / OTP, or optional **Connect with Strava**. School athletes can join teams cleanly with Google or Email—zero Strava account required.
   - Joining a school or club team? Scan your coach's QR poster (`/join/<slug>`) or tap **Team Code** on the homepage to preview your team before signing in.
   - **Read-Only Pledge**: MeetReady never posts to your Strava feed or edits your activities.
2. **Step 2 — Sync Preferences, Profile & Team Sharing Tier**:
   - If using Strava, choose your sync window (**Last 90 Days**, **Last 6 Months**, **Full Archive**, or **Identity Only — 0 Workouts**).
   - Confirm your **Primary Sport** (`Running`, `Cycling`, `Both`), **Units** (`mi / lbs` or `km / kg`), optional **Recent Race / Power Seed Mark**, birth month/year (`YYYY-MM` COPPA/Safe-Sport check), and—if joining a team—your **Coach Data Sharing Tier**.
3. **Step 3 — Add Optional Hardware & Overnight Wellness Sources**:
   - Optionally connect **Garmin Connect**, **Intervals.icu** (including COROS / WHOOP relays), **Wahoo Cloud**, or **Polar AccessLink**, or drag `.FIT/.GPX/.ZIP` archives anytime in **Data Sources**.

### Unified 4-Pillar Athlete Workspace
1. **Today (`#today` / `#fitness`)**: Unified Readiness Verdict + modulated daily prescription, Last Run/Ride summary, contextual 2-tap check-in with Pain Safety Swap, and 3-Channel Orthopedic Load.
2. **Calendar (`#calendar`)**: Monthly & weekly planned/completed ledger + structured Workout Builder + **Plan Builder** (`#plan-builder` / `#totals`, including **Return-to-Run** & **First 5K** starter plans) + Race Simulator.
3. **Log (`#activities`)**: Filterable activity ledger, 1Hz Stream Inspector (`W' Balance`, `Pa:Hr`/`Pw:Hr`), GPS Map, Segments & Workout Comparison.
4. **Progress (`#progress` / `#curves` / `#trends` / `#charts`)**: Standalone analytics stage with `Fitness PMC`, `Power & Pace Curves`, `0–40 kJ/kg` & `0–2,000 kcal` Durability, and `Trends & Custom Lab`.

---

## Chapter 2: Strava Sync Policy, Optional Garmin / Intervals.icu & `.FIT` Import

### 1. Managing Your Strava Sync Window & Account
1. Click the **Connection Status Pill** in the top navigation bar to open **Data Sources & Telemetry Sync**.
2. Under **Strava — Primary Identity**, you can change your sync window (`Last 90d`, `Last 6 Months`, `Full Archive`, `Identity Only`), toggle bike/shoe gear & athlete profile sync, trigger an immediate sync, or click **Sign Out** to clear local telemetry on shared computers.
3. If you unchecked `View data about your activities` on Strava's consent screen, MeetReady detects the missing `activity:read` scope and provides a 1-click **Re-Authorize Activity Scope** button.

### 2. Optional Hardware Connectors: Garmin Connect, Intervals.icu, Wahoo & Polar
These connectors are **never mandatory**—they are optional add-ons that enrich MeetReady with workouts and overnight autonomic wellness:
- **Garmin Connect (Optional Add-On)**: Connects overnight `HRV rMSSD`, `Sleep Score`, `Resting HR`, and workout sync. Disconnect Garmin independently anytime without signing out.
- **Intervals.icu (Optional OAuth / API Key)**: Syncs structured calendars, `eFTP`, `W'`, and Intervals.icu-relayed devices (**COROS**, **WHOOP**, Suunto).
- **Wahoo Cloud & Polar AccessLink (Direct OAuth 2.0)**: Syncs ELEMNT/KICKR/Vantage/Grit X/H10 binary `.FIT` & exercise files using canonical UTC timestamps (`startDateUtcMs`) so evening workouts and ±5-minute deduplication work cleanly across all timezones.

### 3. Local 1Hz `.FIT` / `.GPX` / `.TCX` / `.ZIP` Drag-and-Drop Parser
- Drag `.fit`, `.fit.gz`, `.gpx`, `.tcx`, or bulk `.zip` archives directly into the **Drop Zone** inside **Data Sources** (or **Activities**).
- A background **Web Worker** extracts 1Hz telemetry records, computes Normalized Power (`NP`), Intensity Factor (`IF`), Training Stress Score (`TSS`), 7-zone distributions, and Peak Power/Pace curves, and stores the binary stream in **Browser IndexedDB (Dexie)**.

### 4. Logging Official `0.01s` FAT Race Results (`VDOT`)
- Click **Account Menu → Log Official Race (FAT)** (or **Log Official Race** in **Goals & Totals**).
- Record verified results from **Athletic.net**, **TFRRS**, **MileSplit**, **RunSignup**, or **Official FAT** (`800m` through `Marathon`).
- MeetReady calculates your **Daniels VDOT score**, converts NCAA indoor flat/banked/altitude marks, and pins a gold **Race PR Milestone** onto your PMC.

### 5. Local IndexedDB Archive Export & Restore
- Inside **Data Sources → Local Telemetry Archive**, click **Export Full JSON Backup** or **Import JSON Backup** anytime.

---

## Chapter 3: Fitness (`CTL`), Fatigue (`ATL`), Form & Garmin Load Focus

### 1. Reading the Interactive Performance Management Chart (PMC)
Located on the **Today / Fitness** tab, the dual-canvas ECharts PMC plots:
- **Fitness (`CTL` — Teal Line + Area, `#0D9488` Light / `#2DD4BF` Dark)**: Your 42-day exponentially weighted moving average of daily TSS.
- **Fatigue (`ATL` — Rose Line, `#E11D48` Light / `#FB7185` Dark)**: Your 7-day exponentially weighted moving average of daily TSS.
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
- MeetReady's server-side **Clean-Room Firewall** automatically strips third-party Strava-only raw tracks from multi-user teammate views and AI prompts.

### 3. Context-Aware Google Gemini AI Coach
- Generates 3 daily workout tiers (**Optimal**, **Modulated `-15%`**, **Active Recovery**) with 1-click Calendar push and multi-turn physiological chat.

---

## Chapter 8 · Scholastic, Collegiate & Family Workflows

- **Simplified 5-Tab Coach Workspace**: Dedicated `Home` (Quick Panel Links, Alerts & Conflicts, Comms Launcher), `Workouts` (Builder & Library), `Meets & Plan` (Team Events, Meet Day Packets, External Hy-Tek/Athletic.net Interop), `Timing` (`0.01s` multi-runner stopwatch + `/time` Delegated Timing Passes), and `Team` (Roll Call, GPS Check-In, AT Injury Hub, Roster & Admin).
- **Family Hub, Event RSVPs & Timed `.ics` Sync**: Linked `PARENT_FOLLOWER` accounts view athlete meet schedules, bus/arrival times, `Latest Timed Splits`, and Curated Meet Albums, submit 1-tap `Going / Out / Late / Conflict` RSVPs, and subscribe via revocable timed `webcal://` `.ics` feeds.
- **Unified Comms Hub**: Consolidated `Chat`, `Announcements`, and `Workout Notes` with `Parents Only` & custom sub-groups, staff `Got It` read-receipt rosters, Web Push with automatic Resend Email fallback, durable Dexie offline outbox, and 1-tap PII-redacted `Copy for Remind / ParentSquare`.
- **Athlete Daily & Physiological Intelligence**: Evening Closeout cards, watchless `SELF_REPORTED` completion auto-upgrading on wearable sync, **3-Channel Orthopedic Strip & Plan vs. Actual Ledger**, **`0–40 kJ/kg` & `0–2,000 kcal` Durability**, **Course Physics & Fueling Race Simulator**, and **3-layer Official FAT / Hand-Timed / Watch reconciliation** (see [docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md](SCHOLASTIC_AND_COLLEGIATE_GUIDE.md)).
