# MeetReady — REST API, Multi-Provider Identity & Security Architecture

This document covers the server-side architecture of **MeetReady**, including Multi-Auth identity (Google OAuth 2.0, WebAuthn Passkeys via `@simplewebauthn/server`, fail-closed Magic Link GET/POST, 6-digit Email OTP, and optional Strava OAuth), CSRF-protected OAuth cookie-nonce handshakes, the `AES-256-GCM` Token Vault, strict Postgres TLS (`rejectUnauthorized: true`) with normalized tables (`thresh_teams`, `thresh_team_members`, `thresh_audit_log`), Clean-Room Allowlist AI Firewall, RBAC governance, and hardware connectors.

> **Legal & Procurement Docs:** [`/privacy`](/privacy) · [`/terms`](/terms) · [`/subprocessors`](/subprocessors) · [`/procurement`](/procurement)

---

## 1. Identity, Session & Clean-Room Security Architecture

### 1.1 Multi-Provider Canonical Identity (`server/authService.ts` & `server/securityUtils.ts`)
- **Supported Authentication Methods**: Athletes, coaches, and parents sign in with **Google OAuth 2.0**, **WebAuthn Passkeys** (`@simplewebauthn/server` cryptographic COSE key + counter verification), **Magic Links** (read-only `GET` preview + explicit `POST` burn; fail-closed HTTP `503` in production when email delivery is unconfigured), **6-Digit Email OTP**, or **optional Strava OAuth** (school teams never require Strava).
- **Deterministic Cross-Device Vault Binding**: Verified sessions receive `HttpOnly`, `SameSite=Lax`, HMAC-SHA256 signed `thresh_session` cookies (plus `x-session-token` for strict mobile/webview contexts). Verified email changes require single-use OTP confirmation on the new address before committing or claiming roster invites.
- **Full Sign-Out & Account Deletion Isolation**: Signing out sweeps all user `localStorage` keys, IndexedDB tables, and React slices cleanly to prevent shared-device credential bleed. Permanent deletion revokes Strava tokens and clears `thresh_session`, `thresh_vault`, and `thresh_user`.

### 1.2 HMAC-Signed OAuth Cookie-Nonce Binding (`issueOAuthStateToken` / `verifyOAuthStateToken`)
- All 5 OAuth flows (Strava, Google, Intervals.icu, Wahoo, Polar) mint short-lived HMAC-SHA256 `state` tokens paired with `HttpOnly` cookie nonces compared via `timingSafeEqual`.
- Session IDs rotate cleanly upon authentication, preserving `/join/<slug>` and Team Code claims without exposing raw provider tokens in JSON polls or `postMessage`.

### 1.3 `AES-256-GCM` Token Vault & Normalized Postgres Storage (`server/tokenVault.ts`)
- Encrypts provider credentials and tenant state at rest using `AES-256-GCM` (`96-bit` random IV + `128-bit` auth tag).
- Unified secret key resolution: `TOKEN_VAULT_KEY || OAUTH_ENCRYPTION_KEY || SESSION_SECRET` (generate production 256-bit keys via `npm run secrets:generate`).
- **Normalized Postgres Persistence & Strict TLS**: Writes to `thresh_tenant_vault`, `thresh_teams`, `thresh_team_members`, and append-only `thresh_audit_log` with `pg_advisory_xact_lock` row serialization and `ssl: { rejectUnauthorized: true }` in production, alongside encrypted `HttpOnly` backup cookies (`thresh_vault`, `thresh_user`).

### 1.4 Clean-Room Allowlist AI Firewall (`server/cleanRoomFirewall.ts`)
- **Strict Allowlist Schema**: Strips 100% of Strava-sourced activities (including `recentWorkouts`) before any request reaches Google Gemini AI.
- **U18 / High School Protection**: AI Coach endpoints authenticate caller sessions, disable Gemini by default for minors (`U18` / `HIGH_SCHOOL`), and strip `weightKg` / body-composition fields server-side.

---

## 2. REST API Endpoints

### 2.1 Auth, Sync Policy & Connectors (`server/routers/`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/config/status` | Returns active session state and connected provider flags (requires verified credentials for secret config fields). |
| `POST` | `/api/auth/passkey/*`, `/api/auth/magic-link/*`, `/api/auth/email/*`, `/api/auth/change-email`, `DELETE /api/auth/account` | WebAuthn passkey registration/auth, GET/POST split magic links, OTP verification, email verification, and permanent account erasure. |
| `GET / POST` | `/api/strava/*`, `/api/intervals/*`, `/api/wahoo/*`, `/api/polar/*`, `/api/garmin/*` | Cookie-nonce verified OAuth flows, 1Hz workout sync, canonical `startDateUtcMs` deduplication, and credential revocation. |
| `POST` | `/api/auth/logout` | Clears server vault/session cookies for clean shared-device sign-out. |

### 2.2 Multi-Team, Safe-Sport Governance, Library & Comments (`server/routers/teamRouter.ts`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET / POST` | `/api/teams`, `/api/teams/join-preview`, `/api/teams/join-claim` | Lists/creates teams with `ORG_ADMIN` / `ATHLETIC_TRAINER` / coach / parent RBAC; hashes and strips `parentConsentToken`; enforces COPPA `<13` block and U18 quarantine. |
| `PATCH / DELETE` | `/api/teams/:teamId/members/me/sharing-tier`, `/api/teams/:teamId/members/:id/role`, `/api/teams/:teamId/members/me/guardian` | Post-join `sharingTier` editing, staff role assignments (`HEAD_COACH`, `ASSISTANT_COACH`, `ORG_ADMIN`, `ATHLETIC_TRAINER`), and immutable minor DOB guardian controls. |
| `POST / PUT / DELETE` | `/api/teams/:teamId/workouts/broadcast`, `/broadcast-batch`, `/workouts/:broadcastId`, `/blocks/:blockId` | Cloud team workout CRUD and cohort block recall (`canProgramWorkoutsRole`: `HEAD_COACH` / `ASSISTANT_COACH` only). |
| `GET / POST / DELETE` | `/api/teams/:teamId/workout-library`, `/comments`, `/safety-alerts`, `/audit-log` | Reusable team Workout Library, workout comments with mandatory `403` U18 Guardian-CC enforcement, Guardian safety alerts, and `HEAD_COACH`/`ORG_ADMIN` immutable audit log. |

### 2.3 Vault, Physiology, Webhooks & OTA Workout Export

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/vault/status` | Returns encrypted provider connection metadata with zero raw token leakage. |
| `POST` | `/api/physiology/mmp-debrief`, `/durability`, `/race-simulator`, `/race-passport` | Computes 1Hz MMP/GAP (`CP/W'`), `0–40 kJ/kg` & `0–2,000 kcal` durability, 5-segment Course Physics, and `THV-...` Race Passports. |
| `POST` | `/api/workouts/export` | Compiles structured workouts into `WORKOUTKIT_JSON`, `GARMIN_TRAINING_JSON`, `ZWO`, `ERG`, or binary `.FIT`. |
| `POST` | `/api/webhooks/strava` | Strava deauthorization & verified `subscription_id` webhook handler. |

---

## 3. Environment Variables & Production Quality Gates

- **Core Secrets**: `SESSION_SECRET`, `TOKEN_VAULT_KEY` (or `OAUTH_ENCRYPTION_KEY`), `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `APP_BASE_URL`.
- **Normalized Persistence & Notifications**: `DATABASE_URL` (PostgreSQL with strict TLS), optional `RESEND_API_KEY` (invites, magic links, Guardian alerts), `GEMINI_API_KEY` (adult opt-in AI Coach).
- **CI Gates (`npm run check:bundle`)**: Enforces entry bundle `< 220 KB` gzip, Critical Initial JS+CSS `<= 290 KB` gzip, PWA Precache `<= 1,800 KB` raw, and `0` mixed-case brand casing leaks (`scripts/checkBrandCasing.mjs`).
