# Permanent Activity History & Strava OAuth Persistence Across Vercel Deployments

Deliver zero-latency, permanent persistence for your 4,200+ historical workouts, wellness metrics, Strava segments, and GPS routes using Browser IndexedDB combined with automatic incremental delta syncing and self-healing Strava OAuth token rotation—so pushing code updates from GitHub to Vercel never wipes your activity archive or requires re-authorizing Strava.

## User Review & Critical Decisions

> [!IMPORTANT]
> Your preferences from the clarification step have been locked into this plan:

- **Confirmed Decision 1 — Activity, Segment & GPS Route Persistence**: **Browser IndexedDB Cache + Automatic Incremental Delta Sync**. The full archive (workouts, Garmin wellness days, planned workouts, gear, Strava segments, and GPS polylines) will be persisted locally in a dedicated IndexedDB store (`aeropulse_telemetry_db`). On every page load or after any GitHub/Vercel deployment, the app hydrates immediately from IndexedDB in `<50ms` and then performs a fast incremental delta sync for new workouts without ever wiping existing history.
- **Confirmed Decision 2 — Permanent Strava OAuth Persistence**: **Auto-Persist Rotated Strava Tokens in Browser + Vercel Environment Variables**. The server and client will automatically exchange and persist rotated Strava `refresh_token`, `access_token`, and `expires_at` values on every sync and automatically retry with a token refresh on any `401 Unauthorized` response after a Vercel cold start. In addition, the **Data Sources** modal will provide a 1-click **Copy Vercel Environment Variables** block so you can optionally paste your 5 keys into Vercel Project Settings once for permanent server-side configuration across all devices.

---

## 1. Overview & Core Concept

- **Why Activities & Strava Disappeared on Vercel Deployments**:
  1. **Ephemeral Server `/tmp` on Vercel**: Every GitHub push spins up a brand-new serverless container on Vercel with an empty `/tmp` directory. Because 4,200+ activities (plus GPS routes and segment efforts) are too large for `localStorage`'s 5MB cap, they were previously held only in React memory and server `/tmp`.
  2. **Strava 6-Hour Access Token Expiry on Cold Starts**: When a new Vercel deployment started with `stravaExpiresAt = 0` in `/tmp`, the server accepted the browser's cached `x-strava-access-token` header without realizing it had expired after 6 hours, and when Strava rotated the `refresh_token`, the updated token was not returned to the browser's `localStorage` during background syncs.
- **What This Update Delivers**:
  - **Instant IndexedDB Hydration on Boot**: Your complete activity archive, wellness history, segments, and GPS routes load immediately from IndexedDB before any network call begins, and non-destructive merge logic guarantees that a server cold start or offline state never overwrites your archive with an empty list.
  - **Incremental Delta Sync Engine**: Once your full history is stored in IndexedDB, routine syncs only request recent workouts (e.g., last 45 days from Intervals.icu and page 1 from Strava) and merge them by workout ID into your persistent archive—cutting sync time from ~20 seconds to ~1.5 seconds while still offering a "Full History Re-Sync" button whenever needed.
  - **Self-Healing Strava OAuth Token Rotation**: Every Strava API call automatically refreshes expired tokens using your `refresh_token` (including automatic 401 retry on Vercel cold starts) and returns the newly rotated `refreshToken`, `accessToken`, and `expiresAt` to the browser so `localStorage` stays permanently in sync.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Zero-Latency App Launch After GitHub/Vercel Deploy**: Opening the live Vercel site immediately renders all 4,200+ cached activities, wellness trends, and GPS routes from IndexedDB with a subtle `"Archive Persisted Locally (4,264 workouts) · Syncing latest..."` indicator in the utility sub-bar.
  2. **Seamless Background Strava Token Refresh**: Even if you open the site days or weeks after a code update, the client passes `x-strava-refresh-token`, `x-strava-expires-at`, `x-strava-client-id`, and `x-strava-client-secret` to the backend, which transparently refreshes the Strava token and returns the rotated credentials to browser storage.
  3. **1-Click Vercel Environment Variables Export (`Data Sources` Modal)**: A dedicated card in **Data Sources** lets you copy your exact `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and `STRAVA_REFRESH_TOKEN` formatted for Vercel's Environment Variables paste box, plus shows live IndexedDB storage stats and a "Force Full Archive Re-Sync" action.
- **Visual Identity & Theme**:
  - Preserves the high-contrast **AeroPulse** SaaS telemetry aesthetic (`#F8FAFC` light / `#0B0F17` dark canvas, `#111827` structural surfaces, `#3B82F6` primary accent, `#FC4C02` Strava accent, `#10B981` nominal status) with strict `font-mono tabular-nums` discipline and single-elevation bordered surfaces.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Browser IndexedDB (`aeropulse_telemetry_db`) vs. `localStorage` for Telemetry Archive**
  - *Chosen Approach*: Store credentials and token metadata in `localStorage` (for synchronous header attachment) and store the multi-megabyte telemetry datasets (`activities`, `wellnessDays`, `plannedEvents`, `gearItems`, `connectionStatus`) in `IndexedDB`.
  - *Why*: `localStorage` throws `QuotaExceededError` above ~5MB (especially once GPS route polylines and Strava segment efforts are attached to ribuan workouts), whereas `IndexedDB` comfortably stores hundreds of megabytes of structured JSON objects asynchronously.
- **Decision 2: Non-Destructive Incremental Merge vs. Full Replacement**
  - *Chosen Approach*: Merge incoming synced activities into the existing IndexedDB activity map keyed by canonical ID (`intervalsId` / `stravaId`), preserving previously hydrated `streams`, `routeLatLngs`, `segmentEfforts`, `kudoers`, and `comments` on historical workouts.
  - *Why*: Prevents a fast incremental sync or a freshly deployed Vercel container (whose `/tmp` segment/route cache is empty) from stripping previously scanned Strava segments or GPS polylines off your older workouts.
- **Decision 3: Self-Healing Strava Token Refresh with 401 Automatic Retry**
  - *Chosen Approach*: Track `stravaExpiresAt` in both browser `localStorage` and server memory; proactively refresh whenever `now >= expiresAt - 300`, and if any Strava API call returns `401 Unauthorized`, immediately execute a `refresh_token` grant and retry the request before returning the rotated tokens in the API response payload.
  - *Why*: Guarantees that Vercel serverless cold starts never fail with an expired access token as long as a valid refresh token is present in either browser headers or Vercel environment variables.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Browser Client (React + Vite)                         │
│                                                                              │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ localStorage (Credentials & Tokens)│  │ IndexedDB (aeropulse_telemetry)│  │
│  │ • intervalsApiKey / AthleteId      │  │ • activities (4,264+ workouts) │  │
│  │ • stravaClientId / ClientSecret    │  │ • wellnessDays (Garmin/ICU)    │  │
│  │ • stravaRefreshToken (Auto-Rotated)│  │ • plannedEvents & gearItems    │  │
│  │ • stravaAccessToken & ExpiresAt    │  │ • hydrated GPS routes/segments │  │
│  └─────────────────┬──────────────────┘  └───────────────┬────────────────┘  │
│                    │Headers (x-strava-*, x-intervals-*)  │Instant Boot (<50ms)│
│                    ▼                                     ▼                   │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Incremental Sync & Non-Destructive Reconciler (App.tsx)                │  │
│  │ • Hydrates UI immediately from IndexedDB on mount                      │  │
│  │ • Runs fast delta sync (?oldest=45d) & merges into existing archive    │  │
│  │ • Persists rotated Strava tokens returned from server responses        │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
└──────────────────────────────────────┼───────────────────────────────────────┘
                                       │ HTTPS (/api/intervals/sync, /api/strava/sync)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Vercel Serverless / Express Backend (apiRouter)              │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Self-Healing Strava OAuth Manager (ensureValidStravaToken)             │  │
│  │ • Reads token + expiresAt from Headers -> RuntimeStore -> process.env  │  │
│  │ • Proactively refreshes if expired OR retries automatically on HTTP 401│  │
│  │ • Returns rotated { accessToken, refreshToken, expiresAt } in JSON     │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      ▼                                       │
│            Intervals.icu API v1      &      Strava API v3                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping
- **IndexedDB Storage Engine**: Provides asynchronous `loadPersistedTelemetrySnapshot()`, `savePersistedTelemetrySnapshot()`, and `clearPersistedTelemetrySnapshot()` helpers using native `window.indexedDB` with zero external library overhead.
- **Non-Destructive Activity Merger**: When `/api/intervals/sync` or `/api/strava/sync` returns activities, merges them by ID and Strava ID with the existing client archive so previously loaded `streams`, `routeLatLngs`, `segmentEfforts`, `kudoers`, and `comments` are always retained even if the Vercel server container just cold-started.
- **Incremental vs. Full Sync Mode**:
  - If IndexedDB already contains $\ge 100$ historical activities, automatic startup and tab-focus syncs request incremental delta updates (`?oldest=<45_days_ago>` for Intervals.icu and `?full=false` for Strava) and merge them into the persisted archive in ~1.5 seconds.
  - Clicking **Sync All-Time History** in **Data Sources** triggers a full 2010–present backfill (`?full=true`) and updates IndexedDB.
- **Data Sources Modal Enhancements**:
  - Displays live **Browser IndexedDB Archive Status** (number of persisted workouts, earliest workout date, and last saved timestamp).
  - Adds a 1-click **Copy Vercel `.env` Variables** button that copies `INTERVALS_API_KEY`, `INTERVALS_ATHLETE_ID`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and `STRAVA_REFRESH_TOKEN` so pasting them into Vercel Project Settings -> Environment Variables makes server-side auth permanent across all devices.
