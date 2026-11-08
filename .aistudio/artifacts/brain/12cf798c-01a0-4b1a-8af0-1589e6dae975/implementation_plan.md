# PMC Milestone Markers & CTL Line Redesign Plan

## 1. Root Cause Analysis of Current PMC Chart Dots
In `src/components/FitnessHealthView.tsx`, the Fitness & Freshness (PMC) chart currently renders two sets of noisy markers:
- **CTL Curve Dots (`cy={yLoad(d.ctl)}`)**: Plotted on any day where `dailyLoad >= 115` (`isPeakLoad`) or `stravaPrCount > 0`. Because normal endurance rides and workouts frequently exceed 115 TSS, red dots appear along the cyan Fitness curve even when no physiological breakthrough or race occurred.
- **X-Axis Baseline Dots (`cy={p1Bottom - 4.5}`)**: Plotted for any minor Strava segment PR (`hasPr`) or any day with 2+ logged workouts (`actCount >= 2`, hollow purple ring), without distinguishing true milestone performances or explaining what the markers mean.

---

## 2. Planned Changes (`src/components/FitnessHealthView.tsx`)

### A. Milestone Classification Engine (`enrichedSeries`)
For each day in the active PMC date window, detect and classify true **Milestone Performances** into three distinct categories:
1. **New eFTP Breakthrough (`EFTP_BREAKTHROUGH` — Aero Orange `#F97316`)**:
   - Triggered when Cycling `rideEftp` or Running `runEftp` increases step-wise compared to the prior day (e.g., `+4W Cycling eFTP (316W)` or `+3W Running eFTP (340W)`).
2. **Official Race Result / A-Race / Running Distance PR (`RACE_OR_DISTANCE_PR` — Gold/Amber `#F59E0B`)**:
   - Triggered when an activity on that day has `officialRaceData` (FAT Track / Road Race / XC Meet), matches a high-priority race/time-trial keyword (`Race`, `TT`, `Championship`, `Marathon`, `Half`, `5K`, `10K`, `Mile`, `1500m`, `3000m`, `5000m`), or represents the fastest pace/time in the window for a standard running distance.
3. **Power Curve Peak or Major Benchmark Segment PR (`POWER_OR_BENCHMARK_PR` — Rose/Magenta `#EC4899`)**:
   - Triggered when an activity achieves a peak Normalized Power / 20-min CP effort in the top 98th percentile of the athlete's archive or records a Rank #1 Gold PR (`prRank === 1`) on a primary benchmark climb/segment (`duration >= 120s` or `stravaPrCount >= 2` with `intensityFactor >= 0.88`), filtering out routine short segment noise.

*(Routine `dailyLoad >= 115` TSS days and `actCount >= 2` double-workout days are completely removed from the marker layer.)*

### B. Clean Cyan Fitness (`CTL`) Curve Markers
- Remove the `dailyLoad >= 115` and generic `stravaPrCount > 0` dots from the cyan CTL line.
- Render a crisp, ringed milestone node on the `CTL` curve **only** on days with an **A-Race / Official Race (`RACE_OR_DISTANCE_PR`)** or a **New eFTP Breakthrough (`EFTP_BREAKTHROUGH`)**:
  - **Aero Orange (`#F97316`)** node with white core for eFTP increases.
  - **Gold (`#F59E0B`)** node with white core for Official Races & Running Distance PRs.

### C. Color-Coded X-Axis Milestone Badges, Hover Details & Legend Strip
- Along the bottom baseline of Pane 1 (`p1Bottom - 6`), render distinct color-coded milestone markers for all three milestone categories:
  - **Orange Diamond / Badge (`#F97316`)**: New Cycling or Running eFTP Breakthrough.
  - **Gold Star / Trophy Badge (`#F59E0B`)**: Official Race Result or Running Distance PR.
  - **Magenta Peak Badge (`#EC4899`)**: Power Curve Peak or Major Benchmark Segment PR.
- **Interactive Hover & Daily Activity Bar Readout**:
  - When hovering or clicking a day with a milestone, display the exact milestone badge and label (e.g., `★ New Ride eFTP: 316W (+5W)`, `🏆 Official Race: 5000m Track PR`, or `⚡ Peak NP: 328W + Benchmark Segment PR`) in the top Daily Activities bar and as an SVG callout pill above the X-axis marker.
- **Milestone Legend Pill Bar**:
  - Add a compact, scannable legend strip in the PMC chart footer/header explaining the three X-axis milestone badges and the CTL breakthrough nodes, with a toggle to filter/highlight milestones on the chart.
