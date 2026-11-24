# Delegated Race Timing & External Meet Interop (`MEE-7`)

**Status:** Shipped (`6a4319a`–`b3e0570`) · **Tests:** `tests/fieldDelegatedTimingAndStopwatch.test.ts`, `tests/fieldExternalMeetInterop.test.ts`, `e2e/socraticFieldUseAndMeetInterop.spec.ts`

---

## 1. Context & Problem

Head coaches frequently delegate 200m/400m split timing to a team captain or student manager at the far curve while competing at 24-team invitationals hosted in Hy-Tek, Athletic.net, or FinishLynx. MeetReady must support delegated timing without exposing roster PII, and work seamlessly alongside external meet software and athletes' GPS watches without fabricating heats or double-counting `TSS`.

## 2. Delegated Timing Passes (`/time/:passCode`)

- **Coach Creation (`CoachDelegateTimingModal.tsx`, `server/teamTimingDelegationService.ts`):** Generates scoped timing passes tied to a meet/event, heat label, timing station (`Start/Finish`, `200m Mark`, `400m Split`, etc.), and split plan.
- **Zero-PII Public Payload (`DelegatedTimingPadPage.tsx`):** Exposes ONLY `meetTitle`, `eventLabel`, `heatLabel`, `stationType`, `splitPlan`, and assigned runners (`entryKey`, `First + Last Initial`, `hipOrLane`). Never grants `ASSISTANT_COACH` permissions and never exposes emails, DOBs, guardians, or AT injury data.
- **Coach Approval Queue:** Submissions (`clientSubmissionId` idempotent) land in `PENDING_COACH_APPROVAL` (`APPROVED` / `BACKUP_ARCHIVED` / `DISCARDED`) so multi-station captures never overwrite each other.

## 3. External Meet Interop & 3-Layer Reconciliation

- **Authority Modes (`MeetDayHeatAndFlightModal.tsx`, `meetDayOpsEngine.ts`):**
  - `EXTERNAL_MEET` (Default): MeetReady never invents local heats or lanes; unassigned entries render `TBD (Official Program)`.
  - `HOST_DUAL_MEET`: Coach-managed seeding with relay squad grouping (`1` squad per lane) and full-team export guards.
- **Friday Program Import & Clerk Overrides (`ExternalHeatSheetImportPanel.tsx`):** Ingests external Hy-Tek / Athletic.net assignments (`officialHeat`, `officialLaneOrHip`) while protecting Saturday `CLERK_OVERRIDE` scratches and heat changes unless explicitly overwritten.
- **3-Layer Race Reconciliation (`officialRaceSynthesizer.ts`, `src/utils/telemetryStorage/activityMerge.ts`):**
  1. Preserves Official FAT time & place (`Athletic.net`, `TFRRS`, `MileSplit`, `Official FAT`) as canonical headline.
  2. Attaches matching human-timed lap splits (`handTimedTotalSecs`, `capturedByName`, `timingStation`) when same-date distance (`±2%`) and finish delta match (`<= max(3.5s, 2%)`).
  3. Fuses overlapping wearable GPS/HR streams (`watchStart <= swEnd + 60 && watchEnd >= swStart - 60`, rejecting warmup titles or pace mismatches) so a race day never double- or triple-counts Banister `TSS`.
