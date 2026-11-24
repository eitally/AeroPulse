# MeetReady GTM Positioning, Pricing & Coach Research Reference

**Status:** Active Reference | **Scope:** GTM, Brand Positioning & Coach/Athlete Field Research

This reference distills durable market positioning, pricing, FERPA/COPPA attribution boundaries, print fabrication specs, competitive strategy, and track coach/athlete research for MeetReady. All visual tokens follow the canonical **Mondo Clay & Stadium Chalk** design system in [`DESIGN.md`](../../DESIGN.md).

---

## 1. Market Positioning & Product Lane Separation

- **Track & Field + Cross Country First:** Lead **100%** of external marketing, landing heroes, OpenGraph previews, clinic handouts, banners, and Athletic Director materials with **Track & Field + Cross Country**. Scope solo distance/cycling telemetry quietly to Personal/Multi-Sport mode and technical documentation rather than the front door or Coach Playbook.
- **Canonical 5-Word Tagline:** **`Faster teams. Safer seasons. Watchless.`**
- **Banner & Apparel Slogan:** **`EVERY SPLIT. ZERO WATCHES.`** *(Trackside fence variant: **`0.01s SPLITS. ZERO WATCHES.`**)*
- **Canonical Visual Direction ([`DESIGN.md`](../../DESIGN.md)):**
  - **Surfaces & Accents:** Mondo Clay (`#B83A24`), Stadium Chalk (`#F6F3EC`), Track Asphalt (`#121413`), Infield Pine (`#1E4D36`), Starter Volt (`#D8FF2A` rationed strictly to `<= 5%` of viewport for primary triggers and live clock digits).
  - **Primary Mark:** Flat two-ink **Velocity Chevron `M`** paired with monolithic `Archivo` / outlined `<path>` `MeetReady` typography and orthogonal `OPERATE` workspace chrome (`Z1–Z6` physiological zones remain invariant across team co-branding).

---

## 2. Transparent Pricing & Audience Hooks

| Tier / Role | Published Pricing | Source / Route |
| :--- | :--- | :--- |
| **Individual Athletes & Parents** | **`$0` forever** (zero ads, no watch required) | Landing & `/join/:slug` |
| **Founding Season Pilot (Teams)** | **`$0` first season** | Landing & `/for-athletic-directors` |
| **High School / Club PO** | **`$250/yr` flat per program** | [`/procurement`](https://meetready.app/procurement) |
| **Collegiate Program PO** | **`$1,200/yr` flat** | [`/procurement`](https://meetready.app/procurement) |
| **School District License** | **`$2,000/yr` flat** | [`/procurement`](https://meetready.app/procurement) |

### Core Messaging Hooks by Persona
- **Track & XC Coaches:** Turn any phone into an offline `0.01s` multi-runner stopwatch, auto-group rosters into ability pace pods, print 4-up clipboards in 60 seconds, and run 1-tap practice roll call and delegated meet passes—without requiring student GPS watches.
- **Student-Athletes & Families:** No GPS watch or Strava account required. See timed track splits, daily pace groups, official meet PRs, schedule `.ics` updates, and Guardian-CC'd coach notes in an ad-free app (`$0`).
- **Athletic Directors & District IT:** Built around public district reality: `$250/yr` flat annual PO (`procurement@meetready.app`), zero third-party ad trackers, COPPA `<13` hard block, FERPA `photoReleaseOptOut` album guardrails, CA SDPC NDPA readiness, and SafeSport MAAPP parent-CC enforcement.

---

## 3. Competitive Landscape & Defensible Moat

| Platform | Core Strength | Fatal Gap for Track & XC Teams |
| :--- | :--- | :--- |
| **Athletic.net / MileSplit** | Meet entries, rankings, official results archives | Zero daily training plans, zero live infield multi-runner stopwatch, zero readiness/injury triage |
| **Final Surge / V.O2** | Structured distance plans & GPS watch push | Watch-heavy distance bias; thin sprint/hurdle/field workflows and offline multi-lane track timing |
| **TeamSnap / sportsYou / BAND / Remind** | Team messaging, RSVP, basic schedules | Zero watchless `0.01s` timing, zero pace pods, zero physiology or event-group training plans |
| **Splitly / AthletiFlow** | Standalone multi-runner timing helpers | Thin physiology/ACWR injury prevention, no district compliance stack or wearable 1Hz telemetry fusion |
| **Intervals.icu / TrainingPeaks** | Deep solo `CTL/ATL/TSB` and duration curves | Built for watch/power-meter self-coached adults; no watchless HS rosters, trackside stopwatch, or COPPA/FERPA/MAAPP controls |

### Why Schools & Coaches Adopt MeetReady
1. **No Mandatory Watches or Student Strava:** Roughly `70–85%` of high school track athletes do not wear GPS watches, and many parents/districts restrict social fitness networks for minors.
2. **District Procurement & SafeSport Reality:** Districts buy on annual Purchase Orders gated on W-9 / SDPC NDPA paperwork, Athletic Trainer RBAC isolation, and **SafeSport MAAPP** rules prohibiting private 1-on-1 adult-to-minor direct messages without guardian visibility.
3. **Whole-Program Coverage:** Head Track Coaches need one system covering sprints, hurdles, distance, jumps, pole vault, throws, and multis alongside assistant coaches—and **solo athletes keep full `1Hz` physiology analytics without any regression**.

---

## 4. Privacy-First Attribution & Paid Social Guardrails

> [!CAUTION]
> **FERPA / COPPA / CA NDPA Red Line:** **NEVER** install Meta Pixel, TikTok Pixel, or third-party ad retargeting scripts on `/join/*`, `/team/*`, `/share/*`, or authenticated app routes. A single third-party ad tracker firing on a student route invalidates district NDPA review and contradicts MeetReady's zero-advertising commitment.

- **Approved Privacy-Safe Attribution Stack (configured in [`vercel.json`](../../vercel.json)):**
  1. **Short Vanity QR & Ad Redirects:** Keep printed QRs compact and scannable via `/demo`, `/ad`, `/meet`, `/clinic`, `/flyer`, `/sticker`, `/tee`, `/go/clipboard`, and `/share`.
  2. **First-Party Coach UTM Capture:** Capture URL attribution strictly on adult Coach team creation flows (`sessionStorage` → team setup metadata), never attached to student/minor athlete accounts.
  3. **Coach Self-Reported Source:** Use lightweight onboarding source pills (`Instagram/FB`, `Google`, `Coach/Friend`, `Meet/Clinic`, `Athletic.net`) to measure dark-social coach referrals.
- **Paid Social In-App WebView Rule:** Instagram, Facebook, and TikTok mobile WebViews block Google OAuth (`disallowed_useragent`). Always route paid social creatives to the live Coach Demo (`/demo`) or Email Magic Link first rather than dead-ending on Google OAuth.
- **Search Negative Keywords:** Exclude cycling/watch-required queries (`-cycling`, `-zwift`, `-bike`, `-garmin watch`, `-smartwatch`, `-apple watch`) on Team Coach campaigns.

---

## 5. Print, Apparel & Stadium Fabrication Rules

All exported SVG print masters and physical collateral must meet shop and stadium-sunlight constraints:
1. **Pure Outlined Geometry:** Zero `<text>` elements, unexpanded strokes, or brittle `<mask>`/`<clipPath>` hacks in print SVGs/PDFs/EPS masters.
2. **Full-Bleed Opaque App Icons:** Export `apple-touch-icon.png` and store/PWA tiles completely opaque edge-to-edge—never leave transparent corners that iOS fills black inside its squircle mask.
3. **Stadium-Sun QR Reliability:** Always print high-contrast pure dark `#000000` / `#121413` QR matrices at **EC-M or EC-Q (`15%–25%`)** error correction on a solid matte `#FFFFFF` card (`>= 4-module` quiet zone). Never invert QRs (bright ink on dark fabric/vinyl) because mobile cameras fail in bright stadium sun.
4. **Embroidery & Apparel Floors:** Keep embroidery satin stitch columns **`>= 1.2 mm`** (`1.0 mm` hard floor), clearances `>= 1.0 mm`, minimum letter height `0.25"`, and respect **NFHS/NCAA `<= 2.25 sq in`** chest mark limits on competition gear.
5. **High-Leverage Trackside Distribution Loops:**
   - Print a compact viral mini-QR (`meetready.app/go/clipboard`) in the footer of the **4-Up Printable Trackside Clipboard** seen by opposing staffs at meets.
   - Print the acquisition QR (`meetready.app/sticker`) on the **peel-off sticker liner backing** rather than crowding die-cut athlete stickers with marketing URLs.
   - Use **13oz Matte 70/30 Wind-Slit Mesh Vinyl** for fence banners to avoid sun glare and wind-sail tearing, and **5.5" × 8.5" 14pt clipboard stuffers** for clinics.

---

## 6. Coach & Athlete Field Research Takeaways (Product Guardrails)

These field findings govern ongoing UI work (including [`CoachSimplificationSpec`](coach-simplification-and-team-comms.md)):
- **Full 8-Event-Group Support:** Model `SPRINTS`, `HURDLES`, `MID_DISTANCE`, `DISTANCE`, `JUMPS`, `POLE_VAULT`, `THROWS`, and `MULTI` without assuming every untagged athlete runs cross country or 5K intervals.
- **Progressive Disclosure Without Athlete Regression:** Keep Coach **Home** scannable at first glance (1. Quick links to panels, 2. Alerts & conflicts, 3. Messaging) with **Workouts**, **Meets & Plan**, **Timing**, and **Team** cleanly separated—while leaving personal Athlete tabs (`Today`, `Calendar`, `Log`, `Progress`) in full `1Hz` physiology depth.
- **One-Handed Outdoor Field Ergonomics:** Enforce `>= 44px` tap targets, sticky sunlit-readable master stopwatch clock, chute queue anti-bounce guards, default audible lap confirmation on iOS (where vibration APIs are unsupported), search/heat filtering for `60+` runner rosters, and durable offline syncing on spotty stadium connections.
