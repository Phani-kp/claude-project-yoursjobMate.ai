import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { AlignmentType, BorderStyle, Document, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import { csv } from './db.js';

// ---------------------------------------------------------------------------
// Reading uploaded resumes
// ---------------------------------------------------------------------------

const userError = (message) => Object.assign(new Error(message), { status: 400, expose: true });

/** Extracts plain text from an uploaded resume (PDF, DOCX, TXT or MD). */
export async function extractResumeText(buffer, filename, mimetype = '') {
  const name = filename.toLowerCase();
  let text;
  if (name.endsWith('.pdf') || mimetype === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    ({ text } = await extractText(pdf, { mergePages: true }));
  } else if (name.endsWith('.docx') || mimetype.includes('officedocument.wordprocessingml')) {
    ({ value: text } = await mammoth.extractRawText({ buffer }));
  } else if (/\.(txt|md)$/.test(name) || mimetype.startsWith('text/')) {
    text = buffer.toString('utf8');
  } else if (name.endsWith('.doc')) {
    throw userError('Old .doc files can\'t be read. Open it in Word and "Save as" .docx or PDF, then upload that.');
  } else {
    throw userError('Please upload a PDF, Word (.docx) or text file.');
  }
  text = (text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 50) throw userError("We couldn't find any text in that file. If it's a scanned image, upload the original Word or PDF export instead.");
  return text.slice(0, 30000);
}

// ---------------------------------------------------------------------------
// ATS keyword matching
// ---------------------------------------------------------------------------

// Hard skills: tools, technologies, methods and domain skills that ATS filters screen for. Matched against job text to
// find what a job asks for, and against the resume to find what the candidate has.
const HARD_SKILLS = [
  // Software
  'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'c', 'go', 'rust', 'ruby', 'php', 'kotlin', 'swift', 'scala', 'r', 'matlab', 'perl', 'objective-c', 'dart', 'elixir',
  'react', 'react native', 'next.js', 'vue', 'angular', 'svelte', 'redux', 'html', 'css', 'sass', 'tailwind', 'webpack', 'vite', 'flutter', 'android', 'ios',
  'node.js', 'express', 'nestjs', 'django', 'flask', 'fastapi', 'spring', 'spring boot', '.net', 'asp.net', 'rails', 'laravel',
  'graphql', 'rest api', 'restful', 'grpc', 'microservices', 'websockets', 'kafka', 'rabbitmq', 'distributed systems', 'system design',
  'sql', 'postgresql', 'mysql', 'sql server', 'oracle', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'cassandra', 'snowflake', 'bigquery', 'databricks', 'redshift',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'github actions', 'linux', 'bash', 'shell scripting', 'networking',
  'git', 'jira', 'agile', 'scrum', 'kanban', 'tdd', 'unit testing', 'integration testing', 'jest', 'cypress', 'playwright', 'selenium', 'qa automation',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'llm', 'generative ai', 'pytorch', 'tensorflow', 'scikit-learn', 'pandas', 'numpy', 'spark', 'hadoop', 'airflow', 'etl', 'dbt',
  'data analysis', 'data analytics', 'data engineering', 'data modeling', 'data visualization', 'tableau', 'power bi', 'looker', 'excel', 'statistics', 'a/b testing',
  // Data engineering and cloud data platforms
  'pyspark', 'spark sql', 'spark streaming', 'flink', 'hive', 'presto', 'trino', 'kinesis', 'delta lake', 'iceberg', 'hudi', 'parquet', 'avro', 'data lake', 'lakehouse',
  'data warehousing', 'data pipelines', 'batch processing', 'stream processing', 'real-time data', 'elt', 'data integration', 'data quality', 'data governance', 'data lineage',
  'master data management', 'dimensional modeling', 'star schema', 'stored procedures', 't-sql', 'pl/sql', 'nosql', 'azure data factory', 'azure synapse', 'azure databricks',
  'aws glue', 'aws emr', 'aws lambda', 'amazon s3', 'athena', 'step functions', 'cloudwatch', 'bigtable', 'dataflow', 'dataproc', 'pub/sub', 'informatica', 'talend', 'ssis', 'fivetran',
  'dagster', 'prefect', 'great expectations', 'unity catalog', 'mlflow', 'feature engineering', 'jupyter', 'sqlalchemy', 'spring batch', 'yugabyte', 'cosmos db', 'teradata', 'vertica',
  'azure devops', 'api integration', 'etl pipelines', 'performance tuning', 'query optimization', 'data migration', 'cloud migration', 'serverless', 'event-driven architecture', 'object-oriented programming',
  'figma', 'sketch', 'adobe creative suite', 'photoshop', 'illustrator', 'ui/ux', 'user research', 'prototyping', 'accessibility', 'seo', 'performance optimization',
  'cybersecurity', 'security', 'oauth', 'iam', 'siem', 'penetration testing', 'devops', 'sre', 'observability', 'monitoring', 'incident response',
  // Hardware, engineering, manufacturing
  'embedded systems', 'firmware', 'fpga', 'verilog', 'vhdl', 'pcb design', 'circuit design', 'rf', 'signal processing', 'robotics', 'plc', 'scada',
  'autocad', 'solidworks', 'catia', 'creo', 'ansys', 'cad', 'cam', 'cnc', 'gd&t', 'fea', 'cfd', 'six sigma', 'lean manufacturing', 'root cause analysis',
  'quality assurance', 'quality control', 'iso 9001', 'as9100', 'fmea', 'spc', 'process engineering', 'chemical engineering', 'mechanical engineering', 'electrical engineering',
  'supply chain', 'logistics', 'procurement', 'inventory management', 'erp', 'sap', 'oracle erp',
  // Business, finance, sales, operations, people
  'financial modeling', 'financial analysis', 'fp&a', 'forecasting', 'budgeting', 'accounting', 'gaap', 'audit', 'tax', 'reconciliation', 'accounts payable', 'accounts receivable',
  'risk management', 'compliance', 'aml', 'kyc', 'underwriting', 'credit analysis', 'investment banking', 'portfolio management', 'valuation', 'bloomberg',
  'salesforce', 'hubspot', 'crm', 'lead generation', 'pipeline management', 'account management', 'business development', 'b2b', 'saas', 'enterprise sales', 'negotiation',
  'digital marketing', 'content marketing', 'social media marketing', 'email marketing', 'google analytics', 'sem', 'ppc', 'brand management', 'market research', 'copywriting',
  'product management', 'product strategy', 'roadmapping', 'project management', 'program management', 'pmp', 'stakeholder management', 'change management', 'operations management',
  'customer success', 'customer service', 'technical support', 'recruiting', 'talent acquisition', 'hris', 'workday', 'payroll', 'employee relations',
  // Healthcare and science
  'patient care', 'clinical research', 'clinical trials', 'ehr', 'epic', 'hipaa', 'gcp compliance', 'regulatory affairs', 'fda', 'pharmacovigilance', 'medical devices',
  'laboratory', 'biotechnology', 'molecular biology', 'pcr', 'cell culture', 'bioinformatics', 'nursing', 'cpr', 'bls',
];
// Soft skills: weighted less than hard skills, as real ATS rankings do.
const SOFT_SKILLS = [
  'communication', 'leadership', 'mentoring', 'problem solving', 'collaboration', 'teamwork', 'cross-functional', 'ownership', 'attention to detail',
  'time management', 'critical thinking', 'adaptability', 'decision making', 'presentation', 'customer focus', 'analytical',
];
const ALIASES = {
  node: 'node.js', nodejs: 'node.js', reactjs: 'react', 'react.js': 'react', vuejs: 'vue', postgres: 'postgresql', k8s: 'kubernetes', js: 'javascript', ts: 'typescript',
  golang: 'go', nextjs: 'next.js', ml: 'machine learning', 'gen ai': 'generative ai', genai: 'generative ai', 'large language models': 'llm', 'google cloud': 'gcp',
  'amazon web services': 'aws', 'ms excel': 'excel', 'microsoft excel': 'excel', 'rest apis': 'rest api', 'restful apis': 'rest api', 'ci / cd': 'ci/cd', 'cicd': 'ci/cd',
  'team player': 'teamwork', 'cross functional': 'cross-functional', 'problem-solving': 'problem solving', 'detail-oriented': 'attention to detail', 'detail oriented': 'attention to detail',
  'communicator': 'communication', 'communication skills': 'communication', 'collaborative': 'collaboration', 'mentored': 'mentoring', 'mentor': 'mentoring', 'led': 'leadership',
  'presenting': 'presentation', 'presentations': 'presentation', 'user experience': 'ui/ux', 'ux': 'ui/ux', 'fp and a': 'fp&a',
  'financial planning and analysis': 'fp&a', 'project manager': 'project management', 'product manager': 'product management', 'epic systems': 'epic', 'electronic health records': 'ehr',
  // Data engineering wording
  'apache spark': 'spark', 'apache airflow': 'airflow', 'apache kafka': 'kafka', 'apache flink': 'flink', 'apache hive': 'hive', 'apache iceberg': 'iceberg', 'mwaa': 'airflow',
  'star schemas': 'star schema', 'snowflake schema': 'dimensional modeling', 'data model': 'data modeling', 'data models': 'data modeling', 'data modelling': 'data modeling',
  'data warehouse': 'data warehousing', 'data warehouses': 'data warehousing', 'enterprise data warehouse': 'data warehousing', 'edw': 'data warehousing',
  'data pipeline': 'data pipelines', 'etl pipeline': 'etl pipelines', 'elt pipelines': 'elt', 'data lakes': 'data lake', 'delta tables': 'delta lake', 'adf': 'azure data factory',
  'synapse': 'azure synapse', 'glue': 'aws glue', 'emr': 'aws emr', 'lambda': 'aws lambda', 's3': 'amazon s3', 'aws s3': 'amazon s3', 'tsql': 't-sql', 'plsql': 'pl/sql',
  'stored procedure': 'stored procedures', 'streaming': 'stream processing', 'real time': 'real-time data', 'batch jobs': 'batch processing', 'batch data processing': 'batch processing',
  'data validation': 'data quality', 'data integrity': 'data quality', 'oop': 'object-oriented programming', 'api integrations': 'api integration', 'aws redshift': 'redshift', 'amazon redshift': 'redshift',
  'google bigquery': 'bigquery', 'ms sql server': 'sql server', 'microsoft sql server': 'sql server', 'mssql': 'sql server', 'unit tests': 'unit testing', 'regression testing': 'integration testing',
};
// Dimensional / star-schema design is data modeling, and these imply their broader skill too.
const IMPLIES = {
  'star schema': ['data modeling', 'dimensional modeling'], 'dimensional modeling': ['data modeling'], pyspark: ['spark', 'python'], 'spark sql': ['spark', 'sql'],
  'azure data factory': ['etl', 'azure'], 'azure synapse': ['azure', 'data warehousing'], 'azure databricks': ['databricks', 'azure'], 'aws glue': ['aws', 'etl'], 'aws emr': ['aws', 'spark'],
  'aws lambda': ['aws', 'serverless'], 'amazon s3': ['aws'], redshift: ['aws', 'data warehousing'], snowflake: ['data warehousing'], 'delta lake': ['data lake', 'lakehouse'],
  't-sql': ['sql', 'stored procedures'], 'pl/sql': ['sql'], 'sql server': ['sql'], postgresql: ['sql'], mysql: ['sql'], cassandra: ['nosql'], mongodb: ['nosql'], dynamodb: ['nosql', 'aws'],
  yugabyte: ['nosql'], dbt: ['elt', 'data modeling'], 'etl pipelines': ['etl', 'data pipelines'], 'github actions': ['ci/cd'], jenkins: ['ci/cd'], 'azure devops': ['ci/cd'],
};
const SOFT = new Set(SOFT_SKILLS);
const ALL_TERMS = [...HARD_SKILLS, ...SOFT_SKILLS];
// Skills that are also everyday words ("Go", "R", "C", "Epic", "Workday") count only when written in a list such as
// "Python, Go, Rust" or "Skills: C", never from ordinary sentences ("ready to go", "an epic launch").
const AMBIGUOUS = new Set(['go', 'r', 'c', 'rf', 'cam', 'epic', 'workday', 'sem']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word-boundary match that also works for terms like "c++", "c#", ".net" and "node.js".
// Patterns are built once and reused: job ranking checks hundreds of skills against hundreds of jobs per search.
const RE_CACHE = new Map();
const termRe = (term) => {
  let re = RE_CACHE.get(term);
  if (!re) RE_CACHE.set(term, (re = new RegExp(`(^|[^a-z0-9+#.])${escapeRe(term)}(?=$|[^a-z0-9+#&]|\\.(?![a-z0-9]))`, 'i')));
  return re;
};
const ALIASES_OF = {};
for (const [alias, real] of Object.entries(ALIASES)) (ALIASES_OF[real] ||= []).push(alias);
const IMPLIED_BY = {};
for (const [specific, broader] of Object.entries(IMPLIES)) for (const b of broader) (IMPLIED_BY[b] ||= []).push(specific);
const hasTerm = (text, term) => termRe(term).test(text) || (ALIASES_OF[term] || []).some((alias) => termRe(alias).test(text));
// Ambiguous one-word skills must appear in a list-like context (e.g. "Python, Go, Rust" or "Skills: C").
const listedTerm = (text, term) => new RegExp(`(^|[,;/|•(:]\\s*)${escapeRe(term)}\\s*(?=[,;/|•)]|$)`, 'im').test(text);
const directHas = (text, term) => (AMBIGUOUS.has(term) ? listedTerm(text, term) : hasTerm(text, term));
/** Does the text show this skill, directly or through a more specific one ("PySpark" shows Spark, "star schemas" show data modeling)? */
const textHas = (text, term) => directHas(text, term) || (IMPLIED_BY[term] || []).some((specific) => directHas(text, specific));

// Terms that job ads often use when describing the company or team rather than the role ("our supply chain", "we build
// generative AI"). They count as requirements only when they appear in the requirements/qualifications part of the ad.
const CONTEXT_ONLY = new Set([
  'supply chain', 'logistics', 'procurement', 'inventory management', 'robotics', 'recruiting', 'talent acquisition', 'customer service', 'customer success',
  'account management', 'business development', 'sales', 'marketing', 'digital marketing', 'b2b', 'saas', 'e-commerce', 'fintech', 'crm', 'product management',
  'project management', 'program management', 'operations management', 'compliance', 'audit', 'security', 'networking', 'monitoring', 'statistics', 'excel',
  'machine learning', 'deep learning', 'generative ai', 'llm', 'nlp', 'computer vision', 'patient care', 'hipaa', 'risk management', 'forecasting', 'budgeting',
]);

const REQ_START = /^\s*(basic|minimum|required|preferred|desired|additional)?\s*(qualifications?|requirements?|skills( and (experience|qualifications))?|experience)\s*:?\s*$|what you('| wi)ll (bring|need)|what we('re| are) looking for|who you are|about you|you (have|bring|might be a good fit)|you('re| are) a (great|good) fit|must[- ]haves?|nice[- ]to[- ]haves?|bonus points|ideal candidate/im;
const REQ_END = /^\s*(about (us|the company|the team|[a-z]+)|benefits|compensation|salary|pay (range|transparency)|perks|our (company|team|mission|values|culture)|why (join|work)|equal (employment )?opportunity|we offer|what we offer|the (pay|salary) range|life at)\b|equal (employment )?opportunity|reasonable accommodation|base pay|pay range|compensation (range|package)|salary range|disability|veteran status|e-verify|inclusive culture/im;

/** The requirements/qualifications part of a job description (where an ATS's screening criteria come from). */
export function requirementsText(description = '') {
  const lines = String(description).split('\n');
  const out = [];
  let inReq = false;
  for (const line of lines) {
    if (REQ_START.test(line) && line.length < 120) { inReq = true; continue; }
    if (inReq && REQ_END.test(line) && line.length < 120) inReq = false;
    if (inReq) out.push(line);
  }
  return out.join('\n');
}

/** The skills an ATS would screen for in this job, most important first: { hard: [...], soft: [...] }. */
// Hiring-process boilerplate that says nothing about the role ("contact your Recruiting Partner", EEO notices, pay ranges).
const BOILERPLATE = /recruiting partner|equal (employment )?opportunity|reasonable accommodation|e-verify|background check|veteran status|protected (class|characteristic)|pay transparency|base pay|salary range|applicants? (with|who)|privacy (notice|policy)|country\/region|by applying|benefits include|401\(k\)|medical, dental/i;

// A quick substring test before the exact match: most skills don't appear in a given text at all.
const mightHave = (lower, term) => lower.includes(term) || (ALIASES_OF[term] || []).some((a) => lower.includes(a));

// Job keywords are the same every time a job is scored, so they're computed once per job version.
const KEYWORD_CACHE = new Map();

export function jobKeywords(job) {
  const cacheKey = job.id ? `${job.id}:${job.title}:${(job.description || '').length}` : null;
  if (cacheKey && KEYWORD_CACHE.has(cacheKey)) return KEYWORD_CACHE.get(cacheKey);
  const result = computeJobKeywords(job);
  if (cacheKey) {
    if (KEYWORD_CACHE.size > 30000) KEYWORD_CACHE.delete(KEYWORD_CACHE.keys().next().value);
    KEYWORD_CACHE.set(cacheKey, result);
  }
  return result;
}

function computeJobKeywords(job) {
  const desc = String(job.description || '').split('\n').filter((l) => !BOILERPLATE.test(l)).join('\n');
  const text = `${job.title}\n${desc}`;
  const req = requirementsText(desc);
  const lower = text.toLowerCase();
  const found = new Map();
  // Job-board tags are skills on some sources (Remote OK, Remotive) but departments on others (Greenhouse), so only known skills count.
  for (const tag of csv(job.tags)) {
    const t = ALIASES[tag.toLowerCase()] || tag.toLowerCase();
    if (ALL_TERMS.includes(t)) found.set(t, 3);
  }
  for (const term of ALL_TERMS) {
    if (found.has(term) || !mightHave(lower, term) || !directHas(text, term)) continue;
    const inTitle = hasTerm(job.title, term);
    const inReq = req && directHas(req, term);
    // Company/team background words only count when the requirements ask for them (or with no requirements section, when repeated).
    if (CONTEXT_ONLY.has(term) && !inTitle && !inReq) {
      const hits = (lower.match(new RegExp(escapeRe(term), 'g')) || []).length;
      if (req || hits < 3) continue;
    }
    const hits = (lower.match(new RegExp(escapeRe(term), 'g')) || []).length || 1;
    // Skills in the title or the requirements matter most.
    found.set(term, hits + (inTitle ? 4 : 0) + (inReq ? 3 : 0));
  }
  const ranked = [...found.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { hard: ranked.filter((t) => !SOFT.has(t)).slice(0, 25), soft: ranked.filter((t) => SOFT.has(t)).slice(0, 6) };
}

const TITLE_STOP = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'i', 'ii', 'iii', 'iv', 'v', 'and', 'of', 'the', 'for', 'to', 'a', 'an', 'with', 'in', 'at', 'remote', 'hybrid', 'us', 'usa', 'new', 'grad']);
export const titleWords = (title) => String(title || '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1 && !TITLE_STOP.has(w) && !/^\d+$/.test(w));

const SECTION_NAMES = {
  summary: /^(professional\s+)?(summary|profile|objective|about( me)?)$/i,
  experience: /^(work\s+|professional\s+|relevant\s+)?(experience|employment( history)?|work history)$/i,
  education: /^(education|academic background|qualifications)$/i,
  skills: /^(technical\s+|key\s+|core\s+)?(skills|competencies|technologies|tech stack)$/i,
  projects: /^(personal\s+|key\s+|selected\s+)?projects$/i,
  certifications: /^(certifications?|licenses?( (and|&) certifications)?|courses)$/i,
};
const sectionOf = (line) => {
  const clean = line.replace(/[:\s]+$/, '').trim();
  if (clean.length > 40) return null;
  return Object.keys(SECTION_NAMES).find((k) => SECTION_NAMES[k].test(clean)) || null;
};

/** Target score: what a strong, honest, tailored resume should reach. */
export const TARGET_SCORE = 85;

/**
 * Scores a resume the way ATS ranking does (Workday, Greenhouse, Taleo and resume scanners like Jobscan weigh it similarly):
 *   hard skills 55% · job-title match 15% · soft skills 10% · ATS-readable format 20%.
 * Without a job, only the format checks are returned.
 */
export function atsReport(resumeText, job) {
  const text = resumeText || '';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const sections = new Set(lines.map(sectionOf).filter(Boolean));
  const words = text.split(/\s+/).filter(Boolean).length;
  const checks = [
    { label: 'Has an email address', ok: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text), tip: 'Put your email at the top so recruiters can contact you.' },
    { label: 'Has a phone number', ok: /(\+?\d[\d\s().-]{8,}\d)/.test(text), tip: 'Add a phone number next to your email.' },
    { label: 'Has a Summary section', ok: sections.has('summary'), tip: 'Add a 2–4 line "Summary" at the top that names your target role and top skills.' },
    { label: 'Has a Skills section', ok: sections.has('skills'), tip: 'Add a "Skills" heading listing your tools and technologies.' },
    { label: 'Has an Experience section', ok: sections.has('experience'), tip: 'Use the heading "Experience" or "Work Experience" so the ATS can find your jobs.' },
    { label: 'Has an Education section', ok: sections.has('education'), tip: 'Add an "Education" heading, even if it is short.' },
    { label: 'Good length (300–1,200 words)', ok: words >= 300 && words <= 1200, tip: words < 300 ? 'Add more detail about what you did and achieved.' : 'Trim to the most relevant 1–2 pages.' },
    { label: 'Uses numbers to show impact', ok: (text.match(/\d+\s?(%|percent|x\b|\+|k\b|users|customers|clients|million|hours|days|teams|projects)/gi) || []).length >= 2, tip: 'Quantify results, for example "cut load time by 40%".' },
  ];
  if (!job) return { checks, words };
  const { hard, soft } = jobKeywords(job);
  const hardHit = hard.filter((k) => textHas(text, k));
  const softHit = soft.filter((k) => textHas(text, k));
  const tWords = titleWords(job.title);
  const top = lines.slice(0, 25).join(' ').toLowerCase();
  const titleHit = tWords.filter((w) => top.includes(w) || new RegExp(`\\b${escapeRe(w)}`).test(text.toLowerCase()));
  const parts = {
    hardSkills: { weight: 55, matched: hardHit.length, total: hard.length },
    title: { weight: 15, matched: titleHit.length, total: tWords.length },
    softSkills: { weight: 10, matched: softHit.length, total: soft.length },
    format: { weight: 20, matched: checks.filter((c) => c.ok).length, total: checks.length },
  };
  // A part the job doesn't call for (e.g. no soft skills mentioned) gives its weight to the others.
  const used = Object.values(parts).filter((p) => p.total > 0);
  const totalWeight = used.reduce((n, p) => n + p.weight, 0);
  const score = Math.round(used.reduce((n, p) => n + (p.weight / totalWeight) * (p.matched / p.total), 0) * 100);
  const missingHard = hard.filter((k) => !hardHit.includes(k));
  const missingSoft = soft.filter((k) => !softHit.includes(k));
  return { score, matched: [...hardHit, ...softHit], missing: [...missingHard, ...missingSoft], missingHard, breakdown: parts, checks, words };
}

// ---------------------------------------------------------------------------
// Structured resume
// ---------------------------------------------------------------------------

/** JSON schema of a structured resume. Also used as Claude's structured-output format. */
export const RESUME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'headline', 'contact', 'summary', 'skills', 'skillGroups', 'sections'],
  properties: {
    name: { type: 'string' },
    headline: { type: 'string', description: 'Target role / professional title, e.g. "Senior Frontend Engineer"' },
    contact: { type: 'array', items: { type: 'string' }, description: 'Email, phone, location, LinkedIn, portfolio' },
    summary: { type: 'string', description: '2-4 sentence professional summary' },
    skills: { type: 'array', items: { type: 'string' } },
    skillGroups: {
      type: 'array',
      description: 'Skills grouped by category, e.g. "Big Data & Processing", "Cloud Platforms", "Languages", most relevant group first. Empty if the resume has no categories.',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'items'],
        properties: { name: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
      },
    },
    sections: {
      type: 'array',
      description: 'Experience, Projects, Education, Certifications… in that order, using those exact standard titles',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'items'],
        properties: {
          title: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['heading', 'subheading', 'dates', 'bullets'],
              properties: {
                heading: { type: 'string', description: 'Job title, degree, project or certificate name' },
                subheading: { type: 'string', description: 'Company / school and location, or empty' },
                dates: { type: 'string', description: 'e.g. "Jan 2021 – Present", or empty' },
                bullets: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
};

const TITLES = { experience: 'Experience', projects: 'Projects', education: 'Education', certifications: 'Certifications' };
const BULLET = /^[•\-–*▪●◦·]\s*/;
// Date ranges like "Jan 2021 – Present", "June 2019 to Dec 2020", "01/2021 - 03/2023" or "2015 - 2019".
const DATES = /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+|\d{1,2}[/.])?(19|20)\d{2}\s*(-|–|—|to)\s*(((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+|\d{1,2}[/.])?(19|20)\d{2}|present|current|now)/i;

// Words that mark the job-title part of "CVS Health | Sr. Data Engineer" or "Data Engineer, Acme".
const ROLE_WORDS = /\b(engineer|developer|analyst|scientist|manager|architect|consultant|intern|lead|specialist|administrator|designer|director|associate|officer|technician|coordinator|programmer|sde|devops|sre|tester|qa|head|vp|president|founder|accountant|nurse|recruiter|representative|executive)\b/i;

/**
 * PDFs break long lines, so one bullet or skills line arrives as several lines. This joins them back together:
 * a line continues the previous one unless it starts a bullet, a section, or a new role/date line.
 */
function joinWrappedLines(lines) {
  const out = [];
  for (const line of lines) {
    const prev = out.at(-1);
    const startsNew = BULLET.test(line) || sectionOf(line) || DATES.test(line) || /^[^|]{2,60}\|[^|]{2,80}$/.test(line) && ROLE_WORDS.test(line) && !/[.,;]$/.test(prev || '');
    const prevOpen = prev && !sectionOf(prev) && (/[,;:&/\-–(]$|\b(and|or|with|of|for|to|the|in|across|including)$/i.test(prev) || (BULLET.test(prev) && !/[.!?]$/.test(prev)));
    if (prev && !startsNew && (prevOpen || /^[a-z(]/.test(line))) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

/** Splits a role header into { heading: job title, subheading: company and location, dates }. */
function roleHeader(line) {
  const dates = line.match(DATES)?.[0] || '';
  const parts = line.replace(dates, ' ').split(/\s+(?:\||–|—|@|\bat\b)\s+|\s*\|\s*/).map((p) => p.replace(/^[,\s]+|[,\s]+$/g, '')).filter(Boolean);
  const t = parts.findIndex((p) => ROLE_WORDS.test(p));
  const titleIdx = t >= 0 ? t : 0;
  return { heading: parts[titleIdx] || '', subheading: parts.filter((_, i) => i !== titleIdx).join(', '), dates, bullets: [] };
}

/** Best-effort split of plain resume text into the structured shape (used when AI is off). */
export function parseResume(text, profile = {}, user = {}) {
  const lines = joinWrappedLines((text || '').split('\n').map((l) => l.trim()).filter(Boolean));
  const resume = { name: '', headline: '', contact: [], summary: '', skills: [], skillGroups: [], sections: [] };
  let i = 0;
  // Header: name and contact details before the first section heading.
  const header = [];
  while (i < lines.length && !sectionOf(lines[i]) && header.length < 8) header.push(lines[i++]);
  const contactRe = /@|https?:|linkedin|github|\+?\d[\d\s().-]{8,}/i;
  for (const [n, line] of header.entries()) {
    if (n === 0 && !contactRe.test(line) && line.split(' ').length <= 5) resume.name = line;
    else if (contactRe.test(line)) resume.contact.push(...line.split(/\s*[|•·]\s*/).filter(Boolean));
    else if (!resume.headline && line.length <= 80) resume.headline = line;
    else resume.summary = `${resume.summary} ${line}`.trim();
  }
  // The name as written on the resume, else the account name.
  resume.name ||= user.name || '';
  resume.headline ||= profile.headline || '';
  for (const c of [user.email, profile.phone, profile.linkedin]) if (c && !resume.contact.some((x) => x.includes(c))) resume.contact.push(c);

  let current = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const kind = sectionOf(line);
    if (kind) {
      current = kind === 'summary' || kind === 'skills' ? { kind } : { kind, section: { title: TITLES[kind], items: [] } };
      if (current.section) resume.sections.push(current.section);
      continue;
    }
    if (!current) continue;
    if (current.kind === 'summary') resume.summary = `${resume.summary} ${line}`.trim();
    else if (current.kind === 'skills') {
      // "Batch Processing and Big Data: Apache Spark, PySpark, Scala" keeps its category.
      const m = line.replace(BULLET, '').match(/^([^:]{2,45}):\s*(.+)$/);
      const items = (m ? m[2] : line.replace(BULLET, '')).split(/\s*[,|•·;]\s*/).map((s) => s.replace(/\.$/, '').trim()).filter((s) => s && s.length < 50);
      resume.skills.push(...items);
      if (m) resume.skillGroups.push({ name: m[1].trim(), items });
      else if (resume.skillGroups.length) resume.skillGroups.at(-1).items.push(...items);
    } else {
      const items = current.section.items;
      const last = items.at(-1);
      if (BULLET.test(line) && last) last.bullets.push(line.replace(BULLET, ''));
      // "November 2025 – Present | Remote, USA" under a "Company | Title" line: dates and location of that role.
      else if (last && !last.bullets.length && DATES.test(line) && !last.dates && !ROLE_WORDS.test(line.replace(DATES, ''))) {
        last.dates = line.match(DATES)[0];
        const place = line.replace(DATES, '').replace(/^[\s|,–-]+|[\s|,–-]+$/g, '');
        if (place) last.subheading = [last.subheading, place].filter(Boolean).join(', ');
      } else if (last && !last.subheading && !last.bullets.length && line.length < 80 && !ROLE_WORDS.test(line)) {
        // "Pixel Labs | June 2019 to Dec 2020" under a title line.
        const dates = line.match(DATES)?.[0] || '';
        last.subheading = line.replace(dates, '').replace(/^[\s|,–-]+|[\s|,–-]+$/g, '');
        last.dates ||= dates;
      } else if (line.length > 110 && last) last.bullets.push(line);
      else items.push(roleHeader(line));
    }
  }
  if (!resume.skills.length) resume.skills = csv(profile.skills);
  return resume;
}

/** Plain-text rendering, used for re-scoring and "copy as text". */
export function resumeToText(r) {
  const out = [r.name, r.headline, r.contact.join(' | '), ''];
  if (r.summary) out.push('SUMMARY', r.summary, '');
  if (r.skillGroups?.length) out.push('SKILLS', ...r.skillGroups.map((g) => `${g.name}: ${g.items.join(', ')}`), '');
  else if (r.skills.length) out.push('SKILLS', r.skills.join(', '), '');
  for (const s of r.sections) {
    out.push(s.title.toUpperCase());
    for (const it of s.items) {
      out.push([it.heading, it.subheading, it.dates].filter(Boolean).join(' | '));
      for (const b of it.bullets) out.push(`• ${b}`);
    }
    out.push('');
  }
  return out.filter((l, n, a) => l || a[n - 1]).join('\n').trim();
}

// ---------------------------------------------------------------------------
// Tailoring
// ---------------------------------------------------------------------------

// How common terms are normally written, for skills that aren't already spelled out in the user's resume.
const CASING = { javascript: 'JavaScript', typescript: 'TypeScript', 'node.js': 'Node.js', 'next.js': 'Next.js', graphql: 'GraphQL', 'rest api': 'REST APIs', restful: 'RESTful',
  postgresql: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB', aws: 'AWS', gcp: 'Google Cloud (GCP)', 'ci/cd': 'CI/CD', html: 'HTML', css: 'CSS', sql: 'SQL', 'ui/ux': 'UI/UX',
  nlp: 'NLP', llm: 'LLMs', tdd: 'TDD', etl: 'ETL', 'a/b testing': 'A/B testing', 'power bi': 'Power BI', 'github actions': 'GitHub Actions', saas: 'SaaS', b2b: 'B2B',
  sre: 'SRE', seo: 'SEO', oauth: 'OAuth', '.net': '.NET', 'asp.net': 'ASP.NET', 'c#': 'C#', 'c++': 'C++', php: 'PHP', iam: 'IAM', siem: 'SIEM', erp: 'ERP', sap: 'SAP',
  crm: 'CRM', 'fp&a': 'FP&A', gaap: 'GAAP', aml: 'AML', kyc: 'KYC', pmp: 'PMP', hris: 'HRIS', ehr: 'EHR', hipaa: 'HIPAA', fda: 'FDA', pcr: 'PCR', cpr: 'CPR', bls: 'BLS',
  'gd&t': 'GD&T', fea: 'FEA', cfd: 'CFD', fmea: 'FMEA', spc: 'SPC', plc: 'PLC', scada: 'SCADA', fpga: 'FPGA', 'pcb design': 'PCB design', rf: 'RF', cad: 'CAD', cam: 'CAM', cnc: 'CNC',
  'iso 9001': 'ISO 9001', as9100: 'AS9100', ios: 'iOS', 'objective-c': 'Objective-C', vhdl: 'VHDL', dbt: 'dbt', sem: 'SEM', ppc: 'PPC', 'cross-functional': 'Cross-functional collaboration',
  'scikit-learn': 'scikit-learn', numpy: 'NumPy', pytorch: 'PyTorch', tensorflow: 'TensorFlow', solidworks: 'SolidWorks', autocad: 'AutoCAD', hubspot: 'HubSpot', bigquery: 'BigQuery' };
const pretty = (k) => CASING[k] || k.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Job title as it should appear on a resume: without the location or tags like "(m/w/d)" that job boards append. */
export function cleanJobTitle(job) {
  const t = String(job.title || '')
    .replace(/\s*\((?:[mwfdx*]\s*\/\s*)+[mwfdx*]\)/gi, '')
    .replace(/\s*\((?:all genders?|remote|hybrid|on-?site|full[- ]time|part[- ]time)[^)]*\)/gi, '')
    .trim();
  const loc = String(job.location || '').toLowerCase();
  const parts = t.split(/\s+[-–—|]\s+/);
  while (parts.length > 1) {
    const last = parts.at(-1).toLowerCase();
    const isLocation = loc && last.split(/[\s,/]+/).every((w) => w.length < 3 || loc.includes(w));
    if (isLocation || /^(remote|hybrid|on-?site|full[- ]time|part[- ]time)$/.test(last)) parts.pop();
    else break;
  }
  return parts.join(' - ').trim() || job.title;
}

// ---------------------------------------------------------------------------
// The standard format every tailored resume follows
// ---------------------------------------------------------------------------

/** Standard ATS section order and titles. Anything else goes after, in its original order. */
const SECTION_ORDER = ['Experience', 'Projects', 'Education', 'Certifications', 'Professional Development'];
const STANDARD_TITLE = (title) => {
  const kind = sectionOf(title);
  return kind && TITLES[kind] ? TITLES[kind] : title.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase());
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One date style everywhere: "Jan 2021 – Present", "Mar 2019 – Dec 2020", "2015 – 2019". */
export function normaliseDates(s) {
  if (!s) return '';
  const one = (d) => {
    const t = d.trim();
    if (/^(present|current|now|today)$/i.test(t)) return 'Present';
    let m = t.match(/^(\d{1,2})[/.-](\d{4})$/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${MONTHS[Number(m[1]) - 1]} ${m[2]}`;
    m = t.match(/^([a-z]{3,9})\.?,?\s+(\d{4})$/i);
    if (m) { const i = MONTHS.findIndex((x) => m[1].toLowerCase().startsWith(x.toLowerCase())); if (i >= 0) return `${MONTHS[i]} ${m[2]}`; }
    return t;
  };
  const parts = String(s).split(/\s*(?:–|—|-|\bto\b)\s*/i).filter(Boolean);
  return parts.length === 2 ? `${one(parts[0])} – ${one(parts[1])}` : one(String(s));
}

/** Puts any resume (from the rules or from the AI) into the standard format: fixed order, titles, dates, clean skills. */
export function standardise(r) {
  const seen = new Set();
  const keep = (s) => {
    const key = ALIASES[s.toLowerCase()] || s.toLowerCase();
    if (!s || s.length > 60 || seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const clean = (s) => String(s).trim().replace(/\.$/, '');
  // Categorised skills ("Cloud Platforms: AWS, Azure") stay categorised; each skill appears once across all groups.
  const skillGroups = (r.skillGroups || [])
    .map((g) => ({ name: clean(g.name).replace(/:$/, ''), items: (g.items || []).map(clean).filter(keep) }))
    .filter((g) => g.name && g.items.length).slice(0, 8);
  const skills = skillGroups.length ? skillGroups.flatMap((g) => g.items) : (r.skills || []).map(clean).filter(keep).slice(0, 30);
  const sections = (r.sections || [])
    .map((s) => ({
      title: STANDARD_TITLE(s.title || ''),
      items: (s.items || []).map((it) => ({
        heading: String(it.heading || '').trim(), subheading: String(it.subheading || '').trim(), dates: normaliseDates(it.dates),
        bullets: (it.bullets || []).map((b) => String(b).replace(/^[•\-–*▪●◦·]\s*/, '').trim()).filter(Boolean),
      })).filter((it) => it.heading || it.bullets.length),
    }))
    .filter((s) => s.items.length);
  // Merge duplicate sections (e.g. "Work Experience" and "Experience").
  const merged = [];
  for (const s of sections) { const m = merged.find((x) => x.title === s.title); if (m) m.items.push(...s.items); else merged.push(s); }
  const rank = (t) => { const i = SECTION_ORDER.indexOf(t); return i < 0 ? SECTION_ORDER.length : i; };
  merged.sort((a, b) => rank(a.title) - rank(b.title));
  return {
    name: String(r.name || '').trim(), headline: String(r.headline || '').trim(),
    contact: [...new Set((r.contact || []).map((c) => String(c).trim()).filter(Boolean))],
    summary: String(r.summary || '').replace(/\s+/g, ' ').trim(), skills, skillGroups, sections: merged,
  };
}

// ---------------------------------------------------------------------------
// Evidence: a tailored resume may only claim what the candidate's own resume, profile or confirmation supports
// ---------------------------------------------------------------------------

/** Every known skill the candidate has evidence for. */
const evidencedSkills = (evidence) => ALL_TERMS.filter((t) => textHas(evidence, t));

/**
 * Removes anything the evidence doesn't support: skills, summary sentences, headline and bullets that claim a known
 * skill the candidate never mentioned. Returns the list of removed claims.
 */
function enforceEvidence(r, evidence, originalText) {
  const unsupported = (text) => ALL_TERMS.filter((t) => textHas(text, t) && !textHas(evidence, t) && !SOFT.has(t));
  const removed = new Set();
  const supportedSkill = (s) => { const bad = unsupported(s); bad.forEach((b) => removed.add(b)); return !bad.length; };
  r.skills = r.skills.filter(supportedSkill);
  r.skillGroups = (r.skillGroups || []).map((g) => ({ ...g, items: g.items.filter(supportedSkill) })).filter((g) => g.items.length);
  const sentences = r.summary.split(/(?<=[.!?])\s+/);
  r.summary = sentences.filter((s) => { const bad = unsupported(s); bad.forEach((b) => removed.add(b)); return !bad.length; }).join(' ');
  if (unsupported(r.headline).length) { unsupported(r.headline).forEach((b) => removed.add(b)); r.headline = ''; }
  const original = originalText.toLowerCase().replace(/\s+/g, ' ');
  for (const s of r.sections) {
    for (const it of s.items) {
      it.bullets = it.bullets.filter((b) => {
        const bad = unsupported(b);
        if (!bad.length || original.includes(b.toLowerCase().replace(/\s+/g, ' '))) return true;
        bad.forEach((x) => removed.add(x));
        return false;
      });
    }
  }
  return [...removed];
}

/** Does the candidate's background fit the job title well enough to use it as their headline? */
function titleFits(job, ownTitles) {
  const want = titleWords(cleanJobTitle(job));
  if (!want.length) return false;
  const have = new Set(ownTitles.flatMap(titleWords));
  return want.filter((w) => have.has(w)).length / want.length >= 0.5;
}

/**
 * Rule-based tailoring (no AI). Uses only the candidate's own material:
 * - every skill the job asks for that appears anywhere in the resume or profile goes into Skills, in the job's wording;
 * - skills mentioned only in bullet points are surfaced in the Skills section;
 * - the summary leads with the target role and the matching skills;
 * - the most relevant bullets come first in each role.
 */
/** "Data Engineer II, AWS Analytics Engineering" → "Data Engineer": the role itself, without team names and level numbers. */
export function roleTitle(job) {
  return cleanJobTitle(job).split(/\s*[,(]|\s+[-–—|]\s+/)[0].replace(/\s+\b(i{1,3}|iv|v|\d)\b$/i, '').trim() || cleanJobTitle(job);
}

// How a professional summary describes the work, by role family.
const FAMILY_WORK = {
  'data-engineer': 'designing, building and operating production data pipelines and cloud data platforms',
  'software-engineer': 'designing, building and shipping reliable, scalable software',
  'data-scientist': 'building models and turning data into measurable business decisions',
  'ml-engineer': 'building, deploying and scaling machine learning systems in production',
  'data-analyst': 'turning complex data into clear insights, dashboards and decisions',
  'devops-engineer': 'automating infrastructure, CI/CD and reliable cloud operations',
  'qa-engineer': 'building test automation and keeping releases high quality',
  'security-engineer': 'protecting systems, data and cloud infrastructure',
  'product-manager': 'leading products from discovery to launch with measurable outcomes',
};

/**
 * Rule-based tailoring (no AI), the way a professional resume writer tailors for an ATS, using only the candidate's
 * own material:
 * - headline: the target role plus the four strongest matching skills, e.g. "Data Engineer | Spark • Python • AWS • Snowflake";
 * - summary: a role- and job-specific opening line, then the candidate's own summary (its generic first line replaced);
 * - skills: the candidate's own categories kept, the most relevant category first and matching skills first in each; skills
 *   that appear only in experience bullets are surfaced; the job's exact wording is used for matching skills;
 * - experience: the bullets that mention what the job screens for come first in every role.
 */
function tailorWithoutAI({ resumeText, profile, user, job, evidence, confirmed }) {
  const base = parseResume(resumeText, profile, user);
  const detected = detectResumeProfile(resumeText, profile);
  const { hard, soft } = jobKeywords(job);
  const have = new Set(evidencedSkills(evidence));
  const relevantHard = hard.filter((k) => have.has(k));
  const relevantSoft = soft.filter((k) => have.has(k));
  const isRelevant = (s) => [...relevantHard, ...relevantSoft].some((k) => textHas(s, k));
  const relevance = (s) => relevantHard.filter((k) => textHas(s, k)).length;

  // Skills: keep the candidate's categories; reorder by what this job asks for.
  const listed = (s) => base.skills.some((x) => textHas(x, s)) || textHas(csv(profile.skills).join(', '), s);
  const surfaced = relevantHard.filter((k) => !listed(k));
  if (base.skillGroups.length) {
    for (const g of base.skillGroups) g.items.sort((a, b) => relevance(b) - relevance(a));
    base.skillGroups.sort((a, b) => b.items.filter(isRelevant).length - a.items.filter(isRelevant).length);
    // The job's own wording first, so the ATS finds the exact term ("Data Modeling" for star-schema work, "ETL Pipelines"…).
    const extra = [...surfaced.map(pretty), ...csv(profile.skills).filter((s) => !base.skills.some((x) => x.toLowerCase() === s.toLowerCase()))];
    if (extra.length) base.skillGroups.unshift({ name: 'Core Skills for This Role', items: extra });
  } else {
    const otherEvidence = HARD_SKILLS.filter((t) => have.has(t) && !relevantHard.includes(t)).map(pretty);
    base.skills = [...relevantHard.map(pretty), ...base.skills, ...csv(profile.skills), ...otherEvidence];
  }

  // Headline and summary.
  const ownTitles = [base.headline, profile.headline, ...csv(profile.titles), ...base.sections.flatMap((s) => s.items.map((it) => it.heading))];
  const fits = titleFits(job, ownTitles);
  const ownRole = (base.headline || profile.headline || detected.label || 'Professional').split(/\s*[|•]\s*/)[0].replace(/\b\w+/g, (w) => (w === w.toUpperCase() && w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w));
  const role = fits ? roleTitle(job) : ownRole;
  const top = relevantHard.slice(0, 4).map((k) => base.skills.find((s) => textHas(s, k) && s.length <= 24) || pretty(k));
  base.headline = top.length ? `${role} | ${top.join(' • ')}` : role;
  const years = detected.years ? `${detected.years}+ years of experience` : 'hands-on experience';
  const work = FAMILY_WORK[detected.family] || 'delivering high-impact results';
  const lead = relevantHard.slice(0, 6).map(pretty);
  const intro = `${role} with ${years} ${work}${lead.length ? `, with deep expertise in ${lead.slice(0, -1).join(', ')}${lead.length > 1 ? ' and ' : ''}${lead.at(-1)}` : ''}.`;
  const own = base.summary.split(/(?<=[.!?])\s+/);
  // The candidate's own "X with N years of experience…" opener is replaced by the tailored one; the rest is kept.
  const rest = (/\b\d+\+?\s*years?\b/i.test(own[0] || '') ? own.slice(1) : own).join(' ');
  const softLine = relevantSoft.length && !relevantSoft.every((s) => textHas(rest, s)) ? ` Recognized for ${relevantSoft.slice(0, 3).map((s) => (s === 'cross-functional' ? 'cross-functional collaboration' : s)).join(', ')}.` : '';
  base.summary = `${intro} ${rest}${softLine}`.trim();

  // Experience: most relevant bullets first.
  for (const s of base.sections) for (const it of s.items) it.bullets.sort((a, b) => relevance(b) - relevance(a));

  const changes = [
    fits ? `Headline set to the target role with your strongest matching skills: "${base.headline}".` : `Kept your own role in the headline: your past titles don't match "${cleanJobTitle(job)}" closely enough to claim it.`,
    `Summary opens with a ${detected.label ? detected.label.toLowerCase() : 'role'}-specific line naming ${lead.length ? `the skills this job screens for that you have (${lead.join(', ')})` : 'your experience'}; the rest of your own summary is kept.`,
    base.skillGroups.length ? 'Kept your skill categories, with the most relevant category and the matching skills first.' : 'Matching skills listed first in your Skills section.',
    ...(surfaced.length ? [`Surfaced skills you already show in your experience, in the job's wording: ${surfaced.map(pretty).join(', ')}.`] : []),
    ...(confirmed.length ? [`Added skills you confirmed you have: ${confirmed.map(pretty).join(', ')}.`] : []),
    'In every role, the bullets that match this job now come first.',
    'Standard ATS format: Summary, Skills, Experience, Projects, Education, Certifications; one column; one date style; no tables or graphics.',
  ];
  return { resume: base, changes };
}

// ---------------------------------------------------------------------------
// What the resume is: role family and seniority, used to find the jobs it can win
// ---------------------------------------------------------------------------

export const FAMILIES = [
  { key: 'data-engineer', label: 'Data Engineer', resume: /\b(data|etl|big data|databricks|analytics|data platform|data integration|data warehouse|bi) (engineer|developer)\b/i, job: '(data|etl|big data|databricks|analytics|data platform|data integration|data warehouse|data infrastructure|data pipeline) (engineer|developer)' },
  { key: 'ml-engineer', label: 'Machine Learning Engineer', resume: /\b(machine learning|ml|ai|mlops) engineer\b/i, job: '(machine learning|ml|ai|mlops|applied ai) engineer' },
  { key: 'data-scientist', label: 'Data Scientist', resume: /\bdata scien/i, job: 'data scien|applied scientist|research scientist' },
  { key: 'data-analyst', label: 'Data Analyst', resume: /\b(data|business|bi|reporting|business intelligence|analytics) analyst\b/i, job: '(data|business|bi|reporting|business intelligence|analytics|product) analyst' },
  { key: 'devops-engineer', label: 'DevOps Engineer', resume: /\b(devops|site reliability|sre|cloud|platform|infrastructure) engineer\b/i, job: '(devops|site reliability|sre|cloud|platform|infrastructure) engineer' },
  { key: 'security-engineer', label: 'Security Engineer', resume: /\b(security|cyber ?security|application security) (engineer|analyst)\b/i, job: '(security|cyber ?security|application security|cloud security) (engineer|analyst)' },
  { key: 'qa-engineer', label: 'QA Engineer', resume: /\b(qa|quality assurance|test|automation|sdet) (engineer|analyst)\b|\bsdet\b/i, job: '(qa|quality assurance|test|automation) (engineer|analyst)|sdet' },
  { key: 'software-engineer', label: 'Software Engineer', resume: /\b(software (engineer|developer)|back[- ]?end|front[- ]?end|full[- ]?stack|web developer|application developer|java developer|python developer|\.net developer|sde)\b/i, job: 'software (engineer|developer)|back[- ]?end|front[- ]?end|full[- ]?stack|web developer|application developer|(java|python|\\.net|node|react) developer|\\msde\\M' },
  { key: 'product-manager', label: 'Product Manager', resume: /\bproduct (manager|owner)\b/i, job: 'product (manager|owner)' },
];

export const LEVELS = ['Entry-level', 'Junior', 'Mid-level', 'Senior', 'Staff / Lead', 'Manager / Director'];
// Seniority signalled by a job title. Titles with no marker (and "II") are mid-level.
export const LEVEL_PATTERNS = [
  [5, /\b(manager|director|head of|vp|vice president|chief)\b/i],
  [4, /\b(staff|principal|lead|architect|distinguished)\b/i],
  [3, /\b(senior|sr\.?|iii)\b/i],
  [0, /\b(intern|internship|co-?op|apprentice|new grad|graduate|university)\b/i],
  [1, /\b(junior|jr\.?|associate|entry[- ]level|i)\b/i],
];
export const jobLevel = (title) => (LEVEL_PATTERNS.find(([, re]) => re.test(title)) || [2])[0];

/** Total months of experience from the resume's date ranges (overlaps counted once). */
function experienceMonths(text) {
  const monthIndex = (s) => {
    if (/present|current|now/i.test(s)) { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
    const y = Number(s.match(/(19|20)\d{2}/)?.[0]);
    if (!y) return null;
    const name = s.match(/[a-z]{3}/i)?.[0];
    const num = s.match(/^(\d{1,2})[/.]/)?.[1];
    const m = name ? MONTHS.findIndex((x) => x.toLowerCase() === name.toLowerCase()) : num ? Number(num) - 1 : 0;
    return y * 12 + Math.max(0, m);
  };
  const ranges = [];
  for (const line of String(text).split('\n')) {
    const d = line.match(DATES)?.[0];
    if (!d || /\b(bachelor|master|degree|university|college|b\.?tech|m\.?s|b\.?s|ph\.?d)\b/i.test(line)) continue;
    const [a, b] = d.split(/\s*(?:–|—|-|\bto\b)\s*/i);
    const start = monthIndex(a), end = monthIndex(b || '');
    if (start != null && end != null && end >= start) ranges.push([start, end]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  let total = 0, curStart = null, curEnd = null;
  for (const [s, e] of ranges) {
    if (curEnd == null || s > curEnd + 1) { if (curEnd != null) total += curEnd - curStart + 1; curStart = s; curEnd = e; } else curEnd = Math.max(curEnd, e);
  }
  if (curEnd != null) total += curEnd - curStart + 1;
  return total;
}

/**
 * What kind of professional the resume describes: { family, label, years, level, levelLabel, jobPattern }.
 * Role from the headline and job titles (most recent weighted most); years from the experience dates.
 */
export function detectResumeProfile(text = '', profile = {}) {
  const r = parseResume(text, profile, {});
  const titles = [r.headline, profile.headline, ...r.sections.filter((s) => s.title === 'Experience').flatMap((s) => s.items.map((it) => it.heading))].filter(Boolean);
  let best = null;
  for (const f of FAMILIES) {
    const score = titles.reduce((n, t, i) => n + (f.resume.test(t) ? (i < 2 ? 3 : 2) : 0), 0) + (f.resume.test(r.summary) ? 1 : 0);
    if (score && (!best || score > best.score)) best = { ...f, score };
  }
  const months = experienceMonths(text);
  const years = months ? Math.max(1, Math.floor(months / 12)) : Number(profile.experience_years) || 0;
  const level = years < 1 ? 0 : years < 3 ? 1 : years < 6 ? 2 : years < 9 ? 3 : 4;
  return { family: best?.key || null, label: best?.label || null, years, level, levelLabel: LEVELS[level], jobPattern: best?.job || null };
}

/**
 * Builds the ATS-optimised resume for one job, in the standard format, from the candidate's own evidence only.
 * Returns { resume, changes, before, after, ai, removed, gap }. `gap` explains what stands between the resume and the
 * 85% target when the candidate's real experience can't reach it.
 */
export async function tailorResume({ resumeText, profile, user, job, aiClient, model, confirmedSkills = [], learningSkills = [] }) {
  if (!resumeText || resumeText.trim().length < 50) throw userError('Upload your resume on the Profile page first.');
  const before = atsReport(resumeText, job);
  // Only skills this job actually asks for can be confirmed.
  const confirmed = confirmedSkills.map((s) => String(s).toLowerCase()).filter((s) => before.missing.includes(s));
  // Skills the candidate is actively learning: listed as such, never as skills they already have.
  const learning = learningSkills.map((s) => String(s).toLowerCase()).filter((s) => before.missing.includes(s) && !confirmed.includes(s));
  // The evidence: the resume itself, the skills on the user's profile, and skills they ticked as "I have this".
  const evidence = [resumeText, profile.skills, profile.headline, profile.titles, confirmed.join(', ')].filter(Boolean).join('\n');
  let result = null;
  let ai = false;
  if (aiClient) {
    try {
      result = await tailorWithAI({ resumeText, profile, user, job, evidence, confirmed, aiClient, model });
      ai = !!result;
    } catch (e) {
      console.error('[resume] AI tailoring failed, using rules:', e.message);
    }
  }
  result ||= tailorWithoutAI({ resumeText, profile, user, job, evidence, confirmed });
  result.resume = standardise(result.resume);
  const removed = enforceEvidence(result.resume, evidence, resumeText);
  if (learning.length) {
    // Shown openly as learning, in its own section: ATS software reads the keywords, and recruiters see the truth.
    result.resume.sections = result.resume.sections.filter((s) => s.title !== 'Professional Development');
    result.resume.sections.push({ title: 'Professional Development', items: [{ heading: 'Currently learning', subheading: '', dates: '', bullets: [learning.map(pretty).join(', ')] }] });
    result.changes.push(`Added a Professional Development section listing what you're currently learning: ${learning.map(pretty).join(', ')}. Be ready to talk about your progress in interviews.`);
  }
  if (removed.length) result.changes.push(`Removed ${removed.length} claim${removed.length === 1 ? '' : 's'} your resume doesn't support (${removed.map(pretty).join(', ')}).`);
  const after = atsReport(resumeToText(result.resume), job);
  const gap = after.score >= TARGET_SCORE ? null : {
    target: TARGET_SCORE,
    missing: after.missingHard.slice(0, 8),
    weakFit: after.score < 50,
    message: (after.score < 50 ? 'This role is a weak fit for your background, so an honest resume can\'t reach 85% here. Jobs closer to your experience will score much higher. ' : '')
      + (after.missingHard.length
        ? `This job screens for ${after.missingHard.length} skill${after.missingHard.length === 1 ? '' : 's'} your resume doesn't show. For each one, choose "I have it" if you do, or "Learning" if you're actively learning it (listed openly under Professional Development, which ATS software still counts), then tailor again.`
        : 'Add more detail and numbers to your experience bullets to strengthen the match.'),
  };
  return { ...result, before, after, ai, removed, gap };
}

async function tailorWithAI({ resumeText, profile, user, job, evidence, confirmed, aiClient, model }) {
  const { betaJSONSchemaOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/json-schema');
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['resume', 'changes'],
    properties: {
      resume: RESUME_SCHEMA,
      changes: { type: 'array', items: { type: 'string' }, description: 'Short list of what you changed and why' },
    },
  };
  const { hard, soft } = jobKeywords(job);
  const have = new Set(evidencedSkills(evidence));
  const supported = [...hard, ...soft].filter((k) => have.has(k));
  const unsupported = [...hard, ...soft].filter((k) => !have.has(k));
  const response = await aiClient.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaJSONSchemaOutputFormat(schema) },
    system: `You are an expert resume writer who tailors resumes for Applicant Tracking Systems (Workday, Greenhouse, Lever, Taleo, iCIMS).
Goal: an 85–95% ATS match for the target job, reached only through the candidate's real experience.

Use this standard ATS format, always:
- headline: the target job title if the candidate's experience fits it; otherwise their own current title.
- summary: 2–4 sentences, leading with the role, years of experience and the most relevant supported skills.
- skills: the supported job keywords first, written exactly as the job writes them, then the candidate's other relevant skills.
- sections, in this order and with these exact titles: "Experience", "Projects", "Education", "Certifications". For each item: heading (job title / degree / project), subheading (company or school, city), dates ("Jan 2021 – Present").
- bullets: start with a strong action verb, one or two lines each, keep every number and result the candidate gave, and work the supported keywords in naturally where the experience genuinely involved them. Most relevant bullets first.

Truthfulness rules (most important):
- Only use facts from the candidate's resume and profile. Never invent or inflate employers, titles, dates, degrees, certifications, numbers, responsibilities or skills.
- You may rephrase, reorder, combine and condense what is there, and use the job's terminology for things the candidate actually did.
- Never add any skill from the UNSUPPORTED list. If the match falls short of 85% because of them, say so in "changes" and name them.`,
    messages: [{
      role: 'user',
      content: `TARGET JOB: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ''}
SUPPORTED keywords (the candidate has evidence; feature them): ${supported.join(', ') || '(none)'}
UNSUPPORTED keywords (no evidence; never add): ${unsupported.join(', ') || '(none)'}

JOB DESCRIPTION:
${job.description || '(none provided)'}

CANDIDATE: ${user.name} <${user.email}>${profile.phone ? `, ${profile.phone}` : ''}${profile.linkedin ? `, ${profile.linkedin}` : ''}
Headline: ${profile.headline || '-'}; years of experience: ${profile.experience_years || '-'}; skills on profile: ${profile.skills || '-'}${confirmed.length ? `
The candidate confirms they also have: ${confirmed.join(', ')}` : ''}

CURRENT RESUME:
${resumeText}`,
    }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return response.parsed_output;
}

// ---------------------------------------------------------------------------
// Word (.docx) output: single column, standard fonts, real text and bullets, no tables, images or headers.
// ---------------------------------------------------------------------------

export async function resumeToDocx(r) {
  const FONT = 'Calibri';
  const heading = (text) => new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 24, font: FONT })],
  });
  const para = (text, opts = {}) => new Paragraph({ spacing: { after: 60 }, ...opts, children: [new TextRun({ text, size: 21, font: FONT })] });
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.name, bold: true, size: 36, font: FONT })] }),
  ];
  if (r.headline) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: r.headline, size: 24, font: FONT })] }));
  if (r.contact.length) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: r.contact.join('  |  '), size: 20, font: FONT })] }));
  if (r.summary) children.push(heading('Summary'), para(r.summary));
  if (r.skillGroups?.length) {
    // "Big Data & Processing: Spark, PySpark, Databricks": plain paragraphs with a bold label, which every ATS reads.
    children.push(heading('Skills'), ...r.skillGroups.map((g) => new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: `${g.name}: `, bold: true, size: 21, font: FONT }), new TextRun({ text: g.items.join(', '), size: 21, font: FONT }),
    ] })));
  } else if (r.skills.length) children.push(heading('Skills'), para(r.skills.join(', ')));
  for (const s of r.sections) {
    if (!s.items.length) continue;
    children.push(heading(s.title));
    for (const it of s.items) {
      const runs = [new TextRun({ text: it.heading, bold: true, size: 22, font: FONT })];
      if (it.subheading) runs.push(new TextRun({ text: `, ${it.subheading}`, size: 22, font: FONT }));
      if (it.dates) runs.push(new TextRun({ text: `  ${it.dates}`, size: 20, font: FONT, italics: true }));
      children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: runs }));
      for (const b of it.bullets) children.push(para(b, { numbering: { reference: 'bullets', level: 0 } }));
    }
  }
  const doc = new Document({
    creator: 'YoursJobMate',
    title: `${r.name} - Resume`,
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] }] },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 864, right: 864 } } }, children }],
  });
  return Packer.toBuffer(doc);
}
