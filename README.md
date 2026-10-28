# YoursJobMate

An AI job-search co-pilot, inspired by tools like NextGenApply. You set your preferences once. YoursJobMate then pulls fresh job listings, ranks them by how well they match you, writes a tailored cover letter for each one, applies on your behalf and tracks every application on a **real-time Applied Jobs dashboard**.

## MVP features

| Area | What you get |
| --- | --- |
| **Accounts** | Email/password sign-up and login (bcrypt + JWT) |
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
- **Database:** SQLite through Node's built-in `node:sqlite` (no native build step)
- **AI:** Anthropic Claude via `@anthropic-ai/sdk`

```
client/            React app (pages: Dashboard, Job Matches, Applied Jobs, Profile)
server/src/
  index.js         HTTP + Socket.IO server, starts the agent loop
  app.js           REST API routes
  db.js            SQLite schema
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

To turn on AI cover letters, create `server/.env` from `server/.env.example` and set `ANTHROPIC_API_KEY`.

### Production build (one process)

```bash
npm run build
```

```bash
npm start
```

The server serves the built app at http://localhost:4000.

### Tests

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
5. Postgres + Redis job queue (BullMQ) for multi-instance deployments; OAuth login
6. Billing (Stripe) with plan-based daily limits
