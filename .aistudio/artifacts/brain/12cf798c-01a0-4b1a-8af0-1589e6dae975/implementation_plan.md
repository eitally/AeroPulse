# Multi-Athlete Strava Authentication, Friend/Coach Roster & Granular Privacy Architecture

To launch AeroPulse as a collaborative endurance platform like **Intervals.icu**, this update introduces a **Strava OAuth Sign-Up & Login Landing Gate** (with a 1-click **Live Athlete Sandbox** bypass), a **Top Header Athlete Context Switcher** for inspecting a friend's or coached athlete's dashboard, a **Team & Friends Roster Hub** comparing live `CTL`, `TSB`, `HRV`, and race objectives, **Coach Calendar Workout Push**, and a **Granular Privacy & Strava API Compliance Shield**.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and security decisions reflect your confirmed selections:

- **Confirmed Decision 1 — Strava Auth Landing Gate with 1-Click Demo Sandbox Bypass**:
  - New or signed-out visitors see a dedicated **AeroPulse × Strava Sign-Up / Sign-In Gate** that launches popup-based Strava OAuth (`https://www.strava.com/oauth/authorize`) and provisions their athlete account.
  - Includes a prominent **"Enter Live Athlete Sandbox (1-Click Demo)"** button so anyone can test all features immediately without waiting for OAuth credentials, plus a header account control to switch back to the Auth Gate or sign out anytime.
- **Confirmed Decision 2 — Role-Based Access (`Friend` vs. `Coach`), Invite Codes & Granular Privacy Shield**:
  - **Two Relationship Tiers**:
    - **Friend (`FRIEND_VIEW`)**: Read-only access to permitted fitness metrics, calendar summaries, and PRs.
    - **Coach (`COACH_EDIT`)**: Full physiological visibility plus permission to **push, schedule, and morph structured workouts** directly onto the athlete's Training Calendar.
  - **Granular Privacy & Strava API Compliance Toggles**: Athletes control whether **HRV / Sleep Wellness**, **Outdoor GPS Route Maps**, **Power/Pace Curves**, and **Strava-Sourced Activity Details** are visible to Friends, Coaches Only, or Private.
  - **Shareable Invite Codes & 1-Click Follow Requests**: Athletes can share a unique invite code (e.g., `AP-8492-TALLY`), search athletes by name or Strava ID, and approve/revoke incoming Friend or Coach requests with one click.
- **Confirmed Decision 3 — Top Header Athlete Switcher, Team Roster & Coach Workout Push**:
  - **Top Header Athlete Switcher**: Switch the entire AeroPulse workspace between **Your Profile** and any followed **Friend** or **Coached Athlete** to inspect their Calendar, PMC (`CTL/ATL/TSB`), and Goals.
  - **Team & Friends Roster Leaderboard**: Side-by-side comparison table of all followed athletes showing live **CTL (Fitness)**, **TSB (Form)**, **HRV Status**, **7d Load**, **W/kg & Threshold Pace**, and **Primary Race Goal**, with 1-click **Coach Workout Push**.

---

## 1. Overview & Core Concept

- **What It Does**: Transforms AeroPulse from a single-user analytics dashboard into a multi-athlete social and coaching platform where athletes authenticate with Strava, follow teammates and friends, grant coaches calendar-editing rights, and enforce strict privacy over biometric and GPS data.
- **Target Audience / Persona**: Endurance athletes, training partners, track/XC clubs, and cycling/running coaches who want Intervals.icu's multi-athlete switching and workout prescription combined with Strava's social following.
- **Key Value**: Lets coaches and teammates collaborate in real time—comparing readiness and fitness across a squad and pushing structured workouts directly to an athlete's calendar—without compromising sensitive health telemetry or violating Strava API data-sharing rules.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Strava Sign-Up / Sign-In Gate & 1-Click Sandbox**:
     - Visitors see a clean split-screen landing gate showcasing AeroPulse's core capabilities (Intervals.icu Effort Skylines, Readiness-Morphing Workouts, Watchless FAT Track Synthesizer, and Team/Coach Roster).
     - Clicking **"Continue with Strava"** opens the Strava OAuth popup directly (`https://www.strava.com/oauth/authorize`), exchanges the authorization code via `/api/strava/callback`, and signs the user in.
     - Clicking **"Explore Live Athlete Sandbox"** enters the authenticated workspace immediately with realistic multi-athlete squad data.
  2. **Top Header Athlete Context Switcher & Active Viewing Banner**:
     - A compact **Athlete Switcher** button in the top navigation bar shows who you are currently viewing (e.g., `Elliot Tally (You)` or `Viewing: Maya Lin · Coached`).
     - When viewing a **Friend** or **Coached Athlete**, a high-contrast contextual bar appears at the top of the workspace showing their relationship badge (`Coach Access · Can Prescribe Workouts` or `Friend View · Read-Only`), their active privacy shield status, a **"Push Workout to Athlete's Calendar"** button (for Coaches), and a 1-click **"Return to My Dashboard"** button.
  3. **Athletes, Friends & Coaching Hub Modal**:
     - **Tab 1 — Team & Friends Leaderboard**: High-density tabular comparison of your squad (`CTL`, `ATL`, `TSB`, `HRV rMSSD & Readiness`, `7d TSS`, `FTP / W/kg`, `Threshold Pace`, `Active Goal`), with 1-click **"Switch to Athlete"** and **"Prescribe Workout"** actions.
     - **Tab 2 — Find Friends, Invite Code & Pending Requests**: Copy your personal **Athlete Invite Code** (`AP-8492-TALLY`), paste a teammate's code or search directory profiles to send a **Friend (View)** or **Coach (Edit Calendar)** request, and approve/decline incoming requests.
     - **Tab 3 — Security, Privacy & Strava API Compliance Shield**: Toggle granular sharing permissions (`Share Morning HRV & Sleep`, `Share PMC & Zones`, `Redact GPS Start/End & Strava-Only Routes for Friends`, `Allow Approved Coaches to Edit Calendar`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Popup-Based Strava OAuth + Signed Session Token (`SameSite=None; Secure` + Bearer Header)**
  - *Chosen Approach*: Open `https://www.strava.com/oauth/authorize` directly in a browser popup, handle the code exchange at `/api/strava/callback`, and broadcast the authenticated athlete profile back to the iframe via `window.opener.postMessage` + `BroadcastChannel`, storing a session token in both `SameSite=None; Secure` cookies and client storage.
  - *Why*: Complies with cross-origin iframe security constraints while supporting seamless multi-device login and 1-click sandbox testing.
- **Decision 2: Strava API Compliance & Privacy Redaction Layer**
  - *Chosen Approach*: Implement a server-and-client privacy filter (`applyAthletePrivacyShield`) that automatically redacts raw GPS route coordinates or biometric wellness metrics when viewing a Friend whose privacy shield restricts those fields.
  - *Why*: Protects athlete home-location privacy and honors Strava API rules regarding third-party visibility of Strava-sourced activities while keeping derived fitness (`CTL/TSB`), official FAT race results, and coach-prescribed workouts shareable.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────────┐
│           StravaAuthLandingGate (Sign Up with Strava | Demo Bypass)          │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ OAuth Popup (/api/strava/callback)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            Top Header Athlete Context Switcher & Active View Banner          │
│  [Viewing: Elliot Tally (You) ▼]  ──►  Switch to Friend or Coached Athlete   │
└───────────┬──────────────────────────────────────────┬───────────────────────┘
            │                                          │
            ▼                                          ▼
┌───────────────────────────────────────┐  ┌───────────────────────────────────┐
│   Athletes, Friends & Coaching Hub    │  │ Privacy & Coach Permission Engine │
│ • Team Leaderboard (CTL/TSB/HRV/Goal) │  │ • FRIEND_VIEW (Read-Only + Redact)│
│ • Invite Codes (AP-XXXX) & Requests   │  │ • COACH_EDIT (Push Workouts to    │
│ • Granular Privacy & API Shield       │  │   Athlete's Calendar & Morph)     │
└───────────────────────────────────────┘  └───────────────────────────────────┘
```

- **Data Model & State**:
  - `AthleteConnectionRole`: `'SELF' | 'COACH_EDIT' | 'FRIEND_VIEW'`
  - `AthletePrivacySettings`:
    - `shareWellnessAndHrv`: `'ALL_CONNECTIONS' | 'COACHES_ONLY' | 'PRIVATE'`
    - `sharePmcAndZones`: `'ALL_CONNECTIONS' | 'COACHES_ONLY' | 'PRIVATE'`
    - `shareGpsRoutes`: `'COACHES_ONLY' | 'ALL_CONNECTIONS' | 'PRIVATE'`
    - `stravaComplianceShield`: `boolean` (auto-redacts raw Strava-only GPS polylines for non-owners while preserving multi-source Garmin/Intervals.icu/FAT metrics)
    - `allowCoachCalendarEdits`: `boolean`
  - `ConnectedAthleteRecord`:
    - `id`, `name`, `avatarInitials`, `location`, `stravaAthleteId`, `inviteCode`, `role` (`'COACH_EDIT' | 'FRIEND_VIEW'`), `status` (`'CONNECTED' | 'PENDING_INCOMING' | 'PENDING_OUTGOING'`), `primaryGoalSummary`, `athleteProfile`, `privacySettings`, `wellnessDays`, `activities`, `plannedEvents`, `targetGoals`
- **Interactive Component & State Mapping**:
  - **Authentication Gate (`StravaAuthGate.tsx`)**: Renders when `authSession.status === 'UNAUTHENTICATED'`; provides live Strava OAuth popup launch, inline OAuth callback code paste fallback, and 1-click Demo Sandbox entry.
  - **Header Context Switcher & Banner (`App.tsx`)**: Swaps the active `activities`, `wellnessDays`, `plannedEvents`, `athleteProfile`, and `targetGoals` passed to all child views (`CalendarView`, `FitnessHealthView`, `ActivitiesView`, `GoalsView`) to the selected athlete's privacy-filtered dataset, and enables **Coach Workout Push** onto the selected athlete's calendar.
  - **Athletes & Friends Hub Modal (`AthleteRosterModal.tsx`)**: Full CRUD for following athletes by invite code/search, approving incoming Friend/Coach requests, toggling role permissions, updating your own Privacy Shield, and pushing structured coach workouts to any coached athlete.
