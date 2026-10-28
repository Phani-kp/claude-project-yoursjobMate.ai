import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.APPLY_DELAY_MS = '0';
delete process.env.ANTHROPIC_API_KEY;

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { SAMPLE_JOBS } = await import('../src/sampleJobs.js');
const { runAgentForUser } = await import('../src/agent.js');
const { matchScore } = await import('../src/jobs.js');

const server = createApp().listen(0);
const base = `http://localhost:${server.address().port}/api`;
let token;
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

const insert = db.prepare('INSERT INTO jobs (external_id, source, title, company, location, remote, description, tags, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (const j of SAMPLE_JOBS) insert.run(j.external_id, j.source, j.title, j.company, j.location, j.remote ? 1 : 0, j.description, j.tags.join(','), j.posted_at);

test('signup, login and auth guard', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  const s = await call('POST', '/auth/signup', { name: 'Test', email: 'T@x.com', password: 'secret1' });
  assert.equal(s.status, 201);
  assert.equal((await call('POST', '/auth/login', { email: 't@x.com', password: 'bad' })).status, 401);
  token = (await call('POST', '/auth/login', { email: 't@x.com', password: 'secret1' })).body.token;
  assert.equal((await call('GET', '/me')).body.user.email, 't@x.com');
});

test('match score favours relevant jobs', () => {
  const profile = { titles: 'Frontend Engineer', skills: 'react,typescript,css', locations: '', remote_only: 0 };
  const fe = SAMPLE_JOBS.find((j) => j.title === 'Frontend Engineer');
  const da = SAMPLE_JOBS.find((j) => j.title === 'Data Analyst');
  assert.ok(matchScore({ ...fe, tags: fe.tags.join(',') }, profile) > matchScore({ ...da, tags: da.tags.join(',') }, profile));
});

test('auto-apply agent respects min match and daily limit', async () => {
  await call('PUT', '/profile', { titles: 'Frontend Engineer', skills: 'react,typescript,css,javascript', auto_apply: true, daily_limit: 2, min_match: 50 });
  await runAgentForUser(1);
  const apps = (await call('GET', '/applications')).body;
  assert.equal(apps.length, 2);
  assert.ok(apps.every((a) => a.status === 'applied' && a.match_score >= 50 && a.cover_letter.includes('Dear')));
  await runAgentForUser(1);
  assert.equal((await call('GET', '/applications')).body.length, 2);
});

test('manual tracking, status updates and stats', async () => {
  const created = await call('POST', '/applications', { title: 'PM', company: 'Elsewhere', status: 'applied' });
  assert.equal(created.status, 201);
  assert.equal((await call('PATCH', `/applications/${created.body.id}`, { status: 'interview' })).body.status, 'interview');
  assert.equal((await call('PATCH', `/applications/${created.body.id}`, { status: 'nope' })).status, 400);
  const stats = (await call('GET', '/stats')).body;
  assert.equal(stats.total, 3);
  assert.equal(stats.interviews, 1);
  assert.equal(stats.responseRate, 33);
  assert.equal((await call('GET', '/applications?status=interview')).body.length, 1);
  assert.equal((await call('DELETE', `/applications/${created.body.id}`)).status, 204);
});

test.after(() => server.close());
