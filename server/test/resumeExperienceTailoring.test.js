import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';

// resume.js currently imports the database's CSV helper. Keep that dependency
// entirely in memory; no local credentials, files, server, or provider calls.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'ANTHROPIC_API_KEY', 'BREVO_API_KEY', 'SMTP_HOST']) delete process.env[key];
const fetchMock = mock.method(globalThis, 'fetch', () => assert.fail('Experience tailoring tests must not make network requests'));
const { tailorResume, parseResume, standardise, resumeToText, getResumeInputFingerprint } = await import('../src/resume.js');
const { db } = await import('../src/db.js');
after(async () => { await db.close(); fetchMock.mock.restore(); });

const user = { name: 'Alex Morgan', email: 'alex@example.test' };
const resumeText = `Alex Morgan
alex@example.test | +1 212 555 0199
Data Engineer
SUMMARY
Data engineer maintaining SQL reporting services and reliable business reports.
SKILLS
SQL
EXPERIENCE
Data Engineer | Existing Employer | Jan 2021 - Present
• Maintained SQL reporting jobs for 2 teams and reduced monthly review work by 10 hours
• Reviewed source records and documented repeatable report checks
EDUCATION
BSc Computer Science | Fixture University | 2016 - 2020`;
const job = {
  title: 'Data Engineer', company: 'Fixture Target',
  description: 'Required: Python, Airflow, Pandas and SQL. Preferred: ETL and data pipelines.',
};
const project = {
  id: '6c509fe1-5a02-4f45-bb64-14a268d0c838', kind: 'project', title: 'Personal Sales Pipeline',
  organization: 'Independent project', dates: 'Mar 2024 - Jun 2024',
  skills: ['Python', 'Airflow', 'Pandas', 'SQL', 'ETL', 'data pipelines'],
  details: 'Created Python ETL jobs in Airflow using Pandas and SQL to process 12 CSV sources. Built data pipelines that reduced manual data preparation by 30%.',
};
const profileWith = (...entries) => ({ resume_evidence: structuredClone(entries) });
const sourceDraft = () => standardise(parseResume(resumeText, {}, user));
function withProject(details = project.details) {
  const resume = sourceDraft();
  resume.skills.push(...project.skills);
  resume.sections.push({ title: 'Projects', items: [{
    heading: project.title, subheading: project.organization, dates: project.dates,
    bullets: details.split(/(?<=\.)\s+/),
  }] });
  return standardise(resume);
}
function fakeAI(resume) {
  const calls = [];
  return { calls, beta: { messages: { parse: async (body) => {
    calls.push(body);
    return { stop_reason: 'end_turn', parsed_output: { resume: structuredClone(resume), changes: ['Used candidate-provided project experience.'], inferredSkills: [] } };
  } } } };
}
const itemAt = (result, section, heading) => result.resume.sections.find((entry) => entry.title === section)?.items.find((item) => item.heading === heading);

test('captured real project experience absent from the original document supports a strong tailored Projects section', async () => {
  assert.doesNotMatch(resumeText, /Python|Airflow|Pandas/);
  const ai = fakeAI(withProject());
  const result = await tailorResume({ resumeText, user, profile: profileWith(project), job, aiClient: ai, model: 'fixture' });
  const item = itemAt(result, 'Projects', project.title);
  assert.ok(item, 'the explicitly captured project must survive factual validation');
  assert.equal(item.subheading, project.organization);
  assert.match(item.dates, /Mar 2024.*Jun 2024/);
  assert.match(item.bullets.join(' '), /Python/);
  assert.match(item.bullets.join(' '), /Airflow/);
  assert.match(item.bullets.join(' '), /Pandas/);
  assert.match(item.bullets.join(' '), /12 CSV sources/);
  assert.match(item.bullets.join(' '), /30%/);
  assert.ok(result.after.score >= 85, 'supported skills and existing resume formatting should reach the target');
  for (const keyword of ['python', 'airflow', 'pandas', 'sql', 'etl', 'data pipelines']) assert.ok(result.after.matched.includes(keyword), keyword);
  assert.ok(ai.calls.length > 0);
  assert.match(ai.calls[0].messages[0].content, /Personal Sales Pipeline/);
  assert.match(ai.calls[0].messages[0].content, /12 CSV sources/);
  assert.doesNotMatch(itemAt(result, 'Experience', 'Data Engineer').bullets.join(' '), /Python|Airflow|Pandas|12 CSV sources|30%/);
});

test('persisted experience details are used without resubmitting skill confirmation and invalidate saved tailoring inputs', async () => {
  const saved = JSON.parse(JSON.stringify(profileWith(project)));
  const result = await tailorResume({ resumeText, user, profile: saved, job });
  assert.ok(itemAt(result, 'Projects', project.title));
  assert.ok(result.after.matched.includes('python'));
  const originalFingerprint = getResumeInputFingerprint({ resumeText, user, profile: {}, job });
  const savedFingerprint = getResumeInputFingerprint({ resumeText, user, profile: saved, job });
  assert.notEqual(savedFingerprint, originalFingerprint);
  saved.resume_evidence[0].details += ' Also validated the source file counts.';
  assert.notEqual(getResumeInputFingerprint({ resumeText, user, profile: saved, job }), savedFingerprint);
});

test('an explicit additional employment entry retains its own employer, role and dates', async () => {
  const experience = {
    id: '0b824d12-154f-4437-8b46-379ff5ea11e8', kind: 'experience', title: 'Data Engineering Intern',
    organization: 'Another Real Employer', dates: 'Jun 2020 - Aug 2020',
    skills: ['Python', 'Pandas'], details: 'Built Python data cleaning scripts using Pandas for 6 weekly source files.',
  };
  const result = await tailorResume({ resumeText, user, profile: profileWith(experience), job });
  const item = itemAt(result, 'Experience', experience.title);
  assert.ok(item);
  assert.equal(item.subheading, experience.organization);
  assert.match(item.dates, /Jun 2020.*Aug 2020/);
  assert.match(item.bullets.join(' '), /Python.*Pandas/);
  assert.doesNotMatch(itemAt(result, 'Experience', 'Data Engineer').bullets.join(' '), /Python|Pandas|6 weekly/);
});

test('confirmation without contextual details cannot invent use at an existing employer or a project', async () => {
  const draft = sourceDraft();
  draft.skills.push('Python', 'Airflow', 'Pandas');
  draft.sections.find((section) => section.title === 'Experience').items[0].bullets.unshift('Built Python pipelines in Airflow using Pandas at Existing Employer.');
  const result = await tailorResume({ resumeText, user, profile: {}, job, confirmedSkills: ['python', 'airflow', 'pandas'], aiClient: fakeAI(draft), model: 'fixture' });
  for (const keyword of ['python', 'airflow', 'pandas']) assert.ok(result.after.matched.includes(keyword));
  assert.doesNotMatch(JSON.stringify(result.resume.sections), /Python|Airflow|Pandas/);
  assert.equal(result.resume.sections.some((section) => section.title === 'Projects'), false);
});

test('captured project tools and results cannot be reassigned to another role or project', async () => {
  const draft = withProject();
  const employer = draft.sections.find((section) => section.title === 'Experience').items[0];
  employer.bullets = ['Built Python ETL pipelines in Airflow using Pandas to process 12 CSV sources and reduce preparation by 30%.'];
  const item = draft.sections.find((section) => section.title === 'Projects').items[0];
  item.bullets = ['Maintained SQL reporting jobs for 2 teams and reduced monthly review work by 10 hours.'];
  const result = await tailorResume({ resumeText, user, profile: profileWith(project), job, aiClient: fakeAI(draft), model: 'fixture' });
  const existing = itemAt(result, 'Experience', 'Data Engineer').bullets.join(' ');
  const captured = itemAt(result, 'Projects', project.title).bullets.join(' ');
  assert.match(existing, /2 teams.*10 hours/);
  assert.doesNotMatch(existing, /Python|Airflow|Pandas|12 CSV sources|30%/);
  assert.match(captured, /12 CSV sources/);
  assert.match(captured, /30%/);
  assert.doesNotMatch(captured, /2 teams|10 hours/);
});

test('safe ETL job/workflow paraphrases from captured project details remain eligible', async () => {
  const revised = project.details.replace('Created Python ETL jobs', 'Implemented Python ETL workflows');
  const result = await tailorResume({ resumeText, user, profile: profileWith(project), job, aiClient: fakeAI(withProject(revised)), model: 'fixture' });
  assert.match(itemAt(result, 'Projects', project.title).bullets.join(' '), /Implemented Python ETL workflows/);
  assert.deepEqual(result.after, (await import('../src/resumeAnalysis.js')).atsReport(resumeToText(result.resume), job));
});

test('previously omitted real experience produces a measured result inside the 85–95 target range', async (t) => {
  const target = { ...job, description: `${job.description} Tableau is preferred.` };
  const result = await tailorResume({ resumeText, user, profile: profileWith(project), job: target, aiClient: fakeAI(withProject()), model: 'fixture' });
  assert.ok(result.before.score < 85);
  assert.ok(result.after.score >= 85 && result.after.score <= 95, `measured score ${result.after.score}`);
  assert.ok(result.evidenceMap.find((row) => row.keyword === 'python').sources.some((source) => source.source === 'experience-bank'));
  t.diagnostic(`Omitted-experience fixture: ${result.before.score}% → ${result.after.score}% from saved project facts.`);
});

test('skills explicitly associated with a captured example can be woven into its work bullet', async () => {
  const entry = { ...project, details: 'Created ETL jobs for sales records.' };
  const revised = 'Implemented Python ETL workflows using Pandas for sales records.';
  const result = await tailorResume({ resumeText, user, profile: profileWith(entry), job, aiClient: fakeAI(withProject(revised)), model: 'fixture' });
  const item = itemAt(result, 'Projects', entry.title);
  assert.match(item.bullets.join(' '), /Implemented Python ETL workflows using Pandas/);
  assert.doesNotMatch(itemAt(result, 'Experience', 'Data Engineer').bullets.join(' '), /Python|Pandas/);
});

test('additional details attach to the matching existing role without duplicating or renaming it', async () => {
  const entry = { ...project, kind: 'experience', title: 'Data Engineer', organization: 'Existing Employer', dates: '', details: 'Created Python ETL jobs using Pandas to clean 6 source files.' };
  const result = await tailorResume({ resumeText, user, profile: profileWith(entry), job });
  const roles = result.resume.sections.find((section) => section.title === 'Experience').items;
  assert.equal(roles.length, 1);
  assert.equal(roles[0].subheading, 'Existing Employer');
  assert.match(roles[0].dates, /Jan 2021.*Present/);
  assert.match(roles[0].bullets.join(' '), /6 source files/);
  assert.match(roles[0].bullets.join(' '), /2 teams.*10 hours/);
});

test('student coursework is labeled separately and unrelated examples are left out of this job version', async () => {
  const course = { ...project, kind: 'coursework', title: 'Data Integration Lab', organization: 'Fixture University', dates: '', details: 'Built Python ETL jobs using Pandas for a database assignment.' };
  const unrelated = { ...project, id: 'e07f2bb1-27ee-4c5e-a8ba-a3b533689d55', title: 'Brand Guide', skills: ['figma'], details: 'Designed a Figma brand guide.' };
  const result = await tailorResume({ resumeText, user, profile: profileWith(course, unrelated), job });
  assert.ok(itemAt(result, 'Coursework', course.title));
  assert.ok(!itemAt(result, 'Experience', course.title));
  assert.doesNotMatch(resumeToText(result.resume), /Brand Guide|Figma/i);
});
