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
const { matchScore, saveJobs } = await import('../src/jobs.js');
const { parseLocation } = await import('../src/usLocation.js');
const { outbox } = await import('../src/mailer.js');

const server = createApp().listen(0);
const base = `http://localhost:${server.address().port}/api`;
let token;
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

await saveJobs(SAMPLE_JOBS.map((j) => ({ ...j, ...parseLocation(j.location, { remote: j.remote }) })), 'sample');

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
  // With no email service configured (development only), the code is also returned so the screen can show it.
  assert.equal(s.body.devCode, code);

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

  // Straight after verifying (within the one-minute resend limit) a reset code is still sent.
  const forgot = await call('POST', '/auth/forgot-password', { email: 'reset@x.com' });
  assert.equal(forgot.status, 200);
  const code = lastCode('reset@x.com');
  assert.equal(forgot.body.devCode, code);
  // Asking again within the minute doesn't send another email, but shows the same pending code again.
  const sentBefore = outbox.length;
  assert.equal((await call('POST', '/auth/forgot-password', { email: 'reset@x.com' })).body.devCode, code);
  assert.equal(outbox.length, sentBefore);
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

const RESUME = `Jane Doe
jane@example.com | +1 415 555 0100
Frontend Developer

SKILLS
JavaScript, React, CSS, Git

EXPERIENCE
Frontend Developer | Acme Corp | Jan 2021 - Present
• Built a React component library used by 6 teams
• Cut page load time by 40%

EDUCATION
BSc Computer Science | State University | 2016 - 2020`;

const uploadResume = async (bytes, name, type) => {
  const form = new FormData();
  form.append('resume', new Blob([bytes], { type }), name);
  const res = await fetch(`${base}/profile/resume`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: await res.json() };
};

/** A minimal one-page PDF with the given lines of text (Helvetica), with a correct cross-reference table. */
function makePdf(lines) {
  const stream = `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) '`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

test('resume upload reads PDF, Word and text files and stores the original in the database', async () => {
  const pdf = await uploadResume(makePdf(RESUME.split('\n').filter(Boolean)), 'Jane_CV.pdf', 'application/pdf');
  assert.equal(pdf.status, 200);
  assert.match(pdf.body.resume_text, /React component library/);
  assert.match(pdf.body.resume_text, /EXPERIENCE/);

  const { resumeToDocx } = await import('../src/resume.js');
  const docx = await resumeToDocx({ name: 'Jane Doe', headline: 'Engineer', contact: ['jane@example.com'], summary: 'Builds web apps with React and TypeScript for growing teams.', skills: ['React'], sections: [] });
  const word = await uploadResume(docx, 'Jane_CV.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(word.status, 200);
  assert.match(word.body.resume_text, /Builds web apps with React/);

  const old = await uploadResume(Buffer.from('binary'), 'cv.doc', 'application/msword');
  assert.equal(old.status, 400);
  assert.match(old.body.error, /\.docx or PDF/);
  assert.equal((await uploadResume(Buffer.from('hi'), 'cv.txt', 'text/plain')).status, 400);

  const txt = await uploadResume(RESUME, 'cv.txt', 'text/plain');
  assert.equal(txt.body.resume_file, 'cv.txt');
  assert.equal(txt.body.resume_text, RESUME);
  assert.equal(txt.body.resume_data, undefined);
  const down = await fetch(`${base}/profile/resume`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(await down.text(), RESUME);
  const checks = (await call('GET', '/profile/ats')).body.checks;
  assert.ok(checks.find((c) => c.label.includes('Experience')).ok);
});

test('tailored resumes use the standard format and never keep claims the resume does not support', async () => {
  const { tailorResume } = await import('../src/resume.js');
  const resumeText = `Sam Lee\nsam@example.com | +1 415 555 0100\nFrontend Developer\n\nSKILLS\nJavaScript, React\n\nWORK HISTORY\nFrontend Developer | Acme | 01/2021 - present\n• Built React apps with TypeScript used by 3 teams\n• Cut load time by 30%\n\nEDUCATION\nBSc Computer Science | State U | 2016 - 2020`;
  const job = { title: 'Frontend Engineer', company: 'Globex', description: 'React, TypeScript, Kubernetes and AWS required.' };
  // A stand-in for the AI that invents skills: Kubernetes and AWS appear nowhere in the resume.
  const inventing = { beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: {
    changes: ['Rewrote everything'],
    resume: {
      name: 'Sam Lee', headline: 'Frontend Engineer', contact: ['sam@example.com'],
      summary: 'Frontend engineer with React and TypeScript. Expert in Kubernetes and AWS.',
      skills: ['React', 'TypeScript', 'Kubernetes', 'AWS'],
      sections: [
        { title: 'education', items: [{ heading: 'BSc Computer Science', subheading: 'State U', dates: '2016-2020', bullets: [] }] },
        { title: 'Work Experience', items: [{ heading: 'Frontend Developer', subheading: 'Acme', dates: '01/2021 - present', bullets: ['Built React apps with TypeScript used by 3 teams', 'Deployed services on Kubernetes and AWS'] }] },
      ],
    },
  } }) } } };
  const t = await tailorResume({ resumeText, profile: {}, user: { name: 'Sam Lee', email: 'sam@example.com' }, job, aiClient: inventing, model: 'x' });
  assert.equal(t.ai, true);
  const text = JSON.stringify(t.resume);
  assert.ok(!/kubernetes|aws/i.test(text), `unsupported claims removed: ${text}`);
  assert.deepEqual(t.resume.skills, ['React', 'TypeScript']);
  assert.equal(t.resume.summary, 'Frontend engineer with React and TypeScript.');
  assert.deepEqual(t.removed.sort(), ['aws', 'kubernetes']);
  // Standard order, titles and date style, whatever order the AI used.
  assert.deepEqual(t.resume.sections.map((s) => s.title), ['Experience', 'Education']);
  assert.equal(t.resume.sections[0].items[0].dates, 'Jan 2021 – Present');
  assert.equal(t.resume.sections[1].items[0].dates, '2016 – 2020');
  // The resume can't honestly reach 85% without Kubernetes and AWS, and says so.
  assert.ok(t.gap && t.gap.missing.includes('kubernetes') && t.gap.missing.includes('aws'));

  // Rules-based tailoring of a well-matched job reaches the 85% target from real evidence alone.
  const fit = await tailorResume({ resumeText, profile: { experience_years: 4 }, user: { name: 'Sam Lee', email: 'sam@example.com' }, job: { title: 'Frontend Engineer', company: 'Globex', description: 'React, TypeScript and JavaScript.' } });
  assert.ok(fit.after.score >= 85, `score ${fit.after.score}`);
  assert.equal(fit.gap, null);
  assert.ok(fit.resume.skills.includes('TypeScript'), 'a skill mentioned only in a bullet is surfaced in Skills');

  // Skills being learned are listed openly as learning (which ATS software counts), never as skills already held.
  const learn = await tailorResume({ resumeText, profile: {}, user: { name: 'Sam Lee', email: 'sam@example.com' }, job, learningSkills: ['kubernetes', 'aws', 'cobol'] });
  const dev = learn.resume.sections.find((x) => x.title === 'Professional Development');
  assert.ok(dev && /Kubernetes/.test(dev.items[0].bullets[0]) && /AWS/.test(dev.items[0].bullets[0]));
  assert.ok(!/cobol/i.test(JSON.stringify(learn.resume)), 'only skills the job asks for can be added');
  assert.ok(!learn.resume.skills.some((x) => /kubernetes|aws/i.test(x)), 'learning skills stay out of the Skills list');
  assert.equal(learn.resume.sections.at(-1).title, 'Professional Development');
  assert.ok(learn.after.score > t.after.score, `learning raises the honest score: ${t.after.score} -> ${learn.after.score}`);
});

test('ATS score for a job, tailoring with confirmed skills and the Word download', async () => {
  const { id: jobId, tags } = await db.get("SELECT id, tags FROM jobs WHERE title = 'Frontend Engineer'");
  const ats = (await call('GET', `/jobs/${jobId}/ats`)).body;
  assert.equal(ats.hasResume, true);
  assert.ok(ats.matched.includes('react'));
  assert.ok(ats.missing.length > 0, `expected missing keywords for tags ${tags}`);
  assert.equal(ats.tailored, null);

  const claim = ats.missing[0];
  const t = (await call('POST', `/jobs/${jobId}/tailor`, { confirmedSkills: [claim, 'underwater basket weaving'] })).body;
  assert.equal(t.ai, false);
  assert.ok(t.ats_after > t.ats_before, `score should rise: ${t.ats_before} -> ${t.ats_after}`);
  assert.equal(t.resume.headline, 'Frontend Engineer');
  assert.ok(t.resume.skills.some((s) => s.toLowerCase() === claim));
  assert.ok(!t.text.includes('basket weaving'), 'skills the job does not ask for are never added');
  assert.deepEqual(t.resume.sections.map((s) => s.title), ['Experience', 'Education']);
  assert.equal(t.resume.sections[0].items[0].subheading, 'Acme Corp');
  assert.equal((await call('GET', `/jobs/${jobId}/ats`)).body.tailored.id, t.id);

  const res = await fetch(`${base}/jobs/${jobId}/tailor/docx`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /Jane-Doe-Resume-.+\.docx/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const { extractResumeText } = await import('../src/resume.js');
  const readBack = await extractResumeText(bytes, 'r.docx');
  for (const part of ['Jane Doe', 'Frontend Engineer', 'EXPERIENCE', 'Acme Corp', 'Cut page load time by 40%']) assert.ok(readBack.includes(part), `docx is missing "${part}"`);

  const other = await db.get("SELECT id FROM jobs WHERE title <> 'Frontend Engineer' LIMIT 1");
  assert.equal((await fetch(`${base}/jobs/${other.id}/tailor/docx`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
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

test('US location parsing: keeps US jobs and their states, drops the rest', () => {
  const us = (l, h) => parseLocation(l, h);
  assert.deepEqual(us('San Francisco, CA; New York, NY').states, ['CA', 'NY']);
  assert.equal(us('Remote - US').us, true);
  assert.equal(us('Remote', { defaultUS: true }).us, true);
  assert.equal(us('Remote').us, false, 'worldwide aggregators need an explicit US location');
  for (const l of ['London, UK', 'Toronto, ON', 'Bengaluru, IN', 'Remote (Canada)', 'Cambridge, UK', 'Mexico City, Mexico']) assert.equal(us(l, { defaultUS: true }).us, false, l);
  assert.deepEqual(us('Indianapolis, IN').states, ['IN']);
  assert.deepEqual(us('Portland, ME').states, ['ME']);
  assert.deepEqual(us('Washington, DC').states, ['DC']);
  assert.deepEqual(us('Austin, Texas, United States').states, ['TX']);
  assert.equal(us('Remote', { country: 'Canada' }).us, false);
});

test('career-site links are recognised for every supported platform', async () => {
  const { parseBoardUrl } = await import('../src/sources.js');
  const cases = {
    'https://boards.greenhouse.io/stripe': { ats: 'greenhouse', token: 'stripe' },
    'https://job-boards.greenhouse.io/figma/jobs/123': { ats: 'greenhouse', token: 'figma' },
    'https://boards.greenhouse.io/embed/job_board?for=airbnb': { ats: 'greenhouse', token: 'airbnb' },
    'https://jobs.lever.co/palantir/abc-123': { ats: 'lever', token: 'palantir' },
    'jobs.ashbyhq.com/openai': { ats: 'ashby', token: 'openai' },
    'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/details/x': { ats: 'workday', token: 'nvidia|wd5|NVIDIAExternalCareerSite' },
    'https://zoom.wd5.myworkdayjobs.com/Zoom': { ats: 'workday', token: 'zoom|wd5|Zoom' },
    'https://jobs.smartrecruiters.com/ServiceNow/744': { ats: 'smartrecruiters', token: 'ServiceNow' },
    'https://apply.workable.com/huggingface/': { ats: 'workable', token: 'huggingface' },
  };
  for (const [url, want] of Object.entries(cases)) assert.deepEqual(parseBoardUrl(url), want, url);
  assert.equal(parseBoardUrl('https://careers.google.com/jobs'), null);
  assert.equal(parseBoardUrl('not a link at all'), null);
  assert.equal((await call('POST', '/companies/discover', { query: 'https://careers.google.com/jobs' })).status, 400);
  assert.equal((await call('POST', '/companies/discover', { query: 'x' })).status, 400);
});

test('job search filters: keyword, date posted, company, state, remote, sort, paging and counts', async () => {
  // One stale and one non-US job that must never appear.
  await saveJobs([
    { external_id: 'old-1', source: 'Test', title: 'Frontend Engineer', company: 'Oldco', location: 'Austin, TX', states: ['TX'], remote: false, posted_at: new Date(Date.now() - 45 * 864e5).toISOString() },
  ], 'test');
  await db.run("INSERT INTO jobs (external_id, source, title, company, location, country, posted_ts, posted_at) VALUES ('uk-1', 'Test', 'Frontend Engineer', 'Britco', 'London, UK', NULL, now(), now()::text)");

  const all = (await call('GET', '/jobs?limit=100')).body;
  assert.equal(all.total, SAMPLE_JOBS.length);
  assert.ok(all.jobs.every((j) => j.company !== 'Oldco' && j.company !== 'Britco'));
  assert.ok(all.jobs.every((j, i, a) => i === 0 || a[i - 1].posted_at >= j.posted_at), 'newest first');

  const tx = (await call('GET', '/jobs?state=TX')).body;
  assert.ok(tx.total > 0 && tx.jobs.every((j) => j.states.includes('TX')));
  const txOrRemote = (await call('GET', '/jobs?state=TX|REMOTE')).body;
  assert.ok(txOrRemote.total > tx.total);
  assert.ok((await call('GET', '/jobs?remote=1')).body.jobs.every((j) => j.remote));

  const company = all.jobs[0].company;
  const byCompany = (await call('GET', `/jobs?company=${encodeURIComponent(company)}`)).body;
  assert.ok(byCompany.total > 0 && byCompany.jobs.every((j) => j.company === company));

  const kw = (await call('GET', '/jobs?q=frontend%20engineer')).body;
  assert.ok(kw.total > 0 && kw.jobs.every((j) => /frontend/i.test(j.title)));
  const day = (await call('GET', '/jobs?posted=1')).body;
  assert.ok(day.total > 0 && day.total < all.total, 'sample jobs are spread over several days');

  const page2 = (await call('GET', '/jobs?limit=5&offset=5')).body;
  assert.deepEqual(page2.jobs.map((j) => j.id), all.jobs.slice(5, 10).map((j) => j.id));
  const best = (await call('GET', '/jobs?sort=match&limit=5')).body.jobs;
  assert.ok(best.every((j, i) => i === 0 || best[i - 1].match_score >= j.match_score));

  const facets = (await call('GET', '/jobs/facets?state=TX')).body;
  assert.equal(facets.companies.reduce((n, c) => n + c.count, 0), tx.total, 'company counts respect the state filter');
  assert.ok(facets.states.find((s) => s.code === 'CA').count > 0, 'state counts ignore the state filter itself');
  assert.equal(facets.states[0].code, 'REMOTE');
  assert.equal(facets.dates.find((d) => d.days === 30).count, tx.total);

  const detail = (await call('GET', `/jobs/${all.jobs[0].id}`)).body;
  assert.match(detail.description, /is hiring/);
  assert.equal((await call('GET', '/jobs/999999')).status, 404);
  // Opening a job with preferred locations set on the profile (this used to crash).
  await call('PUT', '/profile', { locations: 'TX, Remote' });
  const withLocations = await call('GET', `/jobs/${all.jobs[0].id}`);
  assert.equal(withLocations.status, 200);
  assert.ok(withLocations.body.match_score >= 0);
  await call('PUT', '/profile', { locations: '' });
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

test('saved jobs: save, list, unsave, and tailor + apply to all with one click', async () => {
  const fresh = (await call('GET', '/jobs?onlyNew=1&limit=3')).body.jobs;
  for (const j of fresh) assert.equal((await call('PUT', `/jobs/${j.id}/save`)).body.saved, true);
  await call('PUT', `/jobs/${fresh[0].id}/save`); // saving twice is harmless
  assert.equal((await call('GET', '/jobs?limit=100')).body.jobs.filter((j) => j.saved).length, 3);
  assert.equal((await call('DELETE', `/jobs/${fresh[2].id}/save`)).body.saved, false);
  const saved = (await call('GET', '/saved')).body;
  assert.deepEqual(saved.map((s) => s.id).sort(), [fresh[0].id, fresh[1].id].sort());

  const before = (await call('GET', '/applications')).body.length;
  const r = await call('POST', '/saved/apply-all');
  assert.equal(r.status, 202);
  assert.equal(r.body.queued, 2);
  for (let i = 0; i < 50 && (await call('GET', '/applications')).body.filter((a) => a.status === 'applied').length < before + 2; i++) await new Promise((res) => setTimeout(res, 100));
  const after = (await call('GET', '/saved')).body;
  assert.ok(after.every((s) => s.application_status === 'applied' && s.ats_after > 0), 'each saved job got a tailored resume and an application');
  assert.equal((await call('POST', '/saved/apply-all')).body.queued, 0, 'already-applied jobs are skipped');
});

test.after(async () => { server.close(); await db.close(); });
