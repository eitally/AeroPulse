# THRESH v2.3 — Precision Endurance Physiology, Load, Race Simulation & Scholastic Team Platform

**THRESH** is a full-stack, mobile-ready Progressive Web App (PWA) and desktop physiological performance cockpit crafted in the **`#1 Stadium Track`** graphic identity (`B3-3A + W1 + G1` track-and-gauge brand lockup + standalone gauge favicon).

- **Strava Handles Identity**: Sign in across desktop and mobile with one click via **Strava OAuth** (deterministic HMAC-derived cross-device session + encrypted `AES-256-GCM` token vault).
- **Athlete-Controlled Strava Sync**: Right after authenticating, choose exactly what syncs to THRESH (`Last 90 Days`, `Last 6 Months`, `Full Archive`, or `Identity Only — 0 Workouts`), confirm units (`mi / lbs` or `km / kg`), and optionally calibrate zones from a recent race or power mark.
- **Optional Overnight Sleep & HRV Add-Ons**: Connect **Garmin Connect** or **Intervals.icu** anytime as optional secondary add-ons for overnight `HRV rMSSD`, `Sleep Score`, and `Resting HR`—never mandatory.
- **Individual & School / Club Team Ready**: Launch a branded High School, Collegiate, or Club workspace with printable Locker-Room QR sheets (`/join/<slug>`), `.CSV` roster auto-matching on Strava sign-in, U18 Safe-Sport weight shielding, VDOT pacing pods, Watchless Split Stopwatch, and NCAA 20-Hour CARA compliance.

---

## Complete Online Documentation Suite

| Resource | Path / URL | Description |
| :--- | :--- | :--- |
| **[Online Documentation Portal (`/docs`)](public/docs/index.html)** | `/docs/index.html` | Standalone, searchable online documentation website served in `#1 Stadium Track` Light/Dark themes covering 3-step Strava onboarding, team QR/CSV workflows, NCAA tables, mathematical formulas, and REST API security. |
| **[In-App Interactive Guide (`UserGuideModal.tsx`)](src/components/UserGuideModal.tsx)** | Click **`?` (Guide)** in top header | Interactive 9-chapter searchable manual with **15 physiological formula cards** and **"Try It Live →"** deep links into every modal and workspace. |
| **[User Manual (`docs/USER_GUIDE.md`)](docs/USER_GUIDE.md)** | `docs/USER_GUIDE.md` | Complete step-by-step walkthrough across all 8 chapters, from 3-step Strava sign-in & sync policy selection to the Plan vs. Actual Ledger, Durability curves, and Team Join codes. |
| **[High School & Collegiate Team Pack Guide (`docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md`)](docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md)** | `docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md` | Deep dive into Team Branding Studio, QR posters, `.CSV` roster auto-matching, `SUMMARY_ONLY` / `FULL_STREAMS` / `LOAD_ONLY` sharing tiers, VDOT Pacing Pods, Watchless Split Pad, NCAA Track Conversions, Safe-Sport / RED-S Protection, and 20-Hour CARA audits. |
| **[Physiology & Math Reference (`docs/PHYSIOLOGY_AND_METRICS.md`)](docs/PHYSIOLOGY_AND_METRICS.md)** | `docs/PHYSIOLOGY_AND_METRICS.md` | Mathematical derivations for Seed-Mark Calibration, Two-Pass Strava `rTSS` & `EF`, Banister `CTL`/`ATL`/`TSB`, 3-Channel Orthopedic ACWR, `0–40 kJ/kg` & `0–2,000 kcal` Durability, `CP`/`W'`, Skiba `W' Balance`, Daniels `VDOT`, and 1Hz Unstructured Interval Hysteresis. |
| **[REST API, OAuth & Security (`docs/API_AND_SECURITY.md`)](docs/API_AND_SECURITY.md)** | `docs/API_AND_SECURITY.md` | Documentation for deterministic Strava session derivation, CSRF-signed OAuth `state`, `AES-256-GCM` Token Vault (`TOKEN_VAULT_KEY` + serverless `thresh_vault` backup), Clean-Room Strava Firewall, hardware webhooks, and OTA workout export. |
| **[Design System (`docs/DESIGN_SYSTEM.md`)](docs/DESIGN_SYSTEM.md)** | `docs/DESIGN_SYSTEM.md` | `#1 Stadium Track` surface tokens (`#0C1D14` Dark Pine / `#163022` Light Pine + `#C8FF00` Volt lane geometry), `B3-3A + W1 + G1` THRESH lockup, protected `Z1–Z7` effort colors, and WCAG AA status pills. |

---

## Why THRESH v2.3?

| Capability | Intervals.icu | Strava | Final Surge / VDOT O2 | **THRESH v2.3** |
| :--- | :---: | :---: | :---: | :---: |
| **Strava Identity + Explicit Sync Window (`90d` / `6mo` / `All` / `None`)** | No | Native | No | **Yes + Optional Garmin / Intervals Add-Ons** |
| **Banister PMC (`42d CTL`, `7d ATL`, `TSB`, `Ramp Rate`)** | Yes | No | No | **Yes + Two-Pass Calibrated Strava `rTSS`** |
| **3-Channel Orthopedic Load Strip** | No | No | No | **Yes (Central / Run Impact / Bike Torque + 1-Tap Swap)** |
| **Fatigue-Sliced Durability (`0–40 kJ/kg` & `0–2,000 kcal`)** | Manual Custom | No | No | **Yes (Built-in Retention Curve & Carb `g/hr` Rx)** |
| **Plan vs. Actual Ledger (`- Original / + Proposed`)** | No | No | No | **Yes ($\Delta\text{TSS}$, $\Delta\text{CTL}$, $\Delta\text{TSB}$ + 1-Tap Commit)** |
| **Course Physics, Weather/Altitude & Carb/Sodium Simulator** | No | No | No | **Yes (5-Segment Pacing + Dual-Source Fueling Plan)** |
| **GPS-to-Official Chip/FAT Rubber-Banding & Passports** | No | No | No | **Yes (`THV-...` Cryptographic Hash + Course Correction)** |
| **Auto-Scaled VDOT Pacing Pods + Watchless Split Stopwatch** | No | No | Partial | **Yes (Pods A–D + Printable Sheet + 0.01s Multi-Runner Pad)** |
| **Team QR Posters, `.CSV` Auto-Match, Safe-Sport & 20h CARA Audit** | No | No | Partial | **Yes (RED-S Shield + Sharing Tiers + NCAA Bylaw 17.1)** |

---

## Quick Start & Commands

```bash
# 1. Install dependencies
npm install

# 2. Generate production session & AES-256-GCM vault secrets
npm run secrets:generate

# 3. Configure .env (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, SESSION_SECRET, TOKEN_VAULT_KEY, optional DATABASE_URL / RESEND_API_KEY / GEMINI_API_KEY)
npm run dev

# 4. Run strict TypeScript check, Vitest unit + integration suites, production build & <220KB gzip gate
npm run lint && npm test && npm run build && npm run check:bundle
```
