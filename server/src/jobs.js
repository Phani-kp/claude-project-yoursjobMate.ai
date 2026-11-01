import { db, csv } from './db.js';
import { fetchJobDetails, sourceList } from './sources.js';
import { STATES } from './usLocation.js';
import { LEVEL_PATTERNS, atsReport, detectResumeProfile } from './resume.js';

/** Only US jobs posted within this many days are kept and shown. */
export const MAX_AGE_DAYS = Number(process.env.JOB_MAX_AGE_DAYS) || 30;
const CONCURRENCY = Number(process.env.SYNC_CONCURRENCY) || 8;

// Jobs a user applied to or saved are never deleted by clean-up, so their links keep working.
const UNREFERENCED = `NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = jobs.id)
  AND NOT EXISTS (SELECT 1 FROM saved_jobs s WHERE s.job_id = jobs.id)`;

const COLS = ['external_id', 'source', 'source_key', 'title', 'company', 'location', 'city', 'states', 'country', 'remote', 'salary', 'job_type', 'url', 'description', 'tags', 'posted_at', 'posted_ts'];

// description/states/city stay as fetched when a list-only source (Workday, SmartRecruiters) sends them empty.
const UPDATABLE = COLS.filter((c) => c !== 'external_id');
const KEEP_IF_EMPTY = new Set(['description', 'states', 'city', 'job_type']);
const setExpr = (c) => (KEEP_IF_EMPTY.has(c) ? `${c} = COALESCE(NULLIF(EXCLUDED.${c}, ''), jobs.${c})` : `${c} = EXCLUDED.${c}`);

/** Inserts new jobs and updates changed ones, in batches of 100. Returns { added, updated }. */
export async function saveJobs(jobs, sourceKey) {
  const result = { added: 0, updated: 0 };
  for (let i = 0; i < jobs.length; i += 100) {
    const batch = jobs.slice(i, i + 100);
    const values = batch.flatMap((j) => [
      j.external_id, j.source, sourceKey, j.title.slice(0, 300), (j.company || 'Unknown').slice(0, 200), (j.location || '').slice(0, 300),
      (j.city || '').slice(0, 100), j.states.length ? `,${j.states.join(',')},` : '', 'US', j.remote ? 1 : 0, j.salary || '',
      j.job_type || '', j.url || '', j.description || '', (j.tags || []).join(',').slice(0, 500), j.posted_at, j.posted_at,
    ]);
    const row = `(${COLS.map(() => '?').join(', ')}, now())`;
    const { rows } = await db.run(`INSERT INTO jobs (${COLS.join(', ')}, seen_at) VALUES ${batch.map(() => row).join(', ')}
      ON CONFLICT (external_id) DO UPDATE SET ${UPDATABLE.map(setExpr).join(', ')}, seen_at = now()
      -- Only rewrite rows that changed, so hourly syncs don't bloat the database.
      WHERE (${UPDATABLE.filter((c) => !KEEP_IF_EMPTY.has(c)).map((c) => `jobs.${c}`).join(', ')}) IS DISTINCT FROM (${UPDATABLE.filter((c) => !KEEP_IF_EMPTY.has(c)).map((c) => `EXCLUDED.${c}`).join(', ')})
        OR (EXCLUDED.description <> '' AND jobs.description IS DISTINCT FROM EXCLUDED.description)
      RETURNING (xmax = 0) AS inserted`, ...values);
    for (const r of rows) r.inserted ? result.added++ : result.updated++;
  }
  return result;
}

/** Runs async tasks with at most `limit` running at once. */
async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

let running = null;
export let lastSync = null;

/**
 * Pulls the latest postings from every source, keeps US jobs from the last MAX_AGE_DAYS days, refreshes ones already
 * stored, and removes postings that have closed or aged out. Concurrent calls share the same run.
 */
export function syncJobs(searchTerms = []) {
  running ||= runSync(searchTerms).finally(() => { running = null; });
  return running;
}

/** Fetches the given sources and stores their US jobs from the last MAX_AGE_DAYS days. */
async function pullSources(sources, stats) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  const seen = new Set();
  await pool(sources, CONCURRENCY, async (source) => {
    try {
      const raw = await source.run();
      const keep = [];
      for (const j of raw) {
        if (!j.external_id || !j.title || seen.has(j.external_id)) continue;
        if (!j.us) { stats.skippedNonUS++; continue; }
        if (!j.posted_at || Date.parse(j.posted_at) < cutoff) { stats.skippedOld++; continue; }
        seen.add(j.external_id);
        keep.push(j);
      }
      const r = await saveJobs(keep, source.key);
      stats.added += r.added;
      stats.updated += r.updated;
      stats.sources++;
      // A full list that came back empty is more likely an API hiccup than every job closing at once.
      if (source.full && raw.length) {
        const gone = await db.run(`DELETE FROM jobs WHERE source_key = ? AND NOT (external_id = ANY(?::text[])) AND ${UNREFERENCED}`, source.key, keep.map((j) => j.external_id));
        stats.removed += gone.count;
      }
    } catch (e) {
      stats.errors.push(`${source.label}: ${e.message}`);
    }
  });
}

const newStats = () => ({ added: 0, updated: 0, removed: 0, skippedNonUS: 0, skippedOld: 0, sources: 0, errors: [] });

/** Pulls only the given company boards (used right after a company is added). */
export async function syncBoards(boards) {
  const keys = new Set(boards.map((b) => `${b.ats}:${b.token}`));
  const stats = newStats();
  await pullSources(sourceList([], boards).filter((s) => keys.has(s.key)), stats);
  return stats;
}

async function runSync(searchTerms) {
  const started = Date.now();
  const stats = newStats();
  await pullSources(sourceList(searchTerms, await db.all('SELECT ats, token, name FROM company_boards')), stats);
  // Clean-up: anything outside the US, too old, or posted by a job board when the employer's own site has it too.
  const old = await db.run(`DELETE FROM jobs WHERE (country IS DISTINCT FROM 'US' OR posted_ts IS NULL OR posted_ts < now() - make_interval(days => ?::int)) AND ${UNREFERENCED}`, MAX_AGE_DAYS);
  const dupes = await db.run(`DELETE FROM jobs WHERE source_key IN ('remotive', 'remoteok', 'themuse', 'adzuna', 'jsearch', 'usajobs') AND ${UNREFERENCED}
    AND EXISTS (SELECT 1 FROM jobs b WHERE b.id <> jobs.id AND b.source_key ~ '^(greenhouse|lever|ashby|workday|smartrecruiters|workable|amazon)' AND lower(b.company) = lower(jobs.company) AND lower(b.title) = lower(jobs.title))`);
  stats.removed += old.count + dupes.count;
  const { c: total } = await db.get("SELECT COUNT(*) AS c FROM jobs WHERE country = 'US'");
  lastSync = { ...stats, total, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) };
  return lastSync;
}

// ---------------------------------------------------------------------------------------------
// Match scoring
// ---------------------------------------------------------------------------------------------

const STOP = new Set(['and', 'the', 'for', 'with', 'senior', 'junior', 'lead', 'sr', 'jr', 'of', 'to', 'a', 'in', 'at', 'remote']);
const words = (s) => (s || '').toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !STOP.has(w));

/**
 * Scores how well a job fits a profile, 0-100.
 * 45% job-title similarity, 40% skill coverage, 15% location / remote fit.
 */
export function matchScore(job, profile) {
  const titles = csv(profile.titles);
  const skills = csv(profile.skills).map((s) => s.toLowerCase());
  const jobTitle = new Set(words(job.title));
  const haystack = `${job.title} ${job.tags} ${job.description}`.toLowerCase();

  let titleScore = 0;
  for (const t of titles) {
    const tw = words(t);
    if (!tw.length) continue;
    const hit = tw.filter((w) => jobTitle.has(w)).length / tw.length;
    titleScore = Math.max(titleScore, hit);
  }
  if (!titles.length) titleScore = 0.5;

  const skillScore = skills.length ? skills.filter((s) => haystack.includes(s)).length / Math.min(skills.length, 8) : 0.5;

  const locs = csv(profile.locations).map((l) => l.toLowerCase());
  let locScore;
  if (profile.remote_only) locScore = job.remote ? 1 : 0;
  else if (!locs.length) locScore = 1;
  else {
    // states arrive as ",CA,NY," from the database or as ['CA', 'NY'] once shaped for the API.
    const states = (Array.isArray(job.states) ? job.states : String(job.states || '').split(',')).map((s) => s.toLowerCase()).filter(Boolean);
    locScore = job.remote || locs.some((l) => (job.location || '').toLowerCase().includes(l) || states.includes(l)) ? 1 : 0.2;
  }

  return Math.round(Math.min(1, titleScore) * 45 + Math.min(1, skillScore) * 40 + locScore * 15);
}

// ---------------------------------------------------------------------------------------------
// Search with LinkedIn-style filters
// ---------------------------------------------------------------------------------------------

export const DATE_FILTERS = { 1: 'Past 24 hours', 3: 'Past 3 days', 7: 'Past week', 14: 'Past 2 weeks', 30: 'Past month' };
const list = (v) => [].concat(v ?? []).flatMap((x) => String(x).split('|')).map((x) => x.trim()).filter(Boolean);

// A plain "Data Engineer" search should focus on individual-contributor roles,
// rather than returning executive or staff-level variants of the same title.
const DATA_ENGINEER_HIGH_LEVEL = '(^|[^A-Za-z])(director|principal|staff|lead|manager|head|vp|vice president|chief|distinguished|architect)([^A-Za-z]|$)';

/** Normalises query-string filters. */
export function parseFilters(q = {}) {
  const days = Number(q.posted);
  return {
    q: String(q.q ?? q.search ?? '').trim().slice(0, 100),
    days: DATE_FILTERS[days] ? days : MAX_AGE_DAYS,
    companies: list(q.company).slice(0, 50),
    states: list(q.state).map((s) => s.toUpperCase()).filter((s) => STATES[s] || s === 'REMOTE').slice(0, 52),
    remote: q.remote === '1' || q.remote === 'true',
    onlyNew: q.onlyNew === '1',
    sort: ['match', 'ats'].includes(q.sort) ? q.sort : 'recent',
    fit: q.fit === '1',
    offset: Math.max(0, Number(q.offset) || 0),
    limit: Math.min(Math.max(Number(q.limit) || 50, 1), 100),
  };
}

/** WHERE clause for the filters; `skip` leaves one filter out (for that filter's own counts, like LinkedIn). */
function whereFor(userId, f, skip = '') {
  const where = ["j.country = 'US'", 'j.posted_ts >= now() - make_interval(days => ?::int)'];
  const params = [skip === 'date' ? MAX_AGE_DAYS : f.days];
  for (const word of f.q.split(/\s+/).filter(Boolean).slice(0, 6)) {
    where.push('(j.title ILIKE ? OR j.company ILIKE ? OR j.tags ILIKE ?)');
    params.push(...Array(3).fill(`%${word}%`));
  }
  if (/\bdata\s+engineer\b/i.test(f.q)) {
    where.push('j.title ~* ?');
    params.push('\\mdata[[:space:]]+engineer\\M');
    where.push('NOT (j.title ~* ?)');
    params.push(DATA_ENGINEER_HIGH_LEVEL);
  }
  if (skip !== 'company' && f.companies.length) { where.push('j.company = ANY(?::text[])'); params.push(f.companies); }
  if (skip !== 'state' && f.states.length) {
    const ors = f.states.map((s) => (s === 'REMOTE' ? 'j.remote = 1' : 'j.states LIKE ?'));
    where.push(`(${ors.join(' OR ')})`);
    params.push(...f.states.filter((s) => s !== 'REMOTE').map((s) => `%,${s},%`));
  }
  if (f.remote) where.push('j.remote = 1');
  // "Fits my resume": the resume's role family, at the candidate's level give or take one.
  if (f.fit && f.fitPattern) {
    where.push('j.title ~* ?');
    params.push(f.fitPattern);
    for (const [level, re] of LEVEL_PATTERNS) {
      if (Math.abs(level - f.fitLevel) <= 1) continue;
      where.push('NOT (j.title ~* ?)');
      params.push(re.source.replace(/\b/g, '\y'));
    }
  }
  if (f.onlyNew) { where.push('NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.user_id = ?)'); params.push(userId); }
  return { sql: where.join(' AND '), params };
}

const LIST_COLS = `j.id, j.external_id, j.source, j.title, j.company, j.location, j.city, j.states, j.remote, j.salary, j.job_type, j.url, j.tags, j.posted_ts AS posted_at`;
const shape = (j) => ({ ...j, remote: !!j.remote, saved: !!j.saved, states: (j.states || '').split(',').filter(Boolean) });

/** Adds the resume's role and level to the filters when "Fits my resume" is on. */
export function withFit(f, profile) {
  if (!f.fit) return f;
  const d = detectResumeProfile(profile?.resume_text || '', profile || {});
  return d.jobPattern ? { ...f, fitPattern: d.jobPattern, fitLevel: d.level, detected: d } : { ...f, fit: false };
}

const hasResume = (profile) => (profile?.resume_text || '').trim().length >= 50;
const atsOf = (profile, j) => atsReport(profile.resume_text, j).score;

/**
 * One page of jobs plus the total count. sort=recent pages in SQL; sort=match scores the newest 1,500 matches by profile;
 * sort=ats ranks the newest 600 matches by the real ATS score of the user's resume against each job.
 */
export async function searchJobs(userId, profile, f) {
  const { sql, params } = whereFor(userId, f);
  const joins = `LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ? LEFT JOIN saved_jobs s ON s.job_id = j.id AND s.user_id = ?`;
  const select = `SELECT ${LIST_COLS}, a.id AS application_id, a.status AS application_status, (s.job_id IS NOT NULL) AS saved`;
  const { c: total } = await db.get(`SELECT COUNT(*) AS c FROM jobs j WHERE ${sql}`, ...params);
  if (f.sort === 'recent') {
    const rows = await db.all(`${select} FROM jobs j ${joins} WHERE ${sql} ORDER BY j.posted_ts DESC, j.id DESC LIMIT ? OFFSET ?`, userId, userId, ...params, f.limit, f.offset);
    const scored = await db.all(`SELECT id, title, tags, description, location, states, remote FROM jobs WHERE id = ANY(?::int[])`, rows.map((r) => r.id));
    const score = Object.fromEntries(scored.map((j) => [j.id, matchScore(j, profile)]));
    const ats = hasResume(profile) ? Object.fromEntries(scored.map((j) => [j.id, atsOf(profile, j)])) : {};
    return { total, jobs: rows.map((r) => shape({ ...r, match_score: score[r.id] ?? 0, ats_score: ats[r.id] ?? null })) };
  }
  if (f.sort === 'ats' && hasResume(profile)) {
    const rows = await db.all(`${select}, j.description FROM jobs j ${joins} WHERE ${sql} ORDER BY j.posted_ts DESC LIMIT 600`, userId, userId, ...params);
    const ranked = rows.map((r) => ({ ...r, ats_score: atsOf(profile, r), match_score: matchScore(r, profile) })).sort((a, b) => b.ats_score - a.ats_score || (b.posted_at > a.posted_at ? 1 : -1));
    return { total: Math.min(total, 600), jobs: ranked.slice(f.offset, f.offset + f.limit).map(({ description: _d, ...r }) => shape(r)) };
  }
  const rows = await db.all(`${select}, j.description FROM jobs j ${joins} WHERE ${sql} ORDER BY j.posted_ts DESC LIMIT 1500`, userId, userId, ...params);
  const ranked = rows.map((r) => ({ ...r, match_score: matchScore(r, profile) })).sort((a, b) => b.match_score - a.match_score || (b.posted_at > a.posted_at ? 1 : -1));
  if (hasResume(profile)) for (const r of ranked.slice(f.offset, f.offset + f.limit)) r.ats_score = atsOf(profile, r);
  return { total, jobs: ranked.slice(f.offset, f.offset + f.limit).map(({ description: _d, ...r }) => shape(r)) };
}

/** Counts for the filter menus: companies, states and date ranges, each counted with the other filters applied. */
export async function jobFacets(userId, f) {
  const c = whereFor(userId, f, 'company');
  const s = whereFor(userId, f, 'state');
  const d = whereFor(userId, f, 'date');
  const [companies, states, remote, dates, all] = await Promise.all([
    db.all(`SELECT j.company AS name, COUNT(*) AS count FROM jobs j WHERE ${c.sql} GROUP BY j.company ORDER BY count DESC, name LIMIT 500`, ...c.params),
    db.all(`SELECT st AS code, COUNT(*) AS count FROM jobs j, unnest(string_to_array(trim(both ',' from j.states), ',')) AS st WHERE ${s.sql} AND j.states <> '' GROUP BY st ORDER BY count DESC`, ...s.params),
    db.get(`SELECT COUNT(*) AS count FROM jobs j WHERE ${s.sql} AND j.remote = 1`, ...s.params),
    db.get(`SELECT ${Object.keys(DATE_FILTERS).map((n) => `COUNT(*) FILTER (WHERE j.posted_ts >= now() - interval '${n} days') AS d${n}`).join(', ')} FROM jobs j WHERE ${d.sql}`, ...d.params),
    db.get("SELECT COUNT(*) AS jobs, COUNT(DISTINCT company) AS companies FROM jobs WHERE country = 'US' AND posted_ts >= now() - make_interval(days => ?::int)", MAX_AGE_DAYS),
  ]);
  return {
    companies,
    states: [{ code: 'REMOTE', name: 'Remote (US)', count: remote.count }, ...states.filter((x) => STATES[x.code]).map((x) => ({ ...x, name: STATES[x.code] }))],
    dates: Object.entries(DATE_FILTERS).map(([days, label]) => ({ days: Number(days), label, count: dates[`d${days}`] })),
    totals: all,
    lastSync,
  };
}

/** Workday and SmartRecruiters list jobs without a description; fetch it (once) when someone opens the job. */
export async function ensureJobDetails(id) {
  const j = await db.get('SELECT id, source, url, description, details_fetched FROM jobs WHERE id = ?', id);
  if (!j || j.details_fetched || j.description || !['Workday', 'SmartRecruiters'].includes(j.source)) return;
  try {
    const d = await fetchJobDetails(j);
    if (!d) return;
    await db.run(`UPDATE jobs SET description = ?, job_type = COALESCE(NULLIF(?, ''), job_type), url = ?, details_fetched = 1${d.states ? ', states = ?, city = ?' : ''} WHERE id = ?`,
      d.description, d.job_type || '', d.url || j.url, ...(d.states ? [`,${d.states.join(',')},`, d.city || ''] : []), id);
  } catch (e) {
    console.error(`[jobs] details for job ${id} failed:`, e.message);
  }
}

export async function getJob(userId, id) {
  await ensureJobDetails(id);
  const j = await db.get(`SELECT j.*, j.posted_ts AS posted_at, a.id AS application_id, a.status AS application_status, (s.job_id IS NOT NULL) AS saved
    FROM jobs j LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ? LEFT JOIN saved_jobs s ON s.job_id = j.id AND s.user_id = ? WHERE j.id = ?`, userId, userId, id);
  return j && shape(j);
}

/** Best-matching new jobs for the auto-apply agent. */
export async function rankedJobsFor(userId, profile, { limit = 200, onlyNew = true } = {}) {
  return (await searchJobs(userId, profile, { ...parseFilters({}), sort: 'match', onlyNew, limit })).jobs;
}
