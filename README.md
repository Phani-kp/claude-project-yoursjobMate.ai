# YoursJobMate

An AI job-search co-pilot, inspired by tools like NextGenApply. You set your preferences once. YoursJobMate then pulls fresh job listings, ranks them by how well they match you, writes a tailored cover letter for each one, applies on your behalf and tracks every application on a **real-time Applied Jobs dashboard**.

## MVP features

| Area | What you get |
| --- | --- |
| **Accounts** | Email/password sign-up with a 6-digit email verification code, login, forgot/reset password by email code, sign-out of all sessions on reset, per-IP rate limits |
| **Profile & resume** | Headline, skills, experience, target titles, locations, remote-only, salary, resume upload or paste |
| **Job matches** | United States jobs only, posted in the last 30 days: 20,000+ at any time from ~270 companies' own career sites (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Amazon) plus Remote OK, Remotive and The Muse. Optional Adzuna, USAJOBS and JSearch (LinkedIn, Indeed, Glassdoor) keys add more. Closed postings are removed. |
| **Any company** | Type a company's name in Job Matches (or paste its careers-page link) and its jobs are pulled in and kept updated from then on. |
| **Apply** | Opens the employer's real application page in a new tab, and records the job in Applied Jobs with a tailored resume and cover letter prepared. |
| **24/7 updates** | A GitHub Action (`.github/workflows/sync-jobs.yml`) refreshes jobs every 30 minutes, even when your computer or server is off. |
| **Search & filters** | Keyword search plus LinkedIn-style filters with live counts: date posted (24 hours to 1 month), company, US state, remote. Sort by newest or best match. Filters live in the URL, so they survive a refresh and can be bookmarked. |
| **Saved jobs** | Save any job, then tailor your resume and apply to all saved jobs with one click. |
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
  mailer.js        Email delivery (Brevo API or SMTP) and email templates
  db.js            PostgreSQL connection and schema
server/scripts/
  migrate-sqlite.js  One-time copy of an old SQLite database into PostgreSQL
  jobs.js          Job sync (US only, last 30 days), search filters and match scoring
  sources.js       Job sources: Greenhouse, Lever, Ashby, Remote OK, Remotive, The Muse, Adzuna, USAJOBS, JSearch
  companies.js     The company career boards that are pulled
  usLocation.js    Reads job locations: US or not, which states, remote
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

Open the frontend URL printed by `npm run dev` (normally http://localhost:5173). The launcher waits until the API is listening before serving the frontend. The API defaults to port 4000; Vite routes `/api` and WebSocket requests to its actual port, including after a restart or a `PORT` change in `server/.env`.

While the API restarts or is unavailable, service requests return a clear JSON error. If the API fails during initial startup, fix the terminal error before trying again; a frontend page left over from another dev session cannot handle sign-up by itself.

To configure the app, copy `server/.env.example` to `server/.env`. Set `ANTHROPIC_API_KEY` there to turn on AI cover letters.

### Database and email in development

Without `DATABASE_URL`, data is saved in an embedded Postgres in `server/data/pgdata`. To copy accounts from an older SQLite version of the app into it, run `npm run migrate:sqlite` inside `server/` (with the dev server stopped).

Run one API process per PGlite directory. The server takes an exclusive directory lock and reports an existing owner instead of opening the same database twice. `npm run dev` waits for database shutdown before restarting its API child, including on Windows. Stop it with Ctrl+C and wait for shutdown before starting another API or a script that opens the same database. Changing the API port does not give it a different database.

If another development session already owns the database, `npm run dev` reports its process ID before starting another API or frontend. Keep using the frontend URL in the original terminal, or press Ctrl+C in that terminal, wait for shutdown to finish, and run `npm run dev` once. Do not delete the database or its lock to bypass a running owner. The final `API exited before it began listening` line summarizes a startup failure; the preceding error identifies its cause. The Node.js version printed after a stack trace does not by itself identify the cause.

The development watcher compares file contents before restarting. Metadata-only filesystem notifications and unchanged files do not interrupt the API; source and configuration edits restart it after the saved contents settle.

The default directory is resolved relative to `server/`, whether you start from the repository root or `server/`. Optional `DB_PATH` selects another PGlite directory; relative paths are also resolved from `server/`. Pointing at another directory does not migrate existing accounts.

**Optional: a real Postgres 17 server on your machine.** If you have [Docker](https://www.docker.com/products/docker-desktop/), run `docker compose up -d --wait` in the project root. It publishes port 5432 on localhost only. Then set this in `server/.env` and restart `npm run dev`:

```
DATABASE_URL=postgresql://yoursjobmate:yoursjobmate@localhost:5432/yoursjobmate
```

The tables are created on first start. Data is kept in the named `pgdata` Compose volume across restarts; `docker compose down` stops Postgres and preserves it. `docker compose down -v` deletes it. The credentials above are local development defaults; if you override `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB` for Compose, update `DATABASE_URL` to match. Accounts in the embedded database are not copied over automatically. To use PGlite again, leave `DATABASE_URL=` empty and restart the app.

`server/.env`, `.env.*` secret variants and `server/data/` are ignored by Git; environment examples remain tracked. Secret environment files and database files are also excluded from Docker builds. Keep API keys and database files there rather than adding them to tracked files.

With no email service set, no email is sent: verification and reset codes are printed in the server terminal, so you can test the whole flow offline. To receive real emails, set up Brevo (below) or SMTP in `server/.env`.

### Embedded database startup recovery

If PGlite cannot start, the server includes PostgreSQL's startup error (such as a checkpoint failure) instead of showing only a WebAssembly `Aborted()` message. It does not reset the database automatically.

1. Stop every API and API watcher for this repository and confirm their database child processes have exited.
2. Preserve the entire PGlite directory before investigating. Keep the original and an untouched backup; never delete `pgdata` to resolve the error. Diagnostic tools must open disposable copies, since PostgreSQL startup recovery can write to a directory.
3. Restore a known-good snapshot into a separate directory, or recover and validate data on a copy before exporting it into a separate clean cluster. Verify user IDs, password hashes, verification/session fields, profiles and foreign-key relationships. Keep `PASSWORD_PEPPER` unchanged so recovered password hashes still work.
4. Select recovered storage only after validation and a clean close/reopen check. Retain the original, backups, diagnostic copies and recovery receipts under ignored `server/data/`; those artifacts can contain account data and must stay out of Git.

Exclusive locking and graceful shutdown prevent overlapping processes from opening the same directory; they do not repair existing checkpoint damage. Recovery work is separate from normal app startup.

## Resume alignment and tailoring

The resume percentage is this app's **estimated alignment**, calculated from the final resume text. It is separate from the profile/job match percentage and does not predict an employer's ATS score or hiring decision. The 85–95% target is an aspiration when sufficient experience supports the role; genuine gaps can keep a result below it, and a supported score above 95 is retained.

The existing category weights remain hard skills 55%, title 15%, soft skills 10%, and format checks 20%; categories without requirements redistribute their weight. Explicit alternatives such as “Python or C#” count as one requirement met by either skill. Required, preferred, and unspecified requirements are labeled separately; the score measures coverage of the extracted groups. Background and benefits text are excluded. Changed job text or tags invalidate the keyword cache, including same-length edits.

Before rewriting, the server maps each requirement to resume evidence, self-attested profile/confirmed skills, current learning, or an unsupported gap. Confirmed skills can enter Skills without inventing their use at a past employer. Learning is shown separately and excluded from proficiency coverage. Original employers, historical titles, dates, qualifications, tools, and metrics are retained; questionable rewrites fall back to their source bullets. Missing facts produce focused questions rather than fabricated achievements.

Open a job and click **Tailor my resume**. The writer automatically uses your upload, profile skills, previously confirmed skills for that job, and relevant saved experience. Profile and confirmed skills can appear in the Summary and categorized Skills without requiring an additional experience form. Professional paraphrases are checked against source responsibilities, tools, identities, and numeric outcomes rather than requiring every output word to exist in the original. The main result shows the original and tailored alignment, a resume preview, and download/re-tailor actions. Keyword and evidence diagnostics are collapsed.

**Review skills** is an optional compact selection panel; known profile skills and saved confirmations are prefilled. There is no required project title, organization, date, or explanation step before tailoring. To add context that an upload leaves out, open the collapsed **Additional details** section. Select project, work/internship, or coursework; enter a title, skills used, and rough notes. Organization, dates, and numeric measurements remain optional. The app stores up to 20 examples on your own Postgres profile and selects up to six relevant examples for each job. These facts can support rewritten bullets in Projects, Experience, or Coursework. An existing role can receive additional details when its title and organization match. Your original upload and saved examples remain intact.

With `ANTHROPIC_API_KEY` set only in the server environment, tailoring makes at most two AI requests: an initial rewrite and one additional revision when recoverable supported gaps remain below target. Each request has a 45-second timeout, no automatic SDK retries, and an 8,000-token output limit. The server validates and scores each candidate and retains the best supported result, including the rules-based candidate. Tests mock AI requests and use isolated databases.

Scores, keyword indicators, and formatting checks for a tailored resume use its final report. Saved resumes are bound to the current source resume, relevant profile/account fields, job contents, and scoring version. Editing these inputs makes an older version unavailable for download until **Re-tailor resume** regenerates it; its database row remains intact. Older saved reports also require regeneration after this scoring update.

## Accounts and email

- **Sign-up** creates an unverified account and emails a 6-digit code. The user can't log in until they enter it. Accounts created before verification existed stay verified.
- **Forgot password** emails a reset code. It always gives the same answer, so it can't reveal who has an account. Resetting signs out every other session and sends a "your password was changed" email.
- **Codes** expire after 10 minutes, allow 5 wrong attempts, can be resent once a minute, and are stored only as a keyed hash.
- **Rate limits** per IP: 10 sign-up/login/code requests per 15 minutes, 30 verify/reset attempts per 15 minutes, 300 API requests per minute.
- **Passwords** need at least 8 characters. They are never stored: the database keeps only `bcrypt(HMAC-SHA256(PASSWORD_PEPPER, password))`. The pepper is a secret key kept in the server environment, not the database, so a stolen database alone can't be used to crack passwords.

### Sending real email with Brevo (recommended)

The server can send through [Brevo](https://www.brevo.com)'s HTTP API using an API key and a verified sender address. One app-owned sender sends codes to each user's email address from the sign-up or reset request; you do not configure a sender for every user. You can use a project or business address as the sender; no personal Gmail address or mailbox password is required. User accounts, password hashes and profiles stay in your configured Postgres database. Brevo receives the sender, recipient address and email contents needed for delivery.

1. Create a free Brevo account.
2. Under **Settings > Senders, Domains, IPs > Senders**, add a single sender address you control and complete the verification code Brevo emails to it. See [Brevo's sender setup guide](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email).
3. Under **SMTP & API > API Keys**, generate an API key and copy it when it is displayed. Grant **Transactional email: All** for sending and the app's scoped checks. **Account: Read** is not required by startup or `mail:check`. See [Brevo's API key guide](https://developers.brevo.com/docs/api-key-authentication) and [API permissions guide](https://help.brevo.com/hc/en-us/articles/40158277171474-About-API-key-permissions).
4. In `server/.env`, set:
   ```
   BREVO_API_KEY=xkeysib-...
   MAIL_FROM="YoursJobMate <the-sender-you-verified@example.com>"
   ```
5. If Brevo blocks the calling IP, authorize your trusted machine's public outbound IP using the steps below. Authorize your production host's outbound IP separately before deployment.
6. From the repository root, run `npm --prefix server run mail:check`, then restart the server. Startup should show `[mail] Mode: Brevo API ready`; failures include Brevo's error message.
7. Sign up with a recipient email address you can check (for example, Gmail), enter the received verification code, then try **Forgot password** for the same account. Recipients do not need to be configured as Brevo senders. If a message is missing, check spam, the server logs and Brevo's transactional email logs.

If both `BREVO_API_KEY` and `SMTP_HOST` are set, Brevo is used. Leave `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` empty when using only Brevo. For better delivery to Gmail and other inboxes, authenticate your sending domain in Brevo (next section); successful API submission does not guarantee inbox placement.

`mail:check` uses a scoped transactional API read and a [Brevo sandbox request](https://developers.brevo.com/docs/using-sandbox-mode) with `X-Sib-Sandbox: drop`. Brevo sends no email and creates no email log for this check. Success confirms API access and request format; it does not verify sender ownership or inbox delivery.

For Brevo access errors:

- **401 with `unrecognised IP address`:** As the account owner, open [Security > Authorized IPs](https://app.brevo.com/security/authorised_ips), click **Authorize IP addresses**, enter the trusted public outbound IPv4/IPv6 reported by Brevo for this machine or host, and confirm. You can also authorize a recognized entry in **Unauthorized IP addresses**. Keep IP security enabled. Local network or VPN changes can change your public IP; production must authorize every actual outbound IP used by the host. See [Brevo's IP authorization guide](https://help.brevo.com/hc/en-us/articles/5740111683858-Authorize-and-block-IP-addresses-for-API-and-SMTP-security).
- **403 / `Access denied for resource`:** Edit the API key actually configured on the server and grant **Transactional email: All**; then rerun `mail:check`. Changing key permissions does not authorize a blocked IP.
- **Sender errors or missing delivery:** Set `MAIL_FROM` to your exact verified sender, confirm its domain authentication and transactional sending status, and inspect **Transactional > Logs** after a real sign-up or reset. A successful sandbox check does not establish sender verification.

### Choosing an email provider

The existing SMTP option remains available: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`, and leave `BREVO_API_KEY` empty. `server/.env.example` includes settings for these transactional email providers:

| Provider | Delivery option |
| --- | --- |
| [Resend](https://resend.com) | SMTP |
| [Brevo](https://www.brevo.com) | HTTP API or SMTP |
| [SendGrid](https://sendgrid.com) | SMTP |
| [Amazon SES](https://aws.amazon.com/ses/) | SMTP |

Whichever you choose:

1. Buy or use a domain you own (for example `yoursjobmate.com`).
2. Add the domain in your provider's dashboard and copy the DNS names, types and values it supplies to your DNS provider. For Brevo, follow its [domain authentication guide](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC) for its verification, DKIM and DMARC records, plus any other records it requests. Use your account's actual values and wait for Brevo to confirm authentication.
3. Set `MAIL_FROM` to an address on that domain, such as `YoursJobMate <no-reply@yoursjobmate.com>`.
4. Start the server and look for `[mail] Mode: Brevo API ready` or `[mail] Mode: SMTP ready` in the logs. If the key or login is wrong, the log line says the check failed and gives the reason.

## Deploy to production

The default deployment is one Node service serving the built React website, `/api` and `/socket.io` from the same HTTPS origin. Accounts, profiles, resumes and applications live in the PostgreSQL database selected by `DATABASE_URL`. Deploy one app instance initially: rate limits and the background application agent currently run in that process.

The repository supplies the database connection, email delivery and production build. You still need to create the hosting and database accounts, configure your sender and DNS, add runtime secrets, and complete a real delivery check before publishing.

### 1. Create the shared hosted database

1. Create a persistent PostgreSQL database with your chosen host, such as [Neon](https://neon.tech) or [Supabase](https://supabase.com), near your app's hosting region.
2. Copy its server connection string and follow the provider's TLS and certificate authority (CA) instructions. Put the actual value in the app host's **server runtime** `DATABASE_URL` secret. All app instances must use the same database.
3. Enable backups and confirm you can restore them. The app creates its tables on startup; production rejects an empty or malformed URL and known placeholder patterns such as `[YOUR-PASSWORD]` or `change-me`.

For cloud URLs without explicit TLS options, the app enables TLS with certificate verification. URL options such as `sslmode`, `sslrootcert`, `sslcert` and `sslkey` take precedence; use the provider's supported settings and CA files when needed. Resolve certificate failures using its TLS instructions instead of globally disabling verification. See [node-postgres TLS configuration](https://node-postgres.com/features/ssl).

PGlite and `docker-compose.yml` are local development options. Deploying a new app container must not create a fresh local account database. Existing PGlite accounts are not migrated automatically; arrange a data migration if those accounts must be kept. Preserve the password pepper used to create any accounts you migrate.

For the older SQLite version, the existing `npm --prefix server run migrate:sqlite` command can copy its accounts after you configure `DATABASE_URL`; it does not migrate PGlite.

### 2. Configure your business sender

1. Add a domain you own to Brevo and authenticate it using the exact DNS records supplied in your Brevo dashboard. Do not use example DNS values or attempt to authenticate `gmail.com`.
2. Create one sender on that domain, for example `YoursJobMate <no-reply@example.com>` with your real business domain replacing `example.com`. Complete sender verification and confirm transactional sending is enabled for the account.
3. Generate a Brevo API key under **SMTP & API > API Keys** with **Transactional email: All**. Save it as the app host's server runtime `BREVO_API_KEY` secret, and set `MAIL_FROM` to that verified sender. Keep `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` empty when using Brevo alone.
4. In [Brevo's Authorized IPs](https://app.brevo.com/security/authorised_ips), authorize the production host's trusted outbound IP addresses. Confirm the host's egress addresses with your provider; authorizing a local development IP does not authorize the deployed server.

Every sign-up verification and password reset uses this sender and the requesting user's recipient address. Users do not need a Brevo account or any mailbox password in your app.

### 3. Set stable server configuration

Set these in the host's **server runtime environment**, rather than frontend build settings:

| Setting | Value or requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Your shared hosted Postgres connection string; no development or placeholder credentials |
| `JWT_SECRET` | An independent random value of at least 32 characters; keep stable across deploys and instances |
| `PASSWORD_PEPPER` | A different random value of at least 32 characters; preserve it permanently once users exist |
| `BREVO_API_KEY` | Your Brevo API key |
| `MAIL_FROM` | Your single verified business sender, including its actual email address |
| `PORT` | The port supplied by the host, or `4000` if it does not supply one |
| `TRUST_PROXY` | The host's actual trusted proxy hop count or trusted IP/subnet list; leave empty for a direct connection |
| `CORS_ORIGIN` | Empty for the default same-origin deployment; exact allowed frontend origins if your architecture requires CORS |

Generate each secret separately with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Production rejects missing or short authentication secrets, equal secrets, and known placeholder patterns such as `change-me` and `dev-secret`. Store both secrets in your host's secret manager and keep secure backups. Never generate new values on each deploy. Changing `JWT_SECRET` signs users out and invalidates pending codes; changing `PASSWORD_PEPPER` prevents existing passwords from working.

Keep `DATABASE_URL`, `JWT_SECRET`, `PASSWORD_PEPPER` and `BREVO_API_KEY` out of `client/.env`, `VITE_*` variables, source code and Docker build arguments. [Vite embeds `VITE_*` values into browser bundles](https://vite.dev/guide/env-and-mode#env-variables), so those values are public. Local `server/.env` remains ignored by Git.

Confirm the proxy topology with your hosting provider before setting `TRUST_PROXY`: `1` means exactly one trusted hop, and is not a universal hosting default. The trusted proxy must overwrite forwarded headers. See [Express's proxy configuration guide](https://expressjs.com/en/guide/behind-proxies/).

### 4. Build and host over HTTPS

For a managed container host, deploy this repository's `Dockerfile`, set the server runtime variables above, and route your HTTPS domain to the container's `PORT`. The Dockerfile uses `node:22-slim`, builds the client and starts the Express server; configure `GET /api/health` as the health check. Enable WebSocket forwarding for Socket.IO.

For a VPS, build the image and run it behind your HTTPS reverse proxy after you put the production values in the ignored `server/.env` file:

```bash
docker build -t yoursjobmate .
docker run -d -p 127.0.0.1:4000:4000 --env-file server/.env -e NODE_ENV=production yoursjobmate
```

To deploy without Docker, install dependencies and build from the repository root:

```bash
npm --prefix server ci --omit=dev
npm --prefix client ci --include=dev
npm run build
npm start
```

Set `NODE_ENV=production` and the other runtime variables in the host before running `npm start`. Keep `client/dist` with the server: Express serves it automatically. Your host or reverse proxy must provide HTTPS for the public domain and forward requests to Express, including `/api` and `/socket.io`.

The bundled client uses relative `/api` requests and same-origin Socket.IO. If you host static frontend files separately, configure that frontend domain's proxy to forward `/api` and `/socket.io` to the server. Merely setting `CORS_ORIGIN` does not change the client's API destination; separate API base URLs require a client change.

### 5. Verify the published flows

1. Check `https://<your-app-domain>/api/health` returns `ok: true` and `db: "postgres"`.
2. Run `npm --prefix server run mail:check` in the deployed runtime and confirm startup logs show `[mail] Mode: Brevo API ready`. These check scoped API access and sandbox request format; they do not prove that your sender is verified or a message reached an inbox.
3. Sign up with an inbox you control, receive the verification email from your business sender, enter its code, and log in. Try another recipient address to confirm recipients come from user requests.
4. Use **Forgot password**, receive and use its reset code, then confirm the new password works and the old password and old sessions fail. Restart or redeploy the app and verify the account still works.
5. For a missing message, check server provider errors and **Brevo > Transactional > Logs** for the recipient and message status. API acceptance means Brevo accepted the request; even a `Delivered` event means the recipient mail server accepted the email, which can still land in spam or another folder. See [Brevo's log guide](https://help.brevo.com/hc/en-us/articles/360021533839-Manage-your-transactional-logs-and-email-previews) and [delivery status explanation](https://help.brevo.com/hc/en-us/articles/35699922048146-View-and-export-your-event-logs).

### Scaling beyond one server

Before running several app instances, use a shared rate-limit store, coordinate Socket.IO state and move the background agent into a separately scheduled worker so several instances do not process the same applications. A shared Postgres connection alone does not coordinate these pieces.

## Keeping jobs fresh 24/7

The web server refreshes jobs from the company career sites every 15 minutes while it runs (`SYNC_EVERY_MS`). Adzuna, USAJOBS and JSearch refresh every 6 hours (`API_SYNC_EVERY_MS`), because their free plans cap requests. To refresh them around the clock, even while your computer or server is off, use the included GitHub Action:

1. Push this repository to GitHub.
2. In the repository, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `DATABASE_URL` and paste the same connection string as in `server/.env`. Optionally add `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `USAJOBS_API_KEY`, `USAJOBS_EMAIL` and `JSEARCH_API_KEY`.
3. Open the **Actions** tab, choose **Sync jobs**, and click **Run workflow** to test it. After that it runs every 30 minutes by itself, and each run's log shows how many jobs were added and removed.

When the Action is running, you can set `SYNC_EVERY_MS=0` on the web server so it doesn't sync too. To sync once by hand: `cd server && npm run sync:jobs`.

## Tests

```bash
npm test
```

The mailer tests mock `fetch` to check Brevo requests, provider errors and delivery mode selection without sending real emails. API tests use in-memory PGlite by default; `TEST_DATABASE_URL` optionally selects a separate, empty Postgres database.

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
