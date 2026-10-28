import { db, csv } from './db.js';
import { matchScore, rankedJobsFor, syncJobs } from './jobs.js';
import { generateCoverLetter } from './ai.js';

let io = null;
export const setIo = (server) => { io = server; };

const emit = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);

/** The user's profile, without the stored resume file itself. */
export async function getProfile(userId) {
  const row = await db.get('SELECT * FROM profiles WHERE user_id = ?', userId);
  if (!row) return row;
  const { resume_data: _file, ...profile } = row;
  return profile;
}
export const getApplication = (id, userId) => db.get('SELECT * FROM applications WHERE id = ? AND user_id = ?', id, userId);

export async function logEvent(userId, applicationId, type, message) {
  const { rows: [event] } = await db.run('INSERT INTO events (user_id, application_id, type, message) VALUES (?, ?, ?, ?) RETURNING *', userId, applicationId, type, message);
  emit(userId, 'event:new', event);
}

export async function updateApplication(id, userId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return getApplication(id, userId);
  const { rows: [app] } = await db.run(`UPDATE applications SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = now() WHERE id = ? AND user_id = ? RETURNING *`,
    ...keys.map((k) => fields[k]), id, userId);
  if (app) emit(userId, 'application:update', app);
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
  const job = await db.get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw new Error('Job not found');
  const user = await db.get('SELECT id, name, email FROM users WHERE id = ?', userId);
  const profile = await getProfile(userId);
  // ON CONFLICT makes double-clicks and overlapping agent runs safe: only one application per job is ever created.
  const { rows: [created] } = await db.run(`INSERT INTO applications (user_id, job_id, title, company, location, url, status, match_score, method)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?) ON CONFLICT (user_id, job_id) DO NOTHING RETURNING *`,
    userId, jobId, job.title, job.company, job.location, job.url, matchScore(job, profile), method);
  if (!created) return db.get('SELECT * FROM applications WHERE user_id = ? AND job_id = ?', userId, jobId);
  const id = created.id;
  emit(userId, 'application:new', created);
  await logEvent(userId, id, 'queued', `Queued ${job.title} at ${job.company}`);

  try {
    await updateApplication(id, userId, { status: 'applying' });
    const coverLetter = await generateCoverLetter(job, profile, user);
    await updateApplication(id, userId, { cover_letter: coverLetter });
    await logEvent(userId, id, 'tailored', `Tailored cover letter for ${job.company}`);
    const result = await submit(job, profile, coverLetter);
    const app = await updateApplication(id, userId, { status: 'applied', applied_at: new Date().toISOString(), notes: result.note || '' });
    await logEvent(userId, id, 'applied', `Applied to ${job.title} at ${job.company}`);
    return app;
  } catch (e) {
    await logEvent(userId, id, 'failed', `Failed to apply at ${job.company}: ${e.message}`);
    return updateApplication(id, userId, { status: 'failed', notes: e.message });
  }
}

const running = new Set();

/** One pass of the auto-apply agent for a single user. */
export async function runAgentForUser(userId) {
  if (running.has(userId)) return { skipped: true };
  running.add(userId);
  try {
    const profile = await getProfile(userId);
    if (!profile) return { applied: 0 };
    const { c: today } = await db.get(`SELECT COUNT(*) AS c FROM applications
      WHERE user_id = ? AND method = 'auto' AND (created_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date`, userId);
    const budget = Math.max(0, profile.daily_limit - today);
    if (!budget) return { applied: 0, reason: 'Daily limit reached' };
    const candidates = (await rankedJobsFor(userId, profile, { onlyNew: true, limit: 200 }))
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
        const terms = [...new Set((await db.all('SELECT titles FROM profiles WHERE auto_apply = 1')).flatMap((p) => csv(p.titles)))];
        const r = await syncJobs(terms);
        console.log(`[jobs] synced +${r.added}`, r.errors.length ? r.errors : '');
      }
      // Only verified accounts: an unverified sign-up must never trigger applications.
      for (const { user_id } of await db.all('SELECT p.user_id FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.auto_apply = 1 AND u.verified = 1')) {
        await runAgentForUser(user_id);
      }
    } catch (e) {
      console.error('[agent]', e);
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}
