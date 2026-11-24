# MeetReady Workspace Rules

These always-on rules govern all human contributors and Antigravity agents working in this repository.

## Project Stack & Architecture

- **Frontend:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + uPlot + Leaflet + Dexie (`IndexedDB`) + Workbox PWA.
- **Backend:** Express 4 (`server/vercelApp.ts`, bundled for Vercel Serverless to `api/index.js` via `esbuild`; local dev via `tsx server.ts`).
- **Persistence:** Normalized PostgreSQL (`thresh_*` tables, strict TLS `rejectUnauthorized: true`) + `AES-256-GCM` Token Vault (`server/tokenVault.ts`) with `/tmp` encrypted vault fallback in single-instance dev.
- **Testing & Quality Gates:** Vitest (`tests/*.test.ts`) + Playwright (`e2e/*.spec.ts`) + Impeccable static audit + strict bundle/brand CI gates.

## Non-Negotiable Code & Brand Invariants

1. **Canonical Brand Casing (`npm run check:brand`):**
   - Always spell the product **`MeetReady`** in UI copy, docs, comments, and filenames.
   - Never introduce legacy mixed/uppercase brand tokens or old product names in user-facing copy or docs. Keep lowercase `thresh_*` database table names, cookie keys, and `localStorage` keys intact for backwards compatibility.
2. **Canonical Design System (`DESIGN.md`):**
   - Root `DESIGN.md` and `.impeccable/design.json` are the single source of truth (**Mondo Clay `#B83A24`**, **Stadium Chalk `#F6F3EC`**, **Track Asphalt `#121413`**, **Infield Pine `#1E4D36`**, **Starter Volt `#D8FF2A`**).
   - Maintain WCAG 2.1 AA contrast (`>= 4.5:1`), `>= 44px` mobile touch targets (`>= 48px` on Strava OAuth sign-in), `font-mono tabular-nums` on numerical telemetry/splits, and `0` Impeccable anti-patterns.
3. **Performance & Bundle Budgets (`npm run check:bundle`):**
   - Entry chunk: `<= 220 KB` gzip.
   - Critical initial JS + CSS load: `<= 290 KB` gzip.
   - PWA Workbox precache: `<= 1,800 KB` raw.
   - Zero leaked `.env` or screenshot files in `dist/`.
   - Keep eager boot modules (`src/utils/telemetryStorage/`, `src/App.tsx`, `src/hooks/useAthleteCloudSync.ts`, `src/components/AeroPulseLogo.tsx`, `src/components/TracksideLiveHeaderPill.tsx`) decoupled from heavy lazy modules (`stopwatchActivitySynthesizer`, `teamOnboardingEngine`, `teamQrHelper`, `shareWorkoutEngine`).
4. **Structural Ceilings & Domain Slicing:**
   - `src/App.tsx` `<= 2,100` lines; `src/components/TeamManagementPanel.tsx` `<= 1,400`; `src/components/StravaAuthGate.tsx` `<= 1,450`; every `src/components/**` file `<= 2,500`; `CockpitModalsProps` `<= 16` props.
   - Keep `src/types.ts`, `server/routers/teamRouter.ts`, and `src/utils/telemetryStorage.ts` as thin facades (`<= 120` lines). Place new types, team routes, and storage logic inside `src/types/`, `server/routers/team/`, and `src/utils/telemetryStorage/`.
5. **Node 22 Native TypeScript ESM Imports:**
   - `scripts/checkBundleBudget.mjs` directly imports `server/vercelApp.ts` under Node 22. Every relative import/export across `server/`, `src/types.ts`, and `src/types/*.ts` **must** keep explicit `.ts` extensions (`allowImportingTsExtensions: true`).
6. **Security & Youth Safeguarding Guardrails:**
   - Strip 100% of Strava-sourced activities before Google Gemini AI calls or peer views (`server/cleanRoomFirewall.ts`).
   - Enforce COPPA `<13` hard block, conservative `${birthYear}-12` minor checks, immutable minor DOB locks, U18 SafeSport weight shielding, mandatory Parent/Guardian CC (`403` on un-CC'd minor comments), and FERPA `photoReleaseOptOut` album warnings.
   - Never log tokens or PII; never weaken `AES-256-GCM` vault checks or `rejectUnauthorized: true` TLS in production.
7. **Serverless Bundle Hygiene (`api/index.js`):**
   - Only commit rebuilt `api/index.js` when files under `server/` changed. Revert `api/index.js` (`git checkout -- api/index.js`) after docs-only or client-only builds.

## Required Verification Before Pushing

Run all local CI-parity checks on code changes:

```bash
npm run lint
npm run check:brand
npm test
npm run build && npm run check:bundle
SERVE_BUILT_DIST=1 CI=true npx playwright test
```

## Issue Tracking & Specs

- Track work in **Linear** (`https://linear.app/meetready`, team key `MEE`) and reference `Fixes MEE-XX` in commit messages and PRs.
- Keep concise feature specs in `docs/specs/` and architectural decision records in `docs/adr/`. Do not store canonical specs or roadmaps in local agent artifact folders.
