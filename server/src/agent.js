import { db, csv } from './db.js';
import { matchScore, rankedJobsFor, syncJobs } from './jobs.js';
import { generateCoverLetter } from './ai.js';

let io = null;
export const setIo = (server) => { io = server; };

const emit = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);

export const getProfile = (userId) => db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
export const getApplication = (id, userId) => db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(id, userId);

export function logEvent(userId, applicationId, type, message) {
  const r = db.prepare('INSERT INTO events (user_id, application_id, type, message) VALUES (?, ?, ?, ?)').run(userId, applicationId, type, message);
  emit(userId, 'event:new', db.prepare('SELECT * FROM events WHERE id = ?').get(r.lastInsertRowid));
}

export function updateApplication(id, userId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getApplication(id, userId);
  db.prepare(`UPDATE applications SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(...keys.map((k) => fields[k]), id, userId);
  const app = getApplication(id, userId);
  emit(userId, 'application:update', app);
  return app;
}

/**
 * Submits the application to the employer.
 * APPLY_MODE=simulate (default) records the application and prepared materials without contacting the employer.
 * Plug real integrations here (e.g. Greenhouse / Lever job-board APIs, or a browser-automation worker).
 */
async function submit(job) {
  const mode = process.env.APPLY_MODE || 'simulate';
  await new Promise((r) => setTimeout(r, Number(process.env.APPLY_DELAY_MS ?? 1500)));
  if (mode === 'simulate') return { ok: true, note: 'Simulated submission (APPLY_MODE=simulate)' };
  throw new Error(`Unknown APPLY_MODE "${mode}"`);
}

/** Queue -> tailor cover letter -> submit, emitting each step in real time. */
export async function applyToJob(userId, jobId, method = 'auto') {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error('Job not found');
  const existing = db.prepare('SELECT * FROM applications WHERE user_id = ? AND job_id = ?').get(userId, jobId);
  if (existing) return existing;

  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
  const profile = getProfile(userId);
  const r = db.prepare(`INSERT INTO applications (user_id, job_id, title, company, location, url, status, match_score, method)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`).run(userId, jobId, job.title, job.company, job.location, job.url, matchScore(job, profile), method);
  const id = Number(r.lastInsertRowid);
  emit(userId, 'application:new', getApplication(id, userId));
  logEvent(userId, id, 'queued', `Queued ${job.title} at ${job.company}`);

  try {
    updateApplication(id, userId, { status: 'applying' });
    const coverLetter = await generateCoverLetter(job, profile, user);
    updateApplication(id, userId, { cover_letter: coverLetter });
    logEvent(userId, id, 'tailored', `Tailored cover letter for ${job.company}`);
    const result = await submit(job, profile, coverLetter);
    const app = updateApplication(id, userId, { status: 'applied', applied_at: new Date().toISOString(), notes: result.note || '' });
    logEvent(userId, id, 'applied', `Applied to ${job.title} at ${job.company}`);
    return app;
  } catch (e) {
    logEvent(userId, id, 'failed', `Failed to apply at ${job.company}: ${e.message}`);
    return updateApplication(id, userId, { status: 'failed', notes: e.message });
  }
}

const running = new Set();

/** One pass of the auto-apply agent for a single user. */
export async function runAgentForUser(userId) {
  if (running.has(userId)) return { skipped: true };
  running.add(userId);
  try {
    const profile = getProfile(userId);
    if (!profile) return { applied: 0 };
    const today = db.prepare(`SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND method = 'auto' AND date(created_at) = date('now')`).get(userId).c;
    const budget = Math.max(0, profile.daily_limit - today);
    if (!budget) return { applied: 0, reason: 'Daily limit reached' };
    const candidates = rankedJobsFor(userId, profile, { onlyNew: true, limit: 200 })
      .filter((j) => j.match_score >= profile.min_match)
      .slice(0, budget);
    emit(userId, 'agent:status', { running: true, queued: candidates.length });
    for (const job of candidates) await applyToJob(userId, job.id, 'auto');
    return { applied: candidates.length };
  } finally {
    running.delete(userId);
    emit(userId, 'agent:status', { running: false });
  }
}

/** Background loop: refresh jobs periodically and run the agent for every user with auto-apply on. */
export function startAgent({ intervalMs = 60_000, syncEveryMs = 30 * 60_000 } = {}) {
  let lastSync = 0;
  const tick = async () => {
    try {
      if (Date.now() - lastSync > syncEveryMs) {
        lastSync = Date.now();
        const terms = [...new Set(db.prepare('SELECT titles FROM profiles WHERE auto_apply = 1').all().flatMap((p) => csv(p.titles)))];
        const r = await syncJobs(terms);
        console.log(`[jobs] synced +${r.added}`, r.errors.length ? r.errors : '');
      }
      for (const { user_id } of db.prepare('SELECT user_id FROM profiles WHERE auto_apply = 1').all()) {
        await runAgentForUser(user_id);
      }
    } catch (e) {
      console.error('[agent]', e);
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}
