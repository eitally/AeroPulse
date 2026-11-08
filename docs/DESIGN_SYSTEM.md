# AeroPulse — "Editorial Endurance Lab" Design System & UI Architecture

This document defines the visual language, CSS surface primitives, typography scale, semantic color tokens, z-index layering hierarchy, and responsive layout standards of **AeroPulse** (`src/index.css` and `src/components/`).

---

## 1. Aesthetic Direction: "Editorial Endurance Lab"

AeroPulse blends three high-craft visual traditions into an adaptive **Light & Dark Mode** cockpit:
1. **Swiss Editorial Precision**: High-contrast typographic hierarchy (`SF Pro Display` / `Plus Jakarta Sans` headers, `DM Sans` prose, and tabular `JetBrains Mono` / `SF Mono` telemetry readouts) with hairline `1px` borders and structured multi-column ledgers.
2. **macOS Tahoe / visionOS Liquid Glass**: Translucent multi-layered specular cards (`.liquid-glass`, `.liquid-glass-header`, `.liquid-glass-subtle`) with `backdrop-filter: blur(24px) saturate(185%)` and subtle inner top-edge highlights (`inset 0 1px 0 0`).
3. **WKO5 / Intervals.icu High-Density Telemetry**: Dedicated dark oscilloscope sub-canvases (`#090B0E` / `#0F131A`) and synchronized ECharts / Leaflet workspaces that preserve crisp contrast in both Light and Dark themes.

---

## 2. Typography & Numeric Discipline

Configured in `src/index.css` under `@layer base`:

| Token | Font Stack | Letter Spacing | Usage |
| :--- | :--- | :---: | :--- |
| `--font-display` | `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Plus Jakarta Sans', 'Inter', sans-serif` | `-0.024em` | Page titles, modal headers, KPI hero readouts, phenotype classifications. |
| `--font-sans` | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', 'Inter', sans-serif` | `-0.011em` | Body copy, coaching rationale, form controls, navigation pills. |
| `--font-mono` | `'SF Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace` | `0em` (`tabular-nums`) | All physiological metrics (`CTL`, `ATL`, `TSB`, `Watts`, `W/kg`, `bpm`, `min/km`, `0.01s FAT`), timestamps, and workout syntax. |

> **Rule**: Every numerical metric column, timer, zone boundary, and chart axis readout **must** apply `font-mono` or `tabular-nums` (`font-variant-numeric: tabular-nums`) so digits never jitter during 1Hz cursor scrubbing.

---

## 3. Adaptive Liquid Glass Surface Classes (`src/index.css`)

| CSS Class | Light Mode Surface | Dark Mode Surface (`.dark`) | Primary Use Case |
| :--- | :--- | :--- | :--- |
| `.liquid-glass` | `linear-gradient(165deg, rgba(255,255,255,0.84), rgba(255,255,255,0.68))`, `blur(24px)`, `1px solid rgba(255,255,255,0.85)` | `linear-gradient(165deg, rgba(19,28,46,0.74), rgba(11,17,30,0.62))`, `blur(26px)`, `1px solid rgba(255,255,255,0.09)` | Primary dashboard cards, modal sheets, chart containers. |
| `.liquid-glass-header` | `linear-gradient(180deg, rgba(255,255,255,0.86), rgba(248,250,252,0.74))`, `blur(28px) saturate(200%)` | `linear-gradient(180deg, rgba(17,25,42,0.80), rgba(10,15,27,0.70))`, `blur(28px) saturate(200%)` | Sticky top navigation dock (`z-40`) and mobile bottom navigation bar. |
| `.liquid-glass-subtle` | `rgba(255, 255, 255, 0.55)`, `1px solid rgba(226, 232, 240, 0.85)` | `rgba(15, 23, 42, 0.46)`, `1px solid rgba(255, 255, 255, 0.065)` | Nested KPI tiles, glossary cards, calendar day cells, table wrappers. |
| `.liquid-capsule-track` | `rgba(15, 23, 42, 0.055)` recessed inset track | `rgba(3, 7, 18, 0.52)` recessed inset track | Segmented control tracks (`Combined / Outdoor / Virtual`, sub-tab switchers). |
| `.liquid-capsule-active` | Raised white specular pill (`#ffffff` to `#f8fafc`) | Raised translucent pill (`rgba(255,255,255,0.16)`) | Active segmented pill inside `.liquid-capsule-track`. |

### Light-Mode Contrast Safeguard for Oscilloscope Canvases
Dark telemetry canvases (`.bg-[#090B0E]`, `.bg-[#0D1015]`, `.bg-[#0F131A]`) explicitly enforce `color: #F1F5F9` in `src/index.css` so dark-canvas legends and overlays remain legible even when the outer application shell is toggled to Light Mode.

---

## 4. Semantic Color Palette & Physiological Encodings

### 4.1 Core Brand & Telemetry Tokens
- `--ap-electric-cyan`: `#0EA5E9` — Chronic Training Load (`CTL` Fitness), primary interactive accent.
- `--ap-luminous-cyan`: `#38BDF8` — Garmin **Low Aerobic** load focus, Fresh `TSB` zone (`+5` to `+25`).
- `--ap-aero-orange`: `#F97316` — Garmin **High Aerobic** load focus, Threshold / Sweet Spot emphasis.
- `--ap-strava-orange`: `#FC4C02` — Strava OAuth branding, KOM / Segment PR highlights.

### 4.2 Garmin Training Load Focus Colors (PMC Stacked Bars)
- **Low Aerobic (`Z1–Z2`)**: Solid `#38bdf8` · Bar fill `rgba(56, 189, 248, 0.92)` · Badge `rgba(56, 189, 248, 0.16)`
- **High Aerobic (`Z3–Z4`)**: Solid `#f97316` · Bar fill `rgba(249, 115, 22, 0.94)` · Badge `rgba(249, 115, 22, 0.18)`
- **Anaerobic (`Z5–Z7`)**: Solid `#d946ef` · Bar fill `rgba(217, 70, 239, 0.92)` · Badge `rgba(217, 70, 239, 0.18)`

### 4.3 7-Zone Effort Skyline & Histogram Palette
| Zone | Name | Hex Color | Tailwind Equivalent |
| :---: | :--- | :---: | :--- |
| **Z1** | Active Recovery | `#38bdf8` | `sky-400` |
| **Z2** | Endurance Base | `#10b981` | `emerald-500` |
| **Z3** | Tempo / Aerobic | `#f59e0b` | `amber-500` |
| **Z4** | Lactate Threshold | `#f97316` | `orange-500` |
| **Z5** | $\text{VO}_2\max$ | `#f43f5e` | `rose-500` |
| **Z6** | Anaerobic Capacity | `#a855f7` | `purple-500` |
| **Z7** | Neuromuscular Sprint | `#ec4899` | `pink-500` |

---

## 5. Strict Z-Index Layering Hierarchy (`z-[15]` to `z-[110]`)

To prevent Leaflet map controls, sticky calendar headers, account menus, and portal modals from colliding, AeroPulse enforces a strict z-index stack:

| Z-Index Layer | Component / Surface | Notes |
| :---: | :--- | :--- |
| `z-[15]` – `z-[25]` | Sticky table headers, calendar day badges, inline chart overlays | Scoped inside scrollable containers. |
| `z-30` | Contextual workspace sub-navbars (`Lab & Goals`, `Activities` switcher) | Sits below the main sticky top navigation bar. |
| `z-40` | Primary Sticky Header Dock (`.liquid-glass-header`) & Mobile Bottom Nav | Always accessible during page scroll. |
| `z-50` | Standard Modal Backdrops (`.ap-modal-backdrop`), Account Dropdown Menu | Base modal layer. |
| `z-[60]` | Slide-Over Drawers (`AICoachDrawer`, Workout Builder Sheet) | Can be opened atop base dashboard views. |
| `z-[70]` | Domain Configuration Modals (`DataSourcesModal`, `AthleteProfileModal`, `AthleteRosterModal`, `OfficialRaceModal`) | Rendered via `createPortal(..., document.body)`. |
| `z-[80]` | **Interactive User Guide Modal (`UserGuideModal`)** | Rendered via `createPortal(..., document.body)` so it can launch above any workspace and trigger deep-link navigation. |
| `z-[100]` – `z-[110]` | Floating Chart Info Tooltips (`ChartInfoTooltip`) & Critical Toast Alerts | Topmost transient feedback layer. |

---

## 6. Responsive Layout & Portal Modal Standards

### 6.1 Fluid Container & Grid System
- **`.ap-shell`**: `min-height: 100dvh; overflow-x: clip;` with automatic bottom safe-area clearance (`calc(4.75rem + env(safe-area-inset-bottom, 0px))`) for the mobile 5-tab dock.
- **`.ap-container`**: `max-width: 96rem (1536px)` with fluid horizontal padding `clamp(0.75rem, 2.2vw, 2rem)`.
- **`.ap-grid-dashboard` & `.ap-grid-dashboard-12`**: Enforces `min-width: 0` on all grid children so ECharts canvases and horizontal scroll tables never blow out mobile viewports.

### 6.2 Modal Ergonomics (`createPortal` + Mobile Bottom Sheet)
All top-level modals (`UserGuideModal`, `AthleteProfileModal`, `DataSourcesModal`, `OfficialRaceModal`, `AthleteRosterModal`) follow four non-negotiable interaction rules:
1. **DOM Portal**: Render into `document.body` via `createPortal` to escape any parent `backdrop-filter` or `overflow: hidden` stacking context.
2. **Backdrop Dismissal**: Clicking the outer backdrop calls `onClose()`, while the inner `.liquid-glass` dialog calls `e.stopPropagation()`.
3. **Keyboard Accessibility**: Pressing `Escape` cleanly closes the active modal.
4. **Responsive Sheet Geometry**: Full-width bottom sheet (`rounded-t-3xl`, `max-h-[92dvh]`) on mobile (`< 640px`) and centered rounded dialog (`rounded-3xl`, `max-h-[88vh]`) on desktop (`>= 640px`).
