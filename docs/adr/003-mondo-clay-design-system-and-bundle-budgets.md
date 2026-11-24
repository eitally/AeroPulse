# ADR 003: Mondo Clay Design System & Automated Bundle Budgets

**Status:** Accepted  
**Applies To:** `DESIGN.md`, `src/index.css`, `scripts/checkBundleBudget.mjs`, `scripts/checkBrandCasing.mjs`, `vite.config.ts`

## Context

Earlier dark-pine bezel layouts introduced visual clutter at `390px` outdoor trackside viewing, while multi-chart dependencies (`uPlot`, `Leaflet`, Excel/QR helpers) risked inflating initial load times and PWA precache size on stadium LTE connections.

## Decision

1. **Mondo Clay & Stadium Chalk System:** Standardize on edge-to-edge Stadium Chalk (`#F6F3EC`) / Track Asphalt (`#121413`), Mondo Clay (`#B83A24`), restrained Starter Volt (`<= 5%`), zero `backdrop-filter: blur()`, orthogonal flat controls, `font-mono tabular-nums`, and locked `Z1–Z6` / Banister semantics ([`DESIGN.md`](../../DESIGN.md)).
2. **Hard Automated CI Budgets:** Every build runs `scripts/checkBundleBudget.mjs` and `scripts/checkBrandCasing.mjs`, failing CI if entry JS exceeds `220 KB` gzip, critical initial JS+CSS exceeds `290 KB` gzip, Workbox PWA precache exceeds `1,800 KB` raw, Node 22 fails to import `server/vercelApp.ts`, or mixed-case brand casing leaks exist.

## Consequences

- Heavy workspace tabs (`Workouts`, `MeetDay`, `FitnessHealthView`, `CalendarView`, `BrandGuidePage`) load lazily and stay listed in `workbox.globIgnores` when non-essential offline.
- Eager boot files (`src/App.tsx`, `src/utils/telemetryStorage/`, `src/hooks/useAthleteCloudSync.ts`, `src/components/AeroPulseLogo.tsx`, `src/components/TracksideLiveHeaderPill.tsx`) must never statically import heavy lazy engines (`tests/sprint6HygieneAndA11yGuard.test.ts`).
