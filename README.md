# AeroPulse — Unified Multi-Sport Physiology, Load, Segments & AI Coaching PWA

**AeroPulse** is a full-stack, mobile-ready Progressive Web App (PWA) and desktop physiological performance cockpit that unifies your **Intervals.icu** (including auto-synced **Garmin Connect** daily health & workout data) and **Strava** accounts, augmented by a context-aware **Google Gemini Training & Recovery Coach**.

---

## Key Capabilities

1. **Autonomic Readiness & Performance Management Chart (PMC)**:
   - Correlates daily **HRV (rMSSD)** vs. 7-day rolling baseline, **Resting HR**, **Sleep Duration & Score**, and **VO2max** (synced from Garmin Connect via Intervals.icu) with chronic training load (**Fitness CTL**, **Fatigue ATL**, **Form TSB**, and weekly **Ramp Rate**).
2. **Outdoor vs. Indoor (Smart Trainer / Treadmill) Filtering & Combination**:
   - One-click filtering across all running and cycling workouts, power/pace curves, and annual mileage trackers to isolate **Outdoor Only**, **Indoor Only (Smart Trainer / Zwift / Treadmill)**, or **Combined** telemetry.
3. **Separate Annual Mileage Targets (Running & Cycling)**:
   - Track year-to-date distance goals independently for **Running** and **Cycling** (in `mi` or `km`), with pro-rated daily pace comparison (*Ahead / Behind Schedule*), required weekly distance for the remainder of the year, and an Outdoor vs. Indoor breakdown.
4. **Cross-Source Activity Explorer & Strava Segment Performance**:
   - Inspects second-by-second time-series streams (`Watts`, `Heart Rate`, `Pace`, `Cadence`, `Altitude`), **Aerobic Decoupling (`Pw:Hr` / `Pa:Hr`)**, 7-zone distributions, and **Strava Segment Efforts** (`PR #1/2/3`, grade, elapsed time, average watts/pace, and benchmark segment progression).
5. **Target Race Calendar & Performance Milestones**:
   - Manage **A/B Target Races** (with Target Peak CTL projected directly onto the PMC chart) and physiological goals (FTP `W/kg`, Threshold Run Pace, VO2max, and Segment Time goals).
6. **Gemini AI Coach (3-Option Daily Workout Generator + Health & Fitness Chat)**:
   - Generates **3 selectable daily workout options** (*Optimal Progression*, *Modulated Aerobic*, *Active Recovery*) tailored to your readiness, indoor/outdoor preference, and available time, alongside a multi-turn **Health & Fitness Chat** grounded in your live metrics.

---

## Forking & Self-Hosting Guide (Bring Your Own API Keys)

Anyone can fork this repository and connect their own **Intervals.icu**, **Garmin Connect**, **Strava**, and **Google Gemini** accounts. You can provide your credentials either via **Environment Variables** (recommended for personal Vercel deployments) or directly inside the app's **Data Sources** modal.

### Step 1: Link Garmin Connect to Intervals.icu (For Garmin Users)
Because Garmin's official enterprise API is closed to personal developer keys, AeroPulse accesses your Garmin workouts and daily wellness metrics (HRV, Resting HR, Sleep, VO2max, Weight) through **Intervals.icu**:
1. Log into [https://intervals.icu](https://intervals.icu) and open **Settings**.
2. Under the **Garmin** section, check both **Download activities** and **Download wellness data** (HRV, RHR, Sleep, Weight, Stress).
3. Scroll down to **Developer Settings** and click **View** next to **API Key** to copy your personal `INTERVALS_API_KEY`.
4. Note your **Athlete ID** (or simply use `0`, which automatically resolves to the owner of the API key).

### Step 2: Create Your Personal Strava API Application
1. Go to [https://www.strava.com/settings/api](https://www.strava.com/settings/api) and create an API application.
2. Note your **Client ID** (`STRAVA_CLIENT_ID`) and **Client Secret** (`STRAVA_CLIENT_SECRET`).
3. Set the **Authorization Callback Domain** to the hostname where your app is hosted:
   - For Vercel: `your-project-name.vercel.app` (do not include `https://` or paths in Strava's domain field)
   - For Local Development: `localhost`
   *(Note: Inside AeroPulse's **Data Sources** modal, the exact callback URL for your active domain is displayed for easy reference).*

### Step 3: Get a Google Gemini API Key
1. Visit [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and generate a Gemini API key (`GEMINI_API_KEY`).

---

## Deploying to Vercel via GitHub

This repository is pre-configured with `vercel.json` and `/api/index.ts` so it deploys cleanly to **Vercel** directly from GitHub:

1. **Fork or Push** this repository to your GitHub account.
2. Log into [Vercel](https://vercel.com), click **Add New... -> Project**, and import your GitHub repository.
3. In the Vercel configuration screen, open **Environment Variables** and add:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   INTERVALS_API_KEY=your_intervals_icu_personal_api_key
   INTERVALS_ATHLETE_ID=0
   STRAVA_CLIENT_ID=your_strava_client_id
   STRAVA_CLIENT_SECRET=your_strava_client_secret
   ```
   *(Tip: If you leave `INTERVALS_API_KEY` or `STRAVA_CLIENT_ID` blank in Vercel, you can still enter them at runtime inside the app's **Data Sources** modal!)*
4. Click **Deploy**. Once Vercel assigns your `.vercel.app` domain, make sure that hostname is listed as your **Authorization Callback Domain** in [https://www.strava.com/settings/api](https://www.strava.com/settings/api).

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy .env.example to .env and fill in your keys
cp .env.example .env

# 3. Start the full-stack Express + Vite development server on port 3000
npm run dev
```

---

## Installing as a Mobile / Desktop PWA

- **Android / Desktop (Chrome, Edge, Brave)**: Click the **Install App** button in the top navigation bar (orinside the **Data Sources** drawer) for one-tap native installation.
- **iOS / iPadOS (Safari)**: Tap **Install on iOS** in the header (or tap the Safari **Share** button and select **Add to Home Screen**) to launch AeroPulse in standalone full-screen mode.
