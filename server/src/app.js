import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { rateLimit } from 'express-rate-limit';
import { db, STATUSES } from './db.js';
import { requireAuth } from './auth.js';
import { authRouter, publicUser } from './authRoutes.js';
import { rankedJobsFor, syncJobs } from './jobs.js';
import { aiEnabled } from './ai.js';
import { applyToJob, getApplication, getProfile, logEvent, runAgentForUser, updateApplication } from './agent.js';

// Resumes are kept in the database (not on the server's disk), so every server instance sees them.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PROFILE_FIELDS = ['headline', 'phone', 'linkedin', 'resume_text', 'skills', 'titles', 'locations', 'remote_only', 'experience_years', 'min_salary', 'auto_apply', 'daily_limit', 'min_match'];
const NUMERIC_FIELDS = new Set(['remote_only', 'experience_years', 'min_salary', 'auto_apply', 'daily_limit', 'min_match']);
const APP_EDITABLE = ['status', 'notes', 'title', 'company', 'location', 'url'];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
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
  app.get('/api/profile', wrap(async (req, res) => res.json(await getProfile(req.user.id))));

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
    const isText = /\.(txt|md)$/i.test(req.file.originalname) || req.file.mimetype.startsWith('text/');
    const update = { resume_file: req.file.originalname.slice(0, 255), resume_mime: req.file.mimetype, resume_data: req.file.buffer };
    if (isText) update.resume_text = req.file.buffer.toString('utf8').slice(0, 20000);
    await db.run(`UPDATE profiles SET ${Object.keys(update).map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`, ...Object.values(update), req.user.id);
    res.json(await getProfile(req.user.id));
  }));

  app.get('/api/profile/resume', wrap(async (req, res) => {
    const row = await db.get('SELECT resume_file, resume_mime, resume_data FROM profiles WHERE user_id = ?', req.user.id);
    if (!row?.resume_data) return res.status(404).json({ error: 'No resume uploaded' });
    res.type(row.resume_mime || 'application/octet-stream').attachment(row.resume_file || 'resume').send(Buffer.from(row.resume_data));
  }));

  // ---- Jobs ----
  app.get('/api/jobs', wrap(async (req, res) => {
    const profile = await getProfile(req.user.id);
    res.json(await rankedJobsFor(req.user.id, profile, { search: String(req.query.search || ''), limit: Math.min(Number(req.query.limit) || 50, 200), onlyNew: req.query.onlyNew === '1' }));
  }));

  app.post('/api/jobs/sync', wrap(async (req, res) => {
    const profile = await getProfile(req.user.id);
    res.json(await syncJobs((profile.titles || '').split(',').map((s) => s.trim()).filter(Boolean)));
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
