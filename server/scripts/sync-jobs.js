/**
 * Refreshes the job database once and exits: pulls every source, keeps US jobs from the last 30 days and removes
 * closed or expired postings. Run on a schedule (GitHub Actions, cron, Render/Railway cron jobs) to keep jobs
 * fresh 24/7, even while the web server is asleep or off.
 *
 *   DATABASE_URL=postgres://… npm run sync:jobs
 *
 * Exits with code 1 if most sources failed, so the scheduler reports a broken run.
 */
const { db, csv } = await import('../src/db.js');
const { syncJobs } = await import('../src/jobs.js');

const started = Date.now();
// Keyword-based sources (Adzuna, JSearch, USAJOBS) search for the job titles users are targeting.
const terms = [...new Set((await db.all('SELECT p.titles FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.verified = 1')).flatMap((p) => csv(p.titles).map((t) => t.toLowerCase())))];
const r = await syncJobs(terms);
console.log(`Synced ${r.sources} sources in ${Math.round((Date.now() - started) / 1000)}s: ${r.total} US jobs (+${r.added} new, ${r.updated} updated, ${r.removed} closed or expired; skipped ${r.skippedNonUS} outside the US and ${r.skippedOld} older than 30 days).`);
if (r.errors.length) console.log(`Sources that failed this run (${r.errors.length}):\n  ${r.errors.join('\n  ')}`);
await db.close();
process.exit(r.errors.length > r.sources ? 1 : 0);
