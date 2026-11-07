# Unified Endurance Performance & Adaptive Goal-Planning Plan ("One App to Rule Them All")

## 1. Product Vision & Architectural Overview
To unify the best capabilities of **Intervals.icu** (deep physiological telemetry & calendar), **Runna** (goal-to-calendar adaptive race plans, automatic deload weeks, race predictors, and pace insights), **TrainerRoad / Xert** (energy-system Progression Levels `1.0–10.0` and FTP block periodization), **Garmin Connect** (Primary Race Glance & 3-Bucket Load Focus tunnels), and **Strava** (Matched Runs/Rides longitudinal route comparison & PR Trophy Matrix), we will upgrade two core workspaces (**Goals & Plan Architect** and **Activity Log**) and connect them directly to the **Training Calendar** and **Athlete Profile**.

---

## 2. Core Functional & UI Modules to Build

### Module A: Multi-Week Goal-to-Calendar Adaptive Plan Generator + Calendar Objective Ribbon
1. **Interactive Goal Plan Architect (`src/components/GoalsView.tsx`)**:
   - **Preset & Custom Flagship Objectives**:
     - **Sub-20:00 5K Speed Block** (`Running` · Target `19:59` / `3:59/km`)
     - **Half Marathon Race Block** (`Running` · Target `1:32:00` in 12 Weeks)
     - **350W Cycling FTP Builder** (`Cycling` · Target `350W` / `4.0+ W/kg`)
     - **Gran Fondo / Century Endurance Peak** (`Cycling` · Target `100 mi` / `240 TSS`)
   - **Block Configuration Controls**:
     - Select **Block Duration** (`8`, `12`, or `16` weeks), **Training Days/Week** (`4`, `5`, or `6` days), **Primary Long Session Day** (`Saturday` or `Sunday`), and **Environment Split** (`Outdoor`, `Indoor/Virtual`, or `Hybrid`).
   - **Automatic Mesocycle Periodization with Deload Weeks**:
     - Generates a week-by-week periodized progression (`Base` → `Build` → **Every-4th-Week Deload (-30% volume & load)** → `Peak / Taper`) with weekly target hours, TSS, and key benchmark workouts.
   - **1-Click "Populate Training Block to Calendar"**:
     - Batch-generates structured `PlannedWorkoutEvent` workouts (complete with Intervals.icu step syntax and Z1–Z6 effort stripes) onto the **Training Calendar** and syncs them via the backend.
2. **Calendar Primary Objective Ribbon (`src/components/CalendarView.tsx`)**:
   - Adds a compact **Garmin Race-Glance Ribbon** at the top of the Calendar displaying the active primary goal (e.g., *`<20:00 5K` or `350W FTP`*), countdown in weeks/days, current mesocycle phase badge (`Base` / `Build` / `Deload Week` / `Taper`), weekly planned vs. completed load progress bar, and a 1-click jump to the Goal Plan Architect.

---

### Module B: Live Race Time Predictor, FTP Trajectory Model & "Pace / Power Insights" Loop
1. **Live Race Time & FTP Trajectory Predictor (`src/components/GoalsView.tsx`)**:
   - **Running Race Predictor Matrix**: Calculates live estimated finish times and paces for **5K, 10K, Half Marathon, and Marathon** from synced Threshold Pace, $\text{VO}_2\text{max}$, recent running Efficiency Factor (EF), and Riegel endurance scaling—displaying the exact time delta vs. your target goal (e.g., *Projected 5K: `20:34` → `-35s` needed for `<20:00`*).
   - **Cycling FTP Trajectory Model**: Projects **Current → 30-Day → 60-Day → 90-Day eFTP** (Watts & W/kg) toward your **350W FTP** target based on current CTL ramp rate and high-aerobic progression.
2. **Runna-Style "Pace & Power Insights" Auto-Calibration Banner (`src/components/GoalsView.tsx`)**:
   - Analyzes recent structured interval/threshold sessions against planned targets and surfaces a live coaching status:
     - **Ahead of the Pack**: Consistently exceeding prescribed power/pace with controlled cardiac decoupling ($<3.5\%$).
     - **On Point**: Hitting prescribed zone targets within $\pm 2\%$.
     - **Stretch Warning**: Elevated HR drift or incomplete interval time-in-zone.
   - Includes a **1-Click "Apply Recommended Target Adjustment"** button that updates your synced Athlete Profile (`ftp` or `thresholdPaceSecsPerKm`) and rescales future planned workouts.

---

### Module C: Energy-System Progression Levels (`1.0–10.0`) & Garmin Load Focus Tunnels
1. **TrainerRoad-Style Progression Levels (`src/components/GoalsView.tsx`)**:
   - Computes your live `1.0–10.0` Progression Level (plus 28-day change badge, e.g., `+0.6`) across 6 physiological zones:
     - **Endurance (Z2)**, **Tempo / Sweet Spot (Z3)**, **Threshold (Z4)**, **$\text{VO}_2\text{max}$ (Z5)**, **Anaerobic Capacity (Z6)**, and **Neuromuscular Sprint**.
   - Overlays the **Target Goal Requirement Marker** on each bar so you can immediately see which energy system is the bottleneck for your `350W FTP` or `<20:00 5K` objective.
2. **Garmin-Style 4-Week Load Focus Target Tunnels (`src/components/GoalsView.tsx`)**:
   - Visualizes 28-day accumulated load split across **Low Aerobic (Z1–Z2)**, **High Aerobic (Z3–Z4)**, and **Anaerobic (Z5–Z6+)** with dashed optimal target tunnels and diagnostic badges (`Shortage`, `Balanced`, `Over-Indexed`).

---

### Module D: Workout History Upgrades — Matched Runs/Rides, Execution Compliance & Seasonal PR Matrix
1. **Strava-Style "Matched Runs & Rides" Longitudinal Cluster (`src/components/ActivitiesView.tsx`)**:
   - Automatically detects and groups repeated routes, virtual courses, and benchmark sessions (e.g., *San Jose Cycling*, *San Jose Track Running*, *Zwift - Watopia*) into an interactive **Matched Sessions Comparison Panel**.
   - Displays attempt-over-attempt progression (Date, Duration, Avg Power or Pace, Avg HR, Efficiency Factor `EF`, Decoupling `%`, and delta vs. fastest/most efficient attempt) so you can verify real-world fitness gains on the exact same loop.
2. **Planned vs. Actual Workout Execution Compliance Score (`src/components/ActivitiesView.tsx` & `src/components/CalendarView.tsx`)**:
   - Computes a `0–100%` **Execution Compliance Score** comparing each completed workout against that day's planned duration, TSS load, and target intensity zone distribution, rendered as a color-coded badge (`Optimal Compliance ≥90%`, `Moderate 75–89%`, `Deviation <75%`) in both the Activity Log and Calendar cards.
3. **Seasonal Peak Power & Best Running Efforts Trophy Matrix (`src/components/ActivitiesView.tsx` & `src/components/GoalsView.tsx`)**:
   - Interactive PR matrix comparing **All-Time Best**, **2026 Season**, and **Last 90 Days** across key cycling durations (`5s`, `1m`, `5m`, `20m`, `60m` in Watts & W/kg) and running distances (`400m`, `1km`, `1 Mile`, `5K`, `10K`, `Half Marathon`), clickable to jump directly to the activity where the record was set.

---

## 3. Implementation Sequence
1. **Data & State Plumbing (`src/App.tsx` & `src/types.ts`)**:
   - Add batch planned-workout creation handler (`onBatchCreatePlannedEvents`) and wire `athleteProfile`, `plannedEvents`, `onSaveProfileOverride`, `onSelectActivity`, and `onSwitchToCalendar` into `GoalsView` and `ActivitiesView`.
2. **Upgrade `src/components/GoalsView.tsx`**:
   - Implement the **Multi-Week Goal-to-Calendar Adaptive Plan Generator (with Deload Weeks)**, **Live Race Time & 350W FTP Predictor Matrix**, **Pace & Power Insights Auto-Calibration Banner**, **Energy-System Progression Levels (`1.0–10.0`)**, **Garmin Load Focus Tunnels**, and **Seasonal PR Trophy Matrix**.
3. **Upgrade `src/components/ActivitiesView.tsx`**:
   - Add the **Matched Runs & Rides Longitudinal Comparison Panel** and **Planned vs. Actual Execution Compliance Score (`0–100%`)** badges.
4. **Upgrade `src/components/CalendarView.tsx`**:
   - Add the **Primary Objective Countdown & Block Phase Ribbon** at the top of the Calendar and display **Execution Compliance `%` badges** on completed activity cards.
5. **Verification**:
   - Run `compile_applet` and `lint_applet` together and verify all new workflows.
