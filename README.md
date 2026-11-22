# MeetReady — Precision Endurance Physiology, Load, Race Simulation & Scholastic Team Platform

**MeetReady** is a full-stack, mobile-ready Progressive Web App (PWA) and desktop physiological performance cockpit crafted in the **`#1 Stadium Track`** graphic identity (`S2 × W-A` brand lockup + `FAV-F` standalone favicon).

- **Multi-Auth Cross-Device Identity**: Sign in across desktop and mobile with **Google OAuth**, **WebAuthn Passkeys**, **Magic Link**, **Email OTP**, or **optional Strava OAuth** (with deterministic HMAC sessions, `AES-256-GCM` vaults, and normalized PostgreSQL persistence).
- **4-Pillar Athlete Workspace & Run/Ride Core**: Unified **Today**, **Calendar** (+ **Plan Builder** with Return-to-Run & First 5K beginner tracks), **Log** (`Activities`), and standalone **Progress** (`Curves`, `Trends`, `Lab`), plus optional **Coach Workspace**.
- **Optional Overnight Sleep & HRV Connectors**: Connect **Garmin Connect**, **Intervals.icu** (also relaying COROS/WHOOP), **Wahoo Cloud**, or **Polar AccessLink** anytime, or drop `.FIT` / `.GPX` / `.TCX` / `.ZIP` archives locally.
- **Individual & School / Club Team Ready**: Launch a branded High School, Collegiate, or Club workspace with `12`-athlete Coach Demo mode, reusable **Workout Library**, Guardian-CC'd **Workout Comments**, Locker-Room QR sheets (`/join/<slug>`), `.CSV` roster auto-matching, U18 Safe-Sport weight shielding, VDOT pacing pods, Watchless `0.01s` Trackside Stopwatch, NCAA 20h CARA compliance, and standalone [`/privacy`](/privacy), [`/terms`](/terms), [`/subprocessors`](/subprocessors), and [`/procurement`](/procurement) school compliance pages.

---

## Complete Online Documentation & Procurement Suite

| Resource | Path / URL | Description |
| :--- | :--- | :--- |
| **[Online Documentation Portal (`/docs`)](public/docs/index.html)** | `/docs` · `/docs/` | Standalone searchable documentation portal in Chalk, Track Pine Dark, and Midnight Slate themes. |
| **[Illustrated Coach Guide (`/docs/coach.html`)](public/docs/coach.html)** | `/docs/coach.html` | 5-chapter visual Coach manual with recaptured screenshots covering team setup, Squad Triage, Clipboard, Trackside Stopwatch, and Parent Hub. |
| **[Legal & School Procurement Pack](/procurement)** | `/privacy` · `/terms` · `/subprocessors` · `/procurement` | Privacy Policy, Terms of Service, Subprocessor disclosure, CA SDPC NDPA / FERPA addendum, HECVAT Lite, and PO pricing / W-9 path. |
| **[In-App Interactive Guide (`UserGuideModal.tsx`)](src/components/UserGuideModal.tsx)** | Click **`?` (Guide)** in top header | Interactive 9-chapter searchable manual with **14 physiological formula cards** and **"Try It Live →"** deep links into modals and workspaces. |
| **[User Manual (`docs/USER_GUIDE.md`)](docs/USER_GUIDE.md)** | `docs/USER_GUIDE.md` | Complete step-by-step walkthrough across the 4-pillar Athlete workspace, onboarding, Plan Builder, Durability, and Teams. |
| **[High School & Collegiate Team Pack Guide (`docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md`)](docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md)** | `docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md` | Team Branding Studio, QR posters, `.CSV` auto-matching, `ORG_ADMIN`/`ATHLETIC_TRAINER` roles, Workout Library, Guardian CC comments, VDOT Pods, Stopwatch, Safe-Sport, and 20h CARA audits. |
| **[Physiology & Math Reference (`docs/PHYSIOLOGY_AND_METRICS.md`)](docs/PHYSIOLOGY_AND_METRICS.md)** | `docs/PHYSIOLOGY_AND_METRICS.md` | Mathematical derivations for Seed-Mark Calibration, Two-Pass Strava `rTSS` & `EF`, Banister `CTL`/`ATL`/`TSB`, 3-Channel Orthopedic ACWR, `0–40 kJ/kg` & `0–2,000 kcal` Durability, `CP`/`W'`, Skiba `W' Balance`, and Daniels `VDOT`. |
| **[REST API, OAuth & Security (`docs/API_AND_SECURITY.md`)](docs/API_AND_SECURITY.md)** | `docs/API_AND_SECURITY.md` | Multi-Auth identity, CSRF OAuth cookie-nonce binding, `AES-256-GCM` Vault & Postgres TLS, Clean-Room Allowlist AI Firewall, RBAC, and audit log endpoints. |
| **[Design System (`docs/DESIGN_SYSTEM.md`)](docs/DESIGN_SYSTEM.md)** | `docs/DESIGN_SYSTEM.md` | `#1 Stadium Track` surface tokens (`#0C1D14` Dark Pine / `#163022` Light Pine + `#C8FF00` Volt lane geometry), `S2 × W-A` lockup, protected `Z1–Z6` effort colors, and WCAG AA tokens. |

---

## Why MeetReady v2.3?

| Capability | Intervals.icu | Strava | Final Surge / VDOT O2 | **MeetReady v2.3** |
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
