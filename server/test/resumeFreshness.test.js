import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const savedEnv = { ...process.env };
Object.assign(process.env, {
  NODE_ENV: 'test', DB_PATH: ':memory:', API_RATE_LIMIT: '1000',
  JWT_SECRET: 'resume-freshness-fixture-secret', PASSWORD_PEPPER: 'resume-freshness-fixture-pepper',
  ANTHROPIC_API_KEY: 'fixture-key-never-sent', ANTHROPIC_MODEL: 'fixture-model', ANTHROPIC_LOG: 'error',
});
for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'BREVO_API_KEY', 'SMTP_HOST', 'TRUST_PROXY',
  'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_PROFILE']) delete process.env[key];

const realFetch = globalThis.fetch;
let origin;
let detailCalls = 0;
const detailUrl = 'https://api.smartrecruiters.com/v1/companies/FreshnessFixture/postings/posting-id';
const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
  if (url === detailUrl) {
    detailCalls++;
    return new Response(JSON.stringify({ jobAd: { sections: {
      qualifications: { title: 'Qualifications', text: '<p>React and TypeScript required.</p>' },
    } } }), { status: 200 });
  }
  assert.equal(new URL(url).origin, origin, 'only loopback requests may use the real fetch');
  return realFetch(url, options);
});

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { aiClient } = await import('../src/ai.js');
const { getTailoredResume } = await import('../src/agent.js');
const { getResumeInputFingerprint, parseResume, RESUME_SCORING_VERSION } = await import('../src/resume.js');
let aiResume;
let pauseAi;
const aiMock = mock.method(aiClient.beta.messages, 'parse', async () => {
  const parsed_output = { resume: structuredClone(aiResume), changes: ['Preserved fixture experience.'], inferredSkills: [] };
  await pauseAi?.();
  return { stop_reason: 'end_turn', parsed_output };
});

const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
origin = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  try {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  } finally {
    aiMock.mock.restore();
    fetchMock.mock.restore();
    process.env = savedEnv;
  }
});

const resumeText = `Sam Fixture
sam@example.invalid | +1 202 555 0123
Frontend Engineer

Summary
Frontend engineer delivering accessible web applications with React and TypeScript.

Skills
React, TypeScript, JavaScript

Experience
Frontend Engineer
Fixture Corp
Jan 2021 - Present
Built React interfaces used by 3 teams and cut page load time by 40%.
Maintained TypeScript and JavaScript applications with unit testing.

Education
BSc Computer Science
Fixture University
2016 - 2020`;
let sequence = 0;
async function fixture(jobOverrides = {}) {
  const number = ++sequence;
  const user = (await db.run('INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, 1) RETURNING *',
    `freshness-${number}@example.invalid`, 'Sam Fixture', 'unused-fixture-hash')).rows[0];
  await db.run('INSERT INTO profiles (user_id, resume_text, headline, skills, titles) VALUES (?, ?, ?, ?, ?)',
    user.id, resumeText, 'Frontend Engineer', 'React, TypeScript, JavaScript', 'Frontend Engineer');
  const values = { source: 'fixture', title: 'Frontend Engineer', company: 'Fixture Corp',
    description: 'Required qualifications\nReact, TypeScript, JavaScript and Docker.', tags: '',
    details_fetched: 1, url: 'https://example.invalid/job', ...jobOverrides };
  const job = (await db.run('INSERT INTO jobs (external_id, source, title, company, description, tags, details_fetched, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    `freshness-${number}`, values.source, values.title, values.company, values.description, values.tags, values.details_fetched, values.url)).rows[0];
  await db.run('INSERT INTO saved_jobs (user_id, job_id) VALUES (?, ?)', user.id, job.id);
  return { user, job, token: signToken(user) };
}
async function call(f, method, path, body) {
  const response = await fetch(`${origin}/api${path}`, { method,
    headers: { Authorization: `Bearer ${f.token}`, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function tailor(f) {
  const profile = await db.get('SELECT * FROM profiles WHERE user_id = ?', f.user.id);
  aiResume = parseResume(profile.resume_text, profile, f.user);
  const result = await call(f, 'POST', `/jobs/${f.job.id}/tailor`, {});
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
async function assertHidden(f) {
  const ats = await call(f, 'GET', `/jobs/${f.job.id}/ats`);
  assert.equal(ats.status, 200);
  assert.equal(ats.body.tailored, null);
  assert.equal((await call(f, 'GET', `/jobs/${f.job.id}/tailor/docx`)).status, 404);
  const saved = (await call(f, 'GET', '/saved')).body.find(job => job.id === f.job.id);
  assert.equal(saved.ats_before, null);
  assert.equal(saved.ats_after, null);
}

test('fresh reports persist their evidence, refinement and version metadata and remain downloadable', async () => {
  const f = await fixture();
  const callsBefore = aiMock.mock.callCount();
  const tailored = await tailor(f);
  assert.ok(aiMock.mock.callCount() > callsBefore, 'AI calls must use the local mock');
  assert.equal(tailored.report.scoringVersion, RESUME_SCORING_VERSION);
  assert.match(tailored.report.inputFingerprint, /^[a-f\d]{64}$/);
  assert.ok(Array.isArray(tailored.report.evidenceMap));
  assert.ok(tailored.report.refinement);
  const profile = await db.get('SELECT * FROM profiles WHERE user_id = ?', f.user.id);
  assert.equal(tailored.report.inputFingerprint, getResumeInputFingerprint({ resumeText, profile, user: f.user, job: f.job }));
  const ats = (await call(f, 'GET', `/jobs/${f.job.id}/ats`)).body;
  assert.equal(ats.tailored.id, tailored.id);
  assert.equal(ats.inputFingerprint, tailored.report.inputFingerprint);
  const saved = (await call(f, 'GET', '/saved')).body.find(job => job.id === f.job.id);
  assert.equal(saved.ats_after, tailored.ats_after);
  assert.equal(Object.hasOwn(saved, 'tailored_report'), false);
  const docx = await call(f, 'GET', `/jobs/${f.job.id}/tailor/docx`);
  assert.equal(docx.status, 200);
  assert.equal(docx.body.subarray(0, 2).toString(), 'PK');
});

test('same-length resume and job edits hide old reports until regeneration without deleting them', async () => {
  const f = await fixture();
  const initial = await tailor(f);
  const changedResume = resumeText.replace('React', 'Vuejs');
  assert.equal(changedResume.length, resumeText.length);
  await db.run('UPDATE profiles SET resume_text = ? WHERE user_id = ?', changedResume, f.user.id);
  await assertHidden(f);
  assert.equal((await db.get('SELECT id FROM tailored_resumes WHERE user_id = ? AND job_id = ?', f.user.id, f.job.id)).id, initial.id);
  const refreshed = await tailor(f);
  assert.equal(refreshed.id, initial.id);
  assert.notEqual(refreshed.report.inputFingerprint, initial.report.inputFingerprint);
  assert.equal((await call(f, 'GET', `/jobs/${f.job.id}/ats`)).body.tailored.id, initial.id);

  const changedDescription = f.job.description.replace('Docker', 'Podman');
  assert.equal(changedDescription.length, f.job.description.length);
  await db.run('UPDATE jobs SET description = ? WHERE id = ?', changedDescription, f.job.id);
  await assertHidden(f);
  const regenerated = await tailor(f);
  assert.equal(regenerated.id, initial.id);
  assert.notEqual(regenerated.report.inputFingerprint, refreshed.report.inputFingerprint);
  assert.equal((await call(f, 'GET', `/jobs/${f.job.id}/tailor/docx`)).status, 200);
});

test('legacy and old-version reports remain stored but cannot be reused', async () => {
  const f = await fixture();
  const tailored = await tailor(f);
  for (const report of [
    { before: tailored.report.before, after: tailored.report.after },
    { ...tailored.report, scoringVersion: 'obsolete-fixture-version' },
  ]) {
    const serialized = JSON.stringify(report);
    await db.run('UPDATE tailored_resumes SET report = ? WHERE id = ?', serialized, tailored.id);
    await assertHidden(f);
    assert.equal(await getTailoredResume(f.user.id, f.job.id), null);
    assert.equal((await db.get('SELECT report FROM tailored_resumes WHERE id = ?', tailored.id)).report, serialized);
  }
});

test('freshness checks and cached resumes remain isolated to their account', async () => {
  const first = await fixture();
  const second = await fixture();
  await db.run('INSERT INTO saved_jobs (user_id, job_id) VALUES (?, ?)', second.user.id, first.job.id);
  second.job = first.job;
  const firstTailored = await tailor(first);
  const secondTailored = await tailor(second);
  assert.notEqual(firstTailored.id, secondTailored.id);
  await db.run('UPDATE profiles SET headline = ? WHERE user_id = ?', 'Updated frontend role', first.user.id);
  await assertHidden(first);
  assert.equal((await getTailoredResume(second.user.id, first.job.id)).id, secondTailored.id);
  assert.equal((await call(second, 'GET', `/jobs/${first.job.id}/tailor/docx`)).status, 200);
});

test('the ATS endpoint loads missing job details before scoring and fingerprinting', async () => {
  const f = await fixture({ source: 'SmartRecruiters', description: '', details_fetched: 0,
    url: 'https://jobs.smartrecruiters.com/FreshnessFixture/posting-id' });
  const before = detailCalls;
  const ats = (await call(f, 'GET', `/jobs/${f.job.id}/ats`)).body;
  assert.equal(detailCalls, before + 1);
  assert.ok(ats.matched.includes('react'));
  const job = await db.get('SELECT * FROM jobs WHERE id = ?', f.job.id);
  assert.match(job.description, /React and TypeScript required/);
  assert.equal(job.details_fetched, 1);
  const tailored = await tailor(f);
  assert.equal(tailored.report.inputFingerprint, ats.inputFingerprint);
  assert.equal(detailCalls, before + 1, 'tailoring uses the same loaded job details');
});

for (const input of ['profile', 'job']) {
  test(`${input} edits during an AI request reject its stale result without overwriting the stored report`, { timeout: 10_000 }, async (t) => {
    const f = await fixture();
    const tailored = await tailor(f);
    const originalRow = await db.get('SELECT * FROM tailored_resumes WHERE id = ?', tailored.id);
    let entered;
    let resume;
    const reachedAi = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { resume = resolve; });
    let waiting = false;
    pauseAi = () => {
      if (waiting) return;
      waiting = true;
      entered();
      return blocked;
    };
    t.after(() => { pauseAi = undefined; resume(); });
    const pending = call(f, 'POST', `/jobs/${f.job.id}/tailor`, {});
    await Promise.race([reachedAi, pending.then(result => {
      throw new Error(`Tailoring returned ${result.status} before reaching the mocked AI request`);
    })]);
    if (input === 'profile') await db.run('UPDATE profiles SET phone = ? WHERE user_id = ?', '+1 202 555 0199', f.user.id);
    else await db.run('UPDATE jobs SET description = ? WHERE id = ?', f.job.description.replace('Docker', 'Podman'), f.job.id);
    resume();
    const result = await pending;
    assert.equal(result.status, 409);
    assert.equal(result.body.error, 'Your resume or this job changed while tailoring. Reload and try again.');
    assert.deepEqual(await db.get('SELECT * FROM tailored_resumes WHERE id = ?', tailored.id), originalRow);
    await assertHidden(f);
  });
}
