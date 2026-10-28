# YoursJobMate

An AI job-search co-pilot, inspired by tools like NextGenApply. You set your preferences once. YoursJobMate then pulls fresh job listings, ranks them by how well they match you, writes a tailored cover letter for each one, applies on your behalf and tracks every application on a **real-time Applied Jobs dashboard**.

## MVP features

| Area | What you get |
| --- | --- |
| **Accounts** | Email/password sign-up with a 6-digit email verification code, login, forgot/reset password by email code, sign-out of all sessions on reset, per-IP rate limits |
| **Profile & resume** | Headline, skills, experience, target titles, locations, remote-only, salary, resume upload or paste |
| **Job matches** | Live jobs from free public APIs ([Remotive](https://remotive.com/api/remote-jobs), [Arbeitnow](https://www.arbeitnow.com/api/job-board-api)), scored 0–100% against your profile. Bundled sample jobs are used when offline. |
| **AI cover letters** | Claude writes a letter per job from your resume and the job description. A template is used if no API key is set. |
| **Auto-apply agent** | A background worker that applies to new jobs above your minimum match score, up to your daily limit |
| **Applied Jobs page** | Status tabs with counts, search, filter by method, sort, inline status changes, notes, a per-application timeline, CSV export, and manual entries for jobs you applied to elsewhere |
| **Dashboard** | Totals, interviews, offers, response rate, a 14-day chart, a pipeline funnel and a live activity feed |
| **Real time** | Socket.IO pushes every change (agent progress, status updates) to all your open tabs instantly |

## Tech stack

- **Frontend:** React 19 + Vite + React Router, plain CSS (light and dark mode, responsive)
- **Backend:** Node.js 22 + Express 5 + Socket.IO
- **Database:** PostgreSQL in the cloud (Neon, Supabase, AWS RDS…) via `pg`. Local development uses an embedded Postgres ([PGlite](https://pglite.dev)), so nothing needs installing
- **AI:** Anthropic Claude via `@anthropic-ai/sdk`

```
client/            React app (pages: Dashboard, Job Matches, Applied Jobs, Profile)
server/src/
  index.js         HTTP + Socket.IO server, starts the agent loop
  app.js           REST API routes, security headers, rate limits
  authRoutes.js    Sign-up, email verification, login, password reset
  auth.js          Sessions (JWT) and route protection
  mailer.js        SMTP email and email templates
  db.js            PostgreSQL connection and schema
server/scripts/
  migrate-sqlite.js  One-time copy of an old SQLite database into PostgreSQL
  jobs.js          Job sources, sync and match scoring
  agent.js         Auto-apply pipeline: queue → tailor → submit → track
  ai.js            Claude cover-letter generation
server/test/       API tests (node:test)
```

## Run it locally

You need **Node.js 22.13 or newer**.

```bash
npm run setup
```

```bash
npm run dev
```

Open http://localhost:5173. The API runs on port 4000, and Vite proxies `/api` and the websocket to it.

To configure the app, copy `server/.env.example` to `server/.env`. Set `ANTHROPIC_API_KEY` there to turn on AI cover letters.

### Database and email in development

Without `DATABASE_URL`, data is saved in an embedded Postgres in `server/data/pgdata`. To copy accounts from an older SQLite version of the app into it, run `npm run migrate:sqlite` inside `server/` (with the dev server stopped).

Without `SMTP_HOST` set, no email is sent: verification and reset codes are printed in the server terminal, so you can test the whole flow offline. To receive real emails locally, set the SMTP settings in `server/.env` (see [Accounts and email](#accounts-and-email)).

## Accounts and email

- **Sign-up** creates an unverified account and emails a 6-digit code. The user can't log in until they enter it. Accounts created before verification existed stay verified.
- **Forgot password** emails a reset code. It always gives the same answer, so it can't reveal who has an account. Resetting signs out every other session and sends a "your password was changed" email.
- **Codes** expire after 10 minutes, allow 5 wrong attempts, can be resent once a minute, and are stored only as a keyed hash.
- **Rate limits** per IP: 10 sign-up/login/code requests per 15 minutes, 30 verify/reset attempts per 15 minutes, 300 API requests per minute.
- **Passwords** need at least 8 characters. They are never stored: the database keeps only `bcrypt(HMAC-SHA256(PASSWORD_PEPPER, password))`. The pepper is a secret key kept in the server environment, not the database, so a stolen database alone can't be used to crack passwords.

### Choosing an email provider

For real users, send through a transactional email service, not a personal mailbox. Gmail limits you to about 500 emails a day, and codes from a personal address often land in spam. All of these work through the SMTP settings, and `server/.env.example` lists the exact values for each:

| Provider | Free tier (check current pricing) | Notes |
| --- | --- | --- |
| [Resend](https://resend.com) | Yes | Simplest setup |
| [Brevo](https://www.brevo.com) | Yes | |
| [SendGrid](https://sendgrid.com) | Yes | |
| [Amazon SES](https://aws.amazon.com/ses/) | Pay per email | Cheapest at large volume |

Whichever you choose:

1. Buy or use a domain you own (for example `yoursjobmate.com`).
2. Add the domain in your provider's dashboard and create the DNS records it shows you (SPF, DKIM and ideally DMARC). This is what keeps your codes out of spam.
3. Set `MAIL_FROM` to an address on that domain, such as `YoursJobMate <no-reply@yoursjobmate.com>`.
4. Start the server and look for `[mail] SMTP ready` in the logs. If the login fails you'll see `[mail] SMTP check failed` with the reason.

## Deploy to production

The app runs as a single Node process that serves both the API and the built website. Every user's data (account, profile, resume file, applications) is saved in a **cloud PostgreSQL database**, so the server itself keeps nothing on disk.

### 1. Create the cloud database

Any PostgreSQL provider works. [Neon](https://neon.tech) and [Supabase](https://supabase.com) both have free tiers:

1. Sign up and create a project, choosing a region close to where you'll host the app.
2. Copy its **connection string** (Neon: *Connect*; Supabase: *Connect → Session pooler*). It looks like `postgresql://user:password@host/dbname?sslmode=require`.
3. Put it in `DATABASE_URL`. The server creates all the tables itself on first start.

You can see your users' data any time in the provider's table editor. Passwords appear only as `pep1$…` hashes.

To bring over accounts from the old local SQLite database, run this once before real users sign up:

```bash
cd server
DATABASE_URL="postgresql://…" npm run migrate:sqlite
```

### 2. Run the app

### With Docker (Render, Railway, Fly.io, a VPS…)

```bash
docker build -t yoursjobmate .
docker run -d -p 4000:4000 --env-file server/.env -e NODE_ENV=production yoursjobmate
```

On a hosting platform, point it at this repository's `Dockerfile` and set the environment variables below. No disk or volume is needed. Health checks can use `GET /api/health`, which also checks the database connection.

### Without Docker

```bash
npm run setup
npm run build
NODE_ENV=production npm start
```

### Production checklist

| Setting | Why |
| --- | --- |
| `NODE_ENV=production` | Turns on the production checks below and closes CORS |
| `DATABASE_URL` | **Required.** Your cloud PostgreSQL connection string |
| `JWT_SECRET` | **Required.** A long random string (see `.env.example` for a command to generate one) |
| `PASSWORD_PEPPER` | **Required.** A different long random string. Never change it once users exist, and keep a backup copy: without it nobody can log in |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | **Required.** The server won't start without `SMTP_HOST` in production |
| `TRUST_PROXY=1` | Needed on almost every host so rate limits see real visitor IPs instead of the proxy's |
| HTTPS | Provided by your host or a proxy such as Cloudflare or Caddy. Never serve logins over plain HTTP |
| Backups | Turn on your provider's automatic backups / point-in-time restore |

### Scaling beyond one server

The database already supports many server instances. The remaining single-instance pieces are the in-memory rate limits, Socket.IO live updates and the auto-apply loop: before running several instances behind a load balancer, move rate limits and Socket.IO state to Redis and run the agent as a separate worker (see the roadmap).

## Tests

```bash
npm test
```

## Step-by-step guide: how it works

1. **Sign up.** You land on *Profile & Resume*. Add your skills and target titles at minimum, since they drive matching.
2. **Job Matches → Fetch new jobs.** This pulls listings and scores each one: 45% title similarity, 40% skill coverage and 15% location/remote fit (`server/src/jobs.js`).
3. **Apply.** Click **Apply** on any job (one-click), or turn on **auto-apply** on the Dashboard or Profile page. Every minute the agent picks your best unseen matches above the minimum score, within your daily limit.
4. **Watch it live.** Each application moves `queued → applying → applied` on the Applied Jobs page and in the activity feed as it happens.
5. **Track outcomes.** When employers reply, change the status (viewed, interview, offer or rejected), add notes and review the cover letter that was sent. The stats and funnel update instantly.

## Important: what "apply" does in this MVP

`APPLY_MODE=simulate` (the default) prepares everything (match, tailored cover letter, record, timeline) but **does not contact employers**. This is deliberate: auto-submitting real applications needs per-site integrations and the user's explicit consent. To go live, implement `submit()` in `server/src/agent.js`. Options:

- **ATS APIs:** Greenhouse Job Board API and Lever Postings API accept applications programmatically for companies that use them.
- **Browser automation:** a Playwright worker that fills application forms (respect each site's terms of service; LinkedIn and Indeed forbid automation).
- **Email apply:** send the resume and cover letter to postings that list an application email.

## Suggested roadmap after the MVP

1. Real submission adapters (Greenhouse/Lever first) with per-application user approval
2. PDF/DOCX resume parsing, plus a per-job tailored resume (not just a cover letter)
3. Gmail/Outlook integration to auto-detect "viewed", "interview" and "rejected" emails and update statuses
4. More job sources (Adzuna, JSearch, company career pages) and de-duplication
5. Redis job queue (BullMQ) and shared rate limits for multi-instance deployments; OAuth login
6. Billing (Stripe) with plan-based daily limits
