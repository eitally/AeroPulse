---
name: THRESH
description: Athletic stadium-track workspace and laboratory-grade endurance physiology system for runners, cyclists, and coaching staffs.
colors:
  track-volt: "#C8FF00"
  track-volt-hover: "#B5EB00"
  stadium-pine: "#1C5436"
  volt-olive-ink: "#3F6212"
  volt-lime-ink: "#A3E635"
  strava-vermilion: "#C23800"
  strava-vermilion-hover: "#A83000"
  stadium-surround-light: "#163022"
  stadium-surround-dark: "#0C1D14"
  stadium-chalk: "#F4F7F2"
  obsidian-pine: "#0B120E"
  pine-frame-light: "#2B5B3F"
  pine-frame-dark: "#2B543B"
  crisp-paper: "#FFFFFF"
  carbon-pine: "#101B15"
  chalk-inset: "#E9EFE9"
  deep-turf: "#15231B"
  pill-track-light: "#E3ECE5"
  pill-track-dark: "#0B140F"
  obsidian-ink: "#080A09"
  ink-primary-light: "#101411"
  ink-primary-dark: "#F4F7F4"
  ink-secondary-light: "#1F3528"
  ink-secondary-dark: "#C8D8CE"
  ink-muted-light: "#43584B"
  ink-muted-dark: "#93A39A"
  zone-1-mist: "#94A3B8"
  zone-2-aerobic-teal: "#0D9488"
  zone-3-ochre: "#D97706"
  zone-4-vermilion: "#EA580C"
  zone-5-crimson: "#DC2626"
  zone-6-violet: "#7C3AED"
  pmc-atl-rose: "#E11D48"
  pmc-tsb-emerald: "#059669"
  pmc-tsb-sky: "#0284C7"
  status-prime-bg: "#ECFDF5"
  status-prime-ink: "#065F46"
  status-info-bg: "#F7FEE7"
  status-info-ink: "#365314"
  status-caution-bg: "#FFFBEB"
  status-caution-ink: "#92400E"
  status-strained-bg: "#FFF1F2"
  status-strained-ink: "#9F1239"
typography:
  display:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif"
    fontSize: "clamp(1.5rem, 2.5vw, 1.875rem)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: "-0.011em"
  label:
    fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.06em"
    fontFeature: "\"tnum\" 1"
  kpi:
    fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
    fontFeature: "\"tnum\" 1"
rounded:
  lane: "0.35rem"
  tab: "0.425rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  stage-mobile: "1.25rem"
  stage: "1.5rem"
  full: "9999px"
spacing:
  2xs: "0.25rem"
  xs: "0.375rem"
  sm: "0.5rem"
  md: "0.875rem"
  lg: "1.25rem"
  xl: "2rem"
  touch: "2.75rem"
components:
  button-primary:
    backgroundColor: "{colors.track-volt}"
    textColor: "{colors.obsidian-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "{spacing.touch}"
  button-primary-hover:
    backgroundColor: "{colors.track-volt-hover}"
    textColor: "{colors.obsidian-ink}"
  button-secondary:
    backgroundColor: "{colors.chalk-inset}"
    textColor: "{colors.ink-primary-light}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.875rem"
    height: "{spacing.touch}"
  button-strava:
    backgroundColor: "{colors.strava-vermilion}"
    textColor: "{colors.crisp-paper}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1.25rem"
    height: "3.125rem"
  button-strava-hover:
    backgroundColor: "{colors.strava-vermilion-hover}"
    textColor: "{colors.crisp-paper}"
  nav-track-tab-active:
    backgroundColor: "{colors.track-volt}"
    textColor: "{colors.obsidian-ink}"
    rounded: "{rounded.tab}"
    padding: "0.25rem 0.875rem"
  nav-track-tab-idle:
    backgroundColor: "{colors.chalk-inset}"
    textColor: "{colors.ink-secondary-light}"
    rounded: "{rounded.tab}"
    padding: "0.25rem 0.875rem"
  card-telemetry:
    backgroundColor: "{colors.crisp-paper}"
    textColor: "{colors.ink-primary-light}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  card-inset-well:
    backgroundColor: "{colors.chalk-inset}"
    textColor: "{colors.ink-primary-light}"
    rounded: "{rounded.md}"
    padding: "1rem"
  chip-status-prime:
    backgroundColor: "{colors.status-prime-bg}"
    textColor: "{colors.status-prime-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
---

# Design System: THRESH

## Overview

**Creative North Star: "The Stadium Track Lab"**

THRESH fuses the painted geometry of a 400-meter collegiate oval with the calm precision of an exercise-physiology laboratory. Every screen sits inside a deep Pine stadium surround lit by a subtle upper-left floodlight glow, framing a crisp `2px` Pine-bordered workspace stage—Stadium Chalk in daylight and Obsidian-Pine after dark. Within that arena, velocity-sheared `-14deg` navigation tabs and lane badges deliver unmistakable athletic identity at the perimeter, while interior telemetry cards, 1Hz workout streams, and coaching tables stay disciplined, orthogonal, and effortless to scan under fatigue or trackside glare.

The interface serves solo self-coached runners and cyclists alongside 80-athlete scholastic and collegiate rosters without splitting into two visual worlds. Density is high where longitudinal load curves, Banister `CTL`/`ATL`/`TSB` readouts, and `0.01s` multi-runner splits demand immediate comparison, yet buffered by recessed turf/chalk wells rather than nested drop-shadow cards. THRESH explicitly rejects decorative full-bar `backdrop-filter` blur passes, gamified neon clutter, fabricated readiness scores on uncalibrated accounts, and stacked uppercase kickers above headings.

**Key Characteristics:**
- **Framed Stadium Stage:** Deep Pine outer surround framing a `2px` Pine-bordered workspace stage (`1.5rem` desktop radius) with opaque tonal layering across light and dark modes.
- **High-Voltage Track Volt Discipline:** Track Volt (`#C8FF00` paired with `#080A09` Obsidian ink) is reserved strictly for primary actions, active navigation pills, and threshold focal markers.
- **Velocity-Sheared Perimeter Geometry:** Primary cockpit tabs and lane badges skew `-14deg` with `+14deg` counter-skewed inner labels, echoing the `B3-3A × W1` THRESH track lockup.
- **Protected Physiological Encodings:** Six-zone effort colors (`Z1–Z6`), Banister load series, and WCAG AA/AAA readiness pills stay invariant across themes and school/club co-branding.
- **Tabular Telemetry & `11px` Floor:** `Plus Jakarta Sans` pairs with `JetBrains Mono` (`tabular-nums`) and a hard `0.6875rem` (`11px`) `rem`-scaled floor so live `0.01s` splits and `1Hz` scrubbers never jitter.
- **Zero-Blur 60fps Surfaces:** Solid surface steps and crisp `1px`–`2px` borders replace GPU-heavy glassmorphism, keeping dense ECharts/uPlot canvases responsive on mobile field devices.

## Colors

The palette balances deep stadium-pine architectural framing and chalk/obsidian lab surfaces against a scarce, high-contrast Track Volt accent and strictly locked physiological data encodings.

### Primary
- **Track Volt** (`#C8FF00`, hover `#B5EB00`): Primary action fill on `.ap-btn-primary`, active `.ap-nav-volt-active` navigation tabs, dark-mode brand gauge sectors, and active switcher indicator bars. Always paired with **Obsidian Ink** (`#080A09`) when used as a solid fill.
- **Stadium Pine** (`#1C5436`): Primary light-mode brand accent ink (`--ap-brand-primary`) for inline brand text, icons, and light-mode chart chrome where raw Volt lacks contrast against white.
- **Volt Olive Ink** (`#3F6212`) & **Volt Lime Ink** (`#A3E635`): High-contrast micro-telemetry label inks (`.ap-telemetry-label`), delivering `7.1:1` AAA contrast on Crisp Paper in light mode and crisp readability on Carbon-Pine in dark mode.

### Secondary
- **Strava Vermilion** (`#C23800`, hover `#A83000`): Dedicated partner OAuth sign-in fill (`.ap-btn-strava`) with Crisp Paper (`#FFFFFF`) text at `5.44:1` WCAG AA contrast, plus provenance text ink (`#B83500` light / `#FF7A45` dark) on Strava sync controls.

### Tertiary
- **Zone 1 Cool Mist** (`#94A3B8`): Active recovery effort encoding across pace/power zone tables, workout blocks, and 1Hz stream overlays.
- **Zone 2 Aerobic Teal** (`#0D9488`): Endurance base zone, Low Aerobic load focus bar, and light-mode Banister Chronic Training Load (`42d CTL`; `#2DD4BF` in dark mode).
- **Zone 3 Ochre** (`#D97706`): Tempo / Sweet Spot effort zone and Banister `TSB` productive grey-zone warning (`#FBBF24` in dark mode).
- **Zone 4 Thresh Vermilion** (`#EA580C`): Lactate threshold (`LT2` / `FTP` / `CP`) effort zone and High Aerobic load focus bar.
- **Zone 5 Crimson** (`#DC2626`): $\text{VO}_2\max$ aerobic power zone and Banister `TSB` high overreach risk (`#F87171` in dark mode).
- **Zone 6 Deep Violet** (`#7C3AED`): Anaerobic / neuromuscular capacity (`W'`) effort zone and Anaerobic load focus bar.
- **Banister ATL Rose & TSB Readiness Series** (`#E11D48` `7d ATL`, `#059669` Optimal Race Window `TSB`, `#0284C7` Fresh/Transition `TSB`): Locked longitudinal chart series in `themeTokens.ts` (lifting to `#FB7185`, `#34D399`, and `#38BDF8` on dark canvases).
- **Semantic Readiness & Compliance Pills**:
  - **Prime** (`#ECFDF5` fill / `#065F46` ink light; `rgba(16, 185, 129, 0.15)` / `#6EE7B7` dark): Optimal autonomic readiness, CARA compliance, and active Safe-Sport shielding.
  - **Info** (`#F7FEE7` fill / `#365314` ink light; `rgba(200, 255, 0, 0.12)` / `#D9F99D` dark): Balanced load, Day-1 `CALIBRATING` states, and sync metadata.
  - **Caution** (`#FFFBEB` fill / `#92400E` ink light; `rgba(245, 158, 11, 0.15)` / `#FCD34D` dark): Modulated (`-15%`) workouts, aerobic decoupling drift, and webview advisories.
  - **Strained** (`#FFF1F2` fill / `#9F1239` ink light; `rgba(244, 63, 94, 0.15)` / `#FDA4AF` dark): Suppressed HRV, overreaching (`TSB < -30`), orthopedic bone-stress stops, and error alerts.

### Neutral
- **Stadium Surround** (`#163022` Classic Pine light / `#0C1D14` Deep Pine dark): Outer `body` backdrop behind the workspace stage, accented by a static upper-left floodlight radial gradient (`rgba(200, 255, 0, 0.14)` light / `0.12` dark).
- **Workspace Stage** (`#F4F7F2` Stadium Chalk light / `#0B120E` Obsidian-Pine dark): Main `.ap-content-stage` canvas housing views and onboarding steps.
- **Pine Structural Frame** (`#2B5B3F` light / `#2B543B` dark): `2px` architectural border around `.ap-content-stage` and `.ap-header-bar`.
- **Telemetry Card Surface** (`#FFFFFF` Crisp Paper light / `#101B15` Carbon-Pine dark): Primary `.ap-card` container surface, bounded by subtle pine-tinted `1px` borders (`rgba(38, 88, 58, 0.19)` light / `rgba(57, 150, 99, 0.36)` dark).
- **Recessed Inset Well** (`#E9EFE9` Chalk Inset light / `#15231B` Deep Turf dark): Nested KPI bento cells, secondary buttons, and form wells (`.ap-card-inset`), bounded by `rgba(38, 88, 58, 0.16)` light / `rgba(57, 150, 99, 0.26)` dark.
- **Capsule Switcher Track** (`#E3ECE5` light / `#0B140F` dark): Recessed track housing segmented view and unit toggles (`.ap-pill-track`).
- **Foreground Inks**: Primary ink (`#101411` light / `#F4F7F4` dark) for headings and KPI numerals; Secondary ink (`#1F3528` light / `#C8D8CE` dark) for supporting labels and idle tabs; Muted ink (`#43584B` light / `#93A39A` dark) for chart axes and captions (`>= 4.5:1` WCAG AA).

### Named Rules
**The 80 / 15 / 5 Stadium Budget Rule.** Eighty percent of any viewport belongs to neutral chalk, paper, or carbon-pine surfaces, fifteen percent to structural stadium-pine frames and recessed turf wells, and at most five percent to Track Volt (`#C8FF00`) so primary actions and active tabs command instant focus.

**The Sacred Physiology Rule.** Physiological effort zones (`Z1–Z6`), Banister load series (`CTL`, `ATL`, `TSB`), and semantic readiness pills never re-theme—even when a school or club activates custom co-branding (`applyTeamBrandToDocument`), which clamps team accents to WCAG 2.1 AA (`>= 4.55:1`) and applies them strictly to outer chrome, hairlines, and primary CTAs.

**The Dark Ink on Volt Rule.** Solid Track Volt (`#C8FF00`) fills always carry Deep Obsidian text (`#080A09`) for `> 15:1` contrast, and standalone brand text on light surfaces shifts to Stadium Pine (`#1C5436`) or Volt Olive (`#3F6212`) rather than rendering illegible yellow-green text on white.

## Typography

**Display Font:** Plus Jakarta Sans (with `-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif`)
**Body Font:** Plus Jakarta Sans (with `-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif`)
**Label/Mono Font:** JetBrains Mono (with `'SF Mono', ui-monospace, SFMono-Regular, monospace`)

**Character:** Geometric, athletic, and high-x-height in `Plus Jakarta Sans` for crisp coaching directives and headers, anchored by laboratory-grade `JetBrains Mono` tabular numerals for physiological metrics, workout syntax, and `0.01s` trackside splits.

### Hierarchy
- **Display** (700 weight, `clamp(1.5rem, 2.5vw, 1.875rem)` / `24px–30px`, `1.25` line-height, `-0.025em` tracking): Onboarding hero headlines in `StravaAuthGate` and primary cockpit milestones.
- **Headline** (700 weight, `1.125rem` / `18px`, `1.35` line-height, `-0.025em` tracking): Primary modal titles, major workspace section headers, and standalone documentation headings.
- **Title** (700 weight, `0.875rem` / `14px`, `1.4` line-height, `-0.025em` tracking): Telemetry card headers, coaching desk subheaders, and pod titles.
- **Body** (400–500 weight, `0.875rem` / `14px` standard and `0.75rem` / `12px` dense cockpit prose, `1.62` line-height, `-0.011em` tracking): Coaching rationale, physiological explanations, privacy pledges, and documentation prose (capped at `65–75ch` in reading views).
- **Label** (600–700 weight, `0.6875rem` / `11px` via `--text-2xs`, `1.45` line-height, `0.06em` tracking, uppercase `JetBrains Mono`): Micro-telemetry labels (`.ap-telemetry-label`), readiness status pills, `.ap-lane-badge` callouts, and table column headers.
- **KPI Readout** (700 weight, `1.5rem` / `24px`, `1.15` line-height, `-0.03em` tracking, `tabular-nums`): Hero readiness metrics, FTP/VDOT thresholds, and live `0.01s` stopwatch displays.

### Named Rules
**The Tabular Telemetry Rule.** Every physiological metric (`CTL`, `ATL`, `TSB`, `Watts`, `W/kg`, `bpm`, `min/mi`, `min/km`), `0.01s` FAT/stopwatch split, join code, and chart axis renders in `JetBrains Mono` with `font-variant-numeric: tabular-nums` so numbers never shift horizontally as values update.

**The 11px Rem Floor Rule.** Micro-telemetry captions and badges bottom out at `0.6875rem` (`11px` via `--text-2xs`), scaling proportionally with browser root `rem` preferences; hardcoded sub-`11px` pixel font sizes are prohibited.

**The Unassisted Heading Rule.** Headings establish hierarchy directly through bold weight and `-0.025em` tracking without stacked uppercase kickers or eyebrows above them; when status or lane context is needed, place a pill or `.ap-lane-badge` inline beside or beneath the heading.

## Layout

THRESH uses a **framed stadium-stage shell** (`.ap-shell`, `min-height: 100dvh`, `overflow-x: clip`) over the outer Pine surround. Content centers inside `.ap-container` (`max-width: 96rem` / `1536px`, `padding-inline: clamp(0.75rem, 2.2vw, 2rem)`), with onboarding flows constrained to a focused `42rem` (`max-w-2xl`) stage so Strava OAuth and sync choices fit cleanly in the first viewport.

Inside `.ap-content-stage` (`padding: 1rem` on mobile, `2rem` on `>= 640px`), analytical views compose on a **12-column desktop bento grid** (`.ap-grid-dashboard-12`, `repeat(12, minmax(0, 1fr))`, `gap: 1.25rem` at `>= 1024px`) that collapses cleanly to a single-column stack (`gap: clamp(0.875rem, 1.8vw, 1.25rem)`) below `1024px`. Every grid child enforces `min-width: 0` so responsive ECharts and uPlot canvases shrink without horizontal overflow. For example, `CircadianFirstTouchHero` splits its 12 columns into a `5 + 3 + 4` morning triage bento (7-day Load Focus, overnight readiness vitals, and adaptive workout prescription).

Navigation adapts by posture: desktop viewports (`>= 768px`) display the full horizontal `.ap-header-bar` with `-14deg` workspace tabs, while mobile viewports (`< 768px`) reserve bottom clearance (`calc(4.75rem + env(safe-area-inset-bottom, 0px))`) for `.ap-mobile-dock`. Horizontal filter toolbars use `.ap-toolbar-scroll` (touch-scrollable single row below `640px`, wrapping cleanly at `>= 640px`). Modals (`.ap-modal-backdrop` + `.ap-modal-sheet`) anchor to the bottom edge as `92dvh` sheets on phones (`< 640px`) and center with `1rem` outer padding (`max-height: 90vh`) on larger screens. Interactive controls enforce a `2.75rem` (`44px`) touch-target floor on touch viewports (`>= 3.125rem` / `50px` on the primary Strava OAuth CTA and `>= 3.5rem` / `56px` on watchless trackside runner rows). Standalone documentation (`public/docs/index.html`) adapts the same Stadium Pine & Chalk/Obsidian palette into a sticky-header + two-column sidebar TOC reading layout.

## Elevation & Depth

THRESH uses **structural Pine framing and opaque tonal luminance steps** rather than heavy drop-shadow stacks or frosted-glass blur. Depth moves across four crisp, solid surface planes: the deep Pine outer stadium surround (`#163022` / `#0C1D14`), the `2px` Pine-bordered workspace stage (`#F4F7F2` / `#0B120E`), `1px`-bordered elevated telemetry cards (`#FFFFFF` / `#101B15`), and shadowless recessed inset wells (`#E9EFE9` / `#15231B`).

### Shadow Vocabulary
- **Content Stage Frame** (`box-shadow: 0 18px 40px -16px rgba(7, 18, 12, 0.42), 0 2px 8px 0 rgba(7, 18, 12, 0.18)` light; `0 22px 48px -16px rgba(0, 0, 0, 0.78), 0 2px 10px 0 rgba(0, 0, 0, 0.5)` dark): Lifts `.ap-content-stage` off the outer stadium surround.
- **Header Bar Lift** (`box-shadow: 0 10px 26px -10px rgba(10, 24, 16, 0.32), 0 1px 3px 0 rgba(16, 20, 17, 0.08)` light; `0 12px 30px -10px rgba(0, 0, 0, 0.75), 0 1px 4px 0 rgba(0, 0, 0, 0.45)` dark): Gives `.ap-header-bar` crisp separation over scrolling telemetry without backdrop blur.
- **Telemetry Card Rest** (`box-shadow: 0 2px 10px -3px rgba(16, 20, 17, 0.05), 0 1px 2px 0 rgba(16, 20, 17, 0.03)` light; `0 10px 28px -10px rgba(0, 0, 0, 0.65), 0 2px 6px -1px rgba(0, 0, 0, 0.4)` dark): Low-profile ambient contact shadow on `.ap-card` containers.
- **Volt Action Glow** (`box-shadow: 0 2px 10px rgba(132, 204, 22, 0.28)` light; `0 2px 16px rgba(200, 255, 0, 0.26)` dark): Subtlelime aura beneath `.ap-btn-primary` and `.ap-nav-volt-active` pills.
- **Active Switcher Bar** (`box-shadow: inset 0 -2.5px 0 0 #A3E635, 0 1px 3px 0 rgba(16, 20, 17, 0.08)` light; `inset 0 -2.5px 0 0 #C8FF00, 0 2px 6px 0 rgba(0, 0, 0, 0.5)` dark): Combines a bottom Volt indicator bar with a `1px` contact lift inside `.ap-pill-active`.

### Named Rules
**The Zero-Blur Cockpit Rule.** Navigation bars, cards, chart tooltips, and modals use opaque fills and crisp `1px`–`2px` borders without full-bar or full-screen `backdrop-filter: blur()` or `background-attachment: fixed`, preserving `60fps` frame pacing during `1Hz` stream scrubbing.

**The Recessed Well Rule.** Sub-sections inside a card—such as bento KPI tiles, privacy pledge blocks, and Load Focus rows—step *down* into shadowless Chalk Inset (`#E9EFE9`) or Deep Turf (`#15231B`) wells rather than stacking elevated white/carbon cards inside cards.

## Shapes

THRESH's form language pairs **concentric stadium-turn radii** on analytical containers with **velocity-sheared `-14deg` parallelograms** on navigation and lane callouts:

- **Concentric Container Radii:** Outer `.ap-content-stage` uses a generous stadium-turn curve (`1.5rem` / `24px` on `>= 640px`, `1.25rem` / `20px` on mobile); interior `.ap-card` and `.ap-header-bar` step down to `1rem` (`16px`); buttons, inputs, and `.ap-card-inset` wells use `0.75rem` (`12px`); compact split cells use `0.5rem` (`8px`); semantic status pills and gauge bars use `9999px` full capsules.
- **Velocity-Sheared `-14deg` Track Silhouettes:** `.ap-track-tab` (`0.425rem` radius) and `.ap-lane-badge` (`0.35rem` radius) apply `transform: skewX(-14deg)` to their outer box while counter-skewing `.ap-track-tab-inner` and `.ap-lane-badge-inner` by `skewX(14deg)`. The `14deg` angle matches the straightaway termination of the `B3-3A × W1` THRESH vector lockup while keeping icons and text strictly vertical.
- **Architectural Borders & Hairlines:** Structural boundaries use `2px solid` Pine (`#2B5B3F` / `#2B543B`) on the main stage, header bar, and account menu, paired with `.ap-brand-hairline` (`linear-gradient(90deg, #C8FF00 0%, #65A30D 55%, #1D3828 100%)`) and the low-opacity 4-lane concentric banking-turn `ThreshBrandWatermark` (`0.13` light / `0.22` dark opacity) in hero corners.

## Components

Components feel **tactile, field-ready, and instrument-grade**: decisive contrast, generous `44px+` mobile hit zones, crisp `120–150ms` exponential ease-out transitions (`cubic-bezier(0.16, 1, 0.3, 1)`), and drawn Phosphor vector icons in consistent `duotone` (idle) and `fill` (active) weights.

### Buttons
- **Shape:** Gently rounded athletic rectangle (`0.75rem` / `12px` radius) with `2.75rem` (`44px`) minimum height and inline-flex `0.45rem` icon-to-label gap.
- **Primary (`.ap-btn-primary`):** Track Volt (`#C8FF00`) fill, Obsidian Ink (`#080A09`) `700`-weight `0.8125rem` (`13px`) label, `1.5px` lime-olive border (`#4D7C0F` light / `#E2FF66` dark), `0.5rem 1rem` padding, and Volt Action Glow shadow.
- **Hover / Focus:** Shifts fill to `#B5EB00` over `150ms cubic-bezier(0.16, 1, 0.3, 1)`; `:focus-visible` renders a `2px` solid brand outline with `2px` offset; `@media (prefers-reduced-motion: reduce)` clamps transition durations to `0.01ms`.
- **Secondary (`.ap-btn-secondary`) & Partner Strava CTA (`.ap-btn-strava`):** Secondary uses Chalk Inset (`#E9EFE9`) / Deep Turf (`#15231B`) with `1px` pine-tinted border, `600` weight, and hover shift to `#DCE7DE` / `#1C3125`. Primary Strava sign-in uses Strava Vermilion (`#C23800`, hover `#A83000`) with `#FFFFFF` text and `>= 3.125rem` (`50px`) height.

### Chips
- **Style:** Two distinct families—full-capsule semantic readiness pills (`9999px` radius, `0.125rem 0.625rem` padding, `1px` tonal border, `JetBrains Mono` `0.6875rem` uppercase `700` text) and `-14deg` velocity-sheared `.ap-lane-badge` callouts (`0.35rem` radius, `0.1875rem 0.625rem` padding, `rgba(86, 186, 0, 0.14)` fill with `#296300` ink in light mode; `rgba(200, 255, 0, 0.15)` fill with `#C8FF00` ink in dark mode).
- **State:** Readiness chips encode physiological state directly (`.ap-status-prime`, `.ap-status-info`, `.ap-status-caution`, `.ap-status-strained`) with a leading dot indicator and `>= 6.8:1` light-mode contrast; `.ap-badge-volt` highlights `SAMPLE DEMO` and active calibration tags.

### Cards / Containers
- **Corner Style:** `1.5rem` (`24px`, `1.25rem` mobile) on `.ap-content-stage`; `1rem` (`16px`) on `.ap-card`; `0.75rem` (`12px`) on nested `.ap-card-inset` wells.
- **Background:** Stadium Chalk (`#F4F7F2`) / Obsidian-Pine (`#0B120E`) on stage; Crisp Paper (`#FFFFFF`) / Carbon-Pine (`#101B15`) on cards; Chalk Inset (`#E9EFE9`) / Deep Turf (`#15231B`) on recessed wells.
- **Shadow Strategy:** Stage uses Content Stage Frame shadow; `.ap-card` uses Telemetry Card Rest shadow; `.ap-card-inset` is strictly flat (`box-shadow: none`).
- **Border:** `2px solid` Pine Frame on `.ap-content-stage`; `1px solid` pine-tinted border on `.ap-card` and `.ap-card-inset`.
- **Internal Padding:** `1rem` to `2rem` (`16px–32px`) on `.ap-content-stage`; `1rem` to `1.25rem` (`16px–20px`) on `.ap-card`; `0.875rem` to `1rem` (`14px–16px`) on `.ap-card-inset`.

### Inputs / Fields
- **Style:** `2.75rem` (`44px`) touch height, `0.75rem` (`12px`) radius, Crisp Paper (`#FFFFFF`) or Chalk Inset (`#E9EFE9`) in light mode and Carbon-Pine (`#101B15`) or Deep Turf (`#15231B`) in dark mode, with `1px` structural border (`rgba(38, 88, 58, 0.22)` light / `#2B543B` dark). Numeric thresholds and 6-character Team Join Codes use `JetBrains Mono` (`tabular-nums`, uppercase tracking on join codes).
- **Focus:** `2px solid` Stadium Pine (`#1C5436`) in light mode or Track Volt (`#C8FF00`) in dark mode with `2px` outline offset.
- **Error / Disabled:** Validation and sync errors surface in `.ap-status-strained` alert banners (`role="alert"`); disabled controls drop to `0.5`–`0.6` opacity with `cursor: not-allowed`.

### Navigation
- **Desktop Header Bar (`.ap-header-bar`):** Crisp Paper (`#FFFFFF`) / Carbon-Pine (`#101B15`) floating bar with `2px solid` Pine border, housing `AeroPulseLogo` (with automatic `Team Crest × THRESH` co-branding when a team is active), four centered `-14deg` `.ap-track-tab` links (`Today`, `Plan`, `Activities`, `Progress`), and right-aligned utility controls (`AI Coach`, theme toggle, account menu).
- **Tab & Segmented States:** Active `.ap-track-tab` applies `.ap-nav-volt-active` (`#C8FF00` fill, `#080A09` `800`-weight ink, Phosphor `fill` icon); idle `.ap-track-tab-idle` uses `#E8EFE9` / `#15251C` with Phosphor `duotone` icon and hover lift to `#DCE7DE` / `#1C3125`. Secondary view/unit toggles sit inside `.ap-pill-track` with `.ap-pill-active` (`1.5px` Volt ring + `2.5px` inset bottom Volt bar).
- **Mobile Dock (`.ap-mobile-dock`):** Fixed bottom bar on `< 768px` honoring `env(safe-area-inset-bottom, 0px)` with `>= 44px` tap targets.

### Load Focus Corridor Gauge & Watchless Split Row
- **Load Focus Corridor Gauge (`CircadianFirstTouchHero`):** Pairs a `JetBrains Mono` header row (zone dot, system name, `TSS` points, percentage share, and target delta badge) over a `0.625rem` (`10px`) full-capsule track (`#E2E8F0` / `#1E293B`) whose colored fill (`#0D9488`, `#EA580C`, or `#7C3AED`) passes through a dashed optimal polarization corridor overlay (`border-inline: 2px dashed`).
- **Watchless Trackside Split Row (`AthleteRosterModal`):** High-speed `>= 3.5rem` (`56px`) multi-athlete tap row designed for coaches timing spiked track intervals without GPS watches—displaying athlete monogram, pod badge, lap counter, and `0.01s` `JetBrains Mono` (`tabular-nums`) last-lap / cumulative split readout.

## Do's and Don'ts

### Do:
- **Do** frame primary application and onboarding views inside `.ap-content-stage` (`2px solid` Pine border over the `#163022` / `#0C1D14` stadium surround) and nest sub-groups inside shadowless `.ap-card-inset` wells.
- **Do** pair solid Track Volt (`#C8FF00`) fills exclusively with Deep Obsidian ink (`#080A09`), and switch standalone brand text on light surfaces to Stadium Pine (`#1C5436`) or Volt Olive (`#3F6212`).
- **Do** set every physiological readout, `0.01s` split, pace/power zone, join code, and chart axis in `JetBrains Mono` with `font-variant-numeric: tabular-nums`, respecting the `0.6875rem` (`11px`) `--text-2xs` floor.
- **Do** counter-skew inner content (`skewX(14deg)`) inside every `-14deg` `.ap-track-tab` and `.ap-lane-badge` so typography and Phosphor icons remain upright.
- **Do** synchronize HTML/CSS UI tokens 1:1 with canvas/SVG chart palettes via `getThreshThemePalette(isDark)` (`src/utils/themeTokens.ts`), keeping `Z1–Z6` and `CTL`/`ATL`/`TSB` colors locked even under school/club co-branding.
- **Do** render explicit `CALIBRATING` states when an athlete has zero synced workouts, and shield body weight / `W/kg` emphasis automatically when U18 Safe-Sport mode is active.

### Don't:
- **Don't** apply full-bar or full-screen `backdrop-filter: blur()` or `background-attachment: fixed` to headers, cards, or modals; maintain crisp opaque surface layering for `60fps` telemetry scrolling.
- **Don't** stack decorative uppercase kickers or eyebrows above headings; let headings stand on their own weight and place contextual status pills or `.ap-lane-badge` callouts inline.
- **Don't** override `Z1–Z6` effort colors, Banister `CTL`/`ATL`/`TSB` series, or `.ap-status-*` readiness pills with custom team co-branding colors or raw Track Volt.
- **Don't** use raw Track Volt (`#C8FF00`) as text or un-cased icon ink on white, Stadium Chalk (`#F4F7F2`), or Chalk Inset (`#E9EFE9`) backgrounds where contrast collapses below WCAG AA.
- **Don't** introduce a third typeface, sub-`11px` hardcoded pixel text (`text-[9px]`, `text-[10px]`), or Unicode emoji icons in place of drawn Phosphor vector icons.
- **Don't** fabricate synthetic `CTL`, `FTP`, resting HR, testimonials, customer school logos, or commercial pricing tiers on any surface.
