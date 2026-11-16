import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
process.env.NODE_ENV = 'test';
const { tailorResume, parseResume, standardise, resumeToText, resumeToDocx, extractResumeText, atsReport } = await import('../src/resume.js');
const { buildEvidenceMap, quoteSupportsSkill } = await import('../src/resumeEvidence.js');
const { db } = await import('../src/db.js');
after(() => db.close());

const user = { name: 'Taylor Reed', email: 'taylor@example.test' };
const resumeText = `Taylor Reed
taylor@example.test | +1 415 555 0100
Frontend Engineer
SUMMARY
Frontend engineer building web interfaces with React and TypeScript.
SKILLS
JavaScript, React, TypeScript
EXPERIENCE
Frontend Engineer | Acme | Jan 2021 - Present
• Built React interfaces with TypeScript for 3 teams and cut load time by 30%
• Wrote JavaScript tests and reduced release review work by 12 hours
EDUCATION
BSc Computer Science | State University | 2016 - 2020`;
const job = { title: 'Frontend Engineer', company: 'Fixture Co', description: 'Required skills: React, TypeScript, JavaScript.' };
function fakeAI(revisions) {
  const calls = [];
  return {
    calls,
    beta: { messages: { parse: async (body, options) => {
      calls.push({ body, options });
      const revision = revisions[Math.min(calls.length - 1, revisions.length - 1)];
      if (revision instanceof Error) throw revision;
      return { stop_reason: 'end_turn', parsed_output: structuredClone(revision) };
    } } },
  };
}
const draft = (text = resumeText) => ({ resume: standardise(parseResume(text, {}, user)), changes: ['Rewrote supported content'], inferredSkills: [] });

test('a supported candidate reaches the target; a synonym-only rewrite does not replace their wording, and source identities are unchanged', async () => {
  const revision = draft();
  revision.resume.sections[0].items[0].bullets[0] = 'Delivered React interfaces with TypeScript for 3 teams and cut load time by 30%';
  const ai = fakeAI([revision]);
  const result = await tailorResume({ resumeText, user, profile: {}, job, aiClient: ai, model: 'fixture' });
  assert.ok(result.after.score >= 85);
  assert.equal(result.ai, true);
  // "Delivered" for "Built" adds no job keyword, so the candidate's own bullet stays.
  assert.match(result.resume.sections[0].items[0].bullets[0], /^Built React interfaces/);
  assert.equal(result.resume.sections[0].items[0].subheading, 'Acme');
  assert.equal(result.resume.sections[0].items[0].dates, 'Jan 2021 – Present');
  assert.equal(result.refinement.attempts, 1);
  assert.equal(result.gap, null);
});

test('genuine gaps remain below target and learning does not turn them into proficiency', async () => {
  const demanding = { ...job, description: 'Required: React, TypeScript, Python, Kubernetes, AWS, PyTorch, pandas, NumPy, C#.' };
  const result = await tailorResume({ resumeText, user, profile: {}, job: demanding, learningSkills: ['python', 'aws'] });
  assert.ok(result.after.score < 85);
  assert.ok(result.after.missing.includes('aws'));
  assert.ok(!result.after.matched.includes('python'));
  assert.ok(result.after.learningTerms.includes('python'));
  assert.equal(result.evidenceMap.find((row) => row.keyword === 'aws').status, 'learning');
  assert.ok(result.gap.questions.length > 0);
  assert.ok(!result.resume.skills.includes('AWS'));
});

test('a verbatim unrelated quotation cannot establish a tool and conservative equivalent wording can', () => {
  const quote = 'Built React interfaces with TypeScript for 3 teams';
  assert.equal(quoteSupportsSkill('kubernetes', quote, resumeText), false);
  const etl = 'Extracted, transformed and loaded sales data from 12 sources';
  assert.equal(quoteSupportsSkill('etl', etl, `${resumeText}\n${etl}`), true);
  const rows = buildEvidenceMap({ resumeText: `${resumeText}\nSkills: Python`, job: { ...job, description: 'Python, pandas, NumPy and PyTorch required.' } });
  assert.equal(rows.find((row) => row.keyword === 'python').status, 'demonstrated');
  for (const keyword of ['pandas', 'numpy', 'pytorch']) assert.equal(rows.find((row) => row.keyword === keyword).status, 'unsupported');
});

test('confirmed skills belong in Skills without fabricated employer use, identities, or metrics', async () => {
  const revision = draft();
  revision.resume.name = 'Invented Person';
  revision.resume.contact = ['invented@example.test'];
  revision.resume.summary = 'Frontend engineer cut latency by 99% and is Kubernetes certified.';
  revision.resume.skills.push('AWS', 'InventedPlatform');
  revision.resume.sections[0].items[0].bullets = ['Built React interfaces with AWS for 30 teams and cut load time by 99%'];
  revision.resume.sections.push({ title: 'Experience', items: [{ heading: 'Director', subheading: 'Invented Employer', dates: '2010 – 2020', bullets: ['Led 90 teams'] }] });
  revision.inferredSkills = [{ keyword: 'kubernetes', quote: 'Built React interfaces with TypeScript for 3 teams' }];
  const ai = fakeAI([revision]);
  const result = await tailorResume({ resumeText, user, profile: {}, job: { ...job, description: 'React, TypeScript, AWS and Kubernetes required.' }, confirmedSkills: ['aws'], aiClient: ai, model: 'fixture' });
  assert.ok(result.resume.skills.includes('AWS'));
  assert.equal(result.evidenceMap.find((row) => row.keyword === 'aws').status, 'confirmed');
  assert.equal(result.resume.name, user.name);
  assert.ok(!/Invented|99%|30 teams|90 teams|AWS|Kubernetes/i.test(JSON.stringify(result.resume.sections)));
  assert.ok(!/99%|certified/i.test(result.resume.summary));
  assert.ok(!result.resume.skills.includes('InventedPlatform'));
  assert.deepEqual(result.inferred, []);
});

test("a revision that guts the summary cannot worsen the result: the candidate's own summary is kept and no second request is needed", async () => {
  const longSummary = 'Frontend engineer creates maintainable web interfaces with React and TypeScript for product teams. '.repeat(24);
  const text = resumeText.replace('Frontend engineer building web interfaces with React and TypeScript.', longSummary);
  const demanding = { ...job, description: 'Required: React, TypeScript, AWS, Python, Kubernetes and PyTorch.' };
  const first = draft(text);
  first.resume.summary = 'Frontend engineer.';
  const second = structuredClone(first);
  second.resume.summary = '';
  const ai = fakeAI([first, second]);
  const baseline = await tailorResume({ resumeText: text, user, profile: {}, job: demanding });
  const result = await tailorResume({ resumeText: text, user, profile: {}, job: demanding, aiClient: ai, model: 'fixture' });
  assert.equal(ai.calls.length, 1);
  assert.equal(result.refinement.attempts, 1);
  assert.ok(result.after.score >= baseline.after.score);
  assert.equal(result.resume.summary.split('Frontend engineer creates maintainable web interfaces').length - 1, 24, 'every sentence of the own summary is kept');
  assert.match(ai.calls[0].body.messages[0].content, /INITIAL REVISION/);
  for (const { body, options } of ai.calls) {
    assert.equal(body.max_tokens, 8000);
    assert.equal(options.maxRetries, 0);
    assert.equal(options.timeout, 45_000);
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('a provider failure uses one request, retains a valid fallback, and does not log echoed secrets or resume data', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const ai = fakeAI([Object.assign(new Error('fixture-secret-key and PRIVATE RESUME BODY'), { status: 401 })]);
  const result = await tailorResume({ resumeText, user, profile: {}, job, aiClient: ai, model: 'fixture' });
  assert.equal(ai.calls.length, 1);
  assert.equal(result.ai, false);
  assert.ok(result.after.score >= 85);
  assert.doesNotMatch(`${logs.join(' ')} ${result.aiNote}`, /fixture-secret-key|PRIVATE RESUME BODY/);
});

test('scores are recomputed from the final text and the downloaded Word document', async () => {
  const result = await tailorResume({ resumeText, user, profile: {}, job });
  assert.deepEqual(result.after, atsReport(resumeToText(result.resume), job));
  const downloaded = await extractResumeText(await resumeToDocx(result.resume), 'fixture.docx');
  const actual = atsReport(downloaded, job);
  assert.equal(actual.score, result.after.score);
  assert.deepEqual(actual.breakdown, result.after.breakdown);
});

test('profile learning stays learning and a known tool cannot smuggle a new certification into Skills', async () => {
  const awsJob = { ...job, description: 'React, TypeScript and AWS required.' };
  const learning = await tailorResume({ resumeText, user, profile: { skills: 'Currently learning: AWS' }, job: awsJob });
  assert.ok(!learning.after.matched.includes('aws'));
  assert.ok(learning.after.learningTerms.includes('aws'));
  assert.equal(learning.evidenceMap.find((row) => row.keyword === 'aws').status, 'learning');
  const revision = draft();
  revision.resume.skills.push('AWS Certified Solutions Architect');
  const result = await tailorResume({ resumeText, user, profile: { skills: 'AWS' }, job: awsJob, aiClient: fakeAI([revision]), model: 'fixture' });
  assert.ok(result.resume.skills.includes('AWS'));
  assert.doesNotMatch(resumeToText(result.resume), /Certified Solutions Architect/);
});

test('a rewrite cannot change maintenance into design or move a metric to another outcome', async () => {
  const text = resumeText.replace('\nEDUCATION', '\n• Maintained Java APIs\n• Reduced Java API latency by 30% across 3 teams\nEDUCATION');
  const revision = draft(text);
  const item = revision.resume.sections.find((section) => section.title === 'Experience').items[0];
  item.bullets = ['Designed Java APIs', 'Reduced Java API costs by 30% across 3 teams'];
  const result = await tailorResume({ resumeText: text, user, profile: {}, job, aiClient: fakeAI([revision]), model: 'fixture' });
  const final = resumeToText(result.resume);
  assert.match(final, /Maintained Java APIs/);
  assert.match(final, /latency by 30%/);
  assert.doesNotMatch(final, /Designed Java APIs|costs by 30%/);
});

test('an original long summary remains a candidate and a genuinely high score is not capped at 95', async () => {
  const summary = `Frontend engineer with 4 years of experience ${'building useful React interfaces with TypeScript for product teams '.repeat(35)}.`;
  const text = resumeText.replace('Frontend engineer building web interfaces with React and TypeScript.', summary);
  const result = await tailorResume({ resumeText: text, user, profile: {}, job });
  assert.ok(result.after.score >= result.before.score);
  assert.ok(result.after.score > 95);
  assert.match(result.resume.summary, /4 years/);
});

test('an already satisfied alternative does not generate a question about its unused option', async () => {
  const result = await tailorResume({ resumeText, user, profile: {}, job: { ...job, description: 'Required: React or Vue. Python and AWS required.' } });
  const unused = result.evidenceMap.find((row) => row.keyword === 'vue');
  assert.equal(unused.status, 'unsupported');
  assert.equal(unused.question, null);
  assert.ok(result.gap.questions.every((question) => !/Vue/i.test(question)));
});

test('target headlines cannot invent a different engineering domain or a seniority level', async () => {
  const unrelated = await tailorResume({ resumeText, user, profile: {}, job: { ...job, title: 'Data Engineer' } });
  assert.equal(unrelated.resume.headline, 'Frontend Engineer');
  const senior = await tailorResume({ resumeText, user, profile: {}, job: { ...job, title: 'Senior Frontend Engineer' } });
  assert.equal(senior.resume.headline, 'Frontend Engineer');
});

test('summary rewrites retain original metrics and cannot reassign a known number to another achievement', async () => {
  const text = resumeText.replace('Frontend engineer building web interfaces with React and TypeScript.', 'Frontend engineer building web interfaces with React and TypeScript. Cut review time by 20%.');
  const revision = draft(text);
  revision.resume.summary = 'Frontend engineer. Reduced infrastructure costs by 30%.';
  const result = await tailorResume({ resumeText: text, user, profile: {}, job, aiClient: fakeAI([revision]), model: 'fixture' });
  assert.match(result.resume.summary, /Cut review time by 20%/);
  assert.doesNotMatch(result.resume.summary, /infrastructure costs/);
});

test('source facts remain intact and bullets stay in the order the candidate wrote them', async () => {
  const text = resumeText.replace('• Built React', '• Maintained Java APIs\n• Built React');
  const result = await tailorResume({ resumeText: text, user, profile: {}, job });
  const bullets = result.resume.sections.find((section) => section.title === 'Experience').items[0].bullets;
  assert.equal(bullets[0], 'Maintained Java APIs');
  assert.match(bullets[1], /React/);
});
