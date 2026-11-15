import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIENCE_LIMITS, experienceDraft, experienceEntry, experienceSkills, upsertExperience } from '../../client/src/resumeExperience.js';

const firstId = 'de46dc6d-0762-4d40-a1b1-10bd14482274';
const secondId = '5e07198c-074c-4b8f-a7d8-f2a541bffb7e';
const draft = (overrides = {}) => ({ ...experienceDraft(), title: 'Course scheduling project', details: 'Built the scheduling form and fixed reported accessibility issues.\nThe form became easier to use with a keyboard.', ...overrides });

test('rough factual notes become a payload without inventing dates, employers, or measurements', () => {
  const input = draft({ title: '  Course scheduling project  ', skillsText: 'React, accessibility', details: '  Built the scheduling form.\nFixed reported keyboard navigation issues.  ' });
  const entry = experienceEntry(input, firstId);
  assert.deepEqual(entry, {
    id: firstId, kind: 'project', title: 'Course scheduling project', organization: '', dates: '',
    skills: ['React', 'accessibility'], details: 'Built the scheduling form.\nFixed reported keyboard navigation issues.',
  });
  assert.equal(input.title, '  Course scheduling project  ', 'preparation must not mutate the draft');
});

test('individual skills are trimmed and deduplicated without adding missing job keywords', () => {
  assert.deepEqual(experienceSkills(' React, C#, react, SQL, , sql, '), ['React', 'C#', 'SQL']);
  assert.deepEqual(experienceSkills(''), []);
  assert.deepEqual(experienceEntry(draft({ skillsText: '' }), firstId).skills, []);
});

test('editing round trips the existing identity and keeps facts attached to their original role', () => {
  const original = { id: firstId, kind: 'experience', title: 'Engineering intern', organization: 'Campus lab', dates: '', skills: ['Python', 'SQL'], details: 'Built a data import script and corrected malformed input handling.' };
  const edit = experienceDraft(original);
  edit.details += '\nDocumented the workflow for the next lab assistant.';
  const updated = experienceEntry(edit, secondId);
  assert.equal(updated.id, firstId);
  assert.equal(updated.kind, 'experience');
  assert.equal(updated.title, original.title);
  assert.equal(updated.organization, original.organization);
  assert.equal(updated.dates, '');
  assert.deepEqual(updated.skills, original.skills);
  assert.equal(original.details.includes('Documented'), false);
});

test('a meaningful title and factual details are required while optional context stays optional', () => {
  assert.throws(() => experienceEntry(draft({ title: '  ' }), firstId), /Add a title/);
  assert.throws(() => experienceEntry(draft({ details: '\n  ' }), firstId), /Describe what you actually did/);
  assert.throws(() => experienceEntry(draft({ kind: 'invented' }), firstId), /Choose a project/);
  for (const kind of ['project', 'experience', 'coursework']) {
    assert.equal(experienceEntry(draft({ kind }), firstId).kind, kind);
  }
});

test('field and skill limits match the server contract and reject excess instead of truncating facts', () => {
  for (const field of ['title', 'organization', 'dates', 'details']) {
    assert.equal(experienceEntry(draft({ [field]: 'x'.repeat(EXPERIENCE_LIMITS[field]) }), firstId)[field].length, EXPERIENCE_LIMITS[field]);
    assert.throws(() => experienceEntry(draft({ [field]: 'x'.repeat(EXPERIENCE_LIMITS[field] + 1) }), firstId), /characters or fewer/);
  }
  const maximumSkills = Array.from({ length: EXPERIENCE_LIMITS.skills }, (_, index) => `skill ${index}`);
  assert.equal(experienceEntry(draft({ skillsText: maximumSkills.join(', ') }), firstId).skills.length, EXPERIENCE_LIMITS.skills);
  assert.throws(() => experienceEntry(draft({ skillsText: [...maximumSkills, 'another skill'].join(', ') }), firstId), /no more than 25 skills/);
  assert.throws(() => experienceEntry(draft({ skillsText: 'x'.repeat(EXPERIENCE_LIMITS.skillLength + 1) }), firstId), /Each skill/);
});

test('saving an edit preserves other examples and cannot duplicate or mutate the bank', () => {
  const original = experienceEntry(draft(), firstId);
  const other = experienceEntry(draft({ kind: 'coursework', title: 'Database assignment' }), secondId);
  const entries = Object.freeze([original, other]);
  const revised = { ...original, details: `${original.details}\nAlso wrote setup instructions.` };
  const next = upsertExperience(entries, revised);
  assert.deepEqual(next, [revised, other]);
  assert.equal(entries[0], original);
  assert.notEqual(next, entries);
});

test('a full bank can be edited while adding beyond the limit is refused', () => {
  const entries = Array.from({ length: EXPERIENCE_LIMITS.entries }, (_, index) => ({ id: String(index), title: `Example ${index}` }));
  const updated = upsertExperience(entries, { ...entries[0], title: 'Updated example' });
  assert.equal(updated.length, EXPERIENCE_LIMITS.entries);
  assert.equal(updated[0].title, 'Updated example');
  assert.throws(() => upsertExperience(entries, { id: firstId }), /up to 20 examples/);
});
