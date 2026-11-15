import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { normalizeExperienceEntries } from '../src/resumeExperience.js';

const fixedId = '95abc9f2-27f4-4bb9-8000-e06d28d24536';
const entry = (overrides = {}) => ({ id: fixedId, kind: 'project', title: 'Personal data project',
  organization: '', dates: '2024', skills: ['Apache Airflow', 'SQL'],
  details: 'Built Apache Airflow tasks and SQL checks for a personal dataset.\nKept the measured result at 25%.', ...overrides });

test('experience normalization preserves supplied facts and stable client ids', () => {
  const source = entry({ title: '  Résumé project  ', skills: ['Apache Airflow', 'airflow', 'SQL', 'constructor'], ignoredScore: 99 });
  const [normalized] = normalizeExperienceEntries([source], { strict: true });
  assert.equal(normalized.id, fixedId);
  assert.equal(normalized.title, 'Résumé project');
  assert.equal(normalized.details, source.details);
  assert.equal(normalized.organization, '');
  assert.equal(normalized.dates, source.dates);
  assert.deepEqual(normalized.skills, ['airflow', 'sql', 'constructor']);
  assert.equal(Object.hasOwn(normalized, 'ignoredScore'), false);
  assert.deepEqual(normalizeExperienceEntries([normalized], { strict: true }), [normalized]);
});

test('new writes assign ids once while legacy reads derive stable ids without inventing facts', () => {
  const source = entry();
  delete source.id;
  const written = normalizeExperienceEntries([source], { strict: true });
  assert.match(written[0].id, /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/);
  assert.deepEqual(normalizeExperienceEntries(written, { strict: true }), written);
  assert.deepEqual(normalizeExperienceEntries([source]), normalizeExperienceEntries([source]));
  assert.equal(normalizeExperienceEntries([source])[0].details, source.details);
});

test('strict validation rejects malformed and oversized entries with safe errors', () => {
  const marker = 'PRIVATE_FIXTURE_FACT';
  const invalidInputs = [
    undefined, null, '{}', {}, [null], [[]], [entry({ id: 'not-a-uuid' })],
    [entry({ kind: 'invented-kind' })], [entry({ title: '' })], [entry({ details: '' })],
    [entry({ title: marker.repeat(8) })], [entry({ organization: marker.repeat(8) })],
    [entry({ dates: marker.repeat(6) })], [entry({ details: marker.repeat(150) })],
    [entry({ skills: 'SQL' })], [entry({ skills: ['x'.repeat(81)] })],
    [entry({ skills: Array(26).fill('SQL') })], [entry({ details: 'Invalid\0details' })],
    [entry(), entry()], Array.from({ length: 21 }, () => entry()),
  ];
  for (const input of invalidInputs) assert.throws(() => normalizeExperienceEntries(input, { strict: true }), error => {
    assert.equal(error.status, 400);
    assert.equal(error.expose, true);
    assert.equal(error.message.includes(marker), false);
    return true;
  });
});

test('the documented field limits accept factual content at their boundaries', () => {
  const entries = Array.from({ length: 20 }, (_, index) => entry({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: 'T'.repeat(100), organization: 'O'.repeat(100), dates: 'D'.repeat(80), details: 'F'.repeat(2000),
    skills: Array.from({ length: 25 }, (_, skill) => `${skill}`.padEnd(80, 's')),
  }));
  assert.equal(normalizeExperienceEntries(entries, { strict: true }).length, 20);
});

test('lenient reads safely handle malformed stored JSON and retain valid entries', () => {
  for (const value of [undefined, null, 'not JSON', '{}', 'null']) assert.deepEqual(normalizeExperienceEntries(value), []);
  assert.deepEqual(normalizeExperienceEntries(JSON.stringify([entry(), { invalid: true }])), normalizeExperienceEntries([entry()]));
});

const savedEnv = { ...process.env };
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: ':memory:', API_RATE_LIMIT: '1000',
  JWT_SECRET: 'resume-experience-fixture-secret', PASSWORD_PEPPER: 'resume-experience-fixture-pepper' });
for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'BREVO_API_KEY', 'SMTP_HOST', 'ANTHROPIC_API_KEY', 'TRUST_PROXY']) delete process.env[key];
const realFetch = globalThis.fetch;
let origin;
const fetchMock = mock.method(globalThis, 'fetch', (url, options) => {
  assert.equal(new URL(url).origin, origin, 'experience tests must not contact external services');
  return realFetch(url, options);
});
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { getProfile } = await import('../src/agent.js');
const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
origin = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  try {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  } finally {
    fetchMock.mock.restore();
    process.env = savedEnv;
  }
});
let sequence = 0;
async function account() {
  const user = (await db.run('INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, 1) RETURNING *',
    `experience-${++sequence}@example.invalid`, 'Experience fixture', 'unused-fixture-hash')).rows[0];
  await db.run('INSERT INTO profiles (user_id, headline, resume_text) VALUES (?, ?, ?)', user.id, 'Keep this headline', 'Keep this original resume');
  return { ...user, token: signToken(user) };
}
async function call(user, method = 'GET', body, route = '/profile/resume-experience') {
  const response = await fetch(`${origin}/api${route}`, { method,
    headers: { ...(user && { Authorization: `Bearer ${user.token}` }), ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test('experience routes require authentication and existing profiles default to an empty bank', async () => {
  assert.equal((await call(null)).status, 401);
  assert.equal((await call(null, 'PUT', { entries: [] })).status, 401);
  const user = await account();
  assert.deepEqual(await call(user), { status: 200, body: { entries: [] } });
  assert.equal((await db.get('SELECT resume_evidence FROM profiles WHERE user_id = ?', user.id)).resume_evidence, '[]');
});

test('authenticated users save and reload their own factual entries without changing the uploaded resume', async () => {
  const first = await account();
  const second = await account();
  const project = entry({ organization: 'Personal project; quoted "dataset"', user_id: second.id });
  delete project.id;
  const saved = await call(first, 'PUT', { entries: [project], user_id: second.id });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.entries[0].details, project.details);
  assert.equal(Object.hasOwn(saved.body.entries[0], 'user_id'), false);
  assert.deepEqual((await call(first)).body, saved.body);
  assert.deepEqual((await call(second)).body.entries, []);
  const stored = await db.get('SELECT * FROM profiles WHERE user_id = ?', first.id);
  assert.deepEqual(JSON.parse(stored.resume_evidence), saved.body.entries);
  assert.equal(stored.resume_text, 'Keep this original resume');
  assert.equal(stored.headline, 'Keep this headline');
  const profile = (await call(first, 'GET', undefined, '/profile')).body;
  assert.deepEqual(profile.resume_evidence, saved.body.entries);
  assert.deepEqual((await getProfile(first.id)).resume_evidence, saved.body.entries);
  assert.equal(Object.hasOwn(profile, 'resume_data'), false);

  const other = entry({ kind: 'coursework', title: 'Database course project', dates: '', organization: '' });
  const otherSaved = await call(second, 'PUT', { entries: [other] });
  assert.equal(otherSaved.status, 200);
  assert.equal(otherSaved.body.entries[0].kind, 'coursework');
  assert.deepEqual((await call(first)).body, saved.body);
});

test('entries can be edited with stable ids or removed explicitly', async () => {
  const user = await account();
  const first = await call(user, 'PUT', { entries: [entry()] });
  const updated = { ...first.body.entries[0], details: 'User supplied an additional factual project result of 30%.' };
  const saved = await call(user, 'PUT', { entries: [updated] });
  assert.equal(saved.body.entries[0].id, fixedId);
  assert.equal(saved.body.entries[0].details, updated.details);
  assert.deepEqual(await call(user, 'PUT', { entries: [] }), { status: 200, body: { entries: [] } });
  assert.deepEqual((await call(user)).body.entries, []);
});

test('invalid writes leave the previous bank unchanged and do not echo private input', async () => {
  const user = await account();
  const original = await call(user, 'PUT', { entries: [entry()] });
  for (const body of [{}, { entries: '{}' }, { entries: [entry({ title: 'PRIVATE_FIXTURE_FACT'.repeat(10) })] },
    { entries: [entry({ details: '' })] }, { entries: [entry({ skills: Array(26).fill('SQL') })] }]) {
    const rejected = await call(user, 'PUT', body);
    assert.equal(rejected.status, 400);
    assert.equal(JSON.stringify(rejected.body).includes('PRIVATE_FIXTURE_FACT'), false);
    assert.deepEqual((await call(user)).body, original.body);
  }
});

test('malformed stored JSON cannot break profile reads and is not silently overwritten', async () => {
  const user = await account();
  await db.run('UPDATE profiles SET resume_evidence = ? WHERE user_id = ?', 'malformed fixture JSON', user.id);
  assert.deepEqual((await call(user)).body.entries, []);
  assert.deepEqual((await call(user, 'GET', undefined, '/profile')).body.resume_evidence, []);
  assert.equal((await db.get('SELECT resume_evidence FROM profiles WHERE user_id = ?', user.id)).resume_evidence, 'malformed fixture JSON');
});
