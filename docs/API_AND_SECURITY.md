# THRESH v2.3 — REST API, Strava OAuth Identity, Webhooks & Security Architecture

This document covers the server-side architecture of **THRESH v2.3**, including Strava-first deterministic session identity, CSRF-protected OAuth handshakes, the `AES-256-GCM` OAuth Token Vault, Clean-Room Provider Firewall, multi-team safeguarding & coach sharing tiers, physiological calculation endpoints, and hardware webhooks.

---

## 1. Identity, Session & Clean-Room Security Architecture

### 1.1 Strava-First Deterministic Session Identity (`server/securityUtils.ts` & `server/apiRouter.ts`)
- **Primary Identity**: Strava OAuth 2.0 is the sole primary sign-in identity for individual athletes, coaches, and team members.
- **Deterministic Cross-Device Vault Binding**: Upon verified Strava authentication, `deriveStravaSessionSid(athleteId)` computes `strv_<HMAC-SHA256(athleteId, SESSION_SECRET)[0..28]>` and binds an `HttpOnly`, `SameSite=Lax`, HMAC-signed `thresh_session` cookie (plus header token `x-session-token` for strict cookie-blocked webviews). Signing in with Strava on a laptop and later on iOS Safari automatically re-attaches the athlete's encrypted vault and team memberships.
- **Account-Switch IndexedDB Wipe**: On the client, `reconcileStoreOwnerAthleteId` tracks the authenticated Strava `athleteId` and purges local IndexedDB (`Dexie`) + cached team state if a different Strava athlete signs in on a shared computer.

### 1.2 HMAC-Signed OAuth CSRF State (`issueOAuthStateToken` / `verifyOAuthStateToken`)
- `GET /api/strava/auth/url` generates a short-lived (`20 min`) HMAC-SHA256 signed `state` token containing `{ nonce, sid, joinCode, slug, exp }` and sets an `HttpOnly` `thresh_oauth_state` cookie.
- `/api/strava/callback` verifies the cryptographic signature, expiration, and cookie binding before exchanging any authorization `code`, preserving `/join/<slug>` and Team Code claims across popup and full-page mobile redirects.
- User cancellation (`error=access_denied`) renders a clean branded THRESH response and auto-closes popup windows via `postMessage`.

### 1.3 `AES-256-GCM` OAuth Token Vault & Serverless Persistence (`server/tokenVault.ts`)
- Encrypts Strava, Garmin Connect, and Intervals.icu credentials at rest using `AES-256-GCM` (`96-bit` random IV + `128-bit` auth tag).
- Unified secret key resolution: `TOKEN_VAULT_KEY || OAUTH_ENCRYPTION_KEY || SESSION_SECRET` (generate production 256-bit keys via `npm run secrets:generate`).
- **Dual-Layer Persistence**: Writes asynchronously to PostgreSQL (`thresh_kv_store` JSONB when `DATABASE_URL` / `POSTGRES_URL` is configured) AND mirrors a compact `AES-256-GCM` `HttpOnly` `thresh_vault` backup cookie so credentials survive cold starts even on zero-database serverless deployments.
- **Zero Hardcoded Personal Keys**: No personal Garmin Connect API tokens or OAuth secrets exist in source code; optional developer `.env` fallbacks require `ALLOW_DEV_ENV_CREDENTIALS=true`.

### 1.4 Clean-Room Provider Firewall (`server/cleanRoomFirewall.ts`)
- Enforces **Strava API Agreement** compliance by stripping third-party `'Strava'`-only raw activity payloads before constructing Google Gemini AI prompts or exposing peer teammate views, while enforcing athlete-selected Coach Data Sharing Tiers (`SUMMARY_ONLY` | `FULL_STREAMS` | `LOAD_ONLY`).

---

## 2. REST API Endpoints

### 2.1 Strava OAuth, Sync Policy & Secondary Connections (`server/apiRouter.ts`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/config/status` | Returns active session identity (`stravaConnected`, `stravaAthleteId`, `stravaMeasurementPreference`, `stravaGrantedScope`, `stravaSyncPolicy`) and optional `garminConnected` / `intervalsConnected` status. |
| `GET` | `/api/strava/auth/url` | Mints CSRF-signed Strava OAuth URL (`activity:read_all,profile:read_all`) and sets `thresh_oauth_state` cookie. |
| `GET` | `/api/strava/callback` | Validates signed `state`, exchanges code, activates canonical Strava session (`activateStravaCanonicalScope`), migrates any pre-created teams, and returns branded popup/redirect completion HTML. |
| `GET` | `/api/strava/auth/poll` | Verified signed-`state` fallback poll for strict mobile/Safari COOP popup contexts. |
| `POST` | `/api/strava/sync-policy` | Saves the athlete's explicit Strava sync choice (`window: '90d' \| '180d' \| '365d' \| 'all' \| 'none'`, `includeGearAndProfile`). |
| `GET` | `/api/strava/sync` | Syncs Strava activities within `?window=...` using `after` epoch pagination, unchecked-scope protection (`missingActivityScope`), and two-pass calibrated running `rTSS` + `efficiencyFactor`. |
| `POST` | `/api/strava/disconnect` | Revokes Strava tokens from the encrypted vault and clears session cookies. |
| `POST` | `/api/garmin/disconnect` | Granularly disconnects optional Garmin Connect credentials without signing out of Strava identity. |
| `POST` | `/api/auth/logout` | Clears server vault/session cookies for clean sign-out. |

### 2.2 Multi-Team, CSV Invites & Coach Broadcast Router (`server/routers/teamRouter.ts`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/teams` | Lists caller's active teams projected according to role (`HEAD_COACH`, `ASSISTANT_COACH`, `ATHLETE`), U18 Safe-Sport shield, and `sharingTier`. |
| `POST` | `/api/teams` | Creates a branded school/club workspace with WCAG-clamped palette, Join Code, and `/join/<slug>`. |
| `GET` | `/api/teams/join-preview` | Public preview of team branding and safeguarding settings for `/join/<slug>` or 6-char Join Code (read-only `?peek=1` supported). |
| `POST` | `/api/teams/join-claim` | Claims team membership for the authenticated Strava athlete, auto-matching pending CSV roster invites by token, Strava ID, email, or name. |
| `POST` | `/api/teams/:teamId/invites/bulk` | Imports CSV/spreadsheet roster rows with U18 safeguarding defaults and optional Resend branded email + Parent/Guardian CC. |
| `POST` | `/api/teams/:teamId/workouts/broadcast` | Pushes structured workouts to an entire squad pod or targeted `targetMembershipIds`. |

### 2.3 Vault, Physiology, Webhooks & OTA Workout Export

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/vault/status` | Returns encrypted provider connection metadata with zero raw token leakage. |
| `POST` | `/api/physiology/mmp-debrief` | Computes 1Hz Empirical MMP/GAP (`CP/W'`), 3-Channel Orthopedic Load, and 30s Post-Workout Debrief. |
| `POST` | `/api/physiology/durability` | Computes `0–40 kJ/kg` (Cycling) or `0–2,000 kcal` (Running) fatigue-sliced durability. |
| `POST` | `/api/physiology/race-simulator` | Computes 5-segment Course Physics, Weather/Altitude & Carb/Sodium Race Simulation. |
| `POST` | `/api/physiology/race-passport` | Rubber-bands GPS splits to certified course distance and mints `THV-...` Verified Passports. |
| `POST` | `/api/webhooks/:provider` | First-party hardware webhook ingestion for `garmin`, `wahoo`, `coros`, `polar`, `oura`, `whoop`, and `apple-healthkit`. |
| `POST` | `/api/workouts/export` | Compiles Intervals-syntax workouts into `WORKOUTKIT_JSON`, `GARMIN_TRAINING_JSON`, `ZWO`, or `ERG`. |

---

## 3. Environment Variables & Production Quality Gates

- **Required for Hosted OAuth**: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_VAULT_KEY` (or `OAUTH_ENCRYPTION_KEY`).
- **Recommended for Persistent Multi-Device Teams**: `DATABASE_URL` (PostgreSQL).
- **Optional**: `RESEND_API_KEY` (direct team invite emails), `GEMINI_API_KEY` (live AI Coach), `GARMIN_OAUTH_CONSUMER_KEY` / `GARMIN_OAUTH_CONSUMER_SECRET` (custom Garmin OAuth).
- **Bundle Budget Gate (`scripts/checkBundleBudget.mjs`)**: Verifies primary entry bundle remains under `220 KB` gzip with zero `.map` or secret leakage in `dist/`.
