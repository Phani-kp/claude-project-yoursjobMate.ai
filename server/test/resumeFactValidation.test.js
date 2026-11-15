import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preserveResumeFacts, summarySentenceSupported, supportedNumbers } from '../src/resumeEvidence.js';
import { textHas } from '../src/resumeAnalysis.js';

function source(bullet) {
  return { name: 'Fixture Person', contact: ['fixture@example.test'], headline: 'Data Engineer', summary: 'Data engineer with SQL skills.', skills: ['SQL'], skillGroups: [], sections: [{ title: 'Experience', items: [{ heading: 'Data Engineer', subheading: 'Existing Employer', dates: '2022 – Present', bullets: [bullet] }] }] };
}
function rewrite(original, next, scopes = []) {
  const before = source(original);
  const draft = structuredClone(before);
  draft.sections[0].items[0].bullets = [next];
  return preserveResumeFacts(draft, before, scopes).resume.sections[0].items[0].bullets[0];
}

test('scheduled SQL jobs can be described as automated data workflows without literal-word matching', () => {
  const original = 'Built scheduled SQL jobs to move records between databases';
  const revised = 'Implemented automated SQL data workflows for moving records between databases';
  assert.equal(rewrite(original, revised), revised);
  const pipeline = 'Implemented automated SQL data pipelines for moving records between databases';
  assert.equal(rewrite(original, pipeline), pipeline);
});

test('only implemented data movement jobs prove equivalent data pipeline wording', () => {
  assert.equal(textHas('Built scheduled SQL jobs to move records between databases', 'data pipelines'), true);
  assert.equal(textHas('Created data workflows for transferring records from databases to warehouses', 'data pipelines'), true);
  for (const text of [
    'Scheduled meetings to review SQL reports between database teams',
    'Read about moving records between databases with SQL jobs',
    'Built SQL reports to review records in databases',
    'Currently learning: built SQL jobs to move records between databases',
    'Never built SQL jobs to move records between databases',
  ]) assert.equal(textHas(text, 'data pipelines'), false, text);
});

test('curated verbs, noun forms and equivalent latency wording preserve the factual frame', () => {
  const original = 'Built SQL applications that reduced load time by 30% across 3 teams';
  const revised = 'Delivered SQL apps that lowered latency by 30% across 3 teams';
  assert.equal(rewrite(original, revised), revised);
});

test('ordinary summary paraphrases retain web-work meaning without literal-word matching', () => {
  const original = 'Frontend engineer building accessible web interfaces with React and JavaScript for internal teams.';
  const revised = 'Frontend engineer developing accessible web applications with React and JavaScript for internal teams.';
  assert.equal(summarySentenceSupported(revised, original, 'Frontend Engineer'), true);
  assert.equal(summarySentenceSupported(revised, `${original}\nCurrently learning Python.\nNo experience with AWS.`, 'Frontend Engineer'), true);
});

test('new ownership, production scope, seniority and credentials remain unsupported', () => {
  for (const [original, invented] of [
    ['Maintained Java APIs', 'Designed Java APIs'],
    ['Built Java APIs', 'Led Java API development'],
    ['Built SQL workflows', 'Built production SQL workflows'],
    ['Maintained Java APIs', 'Maintained Java APIs as principal architect'],
    ['Built SQL applications', 'Built SQL applications as an AWS certified architect'],
    ['Did not maintain SQL APIs', 'Maintained SQL APIs'],
    ['Currently learning to build SQL workflows', 'Built SQL workflows'],
  ]) assert.equal(rewrite(original, invented), original);
});

test('metrics retain their outcome, direction and units instead of matching numbers globally', () => {
  for (const [original, invented] of [
    ['Reduced Java API latency by 30% across 3 teams', 'Reduced Java API costs by 30% across 3 teams'],
    ['Reduced review work by 10 hours', 'Reduced review work across 10 teams'],
    ['Reduced Java API latency by 30%', 'Increased Java API latency by 30%'],
    ['Reduced costs by 30% and latency by 20%', 'Reduced costs by 20% and latency by 30%'],
  ]) assert.equal(rewrite(original, invented), original);
  assert.equal(supportedNumbers('Reduced review time by 10 hours', 'Reduced review work by 10 hours'), true);
  assert.equal(supportedNumbers('Reduced review time by 10 teams', 'Reduced review work by 10 hours'), false);
  assert.equal(supportedNumbers('Raising throughput by 30%', 'Increasing throughput by 30%'), true);
  assert.equal(supportedNumbers('Decreasing throughput by 30%', 'Increasing throughput by 30%'), false);
});

test('trusted confirmed tools support summary capabilities without inventing employer history', () => {
  const original = 'Data Engineer\nMaintained SQL reports at Existing Employer.';
  const skills = `${original}\nPython, AWS`;
  assert.equal(summarySentenceSupported('Data engineer with skills in Python and AWS.', original, 'Data Engineer', skills), true);
  assert.equal(summarySentenceSupported('Skills include Python and AWS.', original, 'Data Engineer', skills), true);
  assert.equal(summarySentenceSupported('Led AWS deployment at Existing Employer.', original, 'Data Engineer', skills), false);
  assert.equal(summarySentenceSupported('Built Python workflows at Existing Employer.', original, 'Data Engineer', skills), false);
  assert.equal(summarySentenceSupported('AWS certified data engineer.', original, 'Data Engineer', skills), false);
  assert.equal(summarySentenceSupported('Skills include AWS at Existing Employer.', original, 'Data Engineer', skills), false);
  assert.equal(summarySentenceSupported('Skills include Kubernetes.', original, 'Data Engineer', skills), false);
});

test('summary actions cannot borrow a tool, credential or employer from a different source statement', () => {
  const original = 'Data Engineer\nLed SQL deployment at Alpha.\nMaintained AWS applications at Beta.\nEarned Java certification.';
  assert.equal(summarySentenceSupported('Led SQL deployment at Alpha.', original, 'Data Engineer'), true);
  assert.equal(summarySentenceSupported('Led AWS deployment at Alpha.', original, 'Data Engineer'), false);
  assert.equal(summarySentenceSupported('Led SQL deployment at Beta.', original, 'Data Engineer'), false);
  assert.equal(summarySentenceSupported('Earned AWS certification.', original, 'Data Engineer'), false);
});

test('summary metrics remain tied to their actual outcome rather than other source numbers', () => {
  const original = 'Data Engineer\nCut review work by 20%.\nReduced Java API latency by 30% across 3 teams.';
  assert.equal(summarySentenceSupported('Reduced Java API latency by 30% across 3 teams.', original, 'Data Engineer'), true);
  assert.equal(summarySentenceSupported('Reduced infrastructure costs by 30%.', original, 'Data Engineer'), false);
  assert.equal(summarySentenceSupported('Reduced Java API latency across 30 teams.', original, 'Data Engineer'), false);
});

test('captured entry tools may enrich only the item explicitly associated with that source', () => {
  const original = 'Created ETL jobs for sales records.';
  const revised = 'Implemented Python ETL workflows using Pandas for sales records.';
  const scope = { section: 'Experience', heading: 'Data Engineer', subheading: 'Existing Employer', dates: '2022 – Present', skills: ['Python', 'Pandas'], notes: [original], toolsLine: 'Tools used: Python, Pandas' };
  assert.equal(rewrite(original, revised, [scope]), revised);
  assert.equal(rewrite(original, revised, [{ ...scope, subheading: 'Another Employer' }]), original);
});
