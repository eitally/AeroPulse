# MeetReady — Endurance Physiology, Trackside Timing & Scholastic Team Platform

**MeetReady** (`https://meetready.app`) is a local-first Progressive Web App (PWA) and Express/PostgreSQL team platform crafted in the **Mondo Clay & Stadium Chalk** trackside console design system ([`DESIGN.md`](DESIGN.md)).

- **Multi-Auth Cross-Device Identity:** Sign in via **Google OAuth**, **WebAuthn Passkeys**, **Magic Link**, **Email OTP**, or **optional read-only Strava OAuth** (with deterministic HMAC sessions, `AES-256-GCM` token vaults, and normalized PostgreSQL persistence).
- **4-Pillar Athlete Workspace:** **Today** (Morning/Evening Readiness, AT Return-to-Play, Coach Notes, Latest Timed Splits, 1-tap Team Event RSVPs), **Calendar & Plan Builder**, **Log** (`Activities` + 1Hz Stream Inspector), and **Progress** (`Curves`, `Durability`, `Trends`, `Lab`).
- **Simplified 5-Tab Coach Workspace:** Clean **Home** (Quick Links, Alerts & Conflicts, Comms Launcher), dedicated **Workouts** builder, **Meets & Plan** (Team Events + timed `.ics` Calendar, Meet Day Packets, External Hy-Tek/Athletic.net Interop, 3-layer FAT/stopwatch/wearable reconciliation), `0.01s` Watchless **Timing** (+ zero-PII `/time` Delegated Timing Passes), and **Team** (Roll Call, GPS Geofence Check-In, AT Injury/RTP Hub, District AD Overview, School PO/Stripe Billing).
- **Family Hub & SafeSport Comms:** Linked `PARENT_FOLLOWER` schedule/split cards, revocable timed `webcal://` `.ics` feeds, Unified **Comms Hub** (`Chat`, `Announcements`, `Workout Notes`, `Parents Only` & custom sub-groups), automatic **Web Push → Resend Email fallback**, durable Dexie offline chat outbox, and **Curated Meet Albums** with **FERPA `photoReleaseOptOut`** guardrails.
- **Optional Wearable & File Connectors:** Garmin Connect, Intervals.icu (plus COROS/WHOOP relays), Wahoo Cloud, Polar AccessLink, and local `.FIT` / `.GPX` / `.TCX` / `.ZIP` Web Worker decoding.

---

## Documentation & Contributor Suite

| Resource | Path / URL | Description |
| :--- | :--- | :--- |
| **[Architecture Overview](ARCHITECTURE.md)** | `ARCHITECTURE.md` | System diagram, domain module ownership, and IndexedDB ↔ Postgres sync invariants. |
| **[Contributor Guide](CONTRIBUTING.md)** | `CONTRIBUTING.md` | Prerequisites, CI-parity verification commands, module boundaries, and Linear workflow. |
| **[AI & Code Invariants](AGENTS.md)** | `AGENTS.md` | Workspace rules, bundle/line ceilings, SafeSport/FERPA gates, and Node 22 ESM checks. |
| **[Design System](DESIGN.md)** & **[Tokens Guide](docs/DESIGN_SYSTEM.md)** | `DESIGN.md` · `docs/DESIGN_SYSTEM.md` | Canonical *Mondo Clay & Stadium Chalk* tokens, `Velocity Chevron M`, `Z1–Z6` semantics, WCAG AA. |
| **[Online Docs Portal (`/docs`)](public/docs/index.html)** | `/docs` · `/docs/` | Searchable standalone documentation portal with interactive physiology & compliance references. |
| **[Illustrated Coach Guide](public/docs/coach.html)** | `/docs/coach.html` | Visual 5-chapter Coach manual covering team setup, Squad Triage, Stopwatch, and Family Hub. |
| **[User Manual](docs/USER_GUIDE.md)** | `docs/USER_GUIDE.md` | Complete athlete, coach, and family walkthrough across all workspaces. |
| **[Team Operations Guide](docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md)** | `docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md` | VDOT pods, Delegated Timing (`/time`), External Meet Interop, Family Hub, Comms, Injury Hub & District AD. |
| **[Physiology & Math Reference](docs/PHYSIOLOGY_AND_METRICS.md)** | `docs/PHYSIOLOGY_AND_METRICS.md` | Derivations for Seed-Mark Calibration, Two-Pass `rTSS`, Banister `CTL`/`ATL`/`TSB`, 3-Channel ACWR, Durability & `VDOT`. |
| **[REST API & Security](docs/API_AND_SECURITY.md)** | `docs/API_AND_SECURITY.md` | Multi-Auth, CSRF cookie-nonce flows, `AES-256-GCM` Vault, Clean-Room AI Firewall, Team RBAC & `.ics`/Comms APIs. |
| **[Youth Privacy & SafeSport](docs/SCHOLASTIC_COMPLIANCE.md)** | `docs/SCHOLASTIC_COMPLIANCE.md` | COPPA `<13` hard block, FERPA `photoReleaseOptOut`, SOPIPA, CA AB-1584, and SafeSport MAAPP guardrails. |
| **[Roadmap](docs/ROADMAP.md)** · **[Specs](docs/specs/README.md)** · **[ADRs](docs/adr/001-dual-storage-indexeddb-and-postgres-vault.md)** | `docs/ROADMAP.md` · `docs/specs/` · `docs/adr/` | High-level roadmap linking to [Linear (`MEE`)](https://linear.app/meetready), distilled feature specs, and decision records. |
| **[Legal & Procurement Pack](/procurement)** | `/privacy` · `/terms` · `/subprocessors` · `/procurement` | Privacy Policy, Terms, Subprocessors, CA SDPC NDPA, HECVAT Lite, and flat-rate PO/ASB pricing. |

---

## Quick Start & CI Verification

```bash
# 1. Install dependencies cleanly (Node >= 22.18.0)
npm ci

# 2. Configure .env and generate local session & AES-256-GCM vault secrets
cp .env.example .env
npm run secrets:generate

# 3. Start full-stack Express + Vite development server
npm run dev

# 4. Run full CI-parity verification before pushing
npm run lint && npm run check:brand && npm test && npm run build && npm run check:bundle
SERVE_BUILT_DIST=1 CI=true npx playwright test
```
