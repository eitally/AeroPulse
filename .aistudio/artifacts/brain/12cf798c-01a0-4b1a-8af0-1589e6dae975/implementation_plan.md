# AeroPulse — Full-History Intervals.icu Analytics Suite, Garmin Health/Sleep/Training Status, Hourly Auto-Sync & AI Coach

AeroPulse will be upgraded into a comprehensive endurance training, physiological health, and workout-planning platform modeled directly after **Intervals.icu**, backed by **100% all-time historical synchronization** across Garmin Connect (via Intervals.icu) and Strava OAuth2, **full Garmin Sleep, HRV & Training Status telemetry**, **automated hourly background polling**, arbitrary multi-metric time-series and correlation charting, and a persistent **AI Training & Program Coach** that can design and schedule daily or multi-week cycling and running workouts directly onto your Training Calendar.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> This revised plan explicitly incorporates your **Garmin Health, Sleep & Training Status** metrics alongside the **All-Time Historical Sync**, **Hourly Background Cron**, and **Intervals.icu Analytics Suite**:

- **Confirmed Decision 1 — Full Garmin Health, Sleep & Training Status Telemetry**:
  - **Garmin Sleep Tracking**: Pulls your real nightly Garmin sleep data (`sleepSecs` duration, `sleepScore` 0–100, `sleepQuality` rating, and overnight sleeping HR) across your entire history, displaying nightly sleep badges on the Training Calendar, a dedicated **Sleep & Recovery** subplot on the Fitness page, and longitudinal sleep trends in the Custom Chart Builder.
  - **Garmin Autonomic & Daily Health Biometrics**: Syncs overnight **HRV (`rMSSD` & `SDNN`)** with 7-day rolling averages and 60-day normal baseline corridors (**Garmin HRV Status**: `Balanced`, `Unbalanced`, `Low`), **Resting HR**, **Garmin VO2max** (Cycling & Running), **SpO2**, **Respiration Rate**, **Steps**, and **Weight**.
  - **8-State Garmin Training Status Engine**: Combines your Garmin **VO2max 28-day trend**, **HRV Status vs. baseline**, **Sleep Score**, and **Acute-to-Chronic Load Ratio (`ATL / CTL`)** to compute and track all 8 official Training Status states (`Productive`, `Peaking`, `Maintaining`, `Recovery`, `Unproductive`, `Strained`, `Overreaching`, `Detraining`) with clear physiological explanations.
- **Confirmed Decision 2 — All-Time Historical Sync + Automated Hourly Background Cron (`0 * * * *`)**:
  - **All-Time Backfill**: Pulls your complete historical timeline (`2010-01-01` through today) from Intervals.icu (`activities`, `wellness`, `events`) and pages through all historical Strava activities (`per_page=200` until exhaustion) so every indoor smart-trainer ride and outdoor workout back to day one is indexed and cached.
  - **Hourly Background Cron**: Runs an automated hourly sync job (`0 * * * *`) both via a server-side background scheduler and a dedicated `/api/cron/hourly-sync` endpoint (configured in `vercel.json` for Vercel Cron deployments) that delta-polls Strava and Intervals.icu every hour.
- **Confirmed Decision 3 — Full Intervals.icu Workspace Emulation + Advanced Endurance Tools**:
  - **Training Calendar (`/calendar`)**: Monthly/weekly grid juxtaposing completed workouts, planned structured workouts, nightly Garmin Sleep Score & HRV badges, weekly training load (`TSS`), duration, distance by sport, indoor/outdoor tags, and an Intervals.icu-style text workout syntax builder with `.zwo` / `.erg` export.
  - **Fitness, Freshness & Garmin Health View (`/fitness`)**: Interactive Performance Management Chart (`CTL` Fitness, `ATL` Fatigue, `TSB` Form), **Garmin Training Status & HRV Status Banner**, Forward PMC Tapering Simulator, and stackable subplots for **Sleep Duration & Score**, **HRV vs. Baseline Band**, **Resting HR**, **VO2max**, and **Weight**.
  - **Arbitrary Custom Chart Builder (`/charts`)**: Supports both **Multi-Axis Time-Series Plots** and **Metric Correlation Scatter Plots** across 30+ workout and Garmin health metrics (so you can chart *Sleep Score vs. Next-Day Efficiency Factor*, *HRV vs. Training Load*, *Resting HR vs. CTL*, or *Power vs. Heart Rate* over any custom date range).
  - **Power, HR & Pace Curves + Durability (`/curves`)**: Maximal effort duration curves (`1s` to `5h`) for Cycling Power (`W`, `W/kg`), Running Pace (`/mi`, `/km`, GAP), and Heart Rate with multi-season overlays, automatic `eFTP` / Critical Speed estimation, **Indoor vs. Outdoor Power/HR Delta**, and **Race Time Predictor**.
  - **Totals, Polarization & Gear Tracker (`/totals`)**: Weekly, monthly, and annual volume and time-in-zone distributions (`Z1–Z7`), **Seiler 80/20 Polarization Index**, Annual Mileage Target tracking, and **Shoe & Bike Gear Lifespan Tracking**.
  - **Activity Detail, Interval Inspector & Similar Workout Matcher**: Deep drill-down modal displaying second-by-second streams, auto-detected work intervals and lap splits, aerobic decoupling (`Pw:Hr` / `Pa:Hr`), Strava segment efforts, and **Matched Similar Workouts**.
- **Confirmed Decision 4 — Omnipresent AI Coach Drawer + Calendar Program Scheduling**:
  - Accessible on every page via a **persistent slide-over AI Coach Drawer** with full awareness of your Garmin Sleep Score, HRV Status, Training Status, CTL/ATL/TSB, and workout history—capable of scheduling single workouts or multi-week cycling/running programs directly onto your Training Calendar.

---

## 1. Overview & Core Concept

- **What It Does**: Provides an end-to-end endurance performance, Garmin health/sleep, and workout-planning environment matching Intervals.icu's analytical depth while unifying Garmin Connect and Strava's complete multi-year history, polling automatically every hour, and embedding a context-aware Gemini AI Coach.
- **Target Audience / Persona**: Data-driven multi-sport athletes (cyclists and runners training both outdoors and indoors on smart trainers/treadmills) who want complete longitudinal visibility into their fitness, workload, sleep, and autonomic recovery alongside intelligent, adaptive program design.
- **Key Value**: Eliminates the data gap caused by Intervals.icu redacting Strava-sourced indoor trainer rides, surfaces your Garmin epix Pro sleep, HRV, VO2max, and Training Status directly alongside your workload curves, and turns coaching conversations into scheduled calendar workouts.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Garmin Health, Sleep & Training Status Cockpit**:
   - At the top of the **Fitness & Health** workspace (and summarized in the header), a dedicated **Garmin Training & Recovery Status Bar** displays:
     - **Training Status Badge** (`Productive`, `Peaking`, `Maintaining`, `Strained`, `Recovery`, `Overreaching`, `Unproductive`, or `Detraining`) driven by your 28-day VO2max trend, HRV Status, and Acute-to-Chronic Load Ratio (`ATL / CTL`).
     - **Last Night's Garmin Sleep Card**: Total Sleep Duration (`7h 03m`), Garmin Sleep Score (`82 / 100`), Sleep Quality rating, and 7-day / 30-day rolling sleep debt.
     - **Garmin HRV Status & Autonomic Balance**: Overnight rMSSD (`ms`) plotted against your personal 7-day rolling average and 60-day normal baseline corridor (`Balanced` / `Unbalanced` / `Low`), plus Resting HR (`bpm`), VO2max (`mL/kg/min`), Respiration, and SpO2.
2. **All-Time Historical Sync & Hourly Auto-Poll Status**:
   - Pulls your complete Intervals.icu archive (`2010–present`, including all historical Garmin wellness/sleep/HRV days) and pages through all historical Strava activities (`200/page` until complete).
   - An **Hourly Auto-Sync Scheduler** runs automatically every 60 minutes so morning sleep/HRV metrics and newly completed Garmin/Strava workouts appear automatically.
3. **Training Calendar with Daily Sleep/HRV Badges & Workout Builder**:
   - Each calendar day cell displays completed workouts, planned structured workouts, and optional compact **Morning Readiness Pills** (Sleep Score, Sleep Hours, and HRV `ms`) so you can visually see how poor sleep or suppressed HRV affected workout execution across any week.
   - Clicking any calendar date opens the **Structured Workout Builder** supporting Intervals.icu shorthand syntax (`- 15m 65% FTP`, `5x - 4m 108% FTP - 2m 50% FTP`) with `.zwo` / `.erg` export and direct Intervals.icu → Garmin watch sync.
4. **Custom Chart Studio (Workouts + Garmin Sleep/Health Correlations)**:
   - Plot any combination of workout metrics AND Garmin health metrics over any custom date range:
     - *Time-Series Examples*: `Sleep Score & Sleep Duration vs. HRV (7d rolling)`, `Resting HR vs. CTL & ATL`, `VO2max vs. Weekly Training Load`.
     - *Scatter / Correlation Examples*: `Previous Night Sleep Score vs. Workout Efficiency Factor`, `Overnight HRV vs. Aerobic Decoupling %`, `Acute Training Load vs. Sleep Quality`.
5. **Slide-Over AI Coach with Sleep & Training Status Awareness**:
   - The AI Coach receives your latest Garmin Sleep Score, Sleep Duration, 7-day Sleep Debt, HRV Status (`Balanced`/`Unbalanced`/`Low`), 8-state Training Status, and CTL/ATL/TSB on every turn—automatically modulating daily or multi-week cycling and running prescriptions when sleep or HRV is suppressed, and scheduling approved sessions onto your calendar.

### Visual Identity & Theme
- **Aesthetic Direction**: High-precision physiological telemetry studio inspired by Intervals.icu's information density and Garmin's Training Status clarity.
- **Color Palette & Mood**:
  - Dark-first analytical slate canvas (`#0B0F17` primary background, `#111827` elevated surface, `1px solid #1E293B` hairlines) with instant toggle to crisp daylight mode (`#F8FAFC` / `#FFFFFF`).
  - Semantic physiological accents: **CTL Fitness Blue** (`#3B82F6`), **ATL Fatigue Purple** (`#A855F7`), **TSB Form & Productive Status Emerald/Amber/Crimson** (`#10B981` / `#F59E0B` / `#EF4444`), **Sleep Indigo/Sky** (`#6366F1` / `#38BDF8`), **Cycling Cyan** (`#06B6D4`), and **Running Orange** (`#F97316`).
- **Typography & Hierarchy**:
  - `Plus Jakarta Sans` for workspace navigation, section headers, and coaching prose.
  - `JetBrains Mono` (`tabular-nums`) strictly enforced across all calendar cells, sleep/HRV metrics, lap tables, power/pace curves, and time-series axes.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Deriving Garmin's 8-State Training Status & HRV Baseline Corridor from Raw Biometrics**
  - *Chosen Approach*: Extract all raw Garmin wellness fields synced through Intervals.icu (`sleepSecs`, `sleepScore`, `sleepQuality`, `hrv`, `hrvSDNN`, `restingHR`, `vo2max`, `spO2`, `respiration`, `steps`, `weight`) and compute the 60-day HRV normal corridor ($\mu \pm 0.75\sigma$), Acute-to-Chronic Load Ratio (`ATL / CTL`), and 28-day VO2max slope to classify each day into Garmin's 8 Training Status states (`Peaking`, `Productive`, `Maintaining`, `Recovery`, `Unproductive`, `Strained`, `Overreaching`, `Detraining`).
  - *Why*: Gives you the exact Garmin Training Status and HRV Status experience right inside your Intervals.icu PMC and Custom Chart workspace, while exposing the underlying math transparently.
- **Decision 2: Dual-Mode Hourly Auto-Sync Cron (Server Daemon + Vercel Cron Endpoint)**
  - *Chosen Approach*: Implement both an in-process hourly cron job on the Express server (`0 * * * *`) and a `/api/cron/hourly-sync` endpoint configured in `vercel.json` so new morning sleep/HRV data and completed Garmin/Strava workouts sync automatically every hour.
- **Decision 3: All-Time Multi-Page Historical Sync with Longitudinal PMC Reconstruction**
  - *Chosen Approach*: Pull your complete multi-year Intervals.icu wellness and activity history (`2010–present`) and paginate through all historical Strava activities (`200/page`), merging Strava-only indoor trainer rides into the daily training load series so `CTL`, `ATL`, `TSB`, and Load Ratio reflect 100% of your outdoor and indoor training.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        AeroPulse Analytical Workspace (React 19)                    │
│                                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │ Top Bar: Navigation Tabs │ Date Range & Sport/Env Filters │ AI Coach Drawer   │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                         │                                           │
│       ┌─────────────────────────────────┴───────────────────────────────────┐       │
│       ▼                                                                     ▼       │
│  ┌──────────────────────────────────────────────────────────┐  ┌─────────────────┐  │
│  │ Primary Analytical Viewport                              │  │ Persistent      │  │
│  │                                                          │  │ Slide-Over      │  │
│  │  ├─ 1. Training Calendar View (/calendar)                │  │ AI Coach Drawer │  │
│  │  │     ├─ Monthly/Weekly Grid + Sleep/HRV Readiness Pills│  │                 │  │
│  │  │     ├─ Completed Workouts + Planned Events + Load     │  │ ├─ Sleep, HRV & │  │
│  │  │     └─ Workout Builder Modal (.zwo/.erg + ICU Sync)   │  │ │  Training     │  │
│  │  │                                                       │  │ │  Status Pill  │  │
│  │  ├─ 2. Fitness, Freshness & Garmin Health (/fitness)     │  │ ├─ Multi-Turn   │  │
│  │  │     ├─ Garmin Training Status, Sleep & HRV Status Bar │  │ │  Run/Bike     │  │
│  │  │     ├─ All-Time CTL / ATL / TSB + Forward Simulator   │  │ │  Program Chat │  │
│  │  │     └─ Subplots: Sleep Score/Hrs, HRV Band, RHR, VO2  │  │ └─ Interactive  │  │
│  │  │                                                       │  │    Proposed     │  │
│  │  ├─ 3. Custom Chart Builder Studio (/charts)             │  │    Workout Cards│  │
│  │  │     ├─ Multi-Axis Time-Series (Workouts + Sleep/HRV)  │  │    [+ Schedule  │  │
│  │  │     └─ Scatter Correlations (e.g. Sleep vs. EF/Drift) │  │     to Calendar]│  │
│  │  │                                                       │  └────────┬────────┘  │
│  │  ├─ 4. Power, HR & Pace Curves + Predictors (/curves)    │           │           │
│  │  │     └─ Season Overlays, Indoor/Outdoor & Race Times   │           │           │
│  │  │                                                       │           │           │
│  │  ├─ 5. Totals, Polarization & Gear View (/totals)        │           │           │
│  │  │     └─ Volume, Z1-Z7 Zones, 80/20 Index & Gear Wear   │           │           │
│  │  │                                                       │           │           │
│  │  └─ 6. Activity Detail & Interval Inspector Modal        │           │           │
│  │        └─ Streams, Intervals/Laps, Segments & Repeats    │           │           │
│  └────────────────────────────┬─────────────────────────────┘           │           │
└───────────────────────────────┼─────────────────────────────────────────┼───────────┘
                                │                                         │
                                ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                     Express Backend API & Hourly Cron Engine (/api/*)               │
│                                                                                     │
│  ├─ Hourly Scheduler (0 * * * *) + GET /api/cron/hourly-sync (Delta Poll + Merge)   │
│  ├─ GET  /api/sync/all-history      (All-time Intervals.icu + Garmin Health/Strava) │
│  ├─ GET  /api/intervals/activities/:id/details (Streams + Intervals/Lap Splits)     │
│  ├─ POST /api/calendar/events       (Create/Update Planned Workout & Sync to ICU)   │
│  ├─ DELETE /api/calendar/events/:id (Remove Planned Workout)                        │
│  └─ POST /api/coach/chat            (Gemini 3.8 Flash Advisor + Workout Generator)  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State
- **`UnifiedWellnessDay` (All-Time Garmin Health & PMC Archive)**:
  - Stores daily fields across your entire history: `date`, `ctl`, `atl`, `tsb`, `loadRatio` (`ATL/CTL`), `rampRate`, `sleepSecs`, `sleepScore` (0–100), `sleepQuality` (1–4), `sleepDebt7dSecs`, `hrvRMSSD`, `hrvSDNN`, `hrvBaseline7d`, `hrvNormalBandLow`, `hrvNormalBandHigh`, `hrvStatus` (`'Balanced' | 'Unbalanced' | 'Low'`), `restingHR`, `vo2MaxCycling`, `vo2MaxRunning`, `spO2`, `respiration`, `steps`, `weightKg`, `garminTrainingStatus` (`'Peaking' | 'Productive' | 'Maintaining' | 'Recovery' | 'Unproductive' | 'Strained' | 'Overreaching' | 'Detraining'`), `trainingStatusReason`, and `dailyLoad`.
- **`UnifiedActivity` (All-Time Workout Archive)**:
  - Normalized across every historical Garmin/Intervals.icu and Strava workout (`id`, `intervalsId`, `stravaId`, `startDateLocal`, `name`, `sportCategory`, `environment`, `subType`, `movingTimeSecs`, `distanceMeters`, `elevationGainMeters`, `avgPower`, `normalizedPower`, `intensityFactor`, `variabilityIndex`, `trainingLoad`, `avgHr`, `maxHr`, `avgCadence`, `avgPaceSecsPerKm`, `gapPaceSecsPerKm`, `aerobicDecouplingPct`, `efficiencyFactor`, `zoneSecs`, `intervals[]`, `segmentEfforts[]`, `gearName`, `sourceBadges[]`).
