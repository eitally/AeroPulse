---
name: ci-verify
description: >-
  Run MeetReady's full CI-parity verification suite locally and validate GitHub Actions checks after pushing.
  Use before committing or pushing code changes, or when diagnosing CI failures.
---

# MeetReady CI-Parity Verification

Execute these steps in order to match `.github/workflows/ci.yml`:

## 1. Static Typecheck & Brand Casing

```bash
npm run lint
npm run check:brand
```

Fix any TypeScript error or mixed-case brand leak before running tests.

## 2. Unit & Security Suites

```bash
npm test
```

If local PostgreSQL is available (matching CI service `postgres:16-alpine`), also verify the Postgres integration suites:

```bash
NODE_ENV=test \
  DATABASE_URL=postgres://meetready:meetready_ci_password@127.0.0.1:5432/meetready_test \
  SESSION_SECRET=ci_postgres_test_session_secret_0123456789abcdef \
  TOKEN_VAULT_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  npx vitest run tests/sprint0SecurityAndReliability.test.ts tests/vaultAndCleanRoom.test.ts
```

## 3. Production Build, Bundle Budget & Node ESM Smoke Check

```bash
npm run build && npm run check:bundle
```

Confirm all four gates pass:
- Entry JS gzip `<= 220 KB`
- Critical initial JS + CSS gzip `<= 290 KB`
- Workbox PWA precache raw `<= 1,800 KB`
- Both `server/vercelApp.ts` (Node 22 native TypeScript ESM) and `api/index.js` boot and respond HTTP `200` on `/api/strava/auth/url`.

Check whether `server/` actually changed:

```bash
git status -s api/index.js
```

If `server/` was untouched, discard build timestamp noise with `git checkout -- api/index.js`.

## 4. CI-Parity Playwright E2E Suite

Run Playwright against the built `dist/` bundle with CI retry/worker parity:

```bash
SERVE_BUILT_DIST=1 CI=true npx playwright test
```

Every test for desktop and mobile viewports must exit `0` failures.

## 5. Post-Push GitHub Actions Check

After `git push origin main`, confirm both `verify` and `postgres-integration` pass:

```bash
gh run list --limit 3
gh run watch <run-id> --exit-status
```
