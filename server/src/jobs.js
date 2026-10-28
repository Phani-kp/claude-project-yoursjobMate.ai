import { db, csv } from './db.js';
import { SAMPLE_JOBS } from './sampleJobs.js';

const stripHtml = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const insertJob = db.prepare(`
  INSERT INTO jobs (external_id, source, title, company, location, remote, salary, job_type, url, description, tags, posted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(external_id) DO NOTHING
`);

function saveJobs(jobs) {
  let added = 0;
  for (const j of jobs) {
    const r = insertJob.run(
      j.external_id, j.source, j.title, j.company, j.location || '', j.remote ? 1 : 0, j.salary || '',
      j.job_type || '', j.url || '', (j.description || '').slice(0, 8000), (j.tags || []).join(','), j.posted_at || new Date().toISOString(),
    );
    added += Number(r.changes);
  }
  return added;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'YoursJobMate/1.0' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Remotive: free public API of remote jobs.
async function fromRemotive(search) {
  const q = search ? `&search=${encodeURIComponent(search)}` : '';
  const data = await fetchJson(`https://remotive.com/api/remote-jobs?limit=100${q}`);
  return (data.jobs || []).map((j) => ({
    external_id: `remotive-${j.id}`,
    source: 'remotive',
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location || 'Remote',
    remote: true,
    salary: j.salary,
    job_type: j.job_type,
    url: j.url,
    description: stripHtml(j.description),
    tags: j.tags || [],
    posted_at: j.publication_date,
  }));
}

// Arbeitnow: free public job board API.
async function fromArbeitnow() {
  const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api');
  return (data.data || []).map((j) => ({
    external_id: `arbeitnow-${j.slug}`,
    source: 'arbeitnow',
    title: j.title,
    company: j.company_name,
    location: j.location,
    remote: j.remote,
    job_type: (j.job_types || []).join(', '),
    url: j.url,
    description: stripHtml(j.description),
    tags: j.tags || [],
    posted_at: new Date((j.created_at || Date.now() / 1000) * 1000).toISOString(),
  }));
}

/** Pulls fresh jobs from public sources. Falls back to bundled sample jobs when offline. */
export async function syncJobs(searchTerms = []) {
  const results = { added: 0, sources: {}, errors: [] };
  const tasks = [['arbeitnow', fromArbeitnow()], ...(searchTerms.length ? searchTerms : ['']).slice(0, 3).map((t) => [`remotive${t ? `:${t}` : ''}`, fromRemotive(t)])];
  for (const [name, p] of tasks) {
    try {
      const n = saveJobs(await p);
      results.sources[name] = n;
      results.added += n;
    } catch (e) {
      results.errors.push(`${name}: ${e.message}`);
    }
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
  if (count === 0) {
    results.sources.sample = saveJobs(SAMPLE_JOBS);
    results.added += results.sources.sample;
  }
  return results;
}

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
  else locScore = job.remote || locs.some((l) => (job.location || '').toLowerCase().includes(l)) ? 1 : 0.2;

  return Math.round(Math.min(1, titleScore) * 45 + Math.min(1, skillScore) * 40 + locScore * 15);
}

export function rankedJobsFor(userId, profile, { search = '', limit = 50, onlyNew = false } = {}) {
  const like = `%${search}%`;
  const rows = db.prepare(`
    SELECT j.*, a.id AS application_id, a.status AS application_status
    FROM jobs j LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ?
    WHERE (j.title LIKE ? OR j.company LIKE ? OR j.tags LIKE ?)
    ORDER BY j.posted_at DESC LIMIT 1000
  `).all(userId, like, like, like);
  return rows
    .filter((j) => !onlyNew || !j.application_id)
    .map((j) => ({ ...j, remote: !!j.remote, match_score: matchScore(j, profile) }))
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, limit);
}
