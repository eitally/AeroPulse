# THRESH — "#1 Stadium Track" Design System & Brand Architecture

This document defines the visual language, `#1 Stadium Track` surface geometry, `B3-3A + W1 + G1` brand lockup, typography scale, physiological zone encodings, z-index layering hierarchy, and responsive layout standards of **THRESH** (`src/index.css`, `src/components/AeroPulseLogo.tsx`, `public/brand/`, and `public/icon.svg`).

---

## 1. Aesthetic Direction: `#1 Stadium Track`

THRESH pairs athletic stadium-track character with laboratory-grade physiological legibility across **Light Mode** and **Dark Mode**:

1. **Stadium Track Outer Surround (`body` / `.ap-shell`)**:
   - **Dark Mode**: Deep Pine surround (`#0C1D14`) overlaid with subtle `-14deg` diagonal Volt lane striations (`rgba(200, 255, 0, 0.055)`) and an upper-left stadium floodlight radial glow.
   - **Light Mode**: Classic Pine track surround (`#163022`) framing crisp Track Chalk (`#F4F7F2`) and Pure White (`#FFFFFF`) editorial cards inside a `2px` Pine-bordered `.ap-content-stage`.
2. **`B3-3A + W1 + G1` THRESH Brand Lockup (`AeroPulseLogo.tsx` & `public/brand/`)**:
   - **`B3-3A` Continuous Track & Prominent Threshold Gauge**: Smooth stadium curve on the left whose outer track lane and highlighted threshold arrow lane sweep continuously underneath the wordmark, paired with a bold 3-zone physiological gauge (`Emerald → Volt → Flame`) and crisp indicator needle.
   - **`W1` Integrated Athletic Wordmark**: Forward-leaning `-10deg` heavy athletic letterforms (`THRESH`) seated directly on the track straightaway with zero horizontal split-letter artifacts, remaining razor-sharp down to `28px` navbar height.
   - **`G1` Emerald-to-Volt Letter Gradient**: Subtle horizontal athletic gradient (`#166534 → #4D7C0F → #65A30D` on light surfaces; `#ECFCCB → #D9F99D → #C8FF00` on dark surfaces) tying the wordmark into the threshold gauge.
   - **Gauge Favicon (`public/icon.svg`)**: Standalone rounded-square `#0B1B13` stadium tile housing the high-contrast interior threshold gauge arc and needle for instant `16×16` and `32×32` browser-tab recognition.
3. **Protected Telemetry & Physiological Semantics**:
   - High-density ECharts & uPlot canvases (`#0D1210` / `#121815`) preserve neutral dark contrast so 7-zone effort colors and readiness badges never clash with chrome accents.

---

## 2. Core Surface & Brand Tokens (`src/index.css`)

| Token | Light Mode | Dark Mode (`.dark`) | Role |
| :--- | :--- | :--- | :--- |
| `--ap-outer-track` | `#163022` | `#0C1D14` | Outer stadium surround behind `.ap-content-stage` & `StravaAuthGate`. |
| `--ap-stage-bg` | `#F4F7F2` | `#0D1210` | Framed main workspace canvas (`.ap-content-stage`). |
| `--ap-stage-border` | `#2B5B3F` | `#25573A` | `2px` structural stadium frame border. |
| `--ap-card-bg` | `#FFFFFF` | `#121815` | Primary telemetry & onboarding cards (`.liquid-glass`). |
| `--ap-recessed-bg` | `#E9EFE9` | `#17201C` | Nested KPI tiles, segmented tracks, form inputs. |
| `--ap-volt` | `#558B00` (text) / `#C8FF00` (on dark) | `#C8FF00` | Primary brand Volt accent, active `.ap-track-tab` underline, primary CTA (`#C8FF00` fill with `#080A09` ink in Dark; `#101411` fill with `#C8FF00` Volt text in Light). |
| `--ap-strava` | `#FC4C02` | `#FC4C02` | Official Strava Primary Identity CTA button (`>= 48px` height). |

---

## 3. Typography & Tabular Numeric Discipline

| Token | Font Stack | Letter Spacing | Usage |
| :--- | :--- | :---: | :--- |
| `--font-display` | `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif` | `-0.024em` | Page titles, onboarding headers, KPI hero readouts, phenotype badges. |
| `--font-sans` | `'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Inter', sans-serif` | `-0.011em` | Body prose, coaching rationale, form labels, navigation tabs. |
| `--font-mono` | `'JetBrains Mono', 'SF Mono', ui-monospace, SFMono-Regular, monospace` | `0em` (`tabular-nums`) | All physiological metrics (`CTL`, `ATL`, `TSB`, `Watts`, `W/kg`, `bpm`, `min/km`, `0.01s FAT`), Join Codes, and workout syntax. |

> **Rule**: Every numerical readout, stopwatch split, zone boundary, and chart axis **must** use `font-mono` / `tabular-nums` so digits never jitter during 1Hz cursor scrubbing.

---

## 4. Protected Physiological Color Encodings

Even when a school or club activates custom co-branding (`TeamBrandConfig`), THRESH strictly preserves canonical physiological colors:

### 4.1 Semantic Readiness & Guardrail Pills (WCAG 2.1 AA)
- **`.ap-status-prime`**: Optimal / Prime autonomic readiness, CARA compliant, Safe-Sport active.
- **`.ap-status-info`**: Balanced / Calibrating / Sync status.
- **`.ap-status-caution`**: Modulated (`-15%` load), elevated drift, approaching cap.
- **`.ap-status-strained`**: Suppressed HRV, Overreaching (`TSB < -30`), Bone-Stress Stop.

### 4.2 7-Zone Effort Skyline & Histogram Palette
| Zone | Name | Hex Color |
| :---: | :--- | :---: |
| **Z1** | Active Recovery | `#38bdf8` |
| **Z2** | Endurance Base | `#10b981` |
| **Z3** | Tempo / Aerobic | `#f59e0b` |
| **Z4** | Lactate Threshold | `#f97316` |
| **Z5** | $\text{VO}_2\max$ | `#f43f5e` |
| **Z6** | Anaerobic Capacity | `#a855f7` |
| **Z7** | Neuromuscular Sprint | `#ec4899` |

---

## 5. Z-Index Layering & Touch Ergonomics

- **Minimum Touch Target**: Primary onboarding CTAs, mobile bottom-dock tabs, and trackside split buttons enforce `min-h-[44px]` (`48px` on Strava OAuth sign-in).
- **Portal Modals (`z-50` to `z-[80]`)**: Top-level modals render cleanly above sticky headers (`z-40`), support backdrop click + `Escape` dismissal, and adapt as full-width bottom sheets on mobile viewports.
