import { test } from 'node:test';
import assert from 'node:assert/strict';

// The tailored version keeps the uploaded resume's own layout and wording, and changes only what the job needs.
process.env.DB_PATH = ':memory:';
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';

const { parseResume, standardise, tailorResume, resumeToText, resumeToDocx, extractResumeText } = await import('../src/resume.js');

const RESUME = `Dana Fixture
DATA ENGINEER | SPARK • AWS • API INTEGRATION
dana@example.com | +1 555 010 0199 | Parlin, NJ | www.linkedin.com/in/dana-fixture/
PROFESSIONAL SUMMARY
Data Engineer with 4+ years of experience building and supporting data pipelines across healthcare and insurance.
Background spans scheduled ETL batch processing and Snowflake data warehousing.
TECHNICAL SKILLS
Batch Processing and Big Data: Apache Spark, PySpark, Databricks, ETL, scheduled batch jobs
AWS and Cloud Platforms: Amazon S3, EMR, Glue, Lambda, Redshift; Azure SQL, Synapse, Key
Vault, Entra ID
Data Warehousing and Storage: Snowflake, dbt, Delta Lake, star schemas, Parquet; NoSQL: Cassandra, MongoDB; SQL Server
PROFESSIONAL EXPERIENCE
Northwind Health | Sr. Data Engineer
November 2025 – Present | Remote, USA
• Monitored scheduled pipeline runs and investigated failed jobs to maintain SLA-driven delivery of downstream data.
• Developed SQL Server stored procedures and views alongside dbt transformations and Snowflake star schemas.
Calder Insurance | Associate Data Engineer
August 2020 – July 2022 | Chennai, India
• Prepared claims reporting datasets using SQL for Finance and insurance teams.
CERTIFICATION
Databricks Certified Data Engineer Professional
EDUCATION
Master’s in Information Systems | Saint Louis University`;
const JOB = { id: 2, title: 'Data Engineer III - REQ27926.2', company: 'Acme', description: 'Basic qualifications\nMust have experience with: ETL/ELT processes; data modeling; SQL; and Oracle.' };
const USER = { name: 'Dana Fixture', email: 'login-address@example.com' };
const GROUPS = ['Batch Processing and Big Data', 'AWS and Cloud Platforms', 'Data Warehousing and Storage'];
const fakeWriter = (revise) => ({ beta: { messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: revise() }) } } });
const experience = (resume) => resume.sections.find((s) => s.title === 'Experience').items;

test('skill categories keep their names, order and wording; a wrapped line stays in its category', () => {
  const parsed = standardise(parseResume(RESUME, {}, USER));
  assert.deepEqual(parsed.skillGroups.map((g) => g.name), GROUPS);
  assert.ok(parsed.skills.includes('Key Vault'), 'a skill split across two lines is one skill');
  assert.ok(parsed.skills.includes('Cassandra') && !parsed.skills.some((s) => /NoSQL:/.test(s)));
  assert.ok(resumeToText(parsed).split('\n').includes('AWS and Cloud Platforms: Amazon S3, EMR, Glue, Lambda, Redshift; Azure SQL, Synapse, Key Vault, Entra ID'));
});

test('rules-only tailoring keeps the uploaded layout and changes only what the job needs', async () => {
  const result = await tailorResume({ resumeText: RESUME, profile: {}, user: USER, job: JOB });
  const text = resumeToText(result.resume);
  const lines = text.split('\n');
  // The headline is rewritten for the job in the candidate's own format: role, bar, three keywords, capitals, bullets.
  assert.equal(lines[1], 'DATA ENGINEER | ETL • ELT • DATA MODELING');
  for (const kept of [
    'dana@example.com | +1 555 010 0199 | Parlin, NJ | www.linkedin.com/in/dana-fixture/',
    'Batch Processing and Big Data: Apache Spark, PySpark, Databricks, ETL, scheduled batch jobs',
    'Northwind Health | Sr. Data Engineer', 'November 2025 – Present | Remote, USA',
    'Calder Insurance | Associate Data Engineer', 'August 2020 – July 2022 | Chennai, India',
    'CERTIFICATION', 'Master’s in Information Systems | Saint Louis University',
    '• Monitored scheduled pipeline runs and investigated failed jobs to maintain SLA-driven delivery of downstream data.',
    '• Prepared claims reporting datasets using SQL for Finance and insurance teams.',
  ]) assert.ok(lines.includes(kept), `kept as written: ${kept}`);
  assert.deepEqual(lines.filter((l) => /^[A-Z ]{6,}$/.test(l)), ['PROFESSIONAL SUMMARY', 'TECHNICAL SKILLS', 'PROFESSIONAL EXPERIENCE', 'CERTIFICATION', 'EDUCATION']);
  assert.ok(text.includes('Data Engineer with 4+ years of experience building and supporting data pipelines across healthcare and insurance. Background spans scheduled ETL batch processing and Snowflake data warehousing.'), 'own summary kept word for word');
  // A job keyword the resume supports in other words is added to the category it belongs in.
  assert.ok(lines.includes('Data Warehousing and Storage: Snowflake, dbt, Delta Lake, star schemas, Parquet; NoSQL: Cassandra, MongoDB; SQL Server, Data Modeling'));
  assert.ok(!/oracle/i.test(text), 'a missing required skill is not invented');
  assert.ok(!text.includes('login-address@example.com'), 'the login email is not added next to the resume email');
  assert.deepEqual(result.after.missingHard, ['oracle']);
});

test('an AI rewrite is kept only where it adds a job keyword; everything else stays as the candidate wrote it', async () => {
  const revise = () => {
    const resume = standardise(parseResume(RESUME, {}, USER));
    resume.headline = 'Data Engineer III';
    resume.summary = 'Seasoned engineer.';
    resume.skillGroups = [{ name: 'Everything', items: resume.skills }];
    const [first] = experience(resume);
    first.bullets[0] = 'Tracked scheduled pipeline runs and investigated failed jobs to maintain SLA-driven delivery of downstream data.';
    first.bullets[1] = 'Developed SQL Server stored procedures and views alongside dbt ELT transformations and Snowflake star schema data modeling.';
    return { resume, changes: [], inferredSkills: [] };
  };
  const result = await tailorResume({ resumeText: RESUME, profile: {}, user: USER, job: JOB, aiClient: fakeWriter(revise), model: 'fixture' });
  const [first] = experience(result.resume);
  assert.equal(result.ai, true);
  assert.equal(first.bullets[0], 'Monitored scheduled pipeline runs and investigated failed jobs to maintain SLA-driven delivery of downstream data.', 'a synonym-only rewrite is not used');
  assert.match(first.bullets[1], /dbt ELT transformations and Snowflake star schema data modeling/, 'a rewrite that adds job keywords is used');
  assert.equal(result.resume.headline, 'DATA ENGINEER | ETL • ELT • DATA MODELING', "the AI's own headline is not used");
  assert.deepEqual(result.resume.skillGroups.map((g) => g.name), GROUPS);
  assert.match(result.resume.summary, /^Data Engineer with 4\+ years of experience building and supporting data pipelines/);
  assert.doesNotMatch(result.resume.summary, /Seasoned/);
});

test('the headline follows each job: supported job keywords first, own keywords fill the rest, nothing unsupported', async () => {
  const { tailoredHeadline } = await import('../src/resume.js');
  const own = 'DATA ENGINEER | SPARK • SPRING BATCH • AWS • API INTEGRATION';
  assert.equal(tailoredHeadline(own, 'Data Engineer', ['snowflake', 'dbt', 'airflow', 'python', 'sql']), 'DATA ENGINEER | SNOWFLAKE • DBT • AIRFLOW • PYTHON');
  assert.equal(tailoredHeadline(own, 'Data Engineer', ['sql', 'data engineering']), 'DATA ENGINEER | SQL • SPARK • SPRING BATCH • AWS');
  assert.equal(tailoredHeadline('Full-Stack Developer', 'Full-Stack Engineer', ['react']), 'Full-Stack Engineer');
  assert.equal(tailoredHeadline('Data Engineer - Spark, AWS', 'Data Engineer', ['kafka']), 'Data Engineer - Kafka, Spark, AWS');
  // A different job gives a different headline, and a skill the resume lacks never appears in it.
  const other = await tailorResume({ resumeText: RESUME, profile: {}, user: USER, job: { id: 3, title: 'Data Engineer', company: 'Globex', description: 'Requirements\nSnowflake, dbt, Spark, Kafka and Kubernetes.' } });
  assert.equal(other.resume.headline, 'DATA ENGINEER | SNOWFLAKE • DBT • SPARK');
  assert.doesNotMatch(other.resume.headline, /KAFKA|KUBERNETES/);
});

test('the Word file is written in the same layout', async () => {
  const result = await tailorResume({ resumeText: RESUME, profile: {}, user: USER, job: JOB });
  const word = await extractResumeText(await resumeToDocx(result.resume), 'resume.docx');
  for (const kept of ['Northwind Health | Sr. Data Engineer', 'November 2025 – Present | Remote, USA', 'CERTIFICATION',
    'AWS and Cloud Platforms: Amazon S3, EMR, Glue, Lambda, Redshift; Azure SQL, Synapse, Key Vault, Entra ID']) {
    assert.ok(word.includes(kept), `Word file keeps: ${kept}`);
  }
});
