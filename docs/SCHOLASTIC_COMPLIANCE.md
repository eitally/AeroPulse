# MeetReady Scholastic Youth Privacy & Safe Sport Compliance Framework

**Version:** 2.4 (Youth Safeguarding & Procurement Pack)  
**Applicability:** High School, Middle School (`<13` Watchless Only), Junior Development Clubs, and Collegiate Programs  
**Statutory & Policy Scope:** COPPA (15 U.S.C. §§ 6501–6506, Under-13 Hard Block), FERPA (34 CFR Part 99 School Official Addendum), SOPIPA (Cal. Bus. & Prof. Code §§ 22584–22585), California AB-1584 (Cal. Ed. Code § 49073.1), and U.S. Center for SafeSport MAAPP (36 U.S.C. §§ 220541–220543).

> **Procurement Pack & Legal Links:** [`/procurement`](/procurement) (CA SDPC NDPA, HECVAT Lite & PO Pricing) · [`/privacy`](/privacy) · [`/subprocessors`](/subprocessors)

---

## 1. COPPA Under-13 Block & Minor Safeguards (Ages 13–17 / High School)

### Closed-Roster Onboarding & Age Verification (`YYYY-MM`)
1. **Under-13 Account Prohibition (COPPA):**
   - Server and client age gates apply conservative `${birthYear}-12` validation when checking birth-year thresholds and hard-block standalone or team account creation when age is `< 13` (coaches may still time watchless trackside splits without creating child accounts).
2. **Mandatory Parental Consent & Quarantine (Ages 13–17 & `HIGH_SCHOOL`):**
   - Minor athletes (`13–17`) and `HIGH_SCHOOL` rosters require `parentGuardianEmail`, lock minor `birthMonthYear` against tampering, use raster-only team logos (dropping unverified inline SVGs), and remain in SafeSport quarantine (`LOAD_ONLY` + Gemini AI disabled) until parental consent is verified.
3. **Zero Un-CC'd 1-on-1 Minor Messaging (SafeSport MAAPP):**
   - Direct coach-to-minor `sms:` buttons are disabled, private un-CC&apos;d coach-to-minor workout comments return HTTP `403`, and staff-only `COACHES_STAFF` or minor DM push notifications redact PII and enforce parent/staff oversight and `thresh_audit_log` logging.

---

## 2. Verifiable Parent / Guardian Acknowledgment & Instant Revocation

1. **Hashed Consent Tokens & Two-Step Confirmation:**
   - `parentConsentToken` values are stored exclusively as SHA-256 hashes at rest (`parentConsentTokenHash`) and are never returned to athlete browsers.
   - `GET /api/teams/parent-consent` renders a non-mutating confirmation screen (safe from email-scanner prefetch links); explicit `POST` approves consent or triggers **Decline & Delete Child Data** to immediately revoke and clear minor team telemetry.
2. **Guardian Safety Alerts:**
   - Pain flags or high-strain safeguarding notices for minors trigger `GUARDIAN_SAFETY_ALERT` notifications and appear in the verified `PARENT_FOLLOWER` portal alongside official practice venues and schedule times.

---

## 3. Safe-Sport & RED-S Body-Weight Suppression

- All `HIGH_SCHOOL` rosters and `isMinorU18: true` athletes lock `safeSportHideWeight` ON (`effectiveSafeSportHideWeight`) across team summaries, Wellness, Curves, Radar, Trends, and Profile views.
- Pre-race caffeine dosing cues are automatically suppressed whenever `isMinorU18` or Safe-Sport weight suppression is active.

---

## 4. Governance RBAC, FERPA School Official Rights & Audit Log

1. **Separated Staff Roles (`ORG_ADMIN`, `ATHLETIC_TRAINER`, Coaching Staff):**
   - `HEAD_COACH` & `ASSISTANT_COACH` program workouts; `ATHLETIC_TRAINER` reviews Squad Triage and injury/safety alerts without modifying workout broadcasts; `ORG_ADMIN` administers District/AD compliance and reads immutable `thresh_audit_log` records.
2. **Zero Ads & Zero Data Sales (SOPIPA / AB-1584 / FERPA):**
   - Student data is never sold, rented, or used for advertising, and leaves `100%` of Strava payloads outside Google Gemini AI prompts.
3. **FERPA Photo Release Opt-Out Guardrails (`photoReleaseOptOut`):**
   - Roster entries support explicit FERPA photo-release opt-out flags (`PATCH /api/teams/:teamId/members/:membershipId/photo-release`). MeetReady intentionally stores **zero raw minor user-generated photo uploads**—linking only staff-curated external album URLs (`https://` allowlist) while displaying pre-save and post-save FERPA reminders when opted-out athletes are on the roster.
4. **Deletion Tombstones, Portability & July 15 Graduation:**
   - Parents or adult athletes (`18+` FERPA rights transfer) can export data or permanently delete accounts at any time (`DELETED` tombstones prevent Postgres account resurrection), and graduating seniors roll over automatically to Alumni while retaining portable workout & stopwatch history.
