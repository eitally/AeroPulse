---
name: new-feature-spec
description: >-
  Workflow for planning, specifying, modularizing, testing, and shipping a new MeetReady feature or epic tracked in Linear.
---

# New MeetReady Feature Workflow

Follow this procedure when designing and implementing a feature or epic:

## 1. Link & Frame in Linear

- Create or locate the `MEE-XX` issue in the MeetReady Linear workspace (`https://linear.app/meetready`), move it to `In Progress`, and assign labels (`mobile`, `backend`, `ux`, `architecture`, `docs`, `gtm`).

## 2. Write a Concise Git-Tracked Spec

- Add `docs/specs/<feature-slug>.md` using the template in `docs/specs/README.md` (`80–150` lines max).
- Record non-trivial data-model, storage, compliance, or architecture trade-offs in `docs/adr/NNN-<decision>.md`.

## 3. Implement in Domain Modules

- **Types:** Add contracts to `src/types/<domain>.ts` (re-exported via `src/types.ts`). Include explicit `.ts` extensions on relative imports/exports.
- **Client storage & sync:** Add helpers under `src/utils/telemetryStorage/<domain>.ts` (re-exported via `src/utils/telemetryStorage.ts`), keeping eager files decoupled from heavy lazy modules.
- **Server routes & services:** Add routes under `server/routers/team/<domain>Router.ts` (or a domain router mounted in `server/apiRouter.ts`) and keep business logic in `server/*Service.ts`. Use explicit `.ts` extensions.
- **UI & Design:** Follow root `DESIGN.md` (*Mondo Clay & Stadium Chalk*) and enforce `>= 44px` touch targets, `font-mono tabular-nums` metrics, SafeSport MAAPP / FERPA rules, and Clean-Room Strava boundaries.

## 4. Test & Verify

- Add targeted unit tests in `tests/` and interactive E2E assertions in `e2e/`.
- Execute the `ci-verify` skill (`npm run lint`, `npm run check:brand`, `npm test`, `npm run build && npm run check:bundle`, and `SERVE_BUILT_DIST=1 CI=true npx playwright test`).

## 5. Commit, Push & Close Issue

- Reference the Linear key in the commit subject: `feat(scope): short summary (Fixes MEE-XX)`.
- Push to `main`, confirm green GitHub Actions (`verify` + `postgres-integration`), and close `MEE-XX` in Linear.
