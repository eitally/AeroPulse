# THRESH v2.3 — REST API, Multi-Wearable Webhooks & Security Architecture

This document covers the server-side architecture of **THRESH v2.3**, including session isolation, the `AES-256-GCM` OAuth Token Vault, the Clean-Room Provider Firewall, physiological calculation endpoints, hardware webhooks, and OTA workout compilation.

---

## 1. Security & Clean-Room Architecture

### 1.1 Per-Visitor Signed Session Isolation (`server.ts`)
- Every browser visitor receives an `HttpOnly`, `SameSite=Lax`, HMAC-SHA256 signed session cookie (`thresh_sid`).
- OAuth credentials and athlete profiles are keyed strictly by `sessionId` inside the encrypted token vault—never stored in process-wide global variables.

### 1.2 `AES-256-GCM` OAuth Token Vault (`server/tokenVault.ts`)
- Encrypts OAuth access tokens, refresh tokens, and personal API keys at rest using `AES-256-GCM` with a random 96-bit IV and 128-bit authentication tag per record.
- Key derivation uses `OAUTH_ENCRYPTION_KEY` (64-char hex / 32-byte key generated via `scripts/generateProdSecrets.mjs`).

### 1.3 Clean-Room Provider Firewall (`server/cleanRoomFirewall.ts`)
- Enforces **Strava May-2024 API Agreement** compliance (`Section 2.13` prohibiting use of Strava API data in AI/ML model prompts or multi-user coaching redistribution):
  - `sanitizeActivitiesForCleanRoomAi(activities)` strips any activity whose sole provenance is `'Strava'` (while preserving first-party `.FIT`/`.GPX`/`.TCX` uploads, `Garmin`, `Intervals.icu`, and `Official FAT` records) before constructing Google Gemini prompts or multi-athlete coach summaries.

---

## 2. REST API Endpoints (`server/apiRouter.ts`)

### 2.1 Vault & Physiology Router (`server/routers/vaultAndPhysiologyRouter.ts`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/vault/status` | Returns the caller session's encrypted provider connection status (`garmin`, `intervals`, `strava`) with zero raw token leakage. |
| `POST` | `/api/vault/store` | Encrypts and stores a provider token record inside the `AES-256-GCM` vault for the current session. |
| `POST` | `/api/physiology/mmp-debrief` | Runs `@thresh/physiology` (`buildEmpiricalMmpSummary`, `evaluateOrthopedicInterference`, `generatePostWorkoutDebrief`) on submitted activities and streams. |

### 2.2 Webhooks, OTA Workout Export & Advanced Physiology Router (`server/routers/webhooksAndExportRouter.ts`)

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `POST` | `/api/webhooks/:provider` | First-party hardware webhook receiver for `garmin`, `wahoo`, `coros`, `polar`, `oura`, `whoop`, and `apple-healthkit`. Normalizes incoming `.FIT` / JSON summaries and records a clean-room provenance stamp. |
| `GET` | `/api/webhooks/recent` | Lists recent verified hardware webhook deliveries for the current session. |
| `POST` | `/api/workouts/export` | Compiles structured Intervals-syntax workouts (`workoutSyntax`, `ftp`, `thresholdPaceSecsPerKm`) into downloadable **`WORKOUTKIT_JSON`** (Apple Watch WorkoutKit), **`GARMIN_TRAINING_JSON`** (Garmin Training API), **`ZWO`** (Zwift XML), or **`ERG`** (Smart Trainer). |
| `POST` | `/api/physiology/durability` | Computes **10x #2** Fatigue-Sliced Durability (`0–40 kJ/kg` Cycling or `0–2,000 kcal` Running) and fueling prescriptions. |
| `POST` | `/api/physiology/race-simulator` | Computes **10x #4** Course Physics, Weather/Altitude Derating, and Dual-Source Carb/Sodium Race Simulation. |
| `POST` | `/api/physiology/race-passport` | Computes **10x #6** GPS-to-Official Chip/FAT Rubber-Banded Splits and mints a `THV-...` Verified Race Passport. |

---

## 3. Production Bundle & CI Quality Gates

- **Bundle Budget Gate (`scripts/checkBundleBudget.mjs`)**: Verifies after `vite build` that the primary entry bundle (`dist/assets/index-*.js`) remains under **`220 KB` gzip** (currently **`58.05 KB` gzip**) and that zero `.map` source maps or secret files exist in `dist/`.
- **Production Secrets Generator (`scripts/generateProdSecrets.mjs`)**: Generates cryptographically random `SESSION_SECRET` and `OAUTH_ENCRYPTION_KEY` values for production `.env` deployments.
