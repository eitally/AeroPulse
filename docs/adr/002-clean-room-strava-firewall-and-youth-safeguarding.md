# ADR 002: Server-Enforced Clean-Room Strava AI Firewall & Youth Safeguarding

**Status:** Accepted  
**Applies To:** `server/cleanRoomFirewall.ts`, `server/coppaGuard.ts`, `server/teamService.ts`, `server/teamMessagingService.ts`, `server/pushNotificationService.ts`

## Context

MeetReady integrates Strava (whose Developer Agreement prohibits feeding Strava activity data into third-party LLMs or exposing raw user streams to unauthorized peers) alongside U.S. high school athletes subject to COPPA (`<13`), FERPA, SOPIPA / CA AB-1584, and U.S. Center for SafeSport MAAPP guardrails.

## Decision

All compliance boundaries are enforced **server-side** rather than relying solely on UI hiding:
- **Clean-Room Allowlist Firewall:** `sanitizeTelemetryForCleanRoom()` strips 100% of Strava-origin records (`recentWorkouts`, `segmentEfforts`, `stravaKudos`) and disables Gemini AI prompts by default for minor / `HIGH_SCHOOL` accounts.
- **COPPA & Minor Locks:** Conservative `${birthYear}-12` validation blocks `<13` accounts; `HIGH_SCHOOL` and `13–17` athletes lock DOB against client tampering and stay quarantined (`LOAD_ONLY`) pending SHA-256 hashed guardian consent.
- **SafeSport MAAPP Comms:** Direct coach-to-minor un-CC'd comments return HTTP `403`, `COACHES_STAFF` and minor notifications redact PII, and parent/guardian visibility is audited.
- **FERPA Media Policy:** MeetReady stores **zero raw minor user-generated media files**, permitting only curated external `https://` album URLs with roster `photoReleaseOptOut` warnings.

## Consequences

- Safe for K–12 / district procurement (`/procurement`, CA SDPC NDPA) without per-season UGC moderation liability.
- Any new AI, messaging, or media feature must explicitly preserve Clean-Room and SafeSport test invariants in `tests/sprint0SecurityAndReliability.test.ts` and `tests/sprint2bFerpaAndSecurity.test.ts`.
