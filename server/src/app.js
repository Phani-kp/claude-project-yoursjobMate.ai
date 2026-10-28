import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, STATUSES } from './db.js';
import { requireAuth, signToken } from './auth.js';
import { rankedJobsFor, syncJobs } from './jobs.js';
import { aiEnabled } from './ai.js';
import { applyToJob, getApplication, getProfile, logEvent, runAgentForUser, updateApplication } from './agent.js';

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'data/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 5 * 1024 * 1024 } });

const PROFILE_FIELDS = ['headline', 'phone', 'linkedin', 'resume_text', 'skills', 'titles', 'locations', 'remote_only', 'experience_years', 'min_salary', 'auto_apply', 'daily_limit', 'min_match'];
const APP_EDITABLE = ['status', 'notes', 'title', 'company', 'location', 'url'];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, ai: aiEnabled() }));

  // ---- Auth ----
  app.post('/api/auth/signup', wrap(async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || password.length < 6 || !name) return res.status(400).json({ error: 'Name, email and a password of at least 6 characters are required' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) return res.status(409).json({ error: 'An account with this email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const r = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email.toLowerCase(), name, hash);
    db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(r.lastInsertRowid);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  }));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const user = email && db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ token: signToken(user), user: publicUser(user) });
  }));

  app.use('/api', requireAuth);

  app.get('/api/me', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user: publicUser(user), ai: aiEnabled() });
  });

  // ---- Profile / preferences ----
  app.get('/api/profile', (req, res) => res.json(getProfile(req.user.id)));

  app.put('/api/profile', (req, res) => {
    const fields = Object.fromEntries(PROFILE_FIELDS.filter((k) => k in req.body).map((k) => [k, typeof req.body[k] === 'boolean' ? Number(req.body[k]) : req.body[k]]));
    const keys = Object.keys(fields);
    if (keys.length) db.prepare(`UPDATE profiles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`).run(...keys.map((k) => fields[k]), req.user.id);
    if ('auto_apply' in fields) logEvent(req.user.id, null, 'agent', fields.auto_apply ? 'Auto-apply agent turned on' : 'Auto-apply agent paused');
    res.json(getProfile(req.user.id));
  });

  app.post('/api/profile/resume', upload.single('resume'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const isText = /\.(txt|md)$/i.test(req.file.originalname) || req.file.mimetype.startsWith('text/');
    const update = { resume_file: req.file.originalname };
    if (isText) update.resume_text = fs.readFileSync(req.file.path, 'utf8').slice(0, 20000);
    db.prepare(`UPDATE profiles SET ${Object.keys(update).map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`).run(...Object.values(update), req.user.id);
    res.json(getProfile(req.user.id));
  });

  // ---- Jobs ----
  app.get('/api/jobs', (req, res) => {
    const profile = getProfile(req.user.id);
    res.json(rankedJobsFor(req.user.id, profile, { search: req.query.search || '', limit: Math.min(Number(req.query.limit) || 50, 200), onlyNew: req.query.onlyNew === '1' }));
  });

  app.post('/api/jobs/sync', wrap(async (req, res) => {
    const profile = getProfile(req.user.id);
    res.json(await syncJobs((profile.titles || '').split(',').map((s) => s.trim()).filter(Boolean)));
  }));

  app.post('/api/jobs/:id/apply', (req, res) => {
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    applyToJob(req.user.id, job.id, 'one-click').catch((e) => console.error(e));
    res.status(202).json({ ok: true });
  });

  // ---- Applications (the "Applied Jobs" page) ----
  app.get('/api/applications', (req, res) => {
    const { status, search, method, sort = 'created_at', order = 'desc' } = req.query;
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
    if (method && method !== 'all') { where.push('method = ?'); params.push(method); }
    if (search) { where.push('(title LIKE ? OR company LIKE ? OR location LIKE ?)'); params.push(...Array(3).fill(`%${search}%`)); }
    const sortCol = ['created_at', 'applied_at', 'match_score', 'company', 'status', 'updated_at'].includes(sort) ? sort : 'created_at';
    const dir = order === 'asc' ? 'ASC' : 'DESC';
    res.json(db.prepare(`SELECT * FROM applications WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${dir}, id DESC`).all(...params));
  });

  app.post('/api/applications', (req, res) => {
    const { title, company, location = '', url = '', status = 'applied', notes = '' } = req.body || {};
    if (!title || !company) return res.status(400).json({ error: 'Title and company are required' });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const r = db.prepare(`INSERT INTO applications (user_id, title, company, location, url, status, notes, method, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)`).run(req.user.id, title, company, location, url, status, notes, new Date().toISOString());
    const created = getApplication(r.lastInsertRowid, req.user.id);
    req.app.get('io')?.to(`user:${req.user.id}`).emit('application:new', created);
    logEvent(req.user.id, created.id, 'manual', `Added ${title} at ${company}`);
    res.status(201).json(created);
  });

  app.get('/api/applications/:id', (req, res) => {
    const found = getApplication(req.params.id, req.user.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const events = db.prepare('SELECT * FROM events WHERE application_id = ? ORDER BY id DESC').all(found.id);
    const job = found.job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(found.job_id) : null;
    res.json({ ...found, events, job });
  });

  app.patch('/api/applications/:id', (req, res) => {
    const found = getApplication(req.params.id, req.user.id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    const fields = Object.fromEntries(APP_EDITABLE.filter((k) => k in (req.body || {})).map((k) => [k, req.body[k]]));
    if (fields.status && !STATUSES.includes(fields.status)) return res.status(400).json({ error: 'Invalid status' });
    const updated = updateApplication(found.id, req.user.id, fields);
    if (fields.status && fields.status !== found.status) logEvent(req.user.id, found.id, 'status', `${found.company}: ${found.status} → ${fields.status}`);
    res.json(updated);
  });

  app.delete('/api/applications/:id', (req, res) => {
    const r = db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!r.changes) return res.status(404).json({ error: 'Not found' });
    req.app.get('io')?.to(`user:${req.user.id}`).emit('application:delete', { id: Number(req.params.id) });
    res.status(204).end();
  });

  // ---- Dashboard stats & activity ----
  app.get('/api/stats', (req, res) => {
    const uid = req.user.id;
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of db.prepare('SELECT status, COUNT(*) AS c FROM applications WHERE user_id = ? GROUP BY status').all(uid)) byStatus[r.status] = r.c;
    const submitted = ['applied', 'viewed', 'interview', 'offer', 'rejected'].reduce((n, s) => n + byStatus[s], 0);
    const responded = byStatus.viewed + byStatus.interview + byStatus.offer + byStatus.rejected;
    const days = db.prepare(`SELECT date(COALESCE(applied_at, created_at)) AS day, COUNT(*) AS c FROM applications
      WHERE user_id = ? AND date(COALESCE(applied_at, created_at)) >= date('now', '-13 days') GROUP BY day`).all(uid);
    const perDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10);
      return { day: d, count: days.find((x) => x.day === d)?.c || 0 };
    });
    const today = perDay[13].count;
    const profile = getProfile(uid);
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
  });

  app.get('/api/events', (req, res) => {
    res.json(db.prepare('SELECT * FROM events WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(req.user.id, Math.min(Number(req.query.limit) || 30, 200)));
  });

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
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
