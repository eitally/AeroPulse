# ADR 001: Dual Local-First Storage (IndexedDB + Cloud Envelope + `AES-256-GCM` Vault & Postgres)

**Status:** Accepted  
**Applies To:** `src/db/`, `src/utils/telemetryStorage/`, `src/hooks/useAthleteCloudSync.ts`, `server/tokenVault.ts`, `server/teamStoreCore.ts`

## Context

Athletes and track coaches operate in concrete stadiums, rural XC courses, and team buses where LTE connectivity drops routinely—while also switching between mobile PWAs, tablets, and desktop laptops where cross-device state, OAuth tokens, and team rosters must remain consistent and encrypted.

## Decision

1. **Dexie IndexedDB First on Client:** All activities, 1Hz streams, planned workouts, gear items, and offline outboxes (`MeetReadyChatOutboxDB`, stopwatch captures) persist locally in IndexedDB and hydrate immediately on boot before network calls resolve.
2. **Scoped Cloud Envelope + Normalized Postgres Tables:** Server state persists to normalized PostgreSQL tables (`thresh_teams`, `thresh_team_members`, `thresh_team_events`, `thresh_team_event_rsvps`, `thresh_team_messages`, `thresh_audit_log`, `thresh_stripe_events`) serialized with `pg_advisory_xact_lock`, plus `AES-256-GCM` encrypted `thresh_tenant_vault` (with encrypted `HttpOnly` fallback cookies and dev `/tmp` vault files when `DATABASE_URL` is omitted).
3. **Per-Field Fast-Reload Dirty Tracking (`sessionEditedFieldsRef`):** Client hydration (`useAthleteCloudSync.ts`) tracks session edits independently per slice (`activities`, `wellnessDays`, `plannedEvents`, `gearItems`, `athleteProfile`) so partial boot responses (such as `/api/auth/me` updating `athleteProfile`) cannot misclassify untouched slices as locally edited or overwrite server `plannedEvents` with empty arrays during fast reloads.

## Consequences

- Trackside stopwatch and messaging survive complete airplane-mode dead zones and flush idempotently on reconnect.
- Contributors adding new synced client slices must register explicit dirty-field tracking in `useAthleteCloudSync.ts` rather than sharing a single dirty timestamp.
