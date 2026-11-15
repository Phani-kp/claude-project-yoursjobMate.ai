import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSkill, createResumeRequestGate, gapQuestions, hasPendingSkillChoices, initialSkillChoices, mergeOriginalReport, priorityLabel, reviewKeywords, savedSkillChoices, selectResumeReport } from '../../client/src/resumeReport.js';

test('latest tailored coverage, checks, and breakdown replace the original assessment without changing its score', () => {
  const original = Object.freeze({ score: 38, matched: ['sql'], missing: ['react'], checks: [{ label: 'Sections', ok: false }], breakdown: { format: { matched: 0 } } });
  const after = { score: 82, matched: ['sql', 'react'], missing: [], checks: [{ label: 'Sections', ok: true }], breakdown: { format: { matched: 1 } } };
  const selected = selectResumeReport(original, { ats_before: 38, ats_after: 82, report: { after } });
  assert.equal(selected, after);
  assert.deepEqual(selected.missing, []);
  assert.equal(selected.checks[0].ok, true);
  assert.equal(selected.breakdown.format.matched, 1);
  assert.equal(original.score, 38);
  assert.deepEqual(original.missing, ['react']);
});

test('original assessment remains usable before tailoring and for older saved versions without after reports', () => {
  const original = { score: 50, matched: ['sql'], missing: ['docker'] };
  for (const tailored of [null, {}, { ats_after: 70 }, { report: { after: null } }, { report: { after: [] } }]) {
    assert.equal(selectResumeReport(original, tailored), original);
  }
});

test('a tailor response refreshes the original score and gaps while preserving resume availability and metadata', () => {
  const original = Object.freeze({ hasResume: true, score: 38, missing: ['react'], missingHard: ['react'], jobTitle: 'Original metadata' });
  const tailored = { report: {
    before: { score: 63, matched: ['react'], missing: ['docker'], missingHard: ['docker'], hasResume: false },
    after: { score: 82, missing: [] },
    evidenceMap: [{ keyword: 'docker', status: 'confirmed' }],
  } };
  const refreshed = mergeOriginalReport(original, tailored);
  assert.equal(refreshed.score, 63, 'the original score must use the inputs actually used during tailoring');
  assert.deepEqual(refreshed.missing, ['docker']);
  assert.equal(refreshed.hasResume, true);
  assert.equal(refreshed.jobTitle, 'Original metadata');
  assert.equal(original.score, 38, 'the earlier response must not be mutated');
  assert.equal(hasPendingSkillChoices(tailored, savedSkillChoices(tailored)), false, 'saved selections do not create ghost pending changes');
  assert.equal(mergeOriginalReport(original, { report: {} }), original);
});

test('individual confirmation controls retain original gaps and persisted choices even after coverage improves', () => {
  const original = { missingHard: ['docker'], missing: ['docker', 'aws'] };
  const tailored = { report: { after: { missing: [] }, evidenceMap: [
    { keyword: 'aws', status: 'confirmed' },
    { keyword: 'python', status: 'learning' },
    { keyword: 'react', status: 'unsupported' },
    { keyword: 'sql', status: 'demonstrated' },
  ] } };
  assert.deepEqual(reviewKeywords(original, tailored), ['docker', 'aws', 'python', 'react']);
  assert.deepEqual(savedSkillChoices(tailored), { confirmed: ['aws'], learning: ['python'] });
  assert.deepEqual(selectResumeReport(original, tailored).missing, [], 'saved missing tags stay independent of confirmation controls');
});

test('optional skill review prefills relevant known skills and saved choices without assuming undocumented skills', () => {
  const original = {
    missing: ['aws', 'docker', 'rust'], knownSkills: ['aws', 'sql'],
    skillChoices: { confirmed: ['docker'], learning: ['rust'] },
  };
  assert.deepEqual(initialSkillChoices(original, null), { confirmed: ['docker', 'aws'], learning: ['rust'] });
  assert.deepEqual(reviewKeywords(original, null), ['aws', 'docker', 'rust']);
  assert.equal(initialSkillChoices({ missing: ['rust'], knownSkills: [] }, null).confirmed.includes('rust'), false);
});

test('explicit choices remain available when the generated document is stale or a newer report clears them', () => {
  const original = { hasResume: true, missing: [], skillChoices: { confirmed: ['aws'], learning: ['python'] } };
  assert.deepEqual(reviewKeywords(original, null), ['aws', 'python']);
  assert.deepEqual(initialSkillChoices(original, null), { confirmed: ['aws'], learning: ['python'] });
  const latest = { report: { before: { missing: ['aws'] }, skillChoices: { confirmed: [], learning: [] }, evidenceMap: [{ keyword: 'aws', status: 'confirmed' }] } };
  assert.deepEqual(savedSkillChoices(latest), { confirmed: [], learning: [] }, 'explicit saved selections take priority over legacy evidence inference');
  const refreshed = mergeOriginalReport(original, latest);
  assert.deepEqual(initialSkillChoices(refreshed, latest), { confirmed: [], learning: [] });
});

test('satisfied alternatives hide unsupported controls while confirmed and learning choices remain editable', () => {
  const original = { missingHard: ['c#', 'docker'], missing: ['c#', 'docker'] };
  const tailored = { report: {
    after: { requirements: [{ terms: ['python', 'c#'], status: 'matched', matchedTerms: ['python'] }] },
    evidenceMap: [{ keyword: 'c#', status: 'unsupported' }, { keyword: 'docker', status: 'unsupported' }],
  } };
  assert.deepEqual(reviewKeywords(original, tailored), ['docker']);
  for (const status of ['confirmed', 'learning']) {
    const persisted = { report: { ...tailored.report, evidenceMap: [{ keyword: 'c#', status }, { keyword: 'docker', status: 'unsupported' }] } };
    assert.deepEqual(reviewKeywords(original, persisted), ['c#', 'docker'], `${status} must remain individually editable`);
  }
  const unmet = { report: { ...tailored.report, after: { requirements: [{ terms: ['python', 'c#'], status: 'missing', matchedTerms: [] }] } } };
  assert.deepEqual(reviewKeywords(original, unmet), ['c#', 'docker'], 'an unmet alternative group still needs review');
});

test('a skill can be confirmed, learning, or unselected through individual mutually exclusive choices', () => {
  const original = { confirmed: [], learning: ['react'] };
  const confirmed = chooseSkill(original, 'react', 'confirmed');
  assert.deepEqual(confirmed, { confirmed: ['react'], learning: [] });
  assert.deepEqual(original, { confirmed: [], learning: ['react'] }, 'the previous state must remain unchanged');
  const learning = chooseSkill(confirmed, 'react', 'learning');
  assert.deepEqual(learning, { confirmed: [], learning: ['react'] });
  assert.deepEqual(chooseSkill(learning, 'REACT', 'learning'), { confirmed: [], learning: [] });
});

test('pending selections compare against persisted confirmations and never alter an existing assessment', () => {
  const tailored = { report: { after: { score: 70, missing: [] }, evidenceMap: [{ keyword: 'react', status: 'confirmed' }] } };
  assert.equal(hasPendingSkillChoices(tailored, { confirmed: ['REACT'], learning: [] }), false);
  assert.equal(hasPendingSkillChoices(tailored, { confirmed: [], learning: ['react'] }), true);
  assert.equal(hasPendingSkillChoices(tailored, { confirmed: [], learning: [] }), true);
  assert.equal(hasPendingSkillChoices(null, { confirmed: [], learning: [] }), false);
  assert.equal(hasPendingSkillChoices(null, { confirmed: ['react'], learning: [] }), true);
  assert.deepEqual(tailored.report.after, { score: 70, missing: [] });
});

test('gap questions combine explicit gaps and unsupported evidence without repeating a question', () => {
  const tailored = { report: {
    gap: { questions: ['Which project used React?', { question: 'What production system used Docker?' }] },
    evidenceMap: [
      { status: 'unsupported', question: 'Which project used React?' },
      { status: 'unsupported', question: 'Which team did you lead?' },
      { status: 'confirmed', question: 'An already confirmed question' },
    ],
  } };
  assert.deepEqual(gapQuestions(tailored), ['Which project used React?', 'What production system used Docker?', 'Which team did you lead?']);
  assert.deepEqual(gapQuestions(null), []);
});

test('an unsupported alternative is not a remaining gap when the latest requirement is already satisfied', () => {
  const tailored = { report: {
    after: { matched: ['react'], missing: ['docker'] },
    evidenceMap: [
      { keyword: 'vue', status: 'unsupported', question: 'Which Vue project did you build?' },
      { keyword: 'docker', status: 'unsupported', question: 'Which production system used Docker?' },
    ],
  } };
  assert.deepEqual(gapQuestions(tailored), ['Which production system used Docker?']);
});

test('requirement priority is explicit and unknown priority is not presented as mandatory', () => {
  assert.equal(priorityLabel('required'), 'Required');
  assert.equal(priorityLabel('preferred'), 'Preferred');
  assert.equal(priorityLabel('unspecified'), 'Priority unspecified');
  assert.equal(priorityLabel(undefined), 'Priority unspecified');
});

test('a request gate ignores old responses across job switches, return navigation, and overlapping tailor requests', async () => {
  const gate = createResumeRequestGate();
  const firstJob = gate.begin(1);
  const nextJob = gate.begin(2);
  assert.equal(gate.accepts(firstJob), false);
  assert.equal(gate.accepts(nextJob), true);
  gate.invalidate();
  assert.equal(gate.accepts(nextJob), false);
  const returnedJob = gate.begin(1);
  assert.equal(gate.accepts(firstJob), false, 'returning to the same job must not revive an old request');
  const latestTailor = gate.begin(1);
  const shown = [];
  const apply = async (request, value) => { await Promise.resolve(); if (gate.accepts(request)) shown.push(value); };
  await Promise.all([apply(latestTailor, 'current result'), apply(returnedJob, 'stale result'), apply(firstJob, 'old job result')]);
  assert.deepEqual(shown, ['current result']);
});
