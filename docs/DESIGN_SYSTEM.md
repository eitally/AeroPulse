# THRESH — "#1 Stadium Track" Design System & Brand Architecture

This document is the engineering reference for the **THRESH** visual language, `#1 Stadium Track — Track Volt & Obsidian` token architecture, `B3-3A + W1 + G1` brand lockup, typography scale, locked 6-zone physiological color encodings, z-index layering, and accessibility standards (`src/index.css`, `src/utils/themeTokens.ts`, `src/utils/teamBrandDom.ts`, `src/components/AeroPulseLogo.tsx`, `public/brand/`, `public/icon.svg`, and `public/docs/index.html`).

For the portable machine-readable Stitch/Impeccable design specification and shadow-DOM component snippets, see root `DESIGN.md` and `.impeccable/design.json`.

---

## 1. Aesthetic Direction: `#1 Stadium Track — Track Volt & Obsidian`

THRESH pairs athletic stadium-track geometry with laboratory-grade physiological legibility across **Light Mode** and **Dark Mode**:

1. **Stadium Track Outer Surround (`body` / `.ap-shell`)**:
   - **Light Mode**: Classic Pine stadium surround (`#163022`) with a static upper-left floodlight radial glow (`rgba(200, 255, 0, 0.14)`), framing a `2px` Pine-bordered (`#2B5B3F`) Stadium Chalk workspace canvas (`#F4F7F2`) and Crisp Paper (`#FFFFFF`) telemetry cards.
   - **Dark Mode (`.dark`)**: Deep Pine surround (`#0C1D14`) with a subtle floodlight radial glow (`rgba(200, 255, 0, 0.12)`), framing a `2px` Pine-bordered (`#2B543B`) Obsidian-Pine workspace canvas (`#0B120E`), Carbon-Pine (`#101B15`) cards, and Deep Turf (`#15231B`) inset wells.
   - **Zero Scroll Jank Policy**: Surfaces use crisp solid/tonal layering without `background-attachment: fixed` or full-bar/full-screen `backdrop-filter` blur passes.
2. **`B3-3A + W1 + G1` THRESH Brand Lockup (`AeroPulseLogo.tsx` & `public/brand/`)**:
   - **`B3-3A` Continuous Track & Prominent Threshold Gauge**: Smooth stadium curve on the left whose outer track lane and highlighted threshold arrow lane sweep continuously underneath the wordmark, paired with a bold 3-zone physiological gauge (`Emerald → Volt → Flame`) and crisp indicator needle.
   - **`W1` Integrated Athletic Wordmark**: Forward-leaning `-10deg` heavy athletic letterforms (`THRESH`) seated directly on the track straightaway, razor-sharp down to `28px` navbar height.
   - **`G1` Emerald-to-Volt Letter Gradient**: Horizontal athletic gradient (`#166534 → #4D7C0F → #65A30D` on light surfaces; `#ECFCCB → #D9F99D → #C8FF00` on dark surfaces).
   - **Velocity-Sheared Navigation (`.ap-track-tab`)**: Primary cockpit navigation tabs and `.ap-lane-badge` callouts use `-14deg` outer skew with `+14deg` counter-skewed inner labels (`.ap-track-tab-inner`, `.ap-lane-badge-inner`).
   - **Gauge Favicon (`public/icon.svg`)**: Standalone rounded-square `#0B1B13` stadium tile housing the interior threshold gauge arc and needle for `16×16` and `32×32` browser-tab recognition.
3. **Protected Telemetry & Physiological Semantics**:
   - High-density ECharts & uPlot canvases (`src/utils/themeTokens.ts`) synchronize 1:1 with `src/index.css` so 6-zone effort colors, Banister PMC series, and readiness pills maintain unambiguous meaning regardless of theme or school/club co-branding.

---

## 2. Core Surface & Brand Tokens (`src/index.css` & `src/utils/themeTokens.ts`)

| CSS / Theme Token | Light Mode | Dark Mode (`.dark`) | Role |
| :--- | :--- | :--- | :--- |
| `--ap-outer-bg` | `#163022` | `#0C1D14` | Outer stadium surround behind `.ap-content-stage` & `StravaAuthGate`. |
| `--ap-canvas-bg` / `canvasBg` | `#F4F7F2` | `#0B120E` | Framed main workspace stage (`.ap-content-stage`). |
| `--ap-content-border` | `#2B5B3F` | `#2B543B` | `2px` structural stadium frame & `.ap-header-bar` border. |
| `--ap-card-bg` / `cardBg` | `#FFFFFF` | `#101B15` | Primary telemetry & onboarding cards (`.liquid-glass`, `.ap-card`). |
| `--ap-card-border` / `borderSubtle` | `rgba(38, 88, 58, 0.19)` | `rgba(57, 150, 99, 0.36)` | `1px` crisp structural card border. |
| `--ap-inset-bg` / `insetBg` | `#E9EFE9` | `#15231B` | Nested KPI wells, segmented tracks, form inputs (`.liquid-glass-subtle`, `.ap-card-inset`). |
| `--ap-inset-border` | `rgba(38, 88, 58, 0.16)` | `rgba(57, 150, 99, 0.26)` | `1px` recessed well border. |
| `textPrimary` | `#101411` | `#F4F7F4` | Primary foreground copy and KPI numerals. |
| `textSecondary` | `#1F3528` | `#C8D8CE` | Supporting telemetry labels and idle tab copy. |
| `textMuted` | `#43584B` | `#93A39A` | WCAG 2.1 AA muted axis/caption ink (`>= 4.5:1`). |
| `--color-ap-volt` / `.ap-btn-primary` | `#C8FF00` fill / `#080A09` ink (`#4D7C0F` border) | `#C8FF00` fill / `#080A09` ink (`#E2FF66` border) | Primary brand Volt CTA & `.ap-nav-volt-active` pill (`> 15:1` contrast). |
| `--ap-brand-primary` / `brandCobalt` | `#1C5436` (Pine ink) / `#3F6212` (`.ap-telemetry-label`) | `#C8FF00` (Volt) / `#A3E635` (`.ap-telemetry-label`) | Brand accent ink on light/dark surfaces (`>= 7.1:1` micro-telemetry label contrast). |
| `.ap-btn-strava` / `.ap-text-strava` | `#C23800` fill + `#FFFFFF` ink (`5.44:1`); `#B83500` text | `#C23800` fill + `#FFFFFF` ink (`5.44:1`); `#FF7A45` text | WCAG 2.1 AA compliant Strava OAuth CTA (`>= 48px` on primary sign-in) & provenance ink. |

---

## 3. Typography, `11px` Floor & Tabular Numeric Discipline

| Token | Font Stack | Size / Tracking | Usage |
| :--- | :--- | :---: | :--- |
| `--font-display` | `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif` | `-0.025em` (`-0.03em` `.ap-kpi-value`) | Page `<h1>`–`<h4>` headings, onboarding headers, KPI hero readouts. |
| `--font-sans` | `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif` | `-0.011em` | Body prose, coaching rationale, form labels, navigation tabs. |
| `--font-mono` | `'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace` | `0em` (`tabular-nums`) | All physiological metrics (`CTL`, `ATL`, `TSB`, `Watts`, `W/kg`, `bpm`, `min/km`, `0.01s FAT`), Join Codes, and workout syntax. |
| `--text-2xs` (`text-2xs`) | Inherits `--font-sans` or `--font-mono` | `0.6875rem` (`11px`) / `1rem` (`16px`) | Hard minimum micro-telemetry & badge floor; scales cleanly with browser root `rem` zoom (zero sub-`11px` pixel font classes). |

> **Rules**:
> 1. Every numerical readout, stopwatch split, zone boundary, and chart axis **must** use `font-mono` and `tabular-nums` so digits never jitter during `0.01s` trackside timing or `1Hz` cursor scrubbing.
> 2. Never stack a decorative uppercase kicker/eyebrow directly above a heading; headings carry their own weight, and inline badges sit beside headings when metadata is required.
> 3. Use drawn Phosphor vector icons (`src/components/icons/PhosphorIcons.tsx`) in consistent stroke weight—never Unicode emoji icons.

---

## 4. Protected Physiological & Co-Branding Color Encodings

Even when a school or club activates custom co-branding (`TeamBrandConfig` via `src/physiology/teamOnboardingEngine.ts` and `src/utils/teamBrandDom.ts`), `computeAccessibleTeamPalette` clamps light and dark brand accents (`primaryOnLight` against `#FFFFFF`, `primaryOnDark` against `#15231B`, and `textOnPrimaryDark` `>= 4.55:1`) while **strictly preserving** canonical physiological tokens:

### 4.1 Semantic Readiness & Guardrail Pills (WCAG 2.1 AA/AAA)
- **`.ap-status-prime`**: Optimal / Prime autonomic readiness, CARA compliant, Safe-Sport active (`#ECFDF5` / `#065F46` light; `rgba(16, 185, 129, 0.15)` / `#6EE7B7` dark).
- **`.ap-status-info`**: Balanced / Calibrating / Sync status (`#F7FEE7` / `#365314` light; `rgba(200, 255, 0, 0.12)` / `#D9F99D` dark).
- **`.ap-status-caution`**: Modulated (`-15%` load), elevated drift, approaching cap (`#FFFBEB` / `#92400E` light; `rgba(245, 158, 11, 0.15)` / `#FCD34D` dark).
- **`.ap-status-strained`**: Suppressed HRV, Overreaching (`TSB < -30`), Bone-Stress Stop (`#FFF1F2` / `#9F1239` light; `rgba(244, 63, 94, 0.15)` / `#FDA4AF` dark).

### 4.2 Banister Performance Management Chart (`CTL` / `ATL` / `TSB`) & Load Focus
| Metric | CSS Token | Light Mode | Dark Mode |
| :--- | :--- | :---: | :---: |
| **Chronic Training Load (`42d CTL`)** | `--color-ap-ctl` | `#0D9488` | `#2DD4BF` |
| **Acute Training Load (`7d ATL`)** | `--color-ap-atl` | `#E11D48` | `#FB7185` |
| **Form (`TSB` Optimal Race Window)** | `--color-ap-tsb-opt` | `#059669` | `#34D399` |
| **Form (`TSB` Fresh / Transition)** | `--color-ap-tsb-fresh` | `#0284C7` | `#38BDF8` |
| **Form (`TSB` Productive Grey Zone)** | `--color-ap-tsb-warn` | `#D97706` | `#FBBF24` |
| **Form (`TSB` High Overreach Risk)** | `--color-ap-tsb-high` | `#DC2626` | `#F87171` |
| **Load Focus (Low / High / Anaerobic)** | `--color-ap-load-*` | `#0D9488` / `#EA580C` / `#7C3AED` | `#0D9488` / `#EA580C` / `#7C3AED` |

### 4.3 Canonical 6-Zone Physiological Effort Spectrum (`Z1–Z6`)
| Zone | Physiological Domain | Token | Canonical Hex |
| :---: | :--- | :--- | :---: |
| **Z1** | Cool Mist — Active Recovery | `--color-ap-z1` | `#94A3B8` |
| **Z2** | Aerobic Teal — Endurance Base | `--color-ap-z2` | `#0D9488` |
| **Z3** | Ochre — Tempo / Sweet Spot | `--color-ap-z3` | `#D97706` |
| **Z4** | Thresh Vermilion — Lactate Threshold | `--color-ap-z4` | `#EA580C` |
| **Z5** | Crimson — $\text{VO}_2\max$ Aerobic Power | `--color-ap-z5` | `#DC2626` |
| **Z6** | Deep Violet — Anaerobic / Neuromuscular | `--color-ap-z6` | `#7C3AED` |

---

## 5. Dialog Accessibility, Motion, Safe-Sport & Touch Ergonomics

- **Minimum Touch Targets**: Interactive controls, mobile bottom-dock tabs, and header tools enforce `>= 44px` (`2.75rem`) hit targets on touch/mobile viewports; primary Strava OAuth sign-in enforces `>= 48px` (`min-h-[52px]`), and Trackside Watchless Split Pad runner rows enforce `>= 56px`.
- **Accessible Modal Dialogs (`useModalDialog.ts`)**: All `9` modals and drawers render `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the inner dialog sheet, trap `Tab` / `Shift+Tab` focus, restore focus to the invoking trigger on close, and handle stacked/popover-aware `Escape` dismissal.
- **Intentional Motion & `prefers-reduced-motion`**: Interactive transitions use crisp exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`, `120–150ms`). Under `@media (prefers-reduced-motion: reduce)`, all CSS transitions/animations clamp to `0.01ms`, continuous `.animate-pulse` / `.animate-spin` / `.animate-ping` loops stop, and ECharts disables canvas entrance/update animations.
- **U18 Safe-Sport Weight Shielding**: When `athleteProfile.u18SafeSportHideWeight` is active (automatic default on High School rosters), body-weight inputs, daily wellness `kg`/`lbs` readouts, and `W/kg` emphasis are shielded across `AthleteProfileModal`, `FitnessHealthView`, and `CalendarView`.
