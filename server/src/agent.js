import { db, csv } from './db.js';
import { ensureJobDetails, matchScore, rankedJobsFor, syncJobs } from './jobs.js';
import { AI_MODEL, aiClient, generateCoverLetter } from './ai.js';
import { tailorResume } from './resume.js';

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

const parseTailored = (row) => row && { ...row, ai: !!row.ai, resume: JSON.parse(row.resume), changes: JSON.parse(row.changes), report: JSON.parse(row.report) };

export const getTailoredResume = async (userId, jobId) =>
  parseTailored(await db.get('SELECT * FROM tailored_resumes WHERE user_id = ? AND job_id = ?', userId, jobId));

/**
 * Creates (or replaces) the user's ATS-tailored resume for a job and saves it.
 * confirmedSkills: missing job keywords the user has confirmed they really have.
 * learningSkills: missing job keywords the user is actively learning (listed under Professional Development).
 */
export async function tailorForJob(userId, jobId, confirmedSkills = [], learningSkills = []) {
  await ensureJobDetails(jobId);
  const job = await db.get('SELECT * FROM jobs WHERE id = ?', jobId);
  if (!job) throw Object.assign(new Error('Job not found'), { status: 404, expose: true });
  const user = await db.get('SELECT id, name, email FROM users WHERE id = ?', userId);
  const profile = await getProfile(userId);
  const t = await tailorResume({ resumeText: profile.resume_text, profile, user, job, aiClient, model: AI_MODEL, confirmedSkills, learningSkills });
  const report = { before: t.before, after: t.after, gap: t.gap, removed: t.removed };
  const { rows: [row] } = await db.run(`INSERT INTO tailored_resumes (user_id, job_id, resume, changes, ats_before, ats_after, report, ai)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, job_id) DO UPDATE SET resume = EXCLUDED.resume, changes = EXCLUDED.changes, ats_before = EXCLUDED.ats_before,
      ats_after = EXCLUDED.ats_after, report = EXCLUDED.report, ai = EXCLUDED.ai, created_at = now()
    RETURNING *`, userId, jobId, JSON.stringify(t.resume), JSON.stringify(t.changes), t.before.score, t.after.score, JSON.stringify(report), t.ai ? 1 : 0);
  return parseTailored(row);
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
  await ensureJobDetails(jobId);
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
    if ((profile.resume_text || '').trim().length >= 50) {
      // A resume problem shouldn't stop the application; it is sent with the cover letter alone.
      const tailored = await tailorForJob(userId, jobId).catch((e) => { console.error('[agent] resume tailoring failed:', e.message); return null; });
      if (tailored) await logEvent(userId, id, 'tailored', `Tailored resume for ${job.company} (ATS match ${tailored.ats_before}% → ${tailored.ats_after}%)`);
    }
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

/**
 * "Apply to all saved jobs": for each saved job not applied to yet, tailors the resume and cover letter and applies,
 * one after another, with live progress. Returns how many were queued.
 */
export async function applySavedJobs(userId) {
  const jobs = await db.all(`SELECT s.job_id FROM saved_jobs s WHERE s.user_id = ?
    AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = s.user_id AND a.job_id = s.job_id) ORDER BY s.created_at`, userId);
  if (!jobs.length || running.has(userId)) return { queued: 0, busy: running.has(userId) };
  running.add(userId);
  (async () => {
    try {
      emit(userId, 'agent:status', { running: true, queued: jobs.length });
      for (const { job_id } of jobs) await applyToJob(userId, job_id, 'one-click').catch((e) => console.error('[apply-saved]', e.message));
    } finally {
      running.delete(userId);
      emit(userId, 'agent:status', { running: false });
    }
  })();
  return { queued: jobs.length };
}

/** Background loop: refresh jobs periodically and run the agent for every user with auto-apply on. */
export function startAgent({ intervalMs = 60_000, syncEveryMs = process.env.SYNC_EVERY_MS === undefined || process.env.SYNC_EVERY_MS === '' ? 60 * 60_000 : Number(process.env.SYNC_EVERY_MS) } = {}) {
  let lastSync = 0;
  const tick = async () => {
    try {
      // SYNC_EVERY_MS=0 turns in-app syncing off (when a scheduled job such as the GitHub Action does it instead).
      if (syncEveryMs > 0 && Date.now() - lastSync > syncEveryMs) {
        lastSync = Date.now();
        // Keyword-based sources (Adzuna, JSearch, USAJOBS) search for the job titles users are targeting.
        const terms = [...new Set((await db.all('SELECT p.titles FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.verified = 1')).flatMap((p) => csv(p.titles).map((t) => t.toLowerCase())))];
        const r = await syncJobs(terms);
        console.log(`[jobs] ${r.total} US jobs from ${r.sources} sources in ${r.seconds}s (+${r.added} new, ${r.updated} refreshed, ${r.removed} closed or expired)`, r.errors.length ? r.errors : '');
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
