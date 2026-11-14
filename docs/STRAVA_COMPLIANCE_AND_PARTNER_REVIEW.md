# THRESH — Strava Developer Program Review & Compliance Pack

> **Document Type:** Formal Developer Program Review Submission & Compliance Audit  
> **Application:** THRESH (formerly AeroPulse)  
> **Platform URL:** `https://thresh.app` (Production: Vercel)  
> **API Version:** Strava v3 REST API  
> **Last Audited:** 2026-11-14  
> **Compliance Baseline:** Strava Developer Agreement (Updated November 2024)

---

## 1. Executive Summary & Purpose of Application

**THRESH** is a dual-sport (running and cycling) endurance training platform and team management workspace designed for competitive athletes, scholastic & collegiate cross-country and track & field teams, and endurance coaches.

THRESH integrates with Strava as an **optional, read-only data source** to help individual athletes sync their historical run and ride logs so THRESH's client-side physiology engine can calibrate baseline threshold benchmarks:
- **Calibrated Running Threshold Pace & rTSS** (running Training Stress Score)
- **Calibrated Cycling FTP & TSS**
- **Banister Impulse-Response Fitness & Fatigue Modeling** (CTL, ATL, TSB)
- **Aerobic Decoupling & Durability Ratios**

---

## 2. Compliance with Strava Developer Agreement (Nov 2024)

### 2.1 Section 5.3 Compliance · Third-Party AI Models & Machine Learning
> **Strava Requirement:** Developer shall not use Strava data to train, fine-tune, or prompt any third-party artificial intelligence (AI) or large language model (LLM).

**THRESH Implementation & Guarantee:**
1. **Clean-Room Firewall (`server/cleanRoomFirewall.ts`):**  
   All outbound requests to generative AI endpoints (e.g., Google Gemini for optional workout syntax generation in `/api/coach/options` and `/api/coach/chat`) pass through `sanitizeTelemetryForCleanRoom()`.
2. **Strict Payload Stripping:**  
   The firewall checks every activity record against `isStravaOriginRecord()`. Any activity synced via Strava is completely stripped from the context window, along with `stravaSegments`, `stravaKudos`, `stravaAthleteId`, and `segmentEfforts`.
3. **First-Party Hardware Only:**  
   The AI coach context window receives *only* first-party hardware biometrics (Garmin Connect overnight HRV, sleep score, resting HR, and direct `.FIT` file telemetry). Strava activity data is **100% excluded from all AI prompt payloads**.
4. **No Model Training:**  
   THRESH does not train, fine-tune, or distill any AI model on user data.

---

### 2.2 Section 5.3 Compliance · Cross-User Data Display & Coach Views
> **Strava Requirement:** Developer shall not display or share one Strava user's data with another user without explicit user consent, and must not expose raw user activity feeds to unauthorized third parties.

**THRESH Implementation & Guarantee:**
1. **Teammate Peer Views:**  
   In team squad rosters and leaderboard triage views (`TeamManagementPanel.tsx`), peer athletes **never see another athlete's activities, GPS routes, sensor streams, or notes**. Peer views only display THRESH-derived aggregate metrics (CTL, ATL, TSB, readiness score).
2. **Coach Data Sharing Tiers:**  
   Athletes select their explicit Coach Sharing Tier (`LOAD_ONLY`, `SUMMARY_ONLY`, or `FULL_STREAMS`):
   - Under `LOAD_ONLY`: Zero activities are shared with coaches; only aggregate load numbers are visible.
   - Under `SUMMARY_ONLY` (Default): Strava activities are excluded entirely by the Clean-Room firewall.
   - Under `FULL_STREAMS`: Coaches receive workout summaries, but **GPS polylines, route coordinates, and second-by-second sensor streams are restricted strictly to first-party hardware (Garmin/FIT/Wahoo/COROS)**. Raw Strava sensor streams and GPS polylines are **never** projected to coaches (`server/teamService.ts:1354-1370`).
3. **Private Notes & Descriptions Shielded:**  
   Personal descriptions, journal entries, gear IDs, comments, and kudoers from Strava are stripped before any cross-user projection.
4. **Safe-Sport U18 Shielding:**  
   Minor athletes (`isMinorU18: true`) have biometric weight and private vitals permanently masked across all team views.

---

### 2.3 Brand Guidelines & Attribution
> **Strava Requirement:** Proper use of "Connect with Strava" button assets, official vermilion color `#FC4C02`, and "Compatible with Strava" / "Powered by Strava" marks.

**THRESH Implementation:**
1. **Canonical CTA Buttons:**  
   All OAuth entry points (`StravaAuthGate.tsx`, `DataSourcesModal.tsx`, `App.tsx`) use the canonical text: **`Connect with Strava`** with official chevron branding.
2. **Accessible Contrast:**  
   The button styling (`.ap-btn-strava`) uses compliant styling exceeding WCAG 2.1 AA requirements (5.44:1 contrast).
3. **Attribution:**  
   Data sources dialog and workout summary cards feature explicit **"Compatible with Strava"** or **"Powered by Strava"** attribution marks.

---

### 2.4 User Consent, Sync Window Control & Data Deletion
> **Strava Requirement:** Users must have clear visibility into what data is accessed, control over what syncs, and the right to disconnect and purge data at any time.

**THRESH Implementation:**
1. **2-Step Onboarding with Sync Choice:**  
   Step 1 authenticates the athlete's identity. In Step 2, the athlete explicitly chooses their sync window (`90 days`, `180 days`, `365 days`, `all`, or `none`). Selecting `none` allows an athlete to use THRESH with zero workout sync.
2. **Instant Disconnect & Vault Purge (`POST /api/strava/disconnect`):**  
   Athletes can disconnect Strava at any time from Settings or Data Sources. Calling disconnect immediately:
   - Revokes and wipes Strava OAuth tokens from the encrypted server vault (`AES-256-GCM`).
   - Clears session cookies (`thresh_session`, `thresh_vault`).
   - Purges athlete profile cache.

---

## 3. Technical Architecture & Security Specifications

| Layer | Implementation | Details |
|---|---|---|
| **OAuth 2.0 Scopes** | `activity:read_all,profile:read_all` | Strictly read-only; THRESH never requests write access. |
| **CSRF Protection** | HMAC-SHA256 signed `state` tokens | Short-lived (`20m`) signed state tokens verified at callback. |
| **Token Storage** | `AES-256-GCM` encryption at rest | 256-bit encryption keys with 96-bit random IV and 128-bit auth tag. |
| **Server AI Firewall** | `sanitizeTelemetryForCleanRoom()` | Filters out all Strava activity data before generative AI inference. |
| **Automated Tests** | `tests/stravaComplianceAndCleanRoom.test.ts` | Continuous regression testing in CI for all firewall rules. |

---

## 4. Developer Program Review Application Answers

*(Ready for copy-paste into Strava Developer Program Review form)*

- **Application Name:** THRESH
- **Website URL:** `https://thresh.app`
- **Redirect URIs:** `https://thresh.app/api/strava/callback`, `http://localhost:3000/api/strava/callback`
- **Application Category:** Coaching & Training Analytics
- **Requested Rate Limit Tier:** 100+ athlete production tier (expanding beyond development sandbox)
- **Detailed Description:**  
  THRESH is an endurance physiology dashboard and coaching management tool for runners and cyclists. It ingests historical activity data to calculate calibrated threshold pace/power, rTSS, and CTL/ATL/TSB training load models.
- **Does your app display Strava data to other users?**  
  No. Individual athlete activities, GPS polylines, and sensor streams are kept strictly private to each athlete. Team and coach views display only THRESH-derived aggregate physiological metrics (CTL, ATL, TSB, readiness score).
- **Does your app share Strava data with AI or LLM providers?**  
  No. THRESH maintains a strict Clean-Room firewall (`server/cleanRoomFirewall.ts`) that strips all Strava activity data, segment efforts, and metadata prior to any AI prompt generation.
- **How can users delete their data?**  
  Users can click "Disconnect Strava" or "Sign Out & Clear Credentials" in the Data Sources modal. This immediately wipes all OAuth tokens from our encrypted vault and clears session credentials.
