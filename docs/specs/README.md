# MeetReady Feature Specifications

Short, single-topic specs live here in Git so contributors and agents can read accepted product requirements without digging through chat transcripts.

## Spec Index

| Spec | Linear Epic | Status | Summary |
| :--- | :--- | :--- | :--- |
| [Coach Simplification, Team Events & Unified Comms](coach-simplification-and-team-comms.md) | `MEE-8` / `MEE-9` | **Shipped** | Unified `TeamEvent` spine, 5-tab Coach Workspace, Family Hub, timed `.ics`, Unified Comms Hub, Push→Email fallback, offline Dexie outbox, Curated Albums & FERPA guardrails. |
| [Delegated Race Timing & External Meet Interop](delegated-timing-and-meet-interop.md) | `MEE-7` | **Shipped** | Zero-PII `/time` delegated timing passes, coach approval queue, `EXTERNAL_MEET` vs. `HOST_DUAL_MEET` seeding rules, and 3-layer FAT / Hand-Timed / Watch reconciliation. |

---

## Feature Spec Template (`80–150` lines)

```markdown
# Feature Title (MEE-XX)

**Status:** Draft | Approved | Shipped | **Linear:** MEE-XX

## 1. Context & Problem
Why this exists and who hits the friction today.

## 2. User Flows & UI Contract
Primary athlete/coach/parent flows and mobile (`390px`) / desktop (`1440px`) layout expectations.

## 3. Data, Security & Compliance Constraints
Schema changes, RBAC boundaries, SafeSport MAAPP / FERPA / COPPA rules, Clean-Room AI exclusions, and bundle impact.

## 4. Acceptance Criteria
Testable checkpoints for Vitest and CI-parity Playwright E2E.
```
