# THRESH v2.3 — High School & Collegiate Team Pack Guide

This guide documents the scholastic, NCAA collegiate, and club team capabilities built into **THRESH v2.3** (`src/physiology/teamOnboardingEngine.ts`, `src/physiology/scholasticEngine.ts`, `src/components/TeamManagementPanel.tsx`, and `server/teamService.ts`), designed to replace fragmented coaching spreadsheets, pace calculators, and result trackers with one unified workspace.

---

## 0. Team Onboarding, Locker-Room QR Posters, CSV Auto-Match & Athlete Sharing Tiers

### Creating or Joining a Team (`+ Team` & `/join/<slug>`)
1. **Strava Handles Identity**: Coaches and athletes sign in with **Continue With Strava**—no separate school passwords or manual API keys required.
2. **2-Card Team Hub (`TeamManagementPanel.tsx`)**:
   - **Athletes & Assistant Coaches**: Enter a 6-character Team Join Code (e.g., `PAXC-26`), tap a personalized magic link, or scan the coach's printable **Locker-Room QR Sheet** (`/join/<slug>`).
   - **Head Coaches & Club Directors**: Launch the **Team Branding & Safeguarding Studio** to configure school/club colors (automatically WCAG 2.1 AA contrast-clamped), upload a crest, and generate a Join Code + QR poster in under 60 seconds.
3. **Bulk `.CSV` Roster Importer & Automatic Strava Claim Matching**:
   - Paste spreadsheet rows or upload a `.CSV` with `Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark`.
   - When an invited athlete signs in with Strava and claims the team code or magic link, THRESH automatically matches their pending roster slot (by invite token, Strava ID, email, or normalized name), assigns their squad (`Varsity`, `Junior Varsity`, etc.), and pre-calibrates their threshold zones from `SeedMark` (including bare HS `3200m` marks like `10:15`, `800m` marks, `5K` times, or `280W 20m` cycling power).
4. **Youth Safeguarding vs. Collegiate Adult Defaults**:
   - `HIGH_SCHOOL` rosters default **Safe-Sport Weight Shield (`isMinorU18`)** and **Parent/Guardian CC** `ON`.
   - `COLLEGIATE` rosters treat standard college graduation years as legal adults (`isMinorU18: false`) unless an explicit incoming high-school recruit year is specified.
5. **Athlete Coach-Sharing Tiers (`CoachDataSharingTier`)**:
   - During Step 2 of onboarding, athletes joining a team explicitly choose what coaches see:
     - **`SUMMARY_ONLY` (Recommended)**: Shares morning readiness, `CTL/ATL/TSB`, 7-day load, and rolling 7-day NCAA CARA hours without exposing raw GPS tracks.
     - **`FULL_STREAMS`**: Shares full workouts, streams, and enables coach calendar workout pushes.
     - **`LOAD_ONLY`**: Shares aggregate training load metrics only.
   - Peer teammates never receive another athlete's raw Strava activities.

---

## 1. Auto-Scaled VDOT Pacing Pods & Printable Trackside Split Sheet

High school and college distance coaches routinely prescribe a single physiological workout (e.g., `6 x 1000m @ Tinman CV / Threshold w/ 60s jog`) to a roster of 25–80+ runners spanning `14:00` to `22:00+` 5K ability.

### How It Works (`computeTeamVdotPacingPods`)
1. Open **Athletes, Friends & Coaching Hub (`AthleteRosterModal.tsx`) → HS & College Coach Deck**.
2. Select:
   - **Physiological Intensity**:
     - `THRESHOLD_CV`: Threshold / Tinman Critical Velocity (`~0.99 × LT Pace`)
     - `INTERVAL_VO2`: VO2max Interval (`3K–5K Pace`, `~0.915 × LT Pace`)
     - `REPETITION`: Mile / Economy Repetition (`~0.855 × LT Pace`)
     - `MARATHON`: Steady State / Aerobic Tempo (`~1.065 × LT Pace`)
     - `EASY`: Easy / Aerobic Base (`~1.24 × LT Pace`)
   - **Rep Count & Rep Distance**: `200m`, `400m`, `800m`, `1000m`, or `1600m`.
   - **Recovery Cue**: e.g., `60s jog` or `200m float`.
3. THRESH infers each athlete's **Jack Daniels VDOT** from their calibrated Threshold Pace (or explicit VDOT override) and clusters the squad into cohesive **Pacing Pods (`Pod A — Varsity Lead`, `Pod B — Varsity Pack`, `Pod C — Sub-Varsity`, `Pod D — Developmental`)** within a `≤ 3.0 VDOT` (`±2s/400m`) corridor.
4. Every pod card displays exact target splits for **`200m`**, **`400m`**, **`800m`**, **`1000m`**, and **`1600m`**.
5. Coaches can:
   - Click **Push to Pod** to schedule the auto-scaled workout directly onto every coached athlete's calendar in that pod.
   - Click **Copy Printable Clipboard Sheet** (`formatPrintablePodSplitSheet`) to paste a formatted trackside split table into team group chats or print for a clipboard.
   - Add walk-on or tryout runners on the fly using the **+ Add Walk-On / Unconnected Teammate** bar.

---

## 2. Trackside "Spikes-On / Watchless" Multi-Athlete Split Pad

During spiked track workouts (`12 x 200m`, time trials) and championship meets, athletes often run **without GPS watches** (or where GPS track drift makes watch splits unreliable).

- Located in **HS & College Coach Deck → Trackside Spikes-On / Watchless Multi-Athlete Split Pad**.
- Click **Start Gun** to launch a `50ms`-resolution (`0.01s` display) stopwatch.
- Tap **+ Tap Split** next to any runner as they cross the line to record their cumulative and individual lap delta (`Last: 63.84s · Cum 2:08.12`).
- Click **Copy All Splits (CSV)** to export the entire squad's lap table for post-practice review.

---

## 3. 1Hz Unstructured Rep Auto-Detection ("Forgot-to-Lap Recovery")

Student-athletes frequently run structured workouts (`8 x 400m`, `6 x 1000m`, hill repeats, or fartleks) without pressing the `Lap` button on their watch—resulting in either a single continuous stream or 1-mile auto-laps that cut right through the middle of work reps.

### How It Works (`autoDetectUnstructuredIntervals`)
- Runs automatically in `src/workers/activityProcessor.worker.ts` when an uploaded or synced workout has `≤ 1` device lap, and on demand via the **Recover Unstructured Reps (1Hz No-Lap Detector)** button inside any workout in `ActivitiesView.tsx`.
- Computes a 5-second smoothed velocity (`m/s`) or power (`W`) trace, evaluates empirical session quantiles (`P30` recovery floor vs. `P82`/`P92` work plateau), and applies two-state hysteresis segmentation down to `18s` minimum work duration (capturing fast `200m` reps in `24–36s`).
- Automatically snaps standard track distances within `±8.5%` to clean labels (`Auto-Rep #1 (~400m)`, `Auto-Rep #2 (~400m)`, `Float / Jog #1`).

---

## 4. Official NCAA Track Facility & Altitude Indexing + Recruiting Standards Matrix

Located in **Log Official Race Result (`OfficialRaceModal.tsx`) → Quick Watchless FAT Logger**:

### NCAA Track Facility Indexing (`convertNcaaTrackPerformance`)
Converts times between **`INDOOR_FLAT_200M`**, **`INDOOR_BANKED_200M`**, and **`OUTDOOR_400M`** using NCAA gender- and event-specific turn-radius multipliers:

| Event | Men's Flat → Banked/Outdoor Factor | Women's Flat → Banked/Outdoor Factor |
| :--- | :---: | :---: |
| **`800m`** | `× 0.9857` | `× 0.9872` |
| **`1500m` / `1600m` / `Mile`** | `× 0.9869` | `× 0.9882` |
| **`3000m` / `3200m`** | `× 0.9885` | `× 0.9896` |
| **`5000m`** | `× 0.9907` | `× 0.9919` |
| **`10000m`** | `× 0.9925` | `× 0.9935` |

### NCAA Altitude Allowance (`≥ 3,000 ft`)
For races contested at `≥ 3,000 ft` elevation (e.g., Boulder `5,280 ft`, Albuquerque `4,950 ft`, Flagstaff `6,910 ft`), THRESH deducts the distance- and elevation-scaled hypoxic time allowance so athletes can see their sea-level championship index mark.

### 6-Tier Recruiting & Championship Standards (`evaluateRecruitingStandards`)
Compares the athlete's indexed time against Men's and Women's benchmarks across `800m`, `1500m`, `1600m`, `Mile`, `3000m`, `3200m`, `5000m`, and `10000m`:
1. **HS State Championship Qualifier**
2. **NCAA D3 Impact Recruit**
3. **NCAA D2 Scholarship Target**
4. **HS Nationals (Nike / New Balance)**
5. **NCAA D1 Roster / Walk-On**
6. **NCAA D1 Scholarship Standard**

---

## 5. Safe-Sport / RED-S Protection, Student-Athlete Check-In & Cross-Training Virtual Miles

### Safe-Sport Body-Weight & `W/kg` Shield (`AthleteProfileModal.tsx`)
- Enabling **Safe-Sport / RED-S Protection (`Hide Weight & W/kg`)** hides body weight (`kg`/`lbs`) and relative power (`W/kg`) across athlete-facing KPI cards, 7-zone tables, segment tables, and roster rows—preventing Relative Energy Deficiency in Sport (RED-S) triggers while preserving full pace, heart rate, and absolute watt zone functionality.

### 5-Second Student-Athlete Check-In (`evaluateStudentAthleteGuardrail` in `FitnessHealthView.tsx`)
Evaluates three scholastic/collegiate risk vectors before practice:
1. **Focal Shin / Metatarsal Bone-Stress Stop (`shinMetatarsalSoreness ≥ 2/3`)**: Immediately triggers a red `BONE_STRESS_STOP` (`0%` running impact cap) to catch tibial or metatarsal Bone Stress Injuries (BSI) before a stress reaction becomes a cortical fracture.
2. **Serum Ferritin Iron-Depletion Caution (`ferritinNgMl < 30 ng/mL`)**: Alerts the athlete and coach when low ferritin reserves blunt aerobic capacity and elevates threshold heart rate.
3. **Academic / Exam Allostatic Modulation (`academicStress ≥ 4/5` or `sleepHours < 6.2h`)**: Down-scales interval volume to `84%` during Midterms and Finals weeks when HPA-axis cortisol is elevated.

### Training Room Cross-Training → Virtual Running Miles (`computeCrossTrainingEquivalence`)
Converts injured or load-managed training-room sessions into **Virtual Running Miles / Km**, systemic TSS, and bone-impact reduction:
- **Deep-Water Aqua Jogging**: `100%` impact saved (`~9.0 min` per virtual mile at RPE 6).
- **AlterG Anti-Gravity Treadmill (`75% BW`)**: `62%` impact saved (`~7.4 min` per virtual mile at RPE 6).
- **High-Cadence Elliptical (`90+ RPM`)**: `96%` impact saved (`~8.5 min` per virtual mile at RPE 6).
- **Cybex Arc Trainer**: `96%` impact saved (`~8.2 min` per virtual mile at RPE 6).
- **Stationary / Spin Bike (`90+ RPM`)**: `100%` impact saved (`~10.0 min` per virtual mile at RPE 6).

---

## 6. NCAA Bylaw 17.1 (`20-Hour Weekly / 4-Hour Daily CARA`) Compliance Audit

Collegiate programs must comply with NCAA Bylaw 17.1 limiting in-season Countable Athletically Related Activities (CARA) to **20 hours per week** and **4 hours per day**.
- `summarizeNcaaCaraWeeklyHours` audits rolling 7-day logged activity duration across every connected athlete in the **HS & College Coach Deck**, flagging warnings at `≥ 17.5h/wk` and non-compliance at `> 20.0h/wk` or `> 4.0h/day`.
