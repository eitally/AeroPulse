---
version: 2
slug: "src-components-stravaauthgate-tsx"
primary_target: "src/components/StravaAuthGate.tsx"
related_targets: ["src/App.tsx", "src/components/TracksideStopwatchView.tsx", "src/components/CockpitHeader.tsx", "src/components/AeroPulseLogo.tsx"]
approved_comps: [".impeccable/mocks/comp-1-split-manifesto.jpg", ".impeccable/mocks/comp-cockpit-mondo-chalk.jpg"]
seed: "5561f13e"
---

# Surface Brief: MeetReady Landing & Operate Architecture (`Mondo Clay & Stadium Chalk`)

- **Scope & Mode:** Unauthenticated entry (`src/components/StravaAuthGate.tsx`, Persuade) + authenticated Track & Field / XC Cockpit (`TracksideStopwatchView.tsx`, Operate) unified under **Mondo Clay & Stadium Chalk** (`seed: 5561f13e`, Assigned Index `3`).
- **Approved Comps & Logo:**
  - Logo (`Concept A — Velocity Chevron M`): `/Users/elliottally/.gemini/antigravity/brain/b118f55f-6bcc-48bc-a4be-39ee1c8f6393/logo_concept_a_velocity_chevron_1795383930137.jpg`
  - Persuade Landing (`Comp 1 · Split Manifesto`): `.impeccable/mocks/comp-1-split-manifesto.jpg` (`.json` `"approved": true`)
  - Operate Cockpit (`Comp Cockpit Mondo Chalk`): `.impeccable/mocks/comp-cockpit-mondo-chalk.jpg` (`.json` `"approved": true`)
- **Audience & Policy Constraints:** High school/college/club TF & XC coaches, student athletes, and athletic directors. Single `Schools & ADs` top-nav link (`/for-athletic-directors`); single `Compliance` footer link (`/procurement`) — zero footer duplication. Zero third-party ads/tracking; COPPA 13+ explainer modal; locked `Z1–Z6` physiology colors.

## Implementation Fidelity Inventory

| Comp Region | Visual & Structural Commitment | Implementation Medium |
| --- | --- | --- |
| Brand Mark & Header Wordmark | 2-peak flat interlocking Velocity Chevron `M` (`#121413` + `#B83A24` on light; `#F6F3EC` + `#D8FF2A` on dark) + razor-sharp native browser-hinted `Archivo` ExtraBold `MeetReady` wordmark | Authored inline SVG (`brandVectors.ts` / `ThreshMark`) + native `Archivo` HTML text in `AeroPulseLogo.tsx` (outlined vector paths kept for downloadable print SVGs) |
| Landing Header | Edge-to-edge Stadium Chalk (`#F6F3EC`) / Track Asphalt (`#121413`), `1px` bottom ink rule; right cluster: Theme toggle, `Team Code` pill, single `Schools & ADs` link, `Explore Coach Sample` | Semantic HTML/CSS in `StravaAuthGate.tsx` |
| Hero Field (`60%` Left Top) | Committed **Mondo Clay** (`#B83A24` light / `#9E2E1A` dark) surface with subtle crisp `#F6F3EC` curved oval banking lane arcs (no gradients), zero eyebrow, `Barlow Condensed` ExtraBold `EVERY EVENT. EVERY MARK. ONE TEAM PLATFORM.`, approved subhead, inline trust strip | Semantic HTML/CSS + clean declarative SVG lane geometry (`aria-hidden="true"`) |
| Specimen Dock (`Left Lower`, Overlapping Hero) | Dark Track Asphalt (`#121413`) floating dock overlapping bottom-left edge of Mondo Clay hero (`lg:-mt-16 lg:ml-6`); interactive 2-tab switch (`Trackside Stopwatch` with `01:08.42` + Pod A/B/C split rows; `Pace Pods & Field Sheet` with High Jump / Shot Put / Pole Vault field sheet rows), `#D8FF2A` `Explore Coach Sample →`, `Try Athlete View` | Interactive React state + semantic HTML/CSS in `StravaAuthGate.tsx` |
| Pilot Auth Card (`38%` Right) | `1.5px solid #121413` bordered Stadium Chalk card, `Coach | Athlete` pill toggle, Email + `#D8FF2A` `Continue with Email`, Google + Strava OAuth buttons, compact single-line `No Advertising. Ever. · COPPA 13+` row | Semantic HTML/CSS in `StravaAuthGate.tsx` |
| Benefits Ledger & Footer | Ruled `For Coaches | For Athletes` 2-column matrix beside dock; deduplicated footer (`Guide & Docs`, `Coach Guide`, `Brand & Style Guide`, `Privacy`, `Terms`, `Compliance`, `Safe-Sport Shield`) | Semantic HTML/CSS in `StravaAuthGate.tsx` |
| Operate Cockpit Shell & Stopwatch | Edge-to-edge Stadium Chalk (`#F6F3EC`) / Track Asphalt (`#121413`), flat `#FAF8F4` header with `2.5px #B83A24` active bottom bar, `#121413` master clock housing with `#D8FF2A` tabular digits, `#D8FF2A` `Start / Resume`, crisp `1px` matte white split cards with Infield Pine deltas | Semantic HTML/CSS in `src/index.css`, `CockpitHeader.tsx`, `TracksideStopwatchView.tsx`, `TracksideRunnerCardsAndMatrix.tsx`, `CockpitFooter.tsx` |
