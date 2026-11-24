# Contributing to MeetReady

Welcome! This guide covers local setup, code organization, verification gates, and how we coordinate work across contributors and AI agents.

---

## 1. Prerequisites & Local Setup

- **Node.js:** `>= 22.18.0` (matches `.github/workflows/ci.yml` and Vercel Node 22 runtime)
- **Package Manager:** `npm` (`package-lock.json` is the sole supported lockfile)

```bash
# 1. Install dependencies cleanly
npm ci

# 2. Copy environment template and generate local 256-bit cryptographic secrets
cp .env.example .env
npm run secrets:generate

# 3. Start full-stack Express + Vite development server
npm run dev
```

For quick demo inspection without OAuth keys, open `http://localhost:3000/?demo=1`.

---

## 2. Where New Code Belongs

To prevent merge conflicts across contributors, follow MeetReady's domain slices rather than appending to legacy barrels:

- **Types:** Add contracts to the matching file under `src/types/` (`telemetry.ts`, `workouts.ts`, `scholastic.ts`, `timing.ts`, `commsAndEvents.ts`, `team.ts`) and ensure `src/types.ts` re-exports it. Always use explicit `.ts` extensions on relative imports inside `src/types/`.
- **Client Storage & Sync:** Add helpers to the matching file under `src/utils/telemetryStorage/` (`profileCalibration.ts`, `snapshotStore.ts`, `activityMerge.ts`, `wellnessRecompute.ts`, `clientSessionStorage.ts`). Keep eager modules free of heavy lazy imports.
- **Backend Routes:** Add endpoints under `server/routers/team/` (or a domain router in `server/routers/`), keeping business logic inside `server/*Service.ts`. Always use explicit `.ts` extensions inside `server/`.
- **Design & Copy:** Match canonical tokens in [DESIGN.md](./DESIGN.md) (*Mondo Clay & Stadium Chalk*) and always spell the brand `MeetReady`.

---

## 3. Required Verification Gates

Run all local checks before opening a PR or pushing to `main`:

```bash
# 1. Typecheck + canonical brand casing check
npm run lint && npm run check:brand

# 2. Unit & security test suites
npm test

# 3. Production build + <220KB entry / <290KB initial / <1,800KB precache + Node 22 ESM server check
npm run build && npm run check:bundle

# 4. Full Playwright desktop & mobile E2E suite in CI-parity mode
SERVE_BUILT_DIST=1 CI=true npx playwright test
```

> **Serverless Bundle Tip:** `npm run build` refreshes `api/index.js`. If your changes only touched `src/`, `docs/`, or `tests/` (not `server/`), run `git checkout -- api/index.js` before committing so diffs stay noise-free.

### Running PostgreSQL Integration Tests Locally

```bash
NODE_ENV=test \
  DATABASE_URL=postgres://meetready:meetready_ci_password@127.0.0.1:5432/meetready_test \
  SESSION_SECRET=ci_postgres_test_session_secret_0123456789abcdef \
  TOKEN_VAULT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  npx vitest run tests/sprint0SecurityAndReliability.test.ts tests/vaultAndCleanRoom.test.ts
```

---

## 4. Issue Tracking, Specs & PR Conventions

- **Canonical Tracker:** [Linear — MeetReady (`MEE`)](https://linear.app/meetready). Move your issue to `In Progress` when starting work.
- **Commit & PR Linking:** Reference the Linear key in commit messages and PR titles (`feat(coach): add split CSV filter (Fixes MEE-42)`).
- **AI Collaboration & Operations Guides:**
  - Read [AI Collaboration Guide](docs/AI_COLLABORATION_GUIDE.md) for prompting templates, slash commands (`/plan`, `/grill-me`, `/teamwork`, `/goal`), swarm rules, and unattended overnight runs.
  - Consult [Production Setup Runbook](docs/runbooks/production-setup.md) for Resend DNS, Vercel Production environment variables, and `procurement@meetready.app` vendor readiness.
- **Durable Specs & Decisions:**
  - Write concise feature specs (`80–150` lines) in `docs/specs/` before major UI or backend changes.
  - Record cross-cutting architectural or compliance decisions in `docs/adr/`.
  - Keep session artifacts/screenshots ephemeral — never treat local agent folders as repository truth.
