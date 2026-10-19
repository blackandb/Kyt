# KYT Monitor

Private wallet monitoring and risk screening for incoming TRON USDT / USDC transfers.

## Setup

### 1. Supabase
1. Create a project.
2. SQL Editor → run `supabase/schema.sql`.
3. Authentication → URL Configuration:
   - Site URL: `https://YOUR_APP_URL`
   - Redirect URLs: `https://YOUR_APP_URL/auth/callback`

### 2. GitHub + Vercel
1. Upload this folder to a new private GitHub repository.
2. Vercel → Add New Project → import the repository.
3. Add the environment variables from `.env.example`.
4. Deploy.

### 3. Scheduler
SQL Editor → open `supabase/scheduler.sql`, replace `YOUR_APP_URL` and `YOUR_CRON_SECRET`, run it.
Transfers sync every minute; the sanctions list refreshes daily.

### 4. First run
1. Sign in with `OWNER_EMAIL` (magic link).
2. Flags → Sanctions list → Update now.
3. Wallets → add your TRON addresses.
4. Settings → Send test email.

## Structure
```
supabase/schema.sql           Database
supabase/scheduler.sql        Every-minute sync + daily sanctions refresh
src/middleware.ts             Owner-only access
src/lib/tron.ts               TronGrid, address codec, Tether blacklist
src/lib/risk.ts               Scoring (0–100, levels, reasons)
src/lib/signals.ts            Signal collection with cache
src/lib/sync.ts               Wallet sync, screening, alerts
src/lib/check.ts              On-demand address / transaction checks
src/lib/sanctions.ts          Sanctions list import
src/lib/amlbot.ts             Optional deep screening
src/lib/email.ts              Alert email (Resend)
src/lib/ai.ts                 AI assistant (Claude, read-only tools)
src/app/(app)/                Transfers, report, assistant, check, wallets, flags, settings
src/app/api/chat/             Assistant endpoint
src/app/api/cron/             Scheduler endpoints
src/app/api/export/           CSV export
```

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Where to get it |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | yes | Supabase → Project Settings → API |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | yes | Supabase → Project Settings → API |
| SUPABASE_SERVICE_ROLE_KEY | yes | Supabase → Project Settings → API (secret) |
| OWNER_EMAIL | yes | Your email — the only account allowed in |
| APP_URL | yes | Your Vercel domain, e.g. https://kyt.vercel.app |
| CRON_SECRET | yes | Any long random string; same value in scheduler.sql |
| ANTHROPIC_API_KEY | for Assistant | console.anthropic.com → API Keys |
| ANTHROPIC_MODEL | no | Default claude-sonnet-5-5 |
| TRONGRID_API_KEY | recommended | trongrid.io → API Keys |
| RESEND_API_KEY | for email alerts | resend.com → API Keys |
| ALERT_FROM | for email alerts | Sender on a domain verified in Resend |
| APP_TIMEZONE | no | Default Europe/Chisinau |
| AMLBOT_ACCESS_ID / AMLBOT_ACCESS_KEY | no | AMLBot account (deep screening) |

## Risk levels
| Score | Level | KYT |
|---|---|---|
| 0–29 | Low | Passed |
| 30–69 | Medium | Passed |
| 70–89 | High | Failed |
| 90–100 | Severe | Failed |

Tether blacklist or sanctions match → 100. Flagged by you → at least the flag severity.
