import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atsReport, directHas, jobKeywords, proficiencyText, requirementsText, textHas } from '../src/resumeAnalysis.js';

const job = (description, extra = {}) => ({ title: '', description, ...extra });
const groupFor = (result, term) => result.requirements.find((group) => group.terms.includes(term));

test('explicit OR skills are one alternative requirement, while SQL and Python remain independent', () => {
  const result = jobKeywords(job('Required: SQL and Python or C#.'));
  assert.equal(result.requirements.length, 2);
  assert.deepEqual(groupFor(result, 'sql').terms, ['sql']);
  assert.deepEqual(groupFor(result, 'python').terms, ['python', 'c#']);
  assert.equal(groupFor(result, 'python').priority, 'required');
  const independent = jobKeywords(job('Required: SQL and Python.'));
  assert.equal(independent.requirements.length, 2);
  assert.ok(independent.requirements.every((group) => group.terms.length === 1));
});

test('a matched alternative is not a missing skill and contributes one scoring group', () => {
  const description = job('Required: SQL and Python or C#.');
  const report = atsReport('Skills\nSQL, C#', description);
  assert.deepEqual(report.matched, ['sql', 'c#']);
  assert.deepEqual(report.missingHard, []);
  assert.equal(report.breakdown.hardSkills.total, 2);
  assert.equal(report.breakdown.hardSkills.matched, 2);
  assert.deepEqual(groupFor(report, 'python').matchedTerms, ['c#']);
  assert.equal(groupFor(report, 'python').status, 'matched');
  assert.equal(report.score, atsReport('Skills\nSQL, Python', description).score);
});

test('an unmatched alternative group reports its choices without counting them as separate requirements', () => {
  const report = atsReport('Skills\nSQL', job('Required: SQL and Python or C#.'));
  assert.deepEqual(report.missingHard, ['python', 'c#']);
  assert.equal(report.breakdown.hardSkills.total, 2);
  assert.equal(report.breakdown.hardSkills.matched, 1);
  assert.equal(groupFor(report, 'python').status, 'missing');
});

test('Oxford OR lists group alternatives without absorbing an independent AND skill', () => {
  const result = jobKeywords(job('Requirements\nPython, Java, or C# and SQL.'));
  assert.deepEqual(groupFor(result, 'python').terms, ['python', 'java', 'c#']);
  assert.deepEqual(groupFor(result, 'sql').terms, ['sql']);
});

test('HTML headings distinguish required, preferred and responsibility skills', () => {
  const result = jobKeywords(job('<h2>About us</h2><p>We build Python products in AWS.</p><h2>Required qualifications</h2><ul><li>SQL and communication skills.</li></ul><h2>Preferred qualifications</h2><p>Docker or Kubernetes.</p><h2>Responsibilities</h2><p>Develop React applications.</p><h2>Benefits</h2><p>Python training and Excel discounts.</p>'));
  assert.equal(groupFor(result, 'sql').priority, 'required');
  assert.equal(groupFor(result, 'communication').kind, 'soft');
  assert.equal(groupFor(result, 'docker').priority, 'preferred');
  assert.equal(groupFor(result, 'react').priority, 'unspecified');
  assert.equal(result.hard.includes('aws'), false);
  assert.equal(result.hard.includes('python'), false);
  assert.equal(result.hard.includes('excel'), false);
});

test('simple inline required/preferred labels and suffixes retain their priorities', () => {
  const result = jobKeywords(job('Required: Python. Preferred: AWS. Docker required, Kubernetes preferred.'));
  assert.equal(groupFor(result, 'python').priority, 'required');
  assert.equal(groupFor(result, 'aws').priority, 'preferred');
  assert.equal(groupFor(result, 'docker').priority, 'required');
  assert.equal(groupFor(result, 'kubernetes').priority, 'preferred');
});

test('company, benefits and hiring boilerplate do not become screening requirements', () => {
  const result = jobKeywords(job('About the company\nPython and machine learning drive our platform.\nRequired skills\nSQL\nBenefits\nAWS training, Excel workshops.\nEqual employment opportunity: recruiting, compliance and leadership.'));
  assert.deepEqual(result.hard, ['sql']);
  assert.deepEqual(result.soft, []);
  assert.equal(requirementsText('Required skills\nSQL\nBenefits\nAWS training').includes('AWS'), false);
});

test('title and skill tags preserve flattened compatibility without overriding an OR requirement', () => {
  const result = jobKeywords(job('Required: Python or C#.', { title: 'Python Engineer', tags: ['Python', 'SQL', 'Engineering'] }));
  assert.deepEqual(groupFor(result, 'python').terms, ['python', 'c#']);
  assert.equal(result.requirements.filter((group) => group.terms.includes('python')).length, 1);
  assert.equal(groupFor(result, 'sql').priority, 'unspecified');
  assert.deepEqual(result.hard, ['python', 'c#', 'sql']);
});

test('learning-only sections cannot satisfy proficiency requirements and remain visible separately', () => {
  const text = 'Summary\nData engineer\nSkills\nSQL\nProfessional Development (Learning Only)\nAWS, Kubernetes\nExperience\nBuilt Python services.';
  const report = atsReport(text, job('Required: SQL, Python and Kubernetes. Preferred: AWS.'));
  assert.deepEqual(report.matched, ['sql', 'python']);
  assert.ok(report.learningTerms.includes('kubernetes'));
  assert.ok(report.learningTerms.includes('aws'));
  assert.ok(report.missingHard.includes('kubernetes'));
  assert.ok(report.missingHard.includes('aws'));
  assert.equal(proficiencyText(text).includes('AWS'), false);
  assert.equal(proficiencyText(text).includes('Python'), true);
});

test('inline learning headings are excluded until the next actual resume section', () => {
  const text = 'Skills: SQL\nCurrently learning: Docker\nKubernetes\nProjects\nBuilt Python services';
  assert.equal(textHas(proficiencyText(text), 'docker'), false);
  assert.equal(textHas(proficiencyText(text), 'kubernetes'), false);
  assert.equal(textHas(proficiencyText(text), 'python'), true);
});

test('conservative equivalents support demonstrated ETL and visualization descriptions', () => {
  assert.equal(textHas('Extracted source data, transformed its schema, and loaded it into a warehouse.', 'etl'), true);
  assert.equal(textHas('Created dashboards with charts and KPIs for the operations team.', 'data visualization'), true);
  assert.equal(textHas('Used the dashboard to check my schedule.', 'data visualization'), false);
  assert.equal(textHas('We transformed the team and loaded the truck.', 'etl'), false);
});

test('specific skills imply only conservative broader skills', () => {
  assert.equal(textHas('Skills: T-SQL', 'sql'), true);
  assert.equal(textHas('Skills: T-SQL', 'stored procedures'), false);
  assert.equal(textHas('Performed regression testing.', 'integration testing'), false);
  assert.equal(textHas('Performed regression testing.', 'regression testing'), true);
  assert.equal(textHas('Used PySpark.', 'python'), true);
});

test('special language spellings and ambiguous words do not create false skills', () => {
  assert.equal(directHas('Skills: C#, C++, .NET, NodeJS', 'c#'), true);
  assert.equal(directHas('Skills: C#, C++, .NET, NodeJS', 'c++'), true);
  assert.equal(directHas('Skills: C#, C++, .NET, NodeJS', 'node.js'), true);
  assert.equal(directHas('Ready to go after an epic workday.', 'go'), false);
  assert.equal(directHas('Ready to go after an epic workday.', 'epic'), false);
  assert.equal(directHas('Skills: Python, Go, Rust', 'go'), true);
});

test('cache identity includes same-length edits, tags and title contents', () => {
  const initial = { id: 123, title: '', tags: '', description: 'Required: Python' };
  assert.deepEqual(jobKeywords(initial).hard, ['python']);
  assert.deepEqual(jobKeywords({ ...initial, description: 'Required: Docker' }).hard, ['docker']);
  assert.ok(jobKeywords({ ...initial, tags: 'SQL' }).hard.includes('sql'));
  assert.ok(jobKeywords({ ...initial, title: 'React Developer' }).hard.includes('react'));
});

test('format checks, words and the existing score weights remain available', () => {
  const text = 'Sam\nsam@example.com\n555-555-0123\nSummary\nEngineer\nSkills\nSQL, communication\nExperience\nImproved 20% and served 500 users.\nEducation\nDegree';
  const report = atsReport(text, job('Required: SQL and communication.', { title: 'Engineer' }));
  assert.deepEqual(Object.fromEntries(Object.entries(report.breakdown).map(([key, value]) => [key, value.weight])), { hardSkills: 55, title: 15, softSkills: 3, format: 20 }); // one soft skill carries a third of the soft-skill weight
  assert.equal(report.checks.length, 8);
  assert.equal(report.words, text.split(/\s+/).length);
  assert.ok(report.score >= 0 && report.score <= 100);
});

test('AND requirements are not absorbed into a following OR group', () => {
  const result = jobKeywords(job('Required: Python and SQL or Java.'));
  assert.deepEqual(groupFor(result, 'python').terms, ['python']);
  assert.deepEqual(groupFor(result, 'sql').terms, ['sql', 'java']);
  assert.equal(atsReport('Skills: Java', job('Required: Python and SQL or Java.')).missingHard.includes('python'), true);
});

test('negated or planned skill mentions never establish proficiency', () => {
  for (const text of ['No Python experience.', 'Not proficient in Python.', 'I have never used Python.', 'I do not know Python.', 'Python: none', 'Currently learning Python.', 'Studying Python.', 'Planning to learn Python.']) {
    assert.equal(textHas(text, 'python'), false, text);
  }
  assert.equal(textHas('No Python experience, but built SQL reporting queries.', 'python'), false);
  assert.equal(textHas('No Python experience, but built SQL reporting queries.', 'sql'), true);
  assert.equal(textHas('No Python experience.\nExperience\nBuilt Python services.', 'python'), true);
  assert.equal(textHas('Implemented machine learning models.', 'machine learning'), true);
  assert.equal(jobKeywords(job('Python experience is not required. Required: SQL.')).hard.includes('python'), false);
  const learning = atsReport('Summary\nCurrently learning Python.', job('Required: Python.'));
  assert.ok(learning.learningTerms.includes('python'));
  assert.ok(learning.missingHard.includes('python'));
});

test('explicit required status wins a later preferred label for the same skill', () => {
  const result = jobKeywords(job('Required: Python. Preferred: Python and AWS.'));
  assert.equal(result.requirements.filter((group) => group.terms.includes('python')).length, 1);
  assert.equal(groupFor(result, 'python').priority, 'required');
  assert.equal(groupFor(result, 'aws').priority, 'preferred');
});

test('inline benefits labels terminate skill extraction and cached results cannot be mutated', () => {
  const source = job('Required: SQL. Benefits: Python training and AWS workshops.');
  const result = jobKeywords(source);
  assert.deepEqual(result.hard, ['sql']);
  assert.throws(() => result.hard.push('python'), TypeError);
  assert.throws(() => result.requirements[0].terms.push('python'), TypeError);
  assert.throws(() => { result.requirements[0].priority = 'preferred'; }, TypeError);
  assert.deepEqual(jobKeywords(source).hard, ['sql']);
});
