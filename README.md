# THRESH v2.3 — Precision Endurance Physiology, Load, Race Simulation & Scholastic Team Platform

**THRESH** is a full-stack, mobile-ready Progressive Web App (PWA) and desktop physiological performance cockpit built in the **Precision Editorial** aesthetic. It unifies **Intervals.icu** (including auto-synced **Garmin Connect** daily health & workout telemetry), **Strava**, and first-party hardware webhooks with local **1Hz `.FIT` / `.FIT.GZ` / `.GPX` / `.TCX` / `.ZIP` archive parsing**, **3-Channel Orthopedic Load Guardrails (`10x #1`)**, **Fatigue-Sliced `kJ/kg` & `kcal` Durability (`10x #2`)**, **Weekly Training Git-Diffs (`10x #3`)**, **Course & Fueling Race Simulation (`10x #4`)**, **Verified `THV-...` Race Passports (`10x #6`)**, and a purpose-built **High School & Collegiate Team Pack (`v2.3`)**.

---

## Complete Online Documentation Suite

| Resource | Path / URL | Description |
| :--- | :--- | :--- |
| **[Online Documentation Portal (`/docs`)](public/docs/index.html)** | `/docs/index.html` | Standalone, searchable online documentation website served directly by the app with Light/Dark theme toggle, architecture matrices, NCAA tables, mathematical formulas, and REST API reference. |
| **[In-App Interactive Guide (`UserGuideModal.tsx`)](src/components/UserGuideModal.tsx)** | Click **`?` (Guide)** in top header | Interactive 9-chapter searchable manual with **18 physiological formula cards** and **"Try It Live →"** deep links into every modal and workspace. |
| **[User Manual (`docs/USER_GUIDE.md`)](docs/USER_GUIDE.md)** | `docs/USER_GUIDE.md` | Complete step-by-step walkthrough across all 8 chapters, from onboarding and bulk `.ZIP` import to Weekly Git-Diffs, Durability curves, and Race Simulation. |
| **[High School & Collegiate Team Pack Guide (`docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md`)](docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md)** | `docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md` | Deep dive into Auto-Scaled VDOT Pacing Pods, Watchless Spikes-On Split Stopwatch, NCAA Flat/Banked/Altitude Track Conversions, Recruiting Standards, Safe-Sport / RED-S Protection, Bone-Stress / Ferritin Guardrails, Cross-Training Virtual Miles, and NCAA 20-Hour CARA audits. |
| **[Physiology & Math Reference (`docs/PHYSIOLOGY_AND_METRICS.md`)](docs/PHYSIOLOGY_AND_METRICS.md)** | `docs/PHYSIOLOGY_AND_METRICS.md` | Mathematical derivations for Banister `CTL`/`ATL`/`TSB`, 3-Channel Orthopedic ACWR, `0–40 kJ/kg` & `0–2,000 kcal` Durability, Coggan `NP`/`IF`/`TSS`, Minetti `GAP`, Monod-Scherrer `CP`/`W'`, Skiba `W' Balance`, Daniels `VDOT`, and 1Hz Unstructured Interval Hysteresis. |
| **[REST API, Webhooks & Security (`docs/API_AND_SECURITY.md`)](docs/API_AND_SECURITY.md)** | `docs/API_AND_SECURITY.md` | Documentation for per-visitor signed session isolation, the `AES-256-GCM` OAuth Token Vault, Clean-Room Strava Firewall, hardware webhooks, and OTA workout export (`WorkoutKit`, Garmin JSON, `.ZWO`, `.ERG`). |
| **[Design System (`docs/DESIGN_SYSTEM.md`)](docs/DESIGN_SYSTEM.md)** | `docs/DESIGN_SYSTEM.md` | Precision Editorial color tokens (`#F6F4F0` Alabaster Paper / `#0A0D12` Carbon Obsidian), WCAG AA status pills, typography, and layout architecture. |

---

## Why THRESH v2.3? (THRESH vs. Intervals.icu vs. Strava vs. Final Surge / VDOT O2)

| Capability | Intervals.icu | Strava | Final Surge / VDOT O2 | **THRESH v2.3** |
| :--- | :---: | :---: | :---: | :---: |
| **Banister PMC (`42d CTL`, `7d ATL`, `TSB`, `Ramp Rate`)** | Yes | No | No | **Yes + Dual-Sport Systemic vs. Modality Split** |
| **3-Channel Orthopedic Load Strip (`10x #1`)** | No | No | No | **Yes (Central / Run Impact / Bike Torque + 1-Tap Swap)** |
| **Fatigue-Sliced Durability (`0–40 kJ/kg` & `0–2,000 kcal`, `10x #2`)** | Manual Custom | No | No | **Yes (Built-in Retention Curve & Carb `g/hr` Rx)** |
| **Weekly Training Git-Diff (`- Original / + Proposed`, `10x #3`)** | No | No | No | **Yes ($\Delta\text{TSS}$, $\Delta\text{CTL}$, $\Delta\text{TSB}$ + 1-Tap Commit)** |
| **Course Physics, Weather/Altitude & Carb/Sodium Simulator (`10x #4`)** | No | No | No | **Yes (5-Segment Pacing + Dual-Source Fueling Plan)** |
| **GPS-to-Official Chip/FAT Rubber-Banding & Passports (`10x #6`)** | No | No | No | **Yes (`THV-...` Cryptographic Hash + Course Correction)** |
| **1Hz Stream Inspector + Unstructured No-Lap Rep Detector** | Partial | Partial | No | **Yes (Drag-to-Zoom + Bimodal Hysteresis Rep Recovery)** |
| **Auto-Scaled VDOT Pacing Pods + Watchless Split Stopwatch** | No | No | Partial | **Yes (Pods A–D + Printable Sheet + 0.01s Multi-Runner Pad)** |
| **NCAA Flat/Banked/Altitude Track Indexer & Recruiting Matrix** | No | No | No | **Yes (HS State, Nationals, NCAA D1/D2/D3 Walk-On & Scholarship)** |
| **Safe-Sport Weight Shield, Shin BSI Guardrail & 20h CARA Audit** | No | No | No | **Yes (RED-S Shield + Ferritin + Pool/AlterG Virtual Miles)** |

---

## Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Generate production session & AES-256-GCM vault secrets (optional)
npm run secrets:generate

# 3. Start full-stack Express + Vite server (http://localhost:3000 & http://localhost:3000/docs/)
npm run dev

# 4. Run strict TypeScript check, Vitest unit suites (23 tests), production build & <220KB gzip gate
npm run lint && npm test && npm run build && npm run check:bundle
```
