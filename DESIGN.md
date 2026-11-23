---
name: MeetReady
description: Trackside timing console and exercise-physiology workspace built on Mondo Clay, Stadium Chalk, Track Asphalt, and restrained Starter Volt.
colors:
  mondo-clay: "#B83A24"
  mondo-clay-dark: "#9E2E1A"
  mondo-clay-bright: "#E05238"
  starter-volt: "#D8FF2A"
  starter-volt-hover: "#C8EF1E"
  infield-pine: "#1E4D36"
  infield-pine-hover: "#163A28"
  infield-pine-bright: "#2F7A55"
  infield-pine-dark-ink: "#86EFAC"
  strava-vermilion: "#C23800"
  strava-vermilion-hover: "#A83000"
  strava-ink-light: "#B83500"
  strava-ink-dark: "#FF7A45"
  stadium-chalk: "#F6F3EC"
  warm-chalk-header: "#FAF8F4"
  matte-white: "#FFFFFF"
  warm-stone: "#EDE9DF"
  warm-stone-hover: "#E3DFD3"
  chalk-axis: "#CFC9BC"
  track-asphalt: "#121413"
  asphalt-header-dark: "#161917"
  matte-carbon: "#1A1D1B"
  deep-asphalt: "#151816"
  asphalt-elevated-dark: "#242826"
  asphalt-edge: "#2C312E"
  ink-secondary-light: "#2C2A26"
  ink-secondary-dark: "#D6D1C7"
  ink-muted-light: "#57544D"
  ink-muted-dark: "#A39E93"
  midnight-slate-stage: "#0E1318"
  midnight-slate-card: "#151C24"
  midnight-slate-inset: "#0A0D12"
  midnight-slate-border: "#2A3644"
  midnight-slate-ink: "#EEF2F6"
  midnight-slate-secondary: "#CBD5E1"
  dusk-stage: "#100E0C"
  dusk-card: "#191612"
  dusk-inset: "#14110E"
  dusk-border: "#3D3528"
  dusk-ink: "#E8E2D8"
  zone-1-mist: "#94A3B8"
  zone-2-aerobic-teal: "#0D9488"
  zone-3-ochre: "#D97706"
  zone-4-vermilion: "#EA580C"
  zone-5-crimson: "#DC2626"
  zone-6-violet: "#7C3AED"
  pmc-atl-rose: "#E11D48"
  pmc-tsb-emerald: "#059669"
  pmc-tsb-sky: "#0284C7"
  status-prime-bg: "#E7F3EC"
  status-prime-border: "#B6D9C4"
  status-caution-bg: "#FFFBEB"
  status-caution-ink: "#92400E"
  status-caution-border: "#FDE68A"
  status-strained-bg: "#FDF0ED"
  status-strained-ink: "#8F2A18"
  status-strained-border: "#E8B4AA"
  status-info-bg: "#F2F0E9"
  ink-aa-emerald-chart: "#047857"
  ink-aa-emerald-chart-dark: "#34D399"
  ink-aa-sky: "#0369A1"
  ink-aa-sky-dark: "#38BDF8"
  ink-aa-teal: "#0F766E"
  ink-aa-teal-dark: "#2DD4BF"
  ink-aa-vermilion-dark: "#FB923C"
  ink-aa-amber-dark: "#FBBF24"
  ink-aa-rose: "#BE123C"
  ink-aa-rose-dark: "#FB7185"
  ink-aa-violet: "#6D28D9"
  ink-aa-violet-dark: "#C4B5FD"
typography:
  display:
    fontFamily: "'Barlow Condensed', 'Archivo', system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 4.5vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 0.94
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"
    fontSize: "clamp(1.125rem, 2vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  body:
    fontFamily: "'Archivo', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "-0.01em"
  label:
    fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.06em"
    fontFeature: "\"tnum\" 1"
  kpi:
    fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace"
    fontSize: "clamp(1.5rem, 3vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
    fontFeature: "\"tnum\" 1"
rounded:
  badge: "0.375rem"
  sm: "0.5rem"
  tab: "0.625rem"
  md: "0.75rem"
  lg: "1rem"
  sheet: "1.25rem"
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
    backgroundColor: "{colors.starter-volt}"
    textColor: "{colors.track-asphalt}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "{spacing.touch}"
  button-primary-hover:
    backgroundColor: "{colors.starter-volt-hover}"
    textColor: "{colors.track-asphalt}"
  button-pine:
    backgroundColor: "{colors.infield-pine}"
    textColor: "{colors.stadium-chalk}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
    height: "{spacing.touch}"
  button-pine-hover:
    backgroundColor: "{colors.infield-pine-hover}"
    textColor: "{colors.stadium-chalk}"
  button-secondary:
    backgroundColor: "{colors.matte-white}"
    textColor: "{colors.track-asphalt}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.875rem"
    height: "{spacing.touch}"
  button-secondary-hover:
    backgroundColor: "{colors.warm-stone}"
    textColor: "{colors.track-asphalt}"
  button-strava:
    backgroundColor: "{colors.strava-vermilion}"
    textColor: "{colors.matte-white}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "{spacing.touch}"
  button-strava-hover:
    backgroundColor: "{colors.strava-vermilion-hover}"
    textColor: "{colors.matte-white}"
  button-landing-cta:
    backgroundColor: "{colors.starter-volt}"
    textColor: "{colors.track-asphalt}"
    rounded: "{rounded.full}"
    padding: "0.5rem 1.25rem"
    height: "{spacing.touch}"
  nav-header-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.track-asphalt}"
    padding: "0.25rem 0.75rem"
    height: "2.375rem"
  nav-track-tab-active:
    backgroundColor: "{colors.starter-volt}"
    textColor: "{colors.track-asphalt}"
    rounded: "{rounded.tab}"
    padding: "0.5rem 0.75rem"
  nav-track-tab-idle:
    backgroundColor: "{colors.warm-stone}"
    textColor: "{colors.ink-muted-light}"
    rounded: "{rounded.tab}"
    padding: "0.5rem 0.75rem"
  hero-mondo-clay:
    backgroundColor: "{colors.mondo-clay}"
    textColor: "{colors.stadium-chalk}"
    rounded: "{rounded.md}"
    padding: "2rem 2.25rem"
  specimen-dock-dark:
    backgroundColor: "{colors.track-asphalt}"
    textColor: "{colors.stadium-chalk}"
    rounded: "{rounded.md}"
    padding: "1.5rem"
  card-telemetry:
    backgroundColor: "{colors.matte-white}"
    textColor: "{colors.track-asphalt}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  card-inset-well:
    backgroundColor: "{colors.warm-stone}"
    textColor: "{colors.track-asphalt}"
    rounded: "{rounded.md}"
    padding: "0.875rem"
  chip-status-prime:
    backgroundColor: "{colors.status-prime-bg}"
    textColor: "{colors.infield-pine}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  chip-status-caution:
    backgroundColor: "{colors.status-caution-bg}"
    textColor: "{colors.status-caution-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  chip-status-strained:
    backgroundColor: "{colors.status-strained-bg}"
    textColor: "{colors.status-strained-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
  chip-status-info:
    backgroundColor: "{colors.status-info-bg}"
    textColor: "{colors.track-asphalt}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
---

# Design System: MeetReady

## Overview

**Creative North Star: "The Trackside Timing Console"**

MeetReady is built like hardware-grade track and field timing infrastructure rather than a generic wellness feed. Every surface starts edge-to-edge on warm **Stadium Chalk** in daylight or **Track Asphalt** after dark, bounded by crisp `1px` ink hairlines and anchored by committed **Mondo Clay** lane surfaces and flat geometric track curves. Rather than nesting heavy drop-shadow frames inside colored bezels, the interface establishes structure through matte tonal contrast—Warm Stone inset wells recessed beneath Matte White panels in daylight, and Deep Asphalt wells beneath Matte Carbon panels at night—so coaches and solo endurance athletes can scan splits, field marks, and readiness curves instantly under midday track glare or stadium floodlights.

The system bridges two visual registers cleanly without fragmenting into separate products: **Persuade** surfaces (`StravaAuthGate` landing hero and `/brand` architectural specimens) pair tall condensed `Barlow Condensed` ExtraBold headlines with committed Mondo Clay track lanes and an overlapping Track Asphalt stopwatch specimen dock, while **Operate** workspaces (`CockpitHeader`, `TracksideStopwatchView`, Banister PMC labs, and roster views) shift into calm, orthogonal `Archivo` UI headings and `JetBrains Mono` tabular readouts. Across both modes, **Starter Volt** is rationed strictly (`<= 5%` of the viewport) for primary gun triggers, active clock digits, and critical action buttons, while **Infield Pine** handles secondary turf controls and positive split deltas, and six-zone physiological effort colors (`Z1–Z6`) remain permanently locked.

MeetReady explicitly rejects pale SaaS greens, decorative frosted-glass `backdrop-filter` blur passes, clipart arrows, gradient-shaded vector marks, parallelogram-sheared navigation tabs, stacked uppercase kickers above headings, and fabricated Day-1 physiological scores.

**Key Characteristics:**
- **Edge-to-Edge Chalk & Asphalt Ground:** Open Stadium Chalk (`#F6F3EC`) and Track Asphalt (`#121413`) canvases replace outer green bezels, separated by `1px` ink hairlines (`rgba(18, 20, 19, 0.14)` light / `rgba(246, 243, 236, 0.13)` dark).
- **Mondo Clay Authority & `<= 5%` Starter Volt Discipline:** Committed Mondo Track Clay (`#B83A24` / `#9E2E1A` / `#E05238`) owns the hero field, active header indicator bar, and stopwatch console top rule, reserving Starter Volt (`#D8FF2A` with `#121413` ink) for primary triggers and live clock digits.
- **3-Font Trackside Hierarchy:** `Barlow Condensed` ExtraBold uppercase powers Persuade display `<h1>` statements, `Archivo` anchors UI headings, body copy, and the native web wordmark, and `JetBrains Mono` (`tabular-nums`) locks `0.01s` splits, pace pods, and `1Hz` telemetry above a hard `0.6875rem` (`11px`) `rem` floor.
- **Flat Orthogonal Controls + Concept A Velocity Chevron `M`:** Angular momentum lives solely inside the flat two-ink **Velocity Chevron `M`** mark; Operate workspace tabs, split cards, and lane badges stay strictly flat and orthogonal (`transform: none`).
- **Protected Physiological Encodings:** Six effort zones (`Z1–Z6`), Banister `CTL`/`ATL`/`TSB` series, `.ap-ink-*` WCAG AA semantic text tokens, and `.ap-status-*` readiness pills remain invariant even when school/club co-branding overrides outer chrome.

## Colors

The palette balances warm Stadium Chalk and dark Track Asphalt grounds with high-authority Mondo Clay, secondary Infield Pine turf controls, scarce Starter Volt focal triggers, and strictly locked physiological encodings.

### Primary
- **Mondo Track Clay** (`#B83A24` primary light, `#9E2E1A` dark hero / `--ap-ink-vermilion` light, `#E05238` bright dark-mode clay top rule): Primary brand accent across the landing hero field, active header navigation underline (`2.5px`), `.ap-card-clay-top` master stopwatch frame, light-stage Velocity Chevron `M` right peak, and primary focus outlines (`:focus-visible` in light mode).
- **Starter Volt** (`#D8FF2A`, hover `#C8EF1E`): High-visibility trigger fill on `.ap-btn-primary`, Comp 1 landing CTAs, `.ap-nav-volt-active` non-header pill tabs, dark-mode Velocity Chevron `M` right peak, and live `#121413`-housed stopwatch digits. Always paired with `#121413` Track Asphalt ink when used as a fill.
- **Infield Pine** (`#1E4D36`, hover `#163A28`, bright border `#2F7A55`, dark ink `#86EFAC`): Secondary turf action fill on `.ap-btn-pine`, light-mode `.ap-telemetry-label` ink, `.ap-status-prime` text ink, and positive split delta pills (`<= 0.5s` target tolerance).

### Secondary
- **Strava Vermilion** (`#C23800`, hover `#A83000`): Isolated partner OAuth fill on `.ap-btn-strava` (`>= 48px` tall on standalone Strava OAuth connect panels such as onboarding Step 2 and Data Sources, whereas unified multi-provider auth cards keep neutral outline buttons labeled `Connect with Strava` beside the single Starter Volt CTA) with `#FFFFFF` ink (`5.44:1` WCAG AA contrast), paired with dedicated provenance text ink (`#B83500` light / `#FF7A45` dark) on sync controls and clean-room attribution labels. Never used inside MeetReady brand marks.

### Tertiary
- **Zone 1 Cool Mist** (`#94A3B8`): Active recovery effort encoding across pace/power zone bars and workout stream overlays.
- **Zone 2 Aerobic Teal** (`#0D9488`): Endurance base zone, Low Aerobic load focus bar, and light-mode Banister `42d CTL` fitness spline (`#2DD4BF` in dark mode).
- **Zone 3 Ochre** (`#D97706`): Tempo / Sweet Spot effort zone and Banister `TSB` productive grey-zone caution (`#FBBF24` in dark mode).
- **Zone 4 Threshold Vermilion** (`#EA580C`): Lactate threshold (`LT2` / `CS` / `FTP` / `CP`) effort zone and High Aerobic load focus bar.
- **Zone 5 Crimson** (`#DC2626`): $\text{VO}_2\max$ / Interval (`I-Pace`) zone and Banister `TSB` high overreach alert (`#F87171` in dark mode).
- **Zone 6 Deep Violet** (`#7C3AED`): Anaerobic capacity (`W'` / `D'`) zone and Anaerobic load focus bar.
- **Banister ATL & TSB Series** (`#E11D48` `7d ATL`, `#059669` Optimal Window `TSB`, `#0284C7` Fresh/Transition `TSB`): Locked longitudinal curves in `src/utils/themeTokens.ts`.
- **WCAG AA Telemetry Ink Tokens (`.ap-ink-*` in `src/index.css` & chart ledgers)**:
  - **Emerald** (`#1E4D36` `--ap-ink-emerald` light / `#86EFAC` dark; `#047857` light / `#34D399` dark in running/TSB ledger badges): Positive progression, optimal form, and active SafeSport readiness.
  - **Sky** (`#0369A1` light / `#38BDF8` dark): Aerobic efficiency, fresh transition `TSB`, and cycling sport badges.
  - **Teal** (`#0F766E` light / `#2DD4BF` dark): Chronic Training Load (`CTL`) and Low Aerobic Z2 text telemetry.
  - **Vermilion** (`#9E2E1A` `--ap-ink-vermilion` light / `#FB923C` dark): Threshold `Z4` intensity readouts and Mondo Clay high-contrast text on light surfaces.
  - **Amber** (`#92400E` light / `#FBBF24` dark): Tempo `Z3` intensity and aerobic decoupling caution text.
  - **Rose** (`#BE123C` light / `#FB7185` dark): Acute fatigue (`ATL`) and `Z5` $\text{VO}_2\max$ text telemetry.
  - **Violet** (`#6D28D9` light / `#C4B5FD` dark): Anaerobic `Z6` / `W'` capacity and strength discipline badges.
- **Semantic Status Pills (`.ap-status-*` in `src/index.css`)**:
  - **Prime** (`#E7F3EC` bg / `#1E4D36` ink / `#B6D9C4` border light; `rgba(30, 77, 54, 0.35)` / `#86EFAC` dark): Optimal readiness, CARA compliance, split targets hit, and `RECOMMENDED` brand evaluations.
  - **Caution** (`#FFFBEB` bg / `#92400E` ink / `#FDE68A` border light; `rgba(245, 158, 11, 0.15)` / `#FCD34D` dark): Modulated `-15%` sessions, bell-lap alerts, rest countdowns, webview advisories, and `CAUTION` surface checks.
  - **Strained** (`#FDF0ED` bg / `#8F2A18` ink / `#E8B4AA` border light; `rgba(184, 58, 36, 0.22)` / `#F6B8AC` dark): Suppressed HRV, bone-stress stops, form/auth alerts, and `AVOID` brand evaluations.
  - **Info** (`#F2F0E9` bg / `#121413` ink / `rgba(18, 20, 19, 0.18)` border light; `rgba(246, 243, 236, 0.08)` / `#F6F3EC` dark): Neutral Day-1 `CALIBRATING` states, race place chips, and active toggle badges.

### Neutral
- **Stadium Chalk** (`#F6F3EC` canvas & outer ground light; `#FAF8F4` warm sticky `.ap-header-bar` light): Edge-to-edge daylight architectural ground.
- **Matte White** (`#FFFFFF` light `.ap-card`) & **Matte Carbon** (`#1A1D1B` dark `.ap-card`): Primary elevated card and form surfaces, framed by subtle `1px` hairlines (`rgba(18, 20, 19, 0.16)` light / `rgba(246, 243, 236, 0.13)` dark).
- **Warm Stone** (`#EDE9DF` light `.ap-card-inset` / `.ap-pill-track` / `.ap-lane-badge`, hover `#E3DFD3`) & **Deep Asphalt** (`#151816` dark `.ap-card-inset`, `#242826` active dark pill & lane badge): Flat recessed tonal step used instead of stacked shadow boxes.
- **Track Asphalt** (`#121413`): Primary daylight foreground ink, dark-mode ground, hero specimen dock fill, master stopwatch housing, and `AI Coach` / `Chute` instrument button fill.
- **Secondary & Muted Inks**: Secondary copy uses `#2C2A26` (light) / `#D6D1C7` (dark); muted chart axes (`#CFC9BC` axis line light, `#2C312E` edge dark) and captions use `#57544D` (light) / `#A39E93` (dark).
- **Circadian Sundown Variants (`src/index.css` & `themeTokens.ts`)**: `Midnight Slate` (`#0E1318` ground, `#151C24` card, `#0A0D12` inset, `#2A3644` border, `#EEF2F6` / `#CBD5E1` ink) and `Dusk` (`#100E0C` ground, `#191612` card, `#14110E` inset, `#3D3528` border, `#E8E2D8` ink) preserve full contrast after local sunset.

### Named Rules
**The 80 / 15 / 5 Track Budget Rule.** Eighty percent of any viewport stays neutral Stadium Chalk, Matte White, or Track Asphalt; fifteen percent belongs to committed Mondo Clay surfaces, `1px` hairlines, and Warm Stone inset wells; and at most five percent uses Starter Volt (`#D8FF2A`) so primary gun triggers and active numerals command immediate focus.

**The Sacred Physiology Rule.** Effort zones (`Z1–Z6`), Banister load series (`CTL`/`ATL`/`TSB`), `.ap-ink-*` semantic text colors, and `.ap-status-*` readiness pills never re-theme—even when school or club co-branding (`applyTeamBrandToDocument`) clamps custom team accents to `>= 4.55:1` WCAG AA across outer chrome, top hairlines, and primary CTAs.

**The Dark Ink on Starter Volt Rule.** Solid Starter Volt (`#D8FF2A`) fills always carry Track Asphalt (`#121413`) text, and raw `#D8FF2A` never appears as text or un-cased icon ink on Stadium Chalk or Matte White surfaces—shifting to Mondo Clay (`#B83A24`) or Infield Pine (`#1E4D36`) on light grounds and converting to Mondo Clay + Track Asphalt (`#B83A24` / `#121413`) or 1-Ink Stencil for 4-color CMYK print.

**The Partner Attribution Isolation Rule.** Strava Vermilion (`#C23800`) and Strava provenance inks (`#B83500` / `#FF7A45`) stay strictly confined to official partner OAuth and clean-room attribution controls and never enter MeetReady brand marks or team co-brand lockups.

## Typography

**Display Font:** Barlow Condensed (`'Barlow Condensed', 'Archivo', system-ui, sans-serif`)
**Body & UI Font:** Archivo (`'Archivo', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif`)
**Label/Mono Font:** JetBrains Mono (`'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace`)

**Character:** Compressed, stadium-scoreboard authority in `Barlow Condensed` ExtraBold for Persuade hero headlines, grounded by crisp geometric `Archivo` across UI headings, wordmarks, and reading prose, and anchored by tabular `JetBrains Mono` for `0.01s` trackside splits and physiological telemetry.

### Hierarchy
- **Display** (`800` ExtraBold uppercase, `clamp(2.25rem, 4.5vw, 3.75rem)` / `36px–60px`, `0.94` line-height, `-0.015em` tracking): Reserved for Persuade landing hero `<h1>` (`StravaAuthGate`) and standalone display poster/OpenGraph master headings.
- **Headline** (`700–800` Bold/ExtraBold, `clamp(1.125rem, 2vw, 1.5rem)` / `18px–24px`, `1.25` line-height, `-0.02em` tracking in `Archivo`): Auth card `<h2>` headers, Operate view `<h1>`/`<h2>` titles (`Trackside Stopwatch`, `Brand & Style Guide` section anchors), and modal headers.
- **Title** (`700` Bold, `0.875rem–1rem` / `14px–16px`, `1.4` line-height, `-0.02em` tracking in `Archivo`): Telemetry card headers, `For Coaches` / `For Athletes` ledger headers, and athlete tap-card names.
- **Body** (`400–600` Regular/SemiBold, `0.875rem` / `14px` standard, `1rem` / `16px` hero subhead, `0.75rem` / `12px` compact table cells, `1.6` line-height, `-0.01em` tracking in `Archivo`): Subheads, coaching rationale, compliance notices, and reading prose capped at `56ch–68ch`.
- **Label** (`600–700` SemiBold/Bold uppercase, `0.6875rem` / `11px` via `--text-2xs`, `1.45` line-height, `0.06em` tracking in `JetBrains Mono`): Micro-telemetry labels (`.ap-telemetry-label`), `.ap-lane-badge` callouts, readiness pills, and table column headers.
- **KPI & Stopwatch Readout** (`700–800` Bold/ExtraBold, `1.5rem–3rem` / `24px–48px`, `1.1` line-height, `-0.03em` tracking, `tabular-nums` in `JetBrains Mono`): Live `01:08.42` landing specimen digits, `TracksideStopwatchView` master clock numerals, `0.01s` split cells, and threshold KPIs.

### Named Rules
**The Split Display / UI Font Rule.** `.font-display` (`Barlow Condensed` ExtraBold uppercase) is restricted strictly to Persuade hero and poster `<h1>` statements; Operate workspace headers, cards, forms, and the sitewide `MeetReady` navbar wordmark use `Archivo` (`--font-sans`) so dense coaching tables stay effortlessly legible.

**The Tabular Telemetry Rule.** Every `0.01s` stopwatch display, lap split, Banister metric (`CTL`/`ATL`/`TSB`), VDOT pace, power readout, join code, and chart axis sets `JetBrains Mono` with `font-variant-numeric: tabular-nums` so columns never jitter horizontally as clocks tick.

**The 11px Rem Floor & Unassisted Heading Rule.** Micro-telemetry labels bottom out at `0.6875rem` (`11px` via `--text-2xs`) so they scale cleanly with root `rem` preferences, and headings assert hierarchy directly by weight and tracking without stacked uppercase kickers or eyebrows above them—placing status badges or `.ap-lane-badge` pills strictly inline or below.

## Layout

MeetReady renders edge-to-edge inside `.ap-shell` (`min-height: 100dvh`, `overflow-x: clip`) without an outer bezel frame. Unauthenticated Persuade landing (`StravaAuthGate` Step 1) centers inside a `max-width: 1320px` container (`px-3 sm:px-8`), opening below a `1px` hairline header (`Theme Toggle`, `Team Code` pill, single `Schools & ADs` link, and desktop `Explore Coach Sample`) onto a **12-column Split Manifesto & Ledger grid**:
- **Top Row (`60% / 38%` Split):** Left spans `7`–`8` columns (`lg:col-span-7 xl:col-span-8`) with the rounded Mondo Clay Hero (`lg:pb-20` bottom clearance), paired beside a `5`–`4` column (`lg:col-span-5 xl:col-span-4`) `1.5px`-bordered Stadium Chalk Pilot Auth card (`Coach | Athlete` segmented role pill, always-visible Email + Volt CTA, Google/Strava OAuth buttons, and compact `No Advertising. Ever. · COPPA 13+` footer).
- **Bottom Row (Overlapping Specimen Dock + Ruled Ledger):** A dark Track Asphalt Specimen Dock (`lg:col-span-6`) pulls upward over the hero's bottom-left edge (`lg:-mt-12 lg:ml-6 lg:mr-3 z-20`) with a 2-tab switch (`Trackside Stopwatch` vs. `Pace Pods & Field Sheet`), while a 2-column ruled `For Coaches | For Athletes` benefits ledger aligns in `lg:col-span-6 lg:col-start-7` beside it, closing on a single-row deduplicated legal/docs footer.

Authenticated Operate views and `/brand` step inside `.ap-container` (`max-width: 96rem` / `1536px`, `padding-inline: 0.5rem` mobile stepping to `clamp(1rem, 2.2vw, 2rem)` at `>= 1024px`) over the flat `.ap-content-stage`. Analytical dashboards use `.ap-grid-dashboard-12` (`repeat(12, minmax(0, 1fr))`, `1.25rem` gap at `>= 1024px`, collapsing to a single-column stack with `clamp(0.875rem, 1.8vw, 1.25rem)` gap below `1024px`, enforcing `min-width: 0` on every child for ECharts/uPlot shrinking). Onboarding Steps 2–3 narrow to `max-w-2xl` (`42rem`).

Responsive posture shifts cleanly by viewport: desktop (`>= 768px`) renders the sticky `.ap-header-bar` (`CockpitHeader`), while touch viewports (`< 768px`) reserve `calc(4.75rem + env(safe-area-inset-bottom, 0px))` bottom clearance for `.ap-mobile-dock` (automatically suppressed during active `TracksideStopwatchView` timing so bottom thumb controls own the lower edge). Modals (`.ap-modal-backdrop` over `rgba(18, 20, 19, 0.78)`) dock as full-width `92dvh` bottom sheets below `640px` and center with `1rem` padding (`max-height: 90vh`) on desktop. Interactive controls enforce a `2.75rem` (`44px`) touch-target floor on mobile (`>= 92px` card height on trackside split tap cards).

## Elevation & Depth

MeetReady is **flat, crisp, and architectural**, conveying hierarchy through opaque tonal luminance steps and `1px`–`1.5px` ink hairlines rather than drop-shadow stacks or frosted glass. Depth moves across three primary planes: the Stadium Chalk (`#F6F3EC`) or Track Asphalt (`#121413`) ground, Matte White (`#FFFFFF`) or Matte Carbon (`#1A1D1B`) primary cards, and Warm Stone (`#EDE9DF`) or Deep Asphalt (`#151816`) recessed inset wells. Only the overlapping landing Specimen Dock, floating cockpit cards, Strava OAuth CTA, and modal overlays carry restrained contact elevation.

### Shadow Vocabulary
- **Telemetry Card Rest (`.ap-card`):** `box-shadow: 0 1px 2px 0 rgba(18, 20, 19, 0.04)` in daylight (`0 2px 10px -4px rgba(0, 0, 0, 0.45)` in dark mode)—hairline surface contact without floating bloat.
- **Overlapping Specimen Dock:** `box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)` (`shadow-md`) grounding the dark `#121413` dock where it steps across the Mondo Clay hero seam.
- **Strava CTA Contact:** `box-shadow: 0 2px 10px rgba(194, 56, 0, 0.26)` beneath `.ap-btn-strava`.
- **Modal & Dropdown Layering:** `shadow-2xl` over `rgba(18, 20, 19, 0.78)` backdrop on centered/sheet overlays and account menus.

### Named Rules
**The Zero-Blur Surface Rule.** Sticky headers, telemetry cards, chart tooltips, and modals use solid opaque fills and `1px` ink borders with zero `backdrop-filter: blur()` or `background-attachment: fixed`, preserving `60fps` responsiveness across `1Hz` stream scrubbers and mobile trackside devices.

**The Recessed Well & Hairline Rule.** Secondary KPI blocks, pill tracks, and form sub-groups step *down* into flat, shadowless Warm Stone (`#EDE9DF`) or Deep Asphalt (`#151816`) wells (`.ap-card-inset`) rather than stacking white cards inside white cards, while structural divisions rely on `1px` ink hairlines (`rgba(18, 20, 19, 0.14)` light / `rgba(246, 243, 236, 0.13)` dark).

## Shapes

MeetReady pairs **flat orthogonal instrument containers** with **concentric stadium oval curves** in decorative hero tracks and **flat 2-ink angular geometry** inside the brand mark:

- **Container & Control Radii:** `.ap-content-stage` is completely square (`0px` edge-to-edge); primary hero fields, specimen docks, auth cards, `.ap-card-inset` wells, and cockpit action buttons (`.ap-btn-primary`, `.ap-btn-pine`, `.ap-btn-secondary`, `.ap-btn-strava`) use `0.75rem` (`12px`); elevated `.ap-card` containers use `1rem` (`16px`); mobile/modal sheets use `1.25rem` (`20px`); `.ap-track-tab` workspace tabs use `0.625rem` (`10px`, flattened to `0px` bottom-underline items inside `header nav`); `.ap-lane-badge` uses `0.375rem` (`6px`); and semantic status chips plus Comp 1 landing CTAs and role toggles use `9999px` full pill capsules.
- **Architectural Track Linework:** Mondo Clay hero banners and the 4-lane oval banking-turn watermark render crisp concentric 4-lane oval banking curves (`#F6F3EC` at `15%–30%` opacity over Mondo Clay; `6%–8%` opacity in stage watermarks) with uniform `2px`–`3px` strokes and zero gradient fades, while `.ap-card-clay-top` accents key timing consoles with a `3px` Mondo Clay top edge (`#B83A24` light / `#E05238` dark).
- **Concept A Velocity Chevron `M` & Outlined Wordmark (`src/utils/brandVectors.ts`):** The canonical `128×128` mark consists of two flat, interlocking geometric peaks sharing a uniform `1:3` leg slope and `6.64`-unit center channel (zero gradients, zero arrowheads, zero thin multi-stripes): left peak in Track Asphalt (`#121413` light) / Stadium Chalk (`#F6F3EC` dark) paired with right peak in Mondo Clay (`#B83A24` light) / Starter Volt (`#D8FF2A` dark). Inline web headers render the SVG mark alongside crisp native `Archivo` ExtraBold `MeetReady` HTML text, while the `472×124` downloadable print/embroidery lockup pairs the `0.94`-scaled symbol with an outlined `<path>` `MeetReady` wordmark (`fill-rule="nonzero"`, zero `<text>` font dependencies). Dedicated `32×32` squircle favicons (`public/icon.svg`, `rx=7`) render `#F6F3EC` + `#D8FF2A` peaks over `#121413` Track Asphalt.
- **23-Asset Print, Apparel & Social Catalog (`/brand`):** `BrandGuidePage` and `src/utils/brandAssetEngine.ts` expose `23` vector SVGs (`6` Primary Lockups including stacked & varsity crests, `3` 1-Ink Knockouts, `10` Emblems & Tiles, and `4` Wordmark & Social/Fence/Apparel masters) with live 7-surface legality evaluation (`Auto`, `Asphalt`, `Chalk`, `Paper`, `Volt`, `Sun Photo`, `Night Photo`, `600-DPI B&W Copier`), `1x`/`2x`/`4x` transparent PNG rasterizers, and a WCAG AA (`>= 4.55:1`) `Team × MeetReady` co-branding sandbox.

### Named Rules
**The Flat Orthogonal Control Rule.** All navigation tabs (`.ap-track-tab`), lane badges (`.ap-lane-badge`), split tap cards, and buttons stay strictly orthogonal (`transform: none`); directional velocity lives exclusively inside the `1:3`-sloped Concept A Velocity Chevron `M` mark.

**The True 1-Ink Knockout & Flat Embroidery Rule.** Monochrome stencils (`#121413` Asphalt, `#FFFFFF` Reversed White, `#D8FF2A` Starter Volt) and embroidery masters ship exclusively as closed, outlined `<path>` silhouettes with zero `<text>` nodes, zero gradients, zero `#FFFFFF` masking strokes, and `>= 1.2mm` satin-stitch floor.

## Components

Components feel **tactile, glare-resistant, and trackside-immediate**: `44px+` touch targets, `120–150ms` exponential ease-out state feedback (`cubic-bezier(0.16, 1, 0.3, 1)`), and Phosphor vector icons (`duotone` idle, `fill` active).

### Buttons
- **Shape:** Orthogonal `0.75rem` (`12px`) radius and `2.75rem` (`44px`) min-height inside the Operate cockpit (`.ap-btn-primary`, `.ap-btn-pine`, `.ap-btn-secondary`, `.ap-btn-strava`); `9999px` full pill capsules on Comp 1 landing hero/auth CTAs (`Explore Coach Sample →`, `Continue with Email`, OAuth buttons).
- **Primary (`.ap-btn-primary`):** Starter Volt (`#D8FF2A`) fill, Track Asphalt (`#121413`) `800`-weight `0.8125rem` (`13px`) label, `1px` `rgba(18, 20, 19, 0.24)` border (`#D8FF2A` in dark mode), `0.5rem 1rem` padding, zero box-shadow.
- **Hover / Focus:** Shifts to `#C8EF1E` over `150ms cubic-bezier(0.16, 1, 0.3, 1)`; `:focus-visible` draws a `2px solid` Mondo Clay (`#B83A24` light) or Starter Volt (`#D8FF2A` dark) outline with `2px` offset; `prefers-reduced-motion: reduce` clamps durations to `90ms` color/opacity fades (`0.01ms` animations).
- **Secondary & Turf Variants:** `.ap-btn-pine` provides a quiet secondary action (`#1E4D36` fill / `#F6F3EC` ink light; `#162D21` fill / `#D8FF2A` ink / `#2F7A55` border dark) to prevent Starter Volt overuse; `.ap-btn-secondary` uses Matte White (`#FFFFFF`) / Matte Carbon (`#1A1D1B`) with `1px` ink border and Warm Stone (`#EDE9DF`) / `#242826` hover; `.ap-btn-strava` (`#C23800`, hover `#A83000`, `#FFFFFF` ink, `>= 48px`) applies to standalone Strava OAuth connect panels while unified multi-provider auth cards keep neutral outline buttons (`Connect with Strava`) beside the single Starter Volt CTA.

### Chips
- **Style:** Full-capsule readiness pills (`.ap-status-prime`, `.ap-status-caution`, `.ap-status-strained`, `.ap-status-info`; `9999px` radius, `JetBrains Mono` `0.6875rem` uppercase `700` text) alongside flat orthogonal `.ap-lane-badge` lane tags (`0.375rem` radius, `#EDE9DF` light / `#242826` dark, `1px` ink border, `0.1875rem 0.5rem` padding).
- **State:** Encode physiological readiness, rest timers (`30s` caution vs. `GO +Ns` prime), offline persistence (`Offline Safe ✓`), and `/brand` surface legality (`Native Pairing`, `Caution`, `Avoid Here`).

### Cards / Containers
- **Corner Style:** `0.75rem` (`12px`) on landing Hero/Specimen Dock/Auth card, stopwatch console, runner tap cards, and `.ap-card-inset` wells; `1rem` (`16px`) on elevated `.ap-card` modals and Brand Studio panels.
- **Background:** `#B83A24` / `#9E2E1A` on landing hero; `#121413` on specimen dock; `#FFFFFF` / `#1A1D1B` on `.ap-card`; `#EDE9DF` / `#151816` on `.ap-card-inset`.
- **Shadow Strategy:** Flat `1px` border + subtle contact shadow (`0 1px 2px rgba(18,20,19,0.04)`) on `.ap-card`; strictly shadowless on `.ap-card-inset`; `3px` Mondo Clay top rule via `.ap-card-clay-top` on the Trackside Stopwatch console.
- **Border:** `1px solid` ink hairline on `.ap-card` (`rgba(18, 20, 19, 0.16)` light / `rgba(246, 243, 236, 0.13)` dark); `1.5px solid #121413` on the landing Pilot Auth card.
- **Internal Padding:** `0.875rem`–`1rem` on inset wells and split cards; `1rem`–`1.5rem` on telemetry cards and specimen docks; `1.5rem`–`2.25rem` on hero banners.

### Inputs / Fields
- **Style:** `2.75rem` (`44px`) touch height (`38px` compact desktop inside landing auth card), `0.5rem`–`0.75rem` radius, `#FFFFFF` (light) or `#121413`/`#151816` (dark), `1px` border (`#121413` on landing auth inputs; `rgba(18, 20, 19, 0.14)` inside cockpit wells). Join codes and numeric marks set `JetBrains Mono` (`tabular-nums`, uppercase tracking).
- **Focus:** `2px solid` Mondo Clay (`#B83A24` light) or Starter Volt (`#D8FF2A` dark) ring/outline with `2px` offset.
- **Error / Disabled:** Validation errors surface in `.ap-status-strained` banners (`role="alert"`); disabled states drop to `0.45`–`0.6` opacity with `cursor: not-allowed`.

### Navigation
- **Landing Header (`StravaAuthGate`):** Transparent over Stadium Chalk / Track Asphalt with a `1px` bottom ink border (`border-b`), carrying `MeetReadyLogo` on the left and a compact cluster (`Theme Toggle`, `Team Code` pill, single `Schools & ADs` link, and `Explore Coach Sample`) on the right.
- **Operate Header (`.ap-header-bar` in `CockpitHeader`):** Sticky opaque `#FAF8F4` (light) / `#161917` (dark) bar with a `1px` bottom rule, `MeetReadyLogo` (or `Team × MeetReady` co-brand), Coach mode toggle, optional floating `TracksideLiveHeaderPill` (`#1A1D1B` carbon + `#D8FF2A` pulsing clock when active), flat bottom-bordered workspace links (`Today`, `Training Calendar`, `Progress`, `Plan Builder` or Coach `Clipboard`, `Team Plan`, `Stopwatch`, `Roster`) where `header nav .ap-nav-volt-active` renders a `2.5px` Mondo Clay (`#B83A24` light) or Starter Volt (`#D8FF2A` dark) bottom indicator, `AI Coach` `#121413` instrument pill, Theme toggle, and Account menu.
- **Mobile Dock (`.ap-mobile-dock`):** Fixed `58px+` bottom 4-column bar below `768px` honoring `env(safe-area-inset-bottom, 0px)` with `.ap-nav-volt-active` Starter Volt active tile (hidden during Stopwatch mode).

### Trackside Stopwatch Console & Tap-Split Cards (`TracksideStopwatchView`)
- **Master Clock Console:** `.ap-card.ap-card-clay-top` housing an opaque `#121413` Track Asphalt digital clock (`#D8FF2A` `tabular-nums`, `text-xl sm:text-3xl`), Starter Volt `Start Gun` / `Resume` CTA (shifting to `.ap-status-caution` `Pause` while ticking), `Undo`, `#121413` `Chute` capture pill with Mondo Clay queue badge, preset/pod/search filters, `Cards | Matrix` `.ap-pill-track` switcher, and `200m–1600m` rep quick-chips.
- **Tap-Split Runner Card (`TracksideRunnerCardsAndMatrix`):** `>= 92px` tall 2–3 column card displaying flat `.ap-lane-badge` (`L1`), athlete name + pod target, live rest/race pill, and `tabular-nums` last split with `.ap-status-prime` / `.ap-status-caution` target delta—flashing a `2px` Mondo Clay / Starter Volt ring (`ring-2`) on tap.

## Do's and Don'ts

### Do:
- **Do** anchor light surfaces on Stadium Chalk (`#F6F3EC`), Matte White (`#FFFFFF`), and Warm Stone (`#EDE9DF`), and dark surfaces on Track Asphalt (`#121413`), Matte Carbon (`#1A1D1B`), and Deep Asphalt (`#151816`), separated by `1px` ink hairlines and zero `backdrop-filter: blur()`.
- **Do** restrict Starter Volt (`#D8FF2A`) to `<= 5%` of any screen (primary `.ap-btn-primary` CTAs, active stopwatch numerals, dark-mode logo right peak, and active tab markers), always paired with `#121413` Track Asphalt ink.
- **Do** reserve `.font-display` (`Barlow Condensed` ExtraBold uppercase) for Persuade hero display `<h1>` headings, while rendering all Operate headings, body copy, and navbar wordmarks in `Archivo` and all `0.01s` splits, pace pods, join codes, and physiological KPIs in `JetBrains Mono` (`tabular-nums`) at `>= 0.6875rem` (`11px`).
- **Do** keep Operate navigation tabs, `.ap-lane-badge` tags, and split cards strictly flat and orthogonal (`transform: none`), confining angled velocity exclusively to the flat 2-ink Concept A Velocity Chevron `M` mark (`#121413` + `#B83A24` on light; `#F6F3EC` + `#D8FF2A` on dark).
- **Do** keep sacred effort zones (`Z1–Z6`), Banister load curves (`CTL`/`ATL`/`TSB`), `.ap-ink-*` AA text tokens, and `.ap-status-*` readiness pills locked across all themes and custom school/club co-branding.
- **Do** enforce `>= 44px` (`2.75rem`) touch targets on mobile controls, `>= 92px` tap height on trackside split cards, explicit `CALIBRATING` states when zero workouts exist, and `CamelCase MeetReady` across all copy (lowercase only in `https://meetready.app`).

### Don't:
- **Don't** restore retired legacy pine-green palette tokens, outer green stage bezels, parallelogram-sheared navigation tabs, or unapproved geometric-sans font substitutions.
- **Don't** apply `backdrop-filter: blur()`, glassmorphism overlays, stacked elevated shadows inside `.ap-card` containers, or decorative gradients inside the Velocity Chevron `M` mark.
- **Don't** stack uppercase kickers or eyebrows above headings; let weight, scale, or an inline `.ap-lane-badge` / status pill carry the context.
- **Don't** render raw Starter Volt (`#D8FF2A`) as text or un-cased icons on Stadium Chalk, Warm Stone, or Matte White surfaces, or export `#D8FF2A` directly to 4-color CMYK print without converting to Mondo Clay + Track Asphalt (`#B83A24` / `#121413`) or a 1-Ink Stencil.
- **Don't** re-theme `Z1–Z6` physiology colors, mix Strava Vermilion (`#C23800`) into MeetReady brand marks, use Unicode emoji icons instead of Phosphor vectors, or fabricate synthetic readiness metrics, testimonials, or partner endorsements.
