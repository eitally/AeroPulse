# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

THRESH serves two co-equal primary user groups:

1. **Self-coached endurance runners and cyclists** managing daily autonomic readiness, training load progression, threshold calibration, fatigue durability, structured workout planning, and race-day pacing/fueling across desktop and mobile web.
2. **High school, NCAA collegiate, and club coaches plus their student-athletes** running team onboarding, squad-wide workout prescription, watchless trackside split timing, official meet result indexing, youth safeguarding, and compliance tracking in one shared workspace.

## Product Purpose

THRESH unifies laboratory-grade endurance physiology, closed-loop daily workout adaptivity, and scholastic/collegiate team operations in a single installable web application and desktop cockpit. It exists so athletes and coaching staffs do not have to stitch together separate analytics charts, static training calendars, pace spreadsheets, and team communication sheets.

Success means:
- Individual athletes sign in with one click via Strava, see honest physiological calibration without fabricated metrics, and know how to adjust today's session and week's load before stepping out the door.
- Coaches onboard a full varsity/JV/club roster in minutes via QR sheet or CSV, prescribe one workout that automatically scales across ability pods, time spiked track sessions without GPS watches, and protect athlete health and regulatory compliance automatically.

## Positioning

Neighboring platforms isolate either raw telemetry charts (e.g., power/load curves without team operations or closed-loop daily workout morphing), social activity feeds (Strava without Banister load, orthopedic guardrails, or coaching pods), or basic team calendars (without 1Hz stream physics, durability curves, or automatic Strava roster claim matching).

THRESH combines in one workflow:
- **Athlete-controlled, read-only Strava identity** with explicit sync windows (`90d`, `6mo`, `Full Archive`, or `Identity Only — 0 Workouts`) and optional Garmin Connect / Intervals.icu overnight wellness enrichment.
- **Multi-system load & durability modeling**: Banister `42d CTL` / `7d ATL` / `TSB`, two-pass calibrated running `rTSS`, Monod-Scherrer `CP` / `W'`, Skiba 1Hz `W' Balance`, `0–40 kJ/kg` & `0–2,000 kcal` fatigue-sliced durability, 3-channel orthopedic load guardrails (Central / Run Impact / Bike Torque), and weekly training Git-diffs (`- Original / + Proposed`).
- **Trackside & scholastic execution**: `/join/<slug>` printable locker-room QR posters, CSV roster auto-matching on Strava sign-in, auto-scaled Jack Daniels `VDOT` pacing pods (`Pods A–D`), a watchless `0.01s` multi-athlete split stopwatch, 1Hz unstructured "forgot-to-lap" interval recovery, NCAA indoor flat/banked/altitude conversions, GPS-to-official chip/FAT rubber-banding (`THV-...` race passports), U18 Safe-Sport weight shielding, and NCAA 20-Hour CARA compliance audits.

## Operating Context

- **Morning check-in (mobile PWA or desktop)**: Athletes check overnight readiness (`HRV rMSSD`, `Resting HR`, `Sleep Score`, `TSB`) and review or commit adaptive workout modulations (`Optimal Progression`, `Modulated Aerobic -15%`, or `Active Recovery`) and weekly load diffs.
- **Post-workout & race lab (desktop & tablet)**: Athletes and coaches inspect synchronized 1Hz streams (Power, HR, Pace, Cadence, Altitude, `W' Balance`), drag-and-drop local `.fit` / `.fit.gz` / `.gpx` / `.tcx` / `.zip` files, recover unlapped track intervals, model 5-segment course physics and dual-source carb/sodium fueling, and log verified `0.01s` FAT results from Athletic.net, TFRRS, MileSplit, or RunSignup.
- **Locker room & trackside oval (mobile, clipboard, & print)**: Coaches post printable `/join/<slug>` QR sheets, import preseason `.CSV` rosters (`Name, Email, Phone, Squad, GradYear, ParentEmail, SeedMark`), print pod split sheets (`200m`–`1600m`), and tap `0.01s` multi-runner splits at the finish line when athletes race or train in spikes without GPS watches.

## Capabilities and Constraints

- **Strava-first read-only identity**: Strava OAuth 2.0 is the sole primary sign-in identity (deterministic HMAC session binding + `AES-256-GCM` encrypted token vault with serverless cookie backup and optional PostgreSQL persistence). THRESH never writes to, modifies, or posts on an athlete's Strava account.
- **Clean-Room Strava API firewall**: Third-party `'Strava'`-only raw activity payloads are stripped before building Google Gemini AI prompts or exposing peer teammate views (`server/cleanRoomFirewall.ts`). Peer teammates never receive another athlete's raw Strava activities.
- **Optional secondary wellness connectors**: Garmin Connect and Intervals.icu are strictly optional add-ons for overnight `HRV rMSSD`, `Sleep Score`, `Resting HR`, and wellness metadata—never required to onboard or use THRESH. Multi-source activities within `±5 minutes` deduplicate automatically so `TSS` is never double-counted.
- **Honest Day-1 calibration**: New accounts with zero workouts render an explicit `CALIBRATING` state and never fabricate synthetic `CTL`, `FTP`, or resting HR numbers.
- **Athlete-controlled coach sharing & youth safeguarding**: Team athletes explicitly select their `CoachDataSharingTier` (`SUMMARY_ONLY`, `FULL_STREAMS`, or `LOAD_ONLY`). `HIGH_SCHOOL` rosters default U18 Safe-Sport weight shielding (`isMinorU18: true`) and Parent/Guardian CC `ON`; `COLLEGIATE` rosters default standard college grad years to adult settings unless an incoming U18 recruit year is specified.
- **Strict performance & security gates**: Production builds (`npm run build && npm run check:bundle`) enforce a hard `< 220 KB` gzipped ceiling on the entry JS chunk (`scripts/checkBundleBudget.mjs`), zero leaked `.env` or screenshot files in `dist/`, and zero hardcoded personal API credentials.
- **Canonical domain terminology**: Preserve exact physiological and regulatory terms (`CTL`, `ATL`, `TSB`, `TSS`, `rTSS`, `NP`, `IF`, `EF`, `Pa:Hr`, `CP`, `W'`, `VDOT`, `FAT`, `ACWR`, `CARA`, `RED-S`) rather than paraphrasing them into vague fitness jargon.
- **Undecided product facts**: Commercial model, pricing tiers, billing, and school/club licensing terms are **explicitly undecided (pre-monetization)**. Future product surfaces and copy must not invent prices, subscription tiers, free-trial claims, or commercial packaging.

## Brand Commitments

- **Canonical name**: **THRESH** (tagline in app metadata: *THRESH — Run & Ride Readiness*). Retire legacy `AeroPulse` naming in all user-facing copy, UI labels, and documentation (retaining internal legacy cache/storage cleanup keys only where required for backwards compatibility).
- **Shipped brand marks**: Preserve the existing THRESH brand lockups and icon assets in `public/brand/thresh-lockup-dark.svg`, `public/brand/thresh-lockup-light.svg`, `public/brand/thresh-1ink-stencil.svg`, `public/brand/thresh-sticker-diecut.svg`, `public/icon.svg`, and `src/components/AeroPulseLogo.tsx`.
- **Partner & trust commitments**: Honor official Strava connect button prominence (`>= 48px` height) and the explicit read-only Strava pledge during onboarding.
- **Voice**: Direct, physiologically precise, coach-credible, and calm under fatigue or injury risk—never alarmist, gamified hype, or generic wellness fluff.

## Evidence on Hand

- **Shipped brand & icon assets**: `public/brand/*.svg`, `public/icon.svg`, `public/apple-touch-icon.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/pwa-maskable-512x512.png`.
- **Shipped product & technical documentation**:
  - Standalone searchable documentation portal: `public/docs/index.html`
  - In-app interactive guide & formula cards: `src/components/UserGuideModal.tsx`
  - Reference manuals: `docs/USER_GUIDE.md`, `docs/SCHOLASTIC_AND_COLLEGIATE_GUIDE.md`, `docs/PHYSIOLOGY_AND_METRICS.md`, `docs/API_AND_SECURITY.md`, `docs/DESIGN_SYSTEM.md`
- **Explicit absences (do not fabricate)**: No external athlete or coach testimonials, named school/university customer logos or endorsements, aggregate user/workout count claims, press mentions, clinical/medical certifications, or pricing/plan comparisons exist.

## Product Principles

1. **Physiological honesty over synthetic polish**: Show real calibration state, real data provenance, and transparent mathematical derivations rather than invented readiness scores or placeholder numbers.
2. **Equal respect for solo mastery and team operations**: Every workflow must remain effortless for an individual self-coached athlete while scaling cleanly to an 80-athlete scholastic or collegiate roster.
3. **Athlete agency and youth safety by default**: Give athletes explicit control over sync history and coach data-sharing tiers, enforce Strava clean-room boundaries, and shield U18 minors from weight-centric pressure automatically.
4. **Trackside and cockpit speed**: Critical actions—tapping `0.01s` splits in spikes, scanning a locker-room QR poster, or checking morning workout modulation—must stay fast, offline-resilient, and within the `< 220 KB` gzip bundle budget.

## Accessibility & Inclusion

- **WCAG 2.1 AA contrast standard**: All status pills, telemetry labels, and custom school/club team co-branding colors enforce WCAG 2.1 AA contrast clamping across light and dark modes.
- **Field & mobile touch ergonomics**: Interactive controls, mobile navigation, and trackside split buttons enforce `>= 44px` minimum touch targets (`>= 48px` on primary Strava OAuth sign-in) for one-handed outdoor and trackside use.
- **Safe-Sport & RED-S safeguarding**: U18 high school rosters shield body-weight fields and power-to-weight (`W/kg`) emphasis by default to support healthy youth athlete development.
- **Bilingual measurement parity**: First-class support for both imperial (`mi / lbs`) and metric (`km / kg`) units, auto-detected from Strava and switchable per athlete.
