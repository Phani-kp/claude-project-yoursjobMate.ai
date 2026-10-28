import { test } from 'node:test';
import assert from 'node:assert/strict';

// Runs on an in-memory embedded Postgres. Set TEST_DATABASE_URL to run against a real (empty) Postgres server instead.
process.env.DB_PATH = ':memory:';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
process.env.APPLY_DELAY_MS = '0';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SMTP_HOST;
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_LIMIT = '1000';

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { SAMPLE_JOBS } = await import('../src/sampleJobs.js');
const { runAgentForUser } = await import('../src/agent.js');
const { matchScore } = await import('../src/jobs.js');
const { outbox } = await import('../src/mailer.js');

const server = createApp().listen(0);
const base = `http://localhost:${server.address().port}/api`;
let token;
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

for (const j of SAMPLE_JOBS) {
  await db.run('INSERT INTO jobs (external_id, source, title, company, location, remote, description, tags, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    j.external_id, j.source, j.title, j.company, j.location, j.remote ? 1 : 0, j.description, j.tags.join(','), j.posted_at);
}

const lastCode = (to) => outbox.findLast((m) => m.to === to).text.match(/\b(\d{6})\b/)[1];
const wrongCode = (code) => (code === '123456' ? '654321' : '123456');
const PW = 'secret123';

test('signup, email OTP verification, login and auth guard', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('POST', '/auth/signup', { name: 'Test', email: 'not-an-email', password: PW })).status, 400);
  assert.equal((await call('POST', '/auth/signup', { name: 'Test', email: 't@x.com', password: 'short' })).status, 400);
  const s = await call('POST', '/auth/signup', { name: 'Test', email: ' T@x.com ', password: PW });
  assert.equal(s.status, 201);
  assert.equal(s.body.token, undefined);
  assert.equal(s.body.needsVerification, true);
  const code = lastCode('t@x.com');

  const blocked = await call('POST', '/auth/login', { email: 't@x.com', password: PW });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.needsVerification, true);
  assert.equal((await call('POST', '/auth/resend-otp', { email: 't@x.com' })).status, 429);

  assert.equal((await call('POST', '/auth/verify', { email: 't@x.com', code: wrongCode(code) })).status, 400);
  const v = await call('POST', '/auth/verify', { email: 't@x.com', code });
  assert.equal(v.status, 200);
  assert.ok(v.body.token);
  assert.equal((await call('POST', '/auth/verify', { email: 't@x.com', code })).status, 400);
  assert.equal((await call('POST', '/auth/signup', { name: 'Again', email: 't@x.com', password: PW })).status, 409);

  assert.equal((await call('POST', '/auth/login', { email: 't@x.com', password: 'bad' })).status, 401);
  token = (await call('POST', '/auth/login', { email: 't@x.com', password: PW })).body.token;
  assert.equal((await call('GET', '/me')).body.user.email, 't@x.com');
});

test('OTP locks after too many wrong attempts and expires', async () => {
  await call('POST', '/auth/signup', { name: 'Lock', email: 'lock@x.com', password: PW });
  const code = lastCode('lock@x.com');
  for (let i = 0; i < 5; i++) await call('POST', '/auth/verify', { email: 'lock@x.com', code: wrongCode(code) });
  assert.equal((await call('POST', '/auth/verify', { email: 'lock@x.com', code })).status, 429);

  await db.run('UPDATE users SET otp_sent_at = 0 WHERE email = ?', 'lock@x.com');
  assert.equal((await call('POST', '/auth/resend-otp', { email: 'lock@x.com' })).status, 200);
  const fresh = lastCode('lock@x.com');
  await db.run('UPDATE users SET otp_expires_at = 0 WHERE email = ?', 'lock@x.com');
  assert.equal((await call('POST', '/auth/verify', { email: 'lock@x.com', code: fresh })).status, 400);
});

test('password reset by email code signs out old sessions', async () => {
  const before = outbox.length;
  const unknown = await call('POST', '/auth/forgot-password', { email: 'nobody@x.com' });
  assert.equal(unknown.status, 200);
  assert.equal(outbox.length, before);

  await call('POST', '/auth/signup', { name: 'Reset', email: 'reset@x.com', password: PW });
  const verified = await call('POST', '/auth/verify', { email: 'reset@x.com', code: lastCode('reset@x.com') });
  const oldToken = verified.body.token;
  await db.run('UPDATE users SET otp_sent_at = 0 WHERE email = ?', 'reset@x.com');

  assert.equal((await call('POST', '/auth/forgot-password', { email: 'reset@x.com' })).status, 200);
  const code = lastCode('reset@x.com');
  assert.match(outbox.at(-1).subject, /password reset/);
  // A reset code can't be used to verify, and a weak new password is refused.
  assert.equal((await call('POST', '/auth/reset-password', { email: 'reset@x.com', code, password: 'short' })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { email: 'reset@x.com', code: wrongCode(code), password: 'newpass123' })).status, 400);
  const r = await call('POST', '/auth/reset-password', { email: 'reset@x.com', code, password: 'newpass123' });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal((await call('POST', '/auth/reset-password', { email: 'reset@x.com', code, password: 'newpass123' })).status, 400);

  const saved = token;
  token = oldToken;
  assert.equal((await call('GET', '/me')).status, 401);
  token = r.body.token;
  assert.equal((await call('GET', '/me')).status, 200);
  token = saved;
  assert.equal((await call('POST', '/auth/login', { email: 'reset@x.com', password: PW })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'reset@x.com', password: 'newpass123' })).status, 200);
});

test('passwords are stored only as peppered bcrypt hashes, and old hashes are upgraded on login', async () => {
  const { password_hash } = await db.get('SELECT password_hash FROM users WHERE email = ?', 't@x.com');
  assert.match(password_hash, /^pep1\$\$2[aby]\$12\$/);
  assert.ok(!password_hash.includes(PW));

  // An account hashed before the pepper existed still logs in, and is re-hashed with the pepper.
  const bcrypt = (await import('bcryptjs')).default;
  await db.run("INSERT INTO users (email, name, password_hash, verified) VALUES ('legacy@x.com', 'Legacy', ?, 1)", await bcrypt.hash(PW, 10));
  const saved = token;
  token = undefined;
  assert.equal((await call('POST', '/auth/login', { email: 'legacy@x.com', password: PW })).status, 200);
  token = saved;
  assert.match((await db.get('SELECT password_hash FROM users WHERE email = ?', 'legacy@x.com')).password_hash, /^pep1\$/);
});

test('resume files are stored in the database', async () => {
  const form = new FormData();
  form.append('resume', new Blob(['Jane Doe\nReact developer'], { type: 'text/plain' }), 'cv.txt');
  const up = await fetch(`${base}/profile/resume`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const profile = await up.json();
  assert.equal(profile.resume_file, 'cv.txt');
  assert.match(profile.resume_text, /React developer/);
  assert.equal(profile.resume_data, undefined);
  const down = await fetch(`${base}/profile/resume`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(await down.text(), 'Jane Doe\nReact developer');
});

test('login is rate limited per IP', async () => {
  process.env.AUTH_RATE_LIMIT = '3';
  const limited = createApp().listen(0);
  process.env.AUTH_RATE_LIMIT = '1000';
  const url = `http://localhost:${limited.address().port}/api/auth/login`;
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    statuses.push((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@x.com', password: 'nope1234' }) })).status);
  }
  limited.close();
  assert.deepEqual(statuses, [401, 401, 401, 429]);
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

test.after(async () => { server.close(); await db.close(); });
