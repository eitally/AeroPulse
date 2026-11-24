# MeetReady Production Setup & Procurement Runbook

Use this runbook to configure transactional email, Vercel Production environment variables, post-deploy health verification, and the school district procurement desk for **`https://meetready.app`** (tracked under Linear `MEE-17`, `MEE-18`, and `MEE-19`).

---

## 1. Transactional Email (`Resend` + GoDaddy DNS for `meetready.app`)

Outbound transactional email (**Magic Link sign-in**, **Verified Email Changes**, **Team Roster & Staff Invites**, **SafeSport Parent/Guardian CCs**, **Web Push → Email fallbacks**, and **Cross-Device Email OTP**) sends through Resend API.

> [!NOTE]
> Paid GoDaddy email hosting or mailboxes are **not** required for outbound senders (`auth@meetready.app`, `teams@meetready.app`). For inbound district/support mail (`procurement@meetready.app`, `support@meetready.app`), configure free GoDaddy Email Forwarding to a monitored inbox.

### Step 1 — Add Domain in Resend
1. Sign in at <https://resend.com>, open **Domains**, and click **Add Domain**.
2. Enter **`meetready.app`**.
3. Select **North America (`us-east-1`)** to co-locate with Vercel US deployments.

### Step 2 — Add DNS Records in GoDaddy
In **GoDaddy → My Products → `meetready.app` → DNS → Manage Zones**, add the exact records displayed by Resend:

| Record Type | GoDaddy `Name` Field | Value / Host | Priority | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `TXT` | `resend._domainkey` | `p=MIGfMA0G...` *(exact DKIM key from Resend)* | — | DKIM email signature |
| `MX` | `send` | `feedback-smtp.us-east-1.amazonses.com` *(match Resend region)* | `10` | SPF bounce / return-path |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | — | SPF sender authorization |
| `TXT` *(optional)* | `_dmarc` | `v=DMARC1; p=none;` | — | DMARC alignment telemetry |

> [!IMPORTANT]
> In GoDaddy's **Name** field, enter only the subdomain prefix (`resend._domainkey`, `send`, `_dmarc`). Do **not** append `.meetready.app`, as GoDaddy adds the root domain automatically.

Verify DNS propagation locally before clicking **Verify DNS Records** in Resend:

```zsh
dig +short TXT resend._domainkey.meetready.app
dig +short MX send.meetready.app
dig +short TXT send.meetready.app
dig +short TXT _dmarc.meetready.app
```

### Step 3 — Create a Domain-Scoped API Key
1. In Resend → **API Keys** → **Create API Key**, name it `MeetReady Production`.
2. Set **Permission** to **Sending access** and restrict **Domain** to **`meetready.app`**.
3. Copy the `re_...` key immediately and store it in Vercel Production Environment Variables.

> [!TIP]
> [`server/authService.ts`](../../server/authService.ts) defaults `AUTH_EMAIL_FROM` to `MeetReady <auth@meetready.app>`, and [`server/teamEmailAndOtpService.ts`](../../server/teamEmailAndOtpService.ts) sets the sender via `RESEND_FROM_EMAIL`. Setting both variables explicitly in Vercel keeps invite mail (`teams@meetready.app`) and auth links (`auth@meetready.app`) cleanly separated.

---

## 2. Vercel Production Environment Matrix (`MEE-17`, `MEE-19`)

Configure these variables in **Vercel Dashboard → Project → Settings → Environment Variables** under **Production**. Never commit real secret values to Git (use `npm run secrets:generate` only for local dev `.env`).

| Category | Variable | Value / Source Notes | Required For |
| :--- | :--- | :--- | :--- |
| **App Origin** | `APP_URL` | `https://meetready.app` | Canonical OAuth callbacks & origin checks |
| **Database Core** | `DATABASE_URL` | Neon Postgres connection string (`server/db.ts` enforces strict TLS `rejectUnauthorized: true` automatically) | Multi-instance roster, comms, vault & billing persistence |
| **Cryptography** | `TOKEN_VAULT_KEY`, `OAUTH_ENCRYPTION_KEY`, `SESSION_SECRET`, `CRON_SECRET` | 64-char hex 256-bit keys (`TOKEN_VAULT_KEY` primary; `OAUTH_ENCRYPTION_KEY` supported fallback) | `AES-256-GCM` token vault, HMAC session cookies & `/api/cron/hourly-sync` bearer auth (`cronAuth`) |
| **Email** | `RESEND_API_KEY` | `re_...` domain-scoped Resend key | Magic Links, OTP, invites, SafeSport guardian CC, message fallbacks (`resendEmail`) |
| **Email** | `RESEND_FROM_EMAIL` | `MeetReady Teams <teams@meetready.app>` | Roster/staff invites, guardian CCs, OTPs |
| **Email** | `AUTH_EMAIL_FROM` | `MeetReady <auth@meetready.app>` | Magic Link sign-in & verified email changes |
| **Rate Limiting** | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST credentials | Edge auth rate limiting (recommended alongside `thresh_rate_limits`) |
| **Web Push** | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push VAPID keypair + `mailto:support@meetready.app` | Priority Alerts & chat browser push notifications (`webPushVapid`) |
| **Billing** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_HS_ANNUAL`, `STRIPE_PRICE_COLLEGIATE_ANNUAL`, `STRIPE_PRICE_DISTRICT_ANNUAL` | Live/test Stripe key, webhook secret for `https://meetready.app/api/billing/stripe/webhook`, and annual Price IDs | Team & District Checkout sessions + atomic `thresh_stripe_events` activation |
| **Identity** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web client (`https://meetready.app/api/auth/google/callback`) | Coach & student Google sign-in (`googleAuth`) |
| **AI Coaching** | `GEMINI_API_KEY` | Google Gemini API key | Clean-Room workout & briefing assistance (`geminiAi`, `server/cleanRoomFirewall.ts`) |
| **Observability** | `SENTRY_DSN` *(optional)* | Sentry DSN | Error telemetry (`sentryObservability`) |
| **Wearables (`MEE-19`)** | `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Strava API application | Optional athlete Strava connector |
| **Wearables (`MEE-19`)** | `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET` | Garmin Health / Training API | Optional Garmin OAuth sync & workout push |
| **Wearables (`MEE-19`)** | `WAHOO_CLIENT_ID`, `WAHOO_CLIENT_SECRET` | Wahoo Cloud API | Direct Wahoo workout push & activity webhook |
| **Wearables (`MEE-19`)** | `POLAR_CLIENT_ID`, `POLAR_CLIENT_SECRET` | Polar AccessLink API | Optional Polar activity sync |
| **Wearables (`MEE-19`)** | `COROS_CLIENT_ID`, `COROS_CLIENT_SECRET` | COROS Training Hub API | Optional COROS activity sync |
| **Wearables (`MEE-19`)** | `INTERVALS_CLIENT_ID`, `INTERVALS_CLIENT_SECRET` | Intervals.icu OAuth app | Optional Intervals.icu sync & workout relay |

> [!IMPORTANT]
> Vercel only injects newly saved Environment Variables into new deployments. Trigger a **Production Redeploy** after updating any variable above.

---

## 3. Post-Deploy Smoke Verification

After saving env vars and redeploying `main`, run these three production checks:

1. **API Health Flags:**
   ```bash
   curl -sS https://meetready.app/api/health
   ```
   Confirm `ok: true`, `databaseHealthy: true`, `resendEmail: true`, `stripeBilling: true`, `stripeWebhook: true`, and `webPushVapid: true`.
2. **Stripe Webhook End-to-End:** Complete one Stripe checkout against a test team and verify the webhook at `https://meetready.app/api/billing/stripe/webhook` transitions the team billing state to `ACTIVE_PAID`.
3. **Resend Auth Delivery:** Request one **Continue with Email** Magic Link on `https://meetready.app`, confirm the email arrives cleanly from `MeetReady <auth@meetready.app>`, and verify clicking the link signs into the live app.

---

## 4. School District Procurement Desk (`procurement@meetready.app`, `MEE-18`)

Public school districts and Athletic Directors pay via annual Purchase Orders and route compliance packets to **`procurement@meetready.app`** (matching `/procurement`, `/for-athletic-directors`, and generated PO invoices).

### Ready-to-Attach Vendor Packet Checklist
- [ ] **Inbound Mail Verified:** `procurement@meetready.app` (and optional `billing@meetready.app` alias) actively forwards to a monitored mailbox.
- [ ] **Countersigned IRS Form W-9 (PDF):** Signed and ready for district Accounts Payable vendor onboarding within 1 business day.
- [ ] **Countersigned CA SDPC NDPA (PDF):** Signed standard Student Data Privacy Agreement aligned with commitments published on [`/procurement`](https://meetready.app/procurement).
- [ ] **Sole-Source Justification Letter (Optional PDF):** Ready for districts requesting single-vendor documentation.
- [ ] **Public Trust Routes Healthy:** Confirm HTTP `200` on `/procurement`, `/for-athletic-directors`, `/privacy`, `/terms`, and `/subprocessors`.
