# Coach Simplification, Team Events & Unified Comms (`MEE-8` / `MEE-9`)

**Status:** Shipped (`ad2b423`, `8932aa4`, `3b093ca`) · **Tests:** `tests/phase1*.test.ts`, `tests/phase2*.test.ts`, `tests/phase3*.test.ts`, `e2e/phase1*.spec.ts`, `e2e/phase2*.spec.ts`, `e2e/phase3*.spec.ts`

---

## 1. Context & Problem

Track and cross-country coaches often juggle TeamSnap/sportsYou for schedules and messaging, Remind for parent SMS reach, spreadsheets for workout pods, and Hy-Tek/Athletic.net for meets. At the same time, rapid feature additions had crowded MeetReady's Coach screen at `390px` mobile trackside.

## 2. Shipped Architecture & User Flows

### Coach 5-Tab Simplification (`CoachWorkspaceView.tsx`)
- Replaced crowded multi-row headers with a compact 1-line Coach context bar (`Meet Day`, `Health`, `Desk`) + dedicated 5-tab navigation (`Home`, `Workouts`, `Team Plan`, `Stopwatch`, `Roster`):
  - **Home (`CoachPracticeHome.tsx`):** First-glance screen restricted strictly to (1) Quick panel links, (2) Alerts & conflicts, and (3) Comms launcher — keeping Roll Call behind its own pane.
  - **Workouts (`CoachClipboardWorkoutBuilder.tsx`):** Dedicated lazy-loaded screen for workout authoring and library selection.
  - **Desk (`CoachDeskDrawer.tsx`):** Moves setup wizards, District AD tools, and config controls out of live trackside UI.

### Unified `TeamEvent` Spine, RSVP Glue & Timed `.ics`
- **Backend:** `server/teamEventsService.ts`, `server/routers/teamEventsRouter.ts`, `server/teamCalendarIcs.ts`.
- Supports `PRACTICE`, `MEET`, `BUS_TRAVEL`, and `TEAM_MEETING` events with attendance RSVPs (`Going / Out / Late / Conflict` + `Team Bus / Parent Pickup / Self Travel`) from athletes and linked `PARENT_FOLLOWER` guardians.
- RSVPs feed directly into Meet Entries (`Scratch Conflicted`), Relays (`Exclude RSVP Conflicts`), and Roll Call (`Apply RSVPs`).
- Timed RFC-5545 `.ics` feeds emit `DTSTART;TZID=...`, `SEQUENCE`, and `LAST-MODIFIED` via revocable private calendar tokens (`TeamCalendarSubscribeButton.tsx`).

### Family Hub, Honest Splits & Unified Comms Hub
- **Family Hub (`FamilyMeetHubCard.tsx`):** Exposes meet schedules, bus departures, Curated Meet Album links, and `Latest Timed Splits` for `PARENT_FOLLOWER` guardians.
- **Honest Provenance (`raceTimingBadge.ts`):** Hand-timed splits show `Hand-Timed` / `Delegated Hand-Timed`, never `Official FAT`.
- **Unified Comms (`TeamMessagingDrawer.tsx`, `CommsHubSecondaryTabs.tsx`):** Merges `Chat`, `Announcements`, and `Workout Notes` with `PARENTS_ONLY` and custom sub-groups, staff `Got It` read-receipt rosters, and 1-tap PII-redacted `Copy for Remind / ParentSquare` (`remindFormatter.ts`).
- **Push-to-Email Fallback & Offline Outbox:** `pushNotificationService.ts` tracks undelivered recipient SIDs and falls back to Resend email automatically (essential for iOS Safari); `chatOutbox.ts` queues offline messages durably in IndexedDB (`MeetReadyChatOutboxDB`) with permanent `4xx` dead-letter quarantine.

## 3. Data, Security & FERPA Constraints

- **No Raw Minor UGC Media Hosting:** MeetReady stores only staff-curated external `https://` album links (`isSafeHttpsUrl`), avoiding unmoderated minor photo/video storage risk.
- **FERPA `photoReleaseOptOut`:** Roster opt-out flags (`PATCH /api/teams/:teamId/members/:membershipId/photo-release`) trigger pre-save and post-save reminders whenever coaches attach external album URLs.
- **SafeSport MAAPP:** Minor direct messages block un-CC'd 1-on-1 staff notes (`403`) and redact PII from staff/minor push previews.
