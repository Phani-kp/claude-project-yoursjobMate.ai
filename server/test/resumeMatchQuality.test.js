import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';

const { atsReport, jobKeywords, textHas } = await import('../src/resumeAnalysis.js');
const { preserveResumeFacts } = await import('../src/resumeEvidence.js');
const { parseResume, standardise, tailorResume, resumeToText } = await import('../src/resume.js');

const RESUME = `Sam Rivera
sam.rivera@example.com | (555) 201-8842 | Austin, TX

Summary
Data engineer with 4 years of experience building data flows and reporting for retail and finance teams.

Skills
Python, SQL, Spark, Airflow, AWS (S3, Redshift, Glue), Snowflake, dbt, Tableau, Git, Docker

Experience
Data Engineer
Northwind Retail, Austin, TX
Mar 2022 - Present
- Built nightly jobs in Python and Spark that move 2 TB of sales data from store systems into Snowflake
- Scheduled and monitored 60+ workflows in Airflow, cutting failed runs by 35%
- Worked with product managers and analysts to define metrics and fix data quality problems
- Packaged jobs in Docker and deployed them through GitHub Actions

Data Analyst
Calder Financial, Dallas, TX
Jun 2020 - Feb 2022
- Wrote SQL queries against Redshift to answer questions from the finance team
- Loaded files from S3 into Redshift using Glue jobs

Education
B.S. Computer Science
University of Texas at Dallas
2016 - 2020`;

const group = (result, term) => result.requirements.find((g) => g.terms.includes(term));
const experience = (resume) => resume.sections.find((s) => s.title === 'Experience').items;

test('a role header after a bullet with no full stop starts a new role instead of joining the bullet', () => {
  const roles = experience(standardise(parseResume(RESUME)));
  assert.deepEqual(roles.map((r) => r.heading), ['Data Engineer', 'Data Analyst']);
  assert.equal(roles[1].subheading, 'Calder Financial, Dallas, TX');
  assert.equal(roles[1].dates, 'Jun 2020 – Feb 2022');
  assert.equal(roles[0].bullets.at(-1), 'Packaged jobs in Docker and deployed them through GitHub Actions');
  assert.equal(roles[0].bullets.length, 4);
});

test('a wrapped bullet line that only looks like a title still continues its bullet', () => {
  const text = `Jo Fixture\njo@example.com\n\nExperience\nSoftware Engineer\nAcme Corp\nJan 2020 - Present\n- Built internal tools used by the Platform\nEngineering organisation every day.\n- Wrote unit tests`;
  const roles = experience(standardise(parseResume(text)));
  assert.equal(roles.length, 1);
  assert.equal(roles[0].bullets[0], 'Built internal tools used by the Platform Engineering organisation every day.');
});

test('a bracketed skill list is unpacked into separate skills, with no broken fragments', () => {
  const skills = standardise(parseResume(RESUME)).skills;
  for (const skill of ['AWS', 'S3', 'Redshift', 'Glue', 'Snowflake']) assert.ok(skills.includes(skill), `${skill} listed`);
  assert.ok(!skills.some((skill) => /[()]/.test(skill)), 'no stray brackets');
  const fromWriter = standardise({ skillGroups: [{ name: 'Cloud', items: ['AWS (S3, Redshift, Glue)', 'S3', 'Docker'] }], sections: [] });
  assert.deepEqual(fromWriter.skillGroups[0].items, ['AWS', 'S3', 'Redshift', 'Glue', 'Docker']);
});

test('"AWS, GCP or Azure" is one choice with or without the comma before "or"', () => {
  for (const text of ['Requirements\nExperience with a cloud platform (AWS, GCP or Azure).', 'Requirements\nExperience with AWS, GCP, or Azure.']) {
    assert.deepEqual([...group(jobKeywords({ title: '', description: text }), 'aws').terms].sort(), ['aws', 'azure', 'gcp']);
  }
  const separate = jobKeywords({ title: '', description: 'Requirements\nExperience with SQL, and Python or Scala.' });
  assert.deepEqual([...group(separate, 'sql').terms], ['sql']);
});

test('conservative equivalents count as evidence; unrelated wording does not', () => {
  assert.ok(textHas('Built nightly jobs in Python and Spark that move 2 TB of sales data from store systems into Snowflake', 'data pipelines'));
  assert.ok(textHas('Experienced in building data flows for finance teams', 'data pipelines'));
  assert.ok(textHas('Loaded files from S3 into Redshift using Glue jobs', 'etl'));
  assert.ok(textHas('Data Engineer, Northwind Retail', 'data engineering'));
  assert.ok(textHas('Worked with product managers and analysts to define metrics', 'collaboration'));
  assert.ok(!textHas('Scheduled meetings and moved desks from one office to another', 'data pipelines'));
  assert.ok(!textHas('Worked with Python and SQL every day', 'collaboration'));
  assert.ok(!textHas('Wrote SQL queries against Redshift', 'etl'));
});

test('a missing preferred skill costs less than a missing required skill', () => {
  const resume = `${RESUME}\n`;
  const required = atsReport(resume, { title: 'Data Engineer', description: 'Requirements\nPython.\nSQL.\nSpark.\nKubernetes.' });
  const preferred = atsReport(resume, { title: 'Data Engineer', description: 'Requirements\nPython.\nSQL.\nSpark.\nPreferred\nKubernetes.' });
  assert.deepEqual(required.missingHard, ['kubernetes']);
  assert.deepEqual(preferred.missingHard, ['kubernetes']);
  assert.ok(preferred.score > required.score, `${preferred.score} > ${required.score}`);
  // Python, SQL, Spark, plus "data engineering" from the job title; Kubernetes is the one gap.
  assert.equal(preferred.breakdown.hardSkills.matched, 4);
  assert.equal(preferred.breakdown.hardSkills.total, 5);
  const all = atsReport(resume, { title: 'Data Engineer', description: 'Requirements\nPython.\nSQL.\nSpark.' });
  assert.equal(all.breakdown.hardSkills.share, 1);
});

function rewriteBullet(original, next) {
  const before = standardise({ name: 'Fixture', contact: [], headline: 'Data Engineer', summary: '', skills: [], skillGroups: [],
    sections: [{ title: 'Experience', items: [{ heading: 'Data Engineer', subheading: 'Acme', dates: '2020 – 2022', bullets: [original] }] }] });
  const draft = structuredClone(before);
  draft.sections[0].items[0].bullets = [next];
  return preserveResumeFacts(draft, before).resume.sections[0].items[0].bullets[0];
}

test('honest rewording in the job vocabulary is kept', () => {
  const cases = [
    ['Built nightly jobs in Python and Spark that move 2 TB of sales data from store systems into Snowflake',
      'Built nightly data pipelines in Python and Spark that move 2 TB of sales data from store systems into the Snowflake data warehouse'],
    ['Scheduled and monitored 60+ workflows in Airflow, cutting failed runs by 35%', 'Orchestrated and monitored 60+ workflows in Airflow, cutting failed runs by 35%'],
    ['Worked with product managers and analysts to define metrics and fix data quality problems', 'Collaborated with product managers and analysts to define metrics and resolve data quality issues'],
    ['Loaded files from S3 into Redshift using Glue jobs', 'Loaded files from S3 into Redshift using AWS Glue ETL jobs'],
  ];
  for (const [original, next] of cases) assert.equal(rewriteBullet(original, next), next);
});

test('invented tools, numbers, scope and leadership are still rejected', () => {
  const original = 'Scheduled and monitored 60+ workflows in Airflow, cutting failed runs by 35%';
  for (const next of [
    'Orchestrated and monitored 60+ workflows in Airflow and Kubernetes, cutting failed runs by 35%',
    'Orchestrated and monitored 600+ workflows in Airflow, cutting failed runs by 35%',
    'Orchestrated and monitored 60+ workflows in Airflow, cutting failed runs by 35% and saving $2M',
    'Led a team that orchestrated 60+ workflows in Airflow, cutting failed runs by 35%',
    'Architected an enterprise platform to orchestrate 60+ workflows in Airflow, cutting failed runs by 35%',
    'Orchestrated and monitored 60+ Kafka streaming workflows in Airflow, cutting failed runs by 35%',
  ]) assert.equal(rewriteBullet(original, next), original, next);
});

const JOB = {
  id: 1, title: 'Senior Data Engineer', company: 'Acme', location: 'Austin, TX', tags: '',
  description: `Responsibilities
- Design and build scalable ETL/ELT data pipelines using Python, SQL and Apache Spark
- Orchestrate workflows with Apache Airflow
Requirements
- Strong programming skills in Python and advanced SQL
- Hands-on experience with Spark, Airflow and dbt
- Experience with a cloud platform (AWS, GCP or Azure) and a cloud data warehouse such as Snowflake, BigQuery or Redshift
- Experience with Docker and Kubernetes
Preferred
- Experience with Kafka or Kinesis
- Experience with Databricks`,
};
const PROFILE = { skills: 'Python, SQL, Spark, Airflow, Snowflake, dbt', headline: 'Data Engineer', titles: 'Data Engineer', experience_years: 4 };
const USER = { name: 'Sam Rivera', email: 'sam.rivera@example.com' };

test('a well-matched resume scores inside the target, and real gaps stay visible instead of being invented', async () => {
  const result = await tailorResume({ resumeText: RESUME, profile: PROFILE, user: USER, job: JOB });
  assert.ok(result.after.score >= 85, `score ${result.after.score}`);
  assert.deepEqual([...result.after.missingHard].sort(), ['databricks', 'kafka', 'kinesis', 'kubernetes']);
  const text = resumeToText(result.resume);
  for (const absent of ['Kubernetes', 'Kafka', 'Kinesis', 'Databricks']) assert.ok(!text.includes(absent), `${absent} not claimed`);
  assert.deepEqual(experience(result.resume).map((r) => r.heading), ['Data Engineer', 'Data Analyst']);
});

test('confirming a skill the candidate has adds it to Skills only, never to a past employer', async () => {
  const result = await tailorResume({ resumeText: RESUME, profile: PROFILE, user: USER, job: JOB, confirmedSkills: ['kubernetes'] });
  assert.ok(!result.after.missingHard.includes('kubernetes'));
  assert.ok(result.resume.skills.includes('Kubernetes'));
  for (const role of experience(result.resume)) assert.ok(!role.bullets.some((b) => /kubernetes/i.test(b)));
});

test('account contact details only fill in what the resume lacks, so the login email is never added as a second email', () => {
  const account = { name: 'Sam Rivera', email: 'login-address@example.com' };
  const profile = { phone: '(555) 999-0000', linkedin: 'linkedin.com/in/other' };
  const withOwn = standardise(parseResume('Sam Rivera\nsam.rivera@example.com | (555) 201-8842 | www.linkedin.com/in/samrivera/\n\nSummary\nData engineer.', profile, account));
  assert.deepEqual(withOwn.contact, ['sam.rivera@example.com', '(555) 201-8842', 'www.linkedin.com/in/samrivera/']);
  const withNone = standardise(parseResume('Sam Rivera\nAustin, TX\n\nSummary\nData engineer.', profile, account));
  assert.deepEqual(withNone.contact, ['login-address@example.com', '(555) 999-0000', 'linkedin.com/in/other']);
});
