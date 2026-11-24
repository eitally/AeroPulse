# MeetReady — Mondo Clay & Stadium Chalk Design System

> **Single Source of Truth:** Root [`DESIGN.md`](../DESIGN.md) and `.impeccable/design.json` are the authoritative token and component specification. This engineering companion summarizes how those tokens map into `src/index.css`, `src/utils/themeTokens.ts`, `src/utils/teamBrandDom.ts`, `src/utils/brandVectors.ts`, and `src/components/AeroPulseLogo.tsx`.

---

## 1. Aesthetic Direction: "The Trackside Timing Console"

MeetReady replaces outer colored bezels and glassmorphism with edge-to-edge **Stadium Chalk** in daylight and **Track Asphalt** after dark, separated by `1px` ink hairlines, warm tonal inset steps, committed **Mondo Clay** track geometry, and rationed **Starter Volt** triggers:

1. **Edge-to-Edge Chalk & Asphalt Surfaces (Zero Scroll Jank):**
   - **Light Mode:** Open Stadium Chalk ground (`#F6F3EC`), Warm Chalk sticky header (`#FAF8F4`), Matte White cards (`#FFFFFF`, `.ap-card`), and Warm Stone inset wells (`#EDE9DF`, `.ap-card-inset`).
   - **Dark Mode (`.dark`) + Circadian Night Themes:** Track Asphalt ground (`#121413`), Matte Carbon cards (`#1A1D1B`), Deep Asphalt inset wells (`#151816`), plus circadian `Midnight Slate` (`#0E1318`) and `Dusk` (`#100E0C`) palettes.
   - **Zero Blur Policy:** Zero `backdrop-filter: blur()` passes or `background-attachment: fixed` on cards, headers, tooltips, or modals.
2. **The 80 / 15 / 5 Track Budget & Orthogonal Craft:**
   - **80%** neutral Chalk/Paper/Asphalt surfaces; **15%** committed Mondo Clay (`#B83A24`), `1px` ink hairlines, and Warm Stone inset wells; **`<= 5%`** Starter Volt (`#D8FF2A` fill always paired with `#121413` Track Asphalt ink) reserved strictly for primary gun triggers, active clock digits, and focal CTAs.
   - All workspace tabs, split cards, and `.ap-lane-badge` tags stay flat and orthogonal (`transform: none`); directional velocity lives solely inside the flat 2-ink **Concept A Velocity Chevron `M`** mark.
3. **`Concept A Velocity Chevron M` & Brand Studio (`/brand`):**
   - Rendered cleanly in Web headers via `src/components/AeroPulseLogo.tsx` alongside native `Archivo` ExtraBold `MeetReady` copy, and exported across 23 SVG/PNG/zip studio masters in `src/components/BrandGuidePage.tsx` (`src/utils/brandAssetEngine.ts`).

---

## 2. Core Surface & Brand Tokens (`src/index.css` & `src/utils/themeTokens.ts`)

| Token / Role | Light Mode | Dark Mode (`.dark`) | Usage |
| :--- | :--- | :--- | :--- |
| Canvas Ground (`stadium-chalk` / `track-asphalt`) | `#F6F3EC` | `#121413` | Edge-to-edge workspace and landing ground. |
| Sticky Header (`warm-chalk-header` / `asphalt-header-dark`) | `#FAF8F4` | `#161917` | Opaque sticky `.ap-header-bar` with `1px` bottom rule. |
| Primary Card (`matte-white` / `matte-carbon`) | `#FFFFFF` | `#1A1D1B` | Elevated telemetry, workout, and modal cards (`.ap-card`). |
| Inset Well (`warm-stone` / `deep-asphalt`) | `#EDE9DF` | `#151816` | Flat shadowless KPI wells, pill tracks, and form groups (`.ap-card-inset`). |
| Mondo Track Clay (`mondo-clay` / `-dark` / `-bright`) | `#B83A24` (`#9E2E1A` ink) | `#E05238` top rule | Hero canvas, active header nav rule, `.ap-card-clay-top` frame, `:focus-visible`. |
| Starter Volt (`starter-volt` + `#121413` ink) | `#D8FF2A` (hover `#C8EF1E`) | `#D8FF2A` | Primary `.ap-btn-primary` gun/save CTAs and active stopwatch digits. |
| Infield Pine (`infield-pine`) | `#1E4D36` | `#86EFAC` ink | Secondary `.ap-btn-pine` controls, positive split deltas, `.ap-status-prime` ink. |
| Secondary & Muted Inks | `#2C2A26` / `#57544D` | `#D6D1C7` / `#A39E93` | Body copy and WCAG AA (`>= 4.5:1`) captions/chart labels. |
| Strava Vermilion (`strava-vermilion`) | `#C23800` / `#FFFFFF` ink | `#C23800` / `#FF7A45` link | Strictly isolated to `.ap-btn-strava` (`>= 48px` standalone connect) & provenance labels. |

---

## 3. Typography, `11px` Floor & Tabular Numeric Discipline

| Role | Font Stack | Size / Tracking | Usage |
| :--- | :--- | :---: | :--- |
| **Display (`--font-display`)** | `'Barlow Condensed', 'Archivo', system-ui, sans-serif` | `36px–60px` (`-0.015em`) | Persuade hero `<h1>` headlines and standalone poster masters only. |
| **UI Headline / Title / Body (`--font-sans`)** | `'Archivo', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif` | `14px–24px` | Operate workspace headings, navbar wordmarks, cards, forms, prose. |
| **Telemetry & Labels (`--font-mono`)** | `'JetBrains Mono', 'SF Mono', ui-monospace, monospace` | `>= 0.6875rem` (`11px`, `tabular-nums`) | `0.01s` splits, `CTL`/`ATL`/`TSB`, pace pods, join codes, `.ap-lane-badge` tags. |

> **Rules:** Every numeric KPI and `0.01s` split uses `font-mono tabular-nums`; headings never stack decorative uppercase kickers/eyebrows directly above them; use Phosphor vector icons (`src/components/icons/PhosphorIcons.tsx`), never Unicode emojis.

---

## 4. Protected Physiological & Co-Branding Encodings

When a school or club activates custom co-branding (`computeAccessibleTeamPalette` in `src/utils/teamPalette.ts` / `applyTeamBrandToDocument`), outer accents clamp to `>= 4.55:1` WCAG AA contrast while keeping semantic health and effort encodings invariant:

- **Readiness & Status Pills (`.ap-status-*`):**
  - `.ap-status-prime`: Optimal readiness, CARA compliant, target split hit (`#E7F3EC` / `#1E4D36` light).
  - `.ap-status-caution`: Modulated `-15%` session, bell lap, or advisory (`#FFFBEB` / `#92400E` light).
  - `.ap-status-strained`: Suppressed HRV, bone-stress stop, or form alert (`#FDF0ED` / `#8F2A18` light).
  - `.ap-status-info`: Neutral `CALIBRATING` Day-1 state or place tag (`#F2F0E9` / `#121413` light).
- **Banister PMC Series (`src/utils/themeTokens.ts`):** `42d CTL` (`#0D9488` light / `#2DD4BF` dark), `7d ATL` (`#E11D48`), `Optimal TSB` (`#059669`), `Fresh TSB` (`#0284C7`).
- **Locked 6-Zone Effort Spectrum (`Z1–Z6`):** `Z1 #94A3B8`, `Z2 #0D9488`, `Z3 #D97706`, `Z4 #EA580C`, `Z5 #DC2626`, `Z6 #7C3AED`.

---

## 5. Accessibility, Motion & Field Ergonomics

- **Touch Targets:** `>= 44px` (`2.75rem`) on interactive mobile controls, `>= 48px` on standalone Strava OAuth sign-in, and `>= 92px` card height on trackside split cards (`TracksideStopwatchView`).
- **Accessible Modals (`useModalDialog.ts`):** All dialogs enforce `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trapping, trigger focus restoration, and `Escape` dismissal.
- **Reduced Motion & Youth SafeSport:** `@media (prefers-reduced-motion: reduce)` clamps animations; `u18SafeSportHideWeight` shields body weight and `W/kg` across HS rosters by default.
