import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { rateLimit } from 'express-rate-limit';
import { csv, db, STATUSES } from './db.js';
import { requireAuth } from './auth.js';
import { authRouter, publicUser } from './authRoutes.js';
import { getJob, jobFacets, matchScore, parseFilters, searchJobs, syncBoards, syncJobs, withFit } from './jobs.js';
import { discoverBoards, parseBoardUrl, verifyBoard } from './sources.js';
import { ATS_LABELS, builtInBoards } from './companies.js';
import { aiEnabled } from './ai.js';
import { applySavedJobs, applyToJob, getApplication, getProfile, getTailoredResume, logEvent, runAgentForUser, tailorForJob, updateApplication } from './agent.js';
import { atsReport, detectResumeProfile, extractResumeText, resumeToDocx, resumeToText } from './resume.js';

// Resumes are kept in the database (not on the server's disk), so every server instance sees them.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PROFILE_FIELDS = ['headline', 'phone', 'linkedin', 'resume_text', 'skills', 'titles', 'locations', 'remote_only', 'experience_years', 'min_salary', 'auto_apply', 'daily_limit', 'min_match'];
const NUMERIC_FIELDS = new Set(['remote_only', 'experience_years', 'min_salary', 'auto_apply', 'daily_limit', 'min_match']);
const APP_EDITABLE = ['status', 'notes', 'title', 'company', 'location', 'url'];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fileSafe = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'resume';
const withText = (t) => t && { ...t, text: resumeToText(t.resume) };
const toNumber = (v) => (typeof v === 'boolean' ? Number(v) : Math.trunc(Number(v)) || 0);

export function createApp() {
  const app = express();
  // Behind a load balancer or reverse proxy (Render, Railway, Nginx…) set TRUST_PROXY=1 so rate limits see real client IPs.
  if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(helmet());
  // The production build is served from this same origin, so CORS is only needed for a separately hosted frontend.
  const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : process.env.NODE_ENV !== 'production' }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: Number(process.env.API_RATE_LIMIT) || 300, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } }));

  app.get('/api/health', wrap(async (req, res) => {
    try {
      await db.get('SELECT 1');
      res.json({ ok: true, db: db.kind, ai: aiEnabled() });
    } catch {
      res.status(503).json({ ok: false, error: 'Database unreachable' });
    }
  }));

  app.use('/api/auth', authRouter());

  app.use('/api', requireAuth);

  app.get('/api/me', wrap(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user: publicUser(user), ai: aiEnabled() });
  }));

  // ---- Profile / preferences ----
  app.get('/api/profile', wrap(async (req, res) => {
    const p = await getProfile(req.user.id);
    res.json({ ...p, detected: detectResumeProfile(p.resume_text || '', p) });
  }));

  app.put('/api/profile', wrap(async (req, res) => {
    const body = req.body || {};
    const fields = Object.fromEntries(PROFILE_FIELDS.filter((k) => k in body).map((k) => [k, NUMERIC_FIELDS.has(k) ? toNumber(body[k]) : String(body[k] ?? '')]));
    const keys = Object.keys(fields);
    if (keys.length) await db.run(`UPDATE profiles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`, ...keys.map((k) => fields[k]), req.user.id);
    if ('auto_apply' in fields) await logEvent(req.user.id, null, 'agent', fields.auto_apply ? 'Auto-apply agent turned on' : 'Auto-apply agent paused');
    res.json(await getProfile(req.user.id));
  }));

  app.post('/api/profile/resume', upload.single('resume'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    // PDF, Word and text resumes are read into resume_text, which matching, cover letters and tailoring use.
    const text = await extractResumeText(req.file.buffer, req.file.originalname, req.file.mimetype);
    const update = { resume_file: req.file.originalname.slice(0, 255), resume_mime: req.file.mimetype, resume_data: req.file.buffer, resume_text: text };
    await db.run(`UPDATE profiles SET ${Object.keys(update).map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`, ...Object.values(update), req.user.id);
    res.json(await getProfile(req.user.id));
  }));

  app.get('/api/profile/ats', wrap(async (req, res) => {
    const { resume_text: text } = await getProfile(req.user.id);
    res.json(atsReport(text));
  }));

  app.get('/api/profile/resume', wrap(async (req, res) => {
    const row = await db.get('SELECT resume_file, resume_mime, resume_data FROM profiles WHERE user_id = ?', req.user.id);
    if (!row?.resume_data) return res.status(404).json({ error: 'No resume uploaded' });
    res.type(row.resume_mime || 'application/octet-stream').attachment(row.resume_file || 'resume').send(Buffer.from(row.resume_data));
  }));

  // ---- Jobs ----
  // US jobs from the last 30 days. Filters: q, posted (1|3|7|14|30 days), company, state (2-letter or REMOTE; repeat
  // or separate with |), remote=1, onlyNew=1, sort (recent|match), offset, limit.
  app.get('/api/jobs', wrap(async (req, res) => {
    const profile = await getProfile(req.user.id);
    res.json(await searchJobs(req.user.id, profile, withFit(parseFilters(req.query), profile)));
  }));

  app.get('/api/jobs/facets', wrap(async (req, res) => {
    const profile = await getProfile(req.user.id);
    const f = withFit(parseFilters(req.query), profile);
    res.json({ ...(await jobFacets(req.user.id, f)), detected: detectResumeProfile(profile.resume_text || '', profile) });
  }));

  const syncLimit = rateLimit({ windowMs: 5 * 60_000, limit: 3, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Jobs were refreshed a moment ago. Please try again in a few minutes.' } });
  app.post('/api/jobs/sync', syncLimit, wrap(async (req, res) => {
    const profile = await getProfile(req.user.id);
    res.json(await syncJobs(csv(profile.titles).map((t) => t.toLowerCase())));
  }));

  // ---- Companies: add any company's career site, by name or by link ----
  const discoverLimit = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many company searches. Please wait a few minutes.' } });
  app.post('/api/companies/discover', discoverLimit, wrap(async (req, res) => {
    const input = String(req.body?.query || '').trim().slice(0, 300);
    if (input.length < 2) return res.status(400).json({ error: 'Enter a company name or a careers-page link' });
    const fromLink = parseBoardUrl(input);
    let boards;
    if (fromLink) {
      const existing = builtInBoards().find((b) => b.ats === fromLink.ats && b.token === fromLink.token);
      const name = String(req.body?.name || '').trim() || existing?.name || fromLink.token.split('|')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const counts = await verifyBoard({ ...fromLink, name }).catch(() => ({ jobs: 0, recent: 0 }));
      boards = counts.jobs ? [{ ...fromLink, name, ...counts }] : [];
    } else if (/^https?:\/\/|\.[a-z]{2,}\//i.test(input)) {
      return res.status(400).json({ error: "That link isn't a Greenhouse, Lever, Ashby, Workday, SmartRecruiters or Workable careers page. Open the company's job list and copy the link from there." });
    } else {
      // "hugging face" → "Hugging Face"; names typed with capitals are kept as typed.
      const pretty = input === input.toLowerCase() ? input.replace(/\b\w/g, (c) => c.toUpperCase()) : input;
      boards = await discoverBoards(pretty);
    }
    // Use the built-in name when the company is already listed.
    for (const b of boards) b.name = builtInBoards().find((x) => x.ats === b.ats && x.token === b.token)?.name || b.name;
    if (!boards.length) return res.json({ found: [], message: `We couldn't find a public job board for "${input}". Paste the link to its careers page instead (the page that lists its open jobs).` });
    for (const b of boards) await db.run('INSERT INTO company_boards (ats, token, name, added_by) VALUES (?, ?, ?, ?) ON CONFLICT (ats, token) DO NOTHING', b.ats, b.token, b.name, req.user.id);
    // Pull just these boards now, so their jobs show up straight away.
    const synced = await syncBoards(boards);
    res.json({ found: boards.map((b) => ({ ...b, platform: ATS_LABELS[b.ats] })), synced });
  }));

  // ---- Saved jobs ----
  app.get('/api/saved', wrap(async (req, res) => {
    const rows = await db.all(`SELECT j.id, j.title, j.company, j.location, j.city, j.states, j.remote, j.salary, j.url, j.source, j.posted_ts AS posted_at, s.created_at AS saved_at,
        a.id AS application_id, a.status AS application_status, t.ats_before, t.ats_after
      FROM saved_jobs s JOIN jobs j ON j.id = s.job_id
      LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = s.user_id
      LEFT JOIN tailored_resumes t ON t.job_id = j.id AND t.user_id = s.user_id
      WHERE s.user_id = ? ORDER BY s.created_at DESC`, req.user.id);
    res.json(rows.map((r) => ({ ...r, remote: !!r.remote, saved: true, states: (r.states || '').split(',').filter(Boolean) })));
  }));

  app.post('/api/saved/apply-all', wrap(async (req, res) => {
    const { resume_text: text } = await getProfile(req.user.id);
    if ((text || '').trim().length < 50) return res.status(400).json({ error: 'Upload your resume on the Profile page first, so each application gets a tailored resume.' });
    const r = await applySavedJobs(req.user.id);
    if (r.busy) return res.status(409).json({ error: 'Applications are already being prepared. Watch the progress on Applied Jobs.' });
    res.status(202).json(r);
  }));

  app.put('/api/jobs/:id/save', wrap(async (req, res) => {
    const id = toNumber(req.params.id);
    if (!(await db.get('SELECT id FROM jobs WHERE id = ?', id))) return res.status(404).json({ error: 'Job not found' });
    await db.run('INSERT INTO saved_jobs (user_id, job_id) VALUES (?, ?) ON CONFLICT DO NOTHING', req.user.id, id);
    res.json({ saved: true });
  }));

  app.delete('/api/jobs/:id/save', wrap(async (req, res) => {
    await db.run('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?', req.user.id, toNumber(req.params.id));
    res.json({ saved: false });
  }));

  app.get('/api/jobs/:id', wrap(async (req, res) => {
    const job = await getJob(req.user.id, toNumber(req.params.id));
    if (!job) return res.status(404).json({ error: 'This job is no longer available' });
    res.json({ ...job, match_score: matchScore(job, await getProfile(req.user.id)) });
  }));

  // ---- ATS check and tailored resume for one job ----
  app.get('/api/jobs/:id/ats', wrap(async (req, res) => {
    const job = await db.get('SELECT * FROM jobs WHERE id = ?', toNumber(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { resume_text: text } = await getProfile(req.user.id);
    res.json({ hasResume: (text || '').trim().length >= 50, ...atsReport(text, job), tailored: withText(await getTailoredResume(req.user.id, job.id)) || null });
  }));

  const tailorLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'You have tailored a lot of resumes recently. Please wait a few minutes.' } });
  app.post('/api/jobs/:id/tailor', tailorLimit, wrap(async (req, res) => {
    const list = (v) => (Array.isArray(v) ? v.slice(0, 30).map(String) : []);
    const confirmed = list(req.body?.confirmedSkills);
    const learning = list(req.body?.learningSkills);
    res.json(withText(await tailorForJob(req.user.id, toNumber(req.params.id), confirmed, learning)));
  }));

  app.get('/api/jobs/:id/tailor/docx', wrap(async (req, res) => {
    const t = await getTailoredResume(req.user.id, toNumber(req.params.id));
    if (!t) return res.status(404).json({ error: 'Tailor your resume for this job first' });
    const job = await db.get('SELECT company FROM jobs WHERE id = ?', t.job_id);
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .attachment(`${fileSafe(t.resume.name)}-Resume-${fileSafe(job?.company)}.docx`)
      .send(await resumeToDocx(t.resume));
  }));

  app.post('/api/jobs/:id/apply', wrap(async (req, res) => {
    const job = await db.get('SELECT id FROM jobs WHERE id = ?', toNumber(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    applyToJob(req.user.id, job.id, 'one-click').catch((e) => console.error(e));
    res.status(202).json({ ok: true });
  }));

  // ---- Applications (the "Applied Jobs" page) ----
  app.get('/api/applications', wrap(async (req, res) => {
    const { status, search, method, sort = 'created_at', order = 'desc' } = req.query;
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (status && status !== 'all') { where.push('status = ?'); params.push(String(status)); }
    if (method && method !== 'all') { where.push('method = ?'); params.push(String(method)); }
    if (search) { where.push('(title ILIKE ? OR company ILIKE ? OR location ILIKE ?)'); params.push(...Array(3).fill(`%${search}%`)); }
    const sortCol = ['created_at', 'applied_at', 'match_score', 'company', 'status', 'updated_at'].includes(sort) ? sort : 'created_at';
    const dir = order === 'asc' ? 'ASC' : 'DESC';
    res.json(await db.all(`SELECT * FROM applications WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${dir} NULLS LAST, id DESC`, ...params));
  }));

  app.post('/api/applications', wrap(async (req, res) => {
    const { title, company, location = '', url = '', status = 'applied', notes = '' } = req.body || {};
    if (!title || !company) return res.status(400).json({ error: 'Title and company are required' });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows: [created] } = await db.run(`INSERT INTO applications (user_id, title, company, location, url, status, notes, method, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', now()) RETURNING *`, req.user.id, title, company, location, url, status, notes);
    req.app.get('io')?.to(`user:${req.user.id}`).emit('application:new', created);
    await logEvent(req.user.id, created.id, 'manual', `Added ${title} at ${company}`);
    res.status(201).json(created);
  }));

  app.get('/api/applications/:id', wrap(async (req, res) => {
    const found = await getApplication(toNumber(req.params.id), req.user.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const events = await db.all('SELECT * FROM events WHERE application_id = ? ORDER BY id DESC', found.id);
    const job = found.job_id ? await db.get('SELECT * FROM jobs WHERE id = ?', found.job_id) : null;
    res.json({ ...found, events, job });
  }));

  app.patch('/api/applications/:id', wrap(async (req, res) => {
    const found = await getApplication(toNumber(req.params.id), req.user.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const fields = Object.fromEntries(APP_EDITABLE.filter((k) => k in (req.body || {})).map((k) => [k, req.body[k]]));
    if (fields.status && !STATUSES.includes(fields.status)) return res.status(400).json({ error: 'Invalid status' });
    const updated = await updateApplication(found.id, req.user.id, fields);
    if (fields.status && fields.status !== found.status) await logEvent(req.user.id, found.id, 'status', `${found.company}: ${found.status} → ${fields.status}`);
    res.json(updated);
  }));

  app.delete('/api/applications/:id', wrap(async (req, res) => {
    const id = toNumber(req.params.id);
    const r = await db.run('DELETE FROM applications WHERE id = ? AND user_id = ?', id, req.user.id);
    if (!r.count) return res.status(404).json({ error: 'Not found' });
    req.app.get('io')?.to(`user:${req.user.id}`).emit('application:delete', { id });
    res.status(204).end();
  }));

  // ---- Dashboard stats & activity ----
  app.get('/api/stats', wrap(async (req, res) => {
    const uid = req.user.id;
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of await db.all('SELECT status, COUNT(*) AS c FROM applications WHERE user_id = ? GROUP BY status', uid)) byStatus[r.status] = r.c;
    const submitted = ['applied', 'viewed', 'interview', 'offer', 'rejected'].reduce((n, s) => n + byStatus[s], 0);
    const responded = byStatus.viewed + byStatus.interview + byStatus.offer + byStatus.rejected;
    const days = await db.all(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(*) AS c FROM (
        SELECT (COALESCE(applied_at, created_at) AT TIME ZONE 'UTC')::date AS d FROM applications WHERE user_id = ?
      ) t WHERE d >= (now() AT TIME ZONE 'UTC')::date - 13 GROUP BY d`, uid);
    const perDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10);
      return { day: d, count: days.find((x) => x.day === d)?.c || 0 };
    });
    const today = perDay[13].count;
    const profile = await getProfile(uid);
    res.json({
      total: submitted,
      today,
      byStatus,
      interviews: byStatus.interview,
      offers: byStatus.offer,
      responseRate: submitted ? Math.round((responded / submitted) * 100) : 0,
      perDay,
      agent: { enabled: !!profile.auto_apply, dailyLimit: profile.daily_limit, minMatch: profile.min_match },
    });
  }));

  app.get('/api/events', wrap(async (req, res) => {
    res.json(await db.all('SELECT * FROM events WHERE user_id = ? ORDER BY id DESC LIMIT ?', req.user.id, Math.min(Number(req.query.limit) || 30, 200)));
  }));

  app.post('/api/agent/run', (req, res) => {
    runAgentForUser(req.user.id).catch((e) => console.error(e));
    res.status(202).json({ ok: true });
  });

  // Serve the built React app in production.
  const dist = path.resolve(import.meta.dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err, req, res, _next) => {
    if (err.expose) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
