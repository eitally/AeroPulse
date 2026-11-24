# MeetReady AI Collaboration & Orchestration Playbook

This guide establishes shared best practices for prompting, selecting agent orchestration modes, using repository skills/MCPs cleanly, and running safe unattended overnight work on MeetReady.

---

## 1. How Memory & Project Truth Work

- **Git is the sole durable team memory:** Rules ([`AGENTS.md`](../AGENTS.md)), system boundaries ([`ARCHITECTURE.md`](../ARCHITECTURE.md)), visual tokens ([`DESIGN.md`](../DESIGN.md)), specs ([`docs/specs/`](./specs/README.md)), ADRs ([`docs/adr/`](./adr/001-dual-storage-indexeddb-and-postgres-vault.md)), runbooks ([`docs/runbooks/production-setup.md`](./runbooks/production-setup.md)), and skills ([`.agents/skills/`](../.agents/skills/ci-verify/SKILL.md)) travel with every branch and teammate.
- **Linear (`MEE`) owns live status & backlog:** All active issues, priorities, bugs, and upcoming milestones live in **[Linear — MeetReady (`MEE`)](https://linear.app/meetready)**. Local agent artifact folders and chat transcripts are **ephemeral**—do not rely on them across teammates or future sprints.
- **One conversation per epic or Linear ticket:** Start a fresh chat for each distinct feature, refactor, or bug sweep instead of reusing a giant conversation across unrelated topics. If one deep session grows heavy, run `/compact` to free context cleanly.

---

## 2. Prompting Best Practices (The 5-Part Brief)

Strong prompts prevent scope drift, wasted tool turns, and unwanted rewrites. Include these five elements for any non-trivial task:

1. **Linear Reference:** Name the issue key (`MEE-14`, `MEE-15`) so the agent pulls requirements, sets status to `In Progress`, and references `Fixes MEE-XX` on commit.
2. **Concrete Outcome & Acceptance Criteria:** State what users, callers, or tests must observe when done.
3. **Scope & Explicit Non-Goals:** Name target modules/routes and state what must **not** change (for example: *"keep existing Athlete telemetry unchanged"*, *"do not modify auth or billing"*).
4. **Verification Gate:** Ask for MeetReady's full CI-parity checks (documented in `.agents/skills/ci-verify/SKILL.md`), not just `tsc` alone.
5. **Decision Authority:** Say upfront whether to pause for plan approval (`/plan` or `/grill-me`) or execute autonomously and push when green.

| Weak Prompt | Strong Prompt |
| :--- | :--- |
| *"Clean up the big files and fix the small UI bugs before I wake up."* | *"Run `/goal` on `MEE-14` and `MEE-15`. Split `TracksideStopwatchView.tsx` and `intervalsRouter.ts` into domain modules matching `ARCHITECTURE.md` without changing UI copy or routes, then implement all checklist items in `MEE-15`. Run full `ci-verify` checks (lint, `check:brand`, Vitest, `check:bundle`, CI-parity Playwright). Push to `main` and mark `MEE-14`/`MEE-15` Done only if every check + `gh run watch` passes green; otherwise stop cleanly on a feature branch and write a morning summary."* |

---

## 3. Choosing the Right Mode, Slash Command & Agent Pattern

Match the coordination weight to the problem rather than defaulting everything to a single giant chat or an unnecessary swarm:

| Situation | Recommended Slash Command / Tool | Why & How to Use It |
| :--- | :--- | :--- |
| **Ambiguous product, UX, or compliance tradeoffs** | `/grill-me` | Runs a structured interview first so design decisions are locked before any code is written. |
| **Medium/large feature where you want review before edits** | `/plan` | Inspects the repo and presents an explicit plan you approve before execution begins. |
| **Complex cross-cutting debugging or deep research** | `/boost` | Allocates deeper strategic reasoning, multi-angle verification, and stricter self-checks. |
| **2+ independent coding tracks on disjoint files** | `/teamwork` *(Swarm)* | Spawns named parallel workers on a shared board. **Rule:** assign `workspace:"share"` to parallel editing workers so git working trees never collide; keep read-only reviewers/verifiers on default `inherit`. |
| **Parallel read-only codebase/market audits** | `research` subagent | Keeps heavy grepping and file reads out of the main thread's context window. |
| **Live web UI / mobile viewport smoke checks** | `/browser` *(browser subagent)* | Operates a real headless browser on `localhost` or `https://meetready.app` to verify visual layout, contrast, console cleanliness, and click flows. |
| **Deterministic batch fan-out across 10+ files/checks** | `run_workflow` | Runs a Python pipeline (`parallel`, `pipeline`, `phase`) with predictable aggregation and zero ad-hoc coordination drift. |
| **Unattended multi-step execution until all checks pass** | `/goal` | Keeps iterating until every acceptance criterion and CI check passes without premature stopping. |
| **Capturing a repeated lesson or mistake** | `/learn` | Writes newly discovered repo/CI traps into durable rules or skills so teammates and future agents don't repeat them. |
| **Recurring checks or delayed reminders** | `/schedule` | Schedules cron checks or timers cleanly without polling loops. |

---

## 4. Built-In Repo Guardrails & Skills You Can Name Directly

You can refer agents directly to MeetReady's preconfigured workflows and safety contracts:

- **`.agents/skills/ci-verify/SKILL.md`:** Full local CI-parity check sequence (`npm run lint`, `npm run check:brand`, `npm test`, `npm run build && npm run check:bundle`, `SERVE_BUILT_DIST=1 CI=true npx playwright test`, and `gh run watch`).
- **`.agents/skills/new-feature-spec/SKILL.md`:** End-to-end process for `MEE-XX` ticket → `docs/specs/<slug>.md` → domain slices (`src/types/`, `src/utils/telemetryStorage/`, `server/routers/team/`) → verification → PR/commit.
- **Canonical Design & Brand Checks:** [`DESIGN.md`](../DESIGN.md) (*Mondo Clay & Stadium Chalk*, WCAG AA, `>= 44px` mobile hit targets, `0` Impeccable anti-patterns) and strict `MeetReady` spelling (`npm run check:brand`).
- **Node 22 & Bundle Hygiene:** Explicit `.ts` extensions on relative imports in `server/`, `src/types.ts`, and `src/types/*.ts`; `<= 220 KB` gzip entry / `<= 290 KB` initial critical assets / `<= 1,800 KB` precache; revert accidental `api/index.js` diffs when `server/` wasn't touched.
- **Youth Safeguarding & Clean-Room Firewall:** Zero Strava data leaked to Gemini AI or peer views, COPPA `<13` hard block, SafeSport MAAPP parent-CC enforcement, and FERPA zero-ad-tracker boundaries.

---

## 5. Unattended Overnight Run Playbook

Before going to bed, choose **bounded, locally verifiable** Linear backlog tickets that have clear acceptance criteria and require zero human logins.

### Overnight Green-Light vs. Human-Gated Tasks

| Run Overnight (`Autonomous`) | Keep for Morning (`Human-Gated`) |
| :--- | :--- |
| Bounded monolith decomposition matching `ARCHITECTURE.md` (e.g., `MEE-14`) | Account linking, OAuth app reviews & API key submissions (e.g., `MEE-16`, `MEE-19`) |
| Scoped P2 UI/a11y/polish fixes with Playwright + Vitest parity (e.g., `MEE-15`) | Production Vercel env var changes, DNS edits, W-9/NDPA & live Stripe checkouts (`MEE-17`, `MEE-18`) |
| Unit test & Playwright viewport test expansion | Destructive database schema drops or unapproved brand/IA overhauls |
| Bundle size reduction & static doc/runbook hygiene | Native store submissions depending on unconfigured prod env (`MEE-20`+ when `MEE-17` is pending) |

### 5 Rules to Include in Every Overnight Instruction

1. **Start a fresh conversation** using **`/goal`** (single track) or **`/teamwork`** (two disjoint tracks with `workspace:"share"`).
2. **Anchor on Linear `MEE-XX` keys** and tell the agent to inspect those tickets first (`get_issue`) and move them `In Progress` → `Done` upon verification.
3. **Ban interactive pauses for minor calls:** Instruct the agent to make conservative, minimal engineering decisions aligned with `AGENTS.md` and `DESIGN.md` rather than stopping mid-run to ask routine questions.
4. **Enforce a clean failure fallback:** Instruct the agent **never to force-push broken code to `main`**—if CI or bundle budgets stay red after two serious fix attempts, stop cleanly on a named branch (`wip/overnight-...`) or uncommitted worktree and leave a clear diagnostic block.
5. **Require a Morning Briefing:** Ask for commits pushed, CI run IDs/status, files changed, Linear issues updated, and any residual follow-ups.

### Copy-Paste Templates

#### Template A · Single-Track `/goal` Overnight Execution
```text
/goal

Start by reading `AGENTS.md`, `ARCHITECTURE.md`, and Linear issues MEE-14 and MEE-15.
Execute MEE-15 first, then MEE-14 (following existing facade + domain-module rules in `ARCHITECTURE.md` and explicit `.ts` extensions where required by Node 22 ESM).

Constraints & Guardrails:
- Follow `AGENTS.md`, `DESIGN.md`, and `.agents/skills/ci-verify/SKILL.md` strictly.
- Do not pause for routine implementation choices; pick the safest minimal design matching existing repo patterns.
- Leave Athlete 1Hz telemetry, auth flows, billing, and Clean-Room / SafeSport rules intact.
- Do not touch MEE-16 through MEE-22.

Verification & Git Rules:
- For each completed ticket, run:
  `npm run lint && npm run check:brand && npm test && npm run build && npm run check:bundle`
  plus `SERVE_BUILT_DIST=1 CI=true npx playwright test`.
- Revert `api/index.js` if `server/` had zero changes.
- Commit cleanly with `Fixes MEE-XX`, push to `main`, and verify GitHub Actions passes green (`gh run watch`).
- If any check remains blocked after two fix attempts, do NOT push broken changes to `main` — leave them on a branch (`wip/overnight-mee`) and report the exact blocker.
- Update Linear ticket statuses for completed work and leave a concise Morning Briefing summarizing commits, test/CI output, and any remaining follow-ups.
```

#### Template B · Parallel 2-Track `/teamwork` Overnight Execution
```text
/teamwork

Coordinate two parallel tracks using `workspace:"share"` for workers editing disjoint files, plus a final shared CI verifier on `main`:
- Worker 1 (`frontend-polish`): Execute MEE-15 across its UI/utility files (`ActivityInspectorModal`, `VisualWorkoutBuilder`, `meetDayOpsEngine.ts`, `districtAdOverviewHelper.ts`, `TeamBrandingStudioForm.tsx`, `MeetDayHeatAndFlightModal.tsx`, `TeamMessagingDrawer.tsx`, `CoachDailyOpsPanel.tsx`, and `App.tsx` multi-school billing polling).
- Worker 2 (`modularize-core`): Execute MEE-14 across strictly disjoint modules first (`server/routers/intervalsRouter.ts`, `src/hooks/useTelemetrySync.ts`, and `src/components/TracksideStopwatchView.tsx`), leaving `TeamMessagingDrawer.tsx` to Worker 1 (or deferring `TeamMessagingDrawer.tsx` modularization until Worker 1 lands) without altering public API routes or UI behavior.

Merge tracks sequentially, keep `api/index.js` clean unless `server/` changed, run the full `.agents/skills/ci-verify/SKILL.md` suite (lint, `check:brand`, Vitest, `check:bundle`, CI-parity Playwright), push to `main` only when all gates pass, watch GitHub Actions green (`gh run watch`), update Linear (`MEE-14`, `MEE-15`), and write a concise Morning Briefing.
```
