import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const savedEnv = { ...process.env };
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: ':memory:', API_RATE_LIMIT: '1000',
  JWT_SECRET: 'one-click-fixture-secret', PASSWORD_PEPPER: 'one-click-fixture-pepper',
  ANTHROPIC_API_KEY: 'one-click-fixture-never-sent', ANTHROPIC_MODEL: 'fixture-model', ANTHROPIC_LOG: 'error' });
for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'BREVO_API_KEY', 'SMTP_HOST', 'TRUST_PROXY',
  'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_PROFILE']) delete process.env[key];
const realFetch = globalThis.fetch;
let origin;
const fetchMock = mock.method(globalThis, 'fetch', (url, options) => {
  assert.equal(new URL(url).origin, origin, 'one-click tests must not contact providers');
  return realFetch(url, options);
});
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');
const { getProfile, getSavedResumeChoices } = await import('../src/agent.js');
const { aiClient } = await import('../src/ai.js');
const { parseResume, standardise, atsReport, extractResumeText } = await import('../src/resume.js');
let aiDraft;
const aiMock = mock.method(aiClient.beta.messages, 'parse', async () => ({ stop_reason: 'end_turn',
  parsed_output: { resume: structuredClone(aiDraft), changes: ['Rewrote the professional summary.'], inferredSkills: [] } }));
const server = createApp().listen(0, '127.0.0.1');
await once(server, 'listening');
origin = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  try {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  } finally {
    aiMock.mock.restore(); fetchMock.mock.restore(); process.env = savedEnv;
  }
});

const resumeText = `Maya Lane
maya@example.invalid | +1 212 555 0199
Frontend Engineer
SUMMARY
Frontend engineer building accessible web interfaces with React and JavaScript for internal teams.
SKILLS
React, JavaScript
EXPERIENCE
Frontend Engineer | Existing Employer | Jan 2021 - Present
Built React interfaces used by 3 teams and reduced page load time by 30%.
Maintained JavaScript applications and reduced release review work by 12 hours.
EDUCATION
BSc Computer Science | Fixture University | 2016 - 2020`;
const paraphrase = 'Frontend engineer developing accessible web applications with React and JavaScript for internal teams.';
let sequence = 0;
async function fixture(skills = '') {
  const number = ++sequence;
  const user = (await db.run('INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, 1) RETURNING *',
    `one-click-${number}@example.invalid`, 'Maya Lane', 'unused-fixture-hash')).rows[0];
  await db.run('INSERT INTO profiles (user_id, resume_text, skills) VALUES (?, ?, ?)', user.id, resumeText, skills);
  const job = (await db.run('INSERT INTO jobs (external_id, source, title, company, description, details_fetched) VALUES (?, ?, ?, ?, ?, 1) RETURNING *',
    `one-click-${number}`, 'fixture', 'Frontend Engineer', 'Fixture Target',
    'Required skills: React, JavaScript, SQL, Python, Airflow and Docker.')).rows[0];
  return { user, job, token: signToken(user) };
}
async function call(f, method, path, body) {
  const response = await fetch(`${origin}/api${path}`, { method,
    headers: { Authorization: `Bearer ${f.token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json')
    ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function tailor(f, body, revise) {
  const profile = await getProfile(f.user.id);
  aiDraft = standardise(parseResume(profile.resume_text, profile, f.user));
  aiDraft.summary = paraphrase;
  revise?.(aiDraft);
  const result = await call(f, 'POST', `/jobs/${f.job.id}/tailor`, body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
const hasSkill = (skills, keyword) => skills.some(value => value.toLowerCase() === keyword);

test('one click tailors an uploaded resume with an empty profile and no experience form fields', async () => {
  const f = await fixture();
  const profile = await getProfile(f.user.id);
  assert.deepEqual(profile.resume_evidence, []);
  assert.equal(profile.skills, '');
  const callsBefore = aiMock.mock.callCount();
  const result = await tailor(f);
  assert.ok(aiMock.mock.callCount() > callsBefore);
  assert.ok(result.text.includes('Existing Employer'));
  assert.equal(result.resume.sections.some(section => section.title === 'Projects'), false);
  assert.deepEqual(result.report.skillChoices, { confirmed: [], learning: [] });
  assert.equal((await getProfile(f.user.id)).resume_text, resumeText);
  const again = await tailor(f, { title: '', organization: '', dates: '' });
  assert.equal(again.id, result.id, 'blank optional form-shaped fields are not required tailoring inputs');
});

test('profile skills and explicit confirmations enter Skills and Summary without fabricated employer use', async () => {
  const f = await fixture('SQL, Python, Airflow');
  const initial = (await call(f, 'GET', `/jobs/${f.job.id}/ats`)).body;
  for (const keyword of ['sql', 'python', 'airflow']) assert.ok(initial.knownSkills.includes(keyword), keyword);
  const result = await tailor(f, { confirmedSkills: ['docker'], learningSkills: [] }, draft => {
    const experience = draft.sections.find(section => section.title === 'Experience').items[0];
    experience.bullets.unshift('Built Python and SQL pipelines in Airflow with Docker at Existing Employer.');
    draft.sections.push({ title: 'Projects', items: [{ heading: 'Invented project', subheading: 'Invented organization', dates: '2010 - 2011', bullets: ['Built Python pipelines in Airflow.'] }] });
  });
  for (const keyword of ['sql', 'python', 'airflow', 'docker']) {
    assert.ok(hasSkill(result.resume.skills, keyword), `${keyword} should be present in Skills`);
    assert.match(result.resume.summary.toLowerCase(), new RegExp(`\\b${keyword}\\b`));
  }
  const employment = result.resume.sections.find(section => section.title === 'Experience');
  assert.doesNotMatch(JSON.stringify(employment), /\b(?:SQL|Python|Airflow|Docker)\b/i);
  assert.ok(employment.items.some(item => item.subheading === 'Existing Employer'));
  assert.equal(result.resume.sections.some(section => section.title === 'Projects'), false);
  assert.doesNotMatch(result.text, /Invented organization|2010/);
  assert.deepEqual(result.report.skillChoices.confirmed, ['docker']);
});

test('professional summary paraphrases survive factual validation', async () => {
  const f = await fixture('SQL, Python, Airflow');
  const result = await tailor(f);
  assert.match(result.resume.summary, /developing accessible web applications/);
});

test('preview, saved report, and Word output share the actual score', async () => {
  const f = await fixture('SQL, Python, Airflow');
  const result = await tailor(f);
  assert.equal(result.report.after.score, result.ats_after);
  assert.equal(atsReport(result.text, f.job).score, result.ats_after);
  const stored = await db.get('SELECT report, ats_after FROM tailored_resumes WHERE id = ?', result.id);
  assert.equal(JSON.parse(stored.report).after.score, result.ats_after);
  assert.equal(stored.ats_after, result.ats_after);
  const ats = (await call(f, 'GET', `/jobs/${f.job.id}/ats`)).body;
  assert.equal(ats.tailored.ats_after, result.ats_after);
  const download = await call(f, 'GET', `/jobs/${f.job.id}/tailor/docx`);
  assert.equal(download.status, 200);
  const text = await extractResumeText(download.body, 'fixture.docx');
  assert.equal(atsReport(text, f.job).score, result.ats_after);
  for (const keyword of ['sql', 'python', 'airflow']) assert.match(text.toLowerCase(), new RegExp(`\\b${keyword}\\b`));
});

test('previously saved project facts are reused without resubmitting an experience form', async () => {
  const f = await fixture();
  const project = { id: '0723f30c-0774-4fb5-a7db-a0b293e88c7c', kind: 'project', title: 'Personal sales workflow',
    organization: 'Independent project', dates: 'Mar 2024 - Jun 2024', skills: ['SQL', 'Python', 'Airflow'],
    details: 'Built SQL and Python workflows in Airflow for 12 source files.' };
  await db.run('UPDATE profiles SET resume_evidence = ? WHERE user_id = ?', JSON.stringify([project]), f.user.id);
  const result = await tailor(f);
  const selected = result.resume.sections.find(section => section.title === 'Projects')?.items.find(item => item.heading === project.title);
  assert.ok(selected);
  assert.equal(selected.subheading, project.organization);
  assert.match(selected.bullets.join(' '), /12 source files/);
  assert.doesNotMatch(JSON.stringify(result.resume.sections.find(section => section.title === 'Experience')), /Python|Airflow|12 source files/);
  const repeated = await tailor(f, {});
  assert.equal(repeated.id, result.id);
  assert.ok(repeated.resume.sections.find(section => section.title === 'Projects')?.items.some(item => item.heading === project.title));
});

test('omitted choices survive stale input changes, explicit empty arrays clear, and accounts stay isolated', async () => {
  const first = await fixture();
  const original = await tailor(first, { confirmedSkills: ['sql', 'python', 'airflow'], learningSkills: ['docker'] });
  await db.run('UPDATE profiles SET phone = ? WHERE user_id = ?', '+1 212 555 0188', first.user.id);
  await db.run('UPDATE jobs SET description = ? WHERE id = ?', `${first.job.description}\nPreferred: Git.`, first.job.id);
  const stale = (await call(first, 'GET', `/jobs/${first.job.id}/ats`)).body;
  assert.equal(stale.tailored, null);
  assert.deepEqual(stale.skillChoices, original.report.skillChoices);
  const repeated = await tailor(first);
  for (const keyword of ['sql', 'python', 'airflow']) {
    assert.ok(hasSkill(repeated.resume.skills, keyword));
    assert.match(repeated.resume.summary.toLowerCase(), new RegExp(`\\b${keyword}\\b`));
  }
  assert.deepEqual(repeated.report.skillChoices, original.report.skillChoices);
  assert.equal(repeated.report.after.matched.includes('docker'), false);

  const second = await fixture();
  second.job = first.job;
  assert.deepEqual(await getSavedResumeChoices(second.user.id, first.job.id), { confirmed: [], learning: [] });
  const isolated = await tailor(second);
  for (const keyword of ['sql', 'python', 'airflow']) assert.equal(hasSkill(isolated.resume.skills, keyword), false);

  const cleared = await tailor(first, { confirmedSkills: [], learningSkills: [] });
  assert.deepEqual(cleared.report.skillChoices, { confirmed: [], learning: [] });
  assert.deepEqual(await getSavedResumeChoices(first.user.id, first.job.id), { confirmed: [], learning: [] });
  for (const keyword of ['sql', 'python', 'airflow']) assert.equal(hasSkill(cleared.resume.skills, keyword), false);
});

test('legacy choices reuse only explicit user attestations rather than profile-derived status', async () => {
  const f = await fixture();
  const tailored = await tailor(f);
  const report = { evidenceMap: [
    { keyword: 'SQL', status: 'confirmed', sources: [{ source: 'user-confirmation' }] },
    { keyword: 'Python', status: 'confirmed', sources: [{ source: 'profile.skills' }] },
    { keyword: 'Docker', status: 'learning' },
    { keyword: {}, status: 'learning' },
  ] };
  await db.run('UPDATE tailored_resumes SET report = ? WHERE id = ?', JSON.stringify(report), tailored.id);
  assert.deepEqual(await getSavedResumeChoices(f.user.id, f.job.id), { confirmed: ['sql'], learning: ['docker'] });
  const result = await tailor(f, {});
  assert.ok(hasSkill(result.resume.skills, 'sql'));
  assert.equal(hasSkill(result.resume.skills, 'python'), false);
  const callsBefore = aiMock.mock.callCount();
  const invalid = await call(f, 'POST', `/jobs/${f.job.id}/tailor`, { confirmedSkills: { sql: true } });
  assert.equal(invalid.status, 400);
  assert.equal(aiMock.mock.callCount(), callsBefore);
});
