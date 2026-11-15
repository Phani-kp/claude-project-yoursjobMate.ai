import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWritingSkills, includeSummarySkills } from '../src/resumeWriting.js';

test('supported skills enter relevant categories instead of appending cloud tools to Languages', () => {
  const resume = { skills: ['Python'], skillGroups: [{ name: 'Languages', items: ['Python'] }] };
  addWritingSkills(resume, ['AWS', 'Airflow', 'React', 'Git', 'Python']);
  assert.deepEqual(resume.skillGroups.find((group) => group.name === 'Languages').items, ['Python']);
  assert.ok(resume.skillGroups.find((group) => group.name === 'Cloud and infrastructure').items.includes('AWS'));
  assert.ok(resume.skillGroups.find((group) => group.name === 'Data and databases').items.includes('Airflow'));
  assert.equal(resume.skills.filter((skill) => skill === 'Python').length, 1);
});

test('flat skill lists are grouped without generating qualifications or job keywords', () => {
  const resume = { skills: ['SQL', 'Python', 'Pandas', 'Custom Research Tool'], skillGroups: [] };
  addWritingSkills(resume, ['Communication']);
  assert.deepEqual([...resume.skills].sort(), ['SQL', 'Python', 'Pandas', 'Custom Research Tool', 'Communication'].sort());
  assert.ok(resume.skillGroups.length > 1);
  assert.ok(!resume.skills.includes('AWS'));
});

test('canonical aliases cannot duplicate a capability already supplied by the user', () => {
  const resume = { skills: ['PostgreSQL'], skillGroups: [] };
  addWritingSkills(resume, ['postgres', 'SQL']);
  assert.equal(resume.skills.filter((skill) => /postgres/i.test(skill)).length, 1);
  assert.ok(resume.skills.includes('SQL'));
});

test('trusted profile skills can strengthen the summary without fabricating a role or result', () => {
  const resume = { summary: 'Data engineer building SQL reports.' };
  includeSummarySkills(resume, ['sql', 'python', 'airflow'], (skill) => ({ sql: 'SQL', python: 'Python', airflow: 'Airflow' })[skill]);
  assert.match(resume.summary, /Skills include Python, Airflow/);
  assert.equal((resume.summary.match(/SQL/g) || []).length, 1);
  assert.doesNotMatch(resume.summary, /employer|years|%|deployed|led/i);
});

test('an already complete professional summary remains intact', () => {
  const summary = 'Data engineer using Python, SQL, and Airflow for data workflows.';
  const resume = { summary };
  includeSummarySkills(resume, ['python', 'sql', 'airflow']);
  assert.equal(resume.summary, summary);
});
