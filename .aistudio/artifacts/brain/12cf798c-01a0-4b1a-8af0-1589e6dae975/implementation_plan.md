# Zero-Shift Activity Bar & macOS Liquid Glass Redesign Plan

## 1. Confirmed Product & Design Decisions
1. **Static 2-Line Daily Activities Bar (Zero Vertical Chart Shift)**:
   - Reserve a fixed 2-line height (`h-[58px] min-h-[58px] max-h-[58px]`) for the hovered-day workout inspector bar above the Fitness & Freshness chart so the chart canvas **never moves vertically** when scrubbing between rest days, single workouts, and multi-workout days.
2. **Adaptive Dual-Mode macOS Liquid Glass System (Dark Default, Both Themes Upgraded)**:
   - Introduce true **Liquid Glass** optical materials in both Dark Obsidian (default) and Daylight Quartz modes: ambient atmospheric mesh backgrounds, `backdrop-filter: blur(24px) saturate(180%)`, `1px` specular top-edge inner highlights (`inset 0 1px 0`), hairline refractive borders, and soft multi-layer elevation shadows.
3. **Single Unified Floating Liquid Glass Header Bar**:
   - Consolidate the 2-tier top header and utility sub-bar into **one floating macOS Liquid Glass dock** (`rounded-2xl`), reclaiming vertical viewport space while keeping the 4 primary workspaces, environment filter (`All / Out / In`), distance units (`mi / km`), sync trigger, AI Coach, and Data Sources immediately accessible.
4. **Tactile Capsule Switchers, Luminous SVG Telemetry & SF-Style Typography**:
   - Upgrade sub-navigation and segmented controls to recessed macOS capsule tracks with floating specular active pills.
   - Add subtle optical glow filters to the `CTL`, `ATL`, and multi-color `Form (TSB)` SVG curves, and refine typographic hierarchy with tight display headings and tabular monospace telemetry cells.

---

## 2. Visual & Structural Architecture

```
+---------------------------------------------------------------------------------------------------+
|  [AeroPulse  o 4.2k]   ( [Fitness & Freshness]  Calendar  Workouts  Goals )   [All|Out|In] [mi] * |
|  ^ Single Floating macOS Liquid Glass Header Bar (blur-2xl + top specular highlight)              |
+---------------------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------------------+
|  [07 NOV 2025 - 06 NOV 2026 v]  53w 365d    ( 7d  1m  42d  3m  6m [1y] 2y All )   [+Sim] [Custom] |
|---------------------------------------------------------------------------------------------------|
|  Fixed 2-Line Daily Activity Inspector Strip (Locked 58px Height — Zero Chart Shift):             |
|  Line 1: Fri 06 Nov 2026 · 2 Workouts Recorded (142 TSS Combined)       Drag chart to zoom range  |
|  Line 2: [o Morning Threshold Ride · 94 TSS · 174bpm]  [o Evening Tempo Run · 48 TSS · 162bpm]    |
|---------------------------------------------------------------------------------------------------|
|  2x-Tall Multi-Pane SVG Canvas with Luminous CTL / ATL / Multi-Color Form Strokes + Right Gutter  |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Detailed Implementation Breakdown

### A. Fixed 2-Line Daily Activity Inspector (`FitnessHealthView`)
- Replace the variable-height flex bar above the PMC chart with a strict **`h-[58px]` two-row grid/flex container** (`py-1.5 px-5 overflow-hidden`):
  - **Row 1 (`22px`)**: Displays the hovered date (`Fri, Nov 6, 2026`), daily load summary (`142 TSS`), Garmin readiness status, and interaction hint (`Drag horizontally to zoom · Click any workout to inspect`).
  - **Row 2 (`24px`)**: Displays up to 4 interactive translucent workout pills for that day (with horizontal scroll or clean truncation if more than 4 workouts exist on a single day) or a subtle `Rest / Active Recovery Day — No structured workouts recorded` caption when empty.
- Because both rows are permanently allocated inside the `58px` height, the top edge of the SVG chart remains **pixel-locked** at all times.

### B. macOS Liquid Glass CSS Architecture (`index.css`)
- **Atmospheric Canvas Backdrops**:
  - **Dark Mode**: Deep obsidian-navy base (`#060A12`) layered with subtle fixed radial light pools (`cyan-500/8`, `indigo-500/7`, `emerald-500/5`) so glass panels refract underlying color gradients.
  - **Light Mode**: Cool quartz-alabaster base (`#EEF2F7`) layered with soft sky and pearl radial gradients (`sky-400/12`, `indigo-400/8`).
- **Reusable Liquid Glass Surface Classes**:
  - `.liquid-glass`: Translucent card surface (`bg-white/75 dark:bg-[#0F172A]/65 backdrop-blur-2xl border border-white/70 dark:border-white/[0.09]`) with top specular rim (`box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.22), 0 12px 32px -8px rgba(0,0,0,0.35)`).
  - `.liquid-glass-header`: High-refraction floating dock surface (`backdrop-blur-3xl saturate-180`) with crisp specular edge and soft floating shadow.
  - `.liquid-capsule-track`: Recessed pill container (`bg-slate-900/[0.06] dark:bg-black/35 inner-shadow rounded-full p-1 border border-slate-900/[0.05] dark:border-white/[0.06]`).
  - `.liquid-capsule-active`: Raised specular pill (`bg-white dark:bg-white/[0.14] shadow-sm inset-top-highlight`).

### C. Single Unified Floating Header & View Restyling (`App.tsx` & Views)
- Collapse the top `<header>` and secondary utility sub-bar in `App.tsx` into a **single floating Liquid Glass bar**:
  - Brand wordmark + compact live sync badge (`o 4,264` with hover tooltip & 1-click sync) on the left.
  - 4 primary workspace tabs inside a centered `.liquid-capsule-track` pill switcher.
  - Compact `All / Out / In` environment switcher, `mi / km` unit pill, `AI Coach` button, `Data Sources` button, and Theme toggle on the right.
- Apply `.liquid-glass` cards, `.liquid-capsule-track` switchers, and refined SF-style typography across `FitnessHealthView`, `FourteenDayReadinessLedger`, `ActivitiesView`, `CalendarView`, `PhysiologyView`, `PhysiologicalTrendsView`, `CustomChartsView`, and `GoalsView`.
