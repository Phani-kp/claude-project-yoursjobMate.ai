// Pure requirement extraction and resume scoring. No database or provider dependencies.
export const HARD_SKILLS = [
  // Software
  'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'c', 'go', 'rust', 'ruby', 'php', 'kotlin', 'swift', 'scala', 'r', 'matlab', 'perl', 'objective-c', 'dart', 'elixir',
  'react', 'react native', 'next.js', 'vue', 'angular', 'svelte', 'redux', 'html', 'css', 'sass', 'tailwind', 'webpack', 'vite', 'flutter', 'android', 'ios',
  'node.js', 'express', 'nestjs', 'django', 'flask', 'fastapi', 'spring', 'spring boot', '.net', 'asp.net', 'rails', 'laravel',
  'graphql', 'rest api', 'restful', 'grpc', 'microservices', 'websockets', 'kafka', 'rabbitmq', 'distributed systems', 'system design',
  'sql', 'postgresql', 'mysql', 'sql server', 'oracle', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'cassandra', 'snowflake', 'bigquery', 'databricks', 'redshift',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'github actions', 'linux', 'bash', 'shell scripting', 'networking',
  'git', 'jira', 'agile', 'scrum', 'kanban', 'tdd', 'unit testing', 'integration testing', 'regression testing', 'jest', 'cypress', 'playwright', 'selenium', 'qa automation',
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
// This app's heuristic weights soft skills less than hard skills.
const SOFT_SKILLS = [
  'communication', 'leadership', 'mentoring', 'problem solving', 'collaboration', 'teamwork', 'cross-functional', 'ownership', 'attention to detail',
  'time management', 'critical thinking', 'adaptability', 'decision making', 'presentation', 'customer focus', 'analytical',
];
export const ALIASES = {
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
  'google bigquery': 'bigquery', 'ms sql server': 'sql server', 'microsoft sql server': 'sql server', 'mssql': 'sql server', 'unit tests': 'unit testing',
};
// Dimensional / star-schema design is data modeling, and these imply their broader skill too.
const IMPLIES = {
  'star schema': ['data modeling', 'dimensional modeling'], 'dimensional modeling': ['data modeling'], pyspark: ['spark', 'python'], 'spark sql': ['spark', 'sql'],
  'azure data factory': ['azure'], 'azure synapse': ['azure', 'data warehousing'], 'azure databricks': ['databricks', 'azure'], 'aws glue': ['aws'], 'aws emr': ['aws'],
  'aws lambda': ['aws', 'serverless'], 'amazon s3': ['aws'], redshift: ['aws', 'data warehousing'], snowflake: ['data warehousing'], 'delta lake': ['data lake', 'lakehouse'],
  't-sql': ['sql'], 'pl/sql': ['sql'], 'sql server': ['sql'], postgresql: ['sql'], mysql: ['sql'], cassandra: ['nosql'], mongodb: ['nosql'], dynamodb: ['nosql', 'aws'],
  yugabyte: ['sql', 'distributed systems'], dbt: ['elt', 'data modeling'], 'etl pipelines': ['etl', 'data pipelines'], 'github actions': ['ci/cd'], jenkins: ['ci/cd'], 'azure devops': ['ci/cd'],
};

export const SOFT = new Set(SOFT_SKILLS);
export const ALL_TERMS = [...new Set([...HARD_SKILLS, ...SOFT_SKILLS])];
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const csv = (value) => (Array.isArray(value) ? value : String(value || '').split(',')).map((v) => String(v).trim()).filter(Boolean);
const AMBIGUOUS = new Set(['go', 'r', 'c', 'rf', 'cam', 'epic', 'workday', 'sem']);
const RE_CACHE = new Map();
const termRe = (term) => {
  if (!RE_CACHE.has(term)) RE_CACHE.set(term, new RegExp(`(^|[^a-z0-9+#.])${escapeRe(term)}(?=$|[^a-z0-9+#&]|\\.(?![a-z0-9]))`, 'i'));
  return RE_CACHE.get(term);
};
const ALIASES_OF = {};
for (const [alias, term] of Object.entries(ALIASES)) (ALIASES_OF[term] ||= []).push(alias);
const IMPLIED_BY = {};
for (const [specific, broader] of Object.entries(IMPLIES)) for (const term of broader) (IMPLIED_BY[term] ||= []).push(specific);
const SEMANTIC = {
  etl: /\bextract(?:ed|ing|ion)?\b[^\n.!?]{0,160}\btransform(?:ed|ing|ation)?\b[^\n.!?]{0,160}\bload(?:ed|ing)?\b/i,
  // Moving records between databases through explicitly built data jobs is a
  // pipeline. Scheduling unrelated work or merely studying it is not evidence.
  'data pipelines': /\b(?:built|implemented|created|developed|delivered)\b[^\n.!?]{0,70}\b(?:data|sql|etl)\b[^\n.!?]{0,50}\b(?:jobs?|workflows?)\b[^\n.!?]{0,70}\b(?:mov(?:e|ed|ing)|transfer(?:red|ring)?)\b[^\n.!?]{0,35}\b(?:records?|data)\b[^\n.!?]{0,35}\b(?:between\s+(?:\w+\s+){0,3}(?:databases?|warehouses?)|from\s+(?:\w+\s+){0,3}(?:databases?|warehouses?)\s+to\s+(?:\w+\s+){0,3}(?:databases?|warehouses?))\b/i,
  'data visualization': /\b(?:built|created|designed|developed|produced)\b[^\n.!?]{0,100}\b(?:charts?|graphs?|data visuali[sz]ations?)\b|\b(?:built|created|designed|developed)\b[^\n.!?]{0,80}\bdashboards?\b[^\n.!?]{0,100}\b(?:charts?|graphs?|visuali[sz](?:e|ation|ations)|metrics|kpis?)\b/i,
};
export const hasTerm = (text, term) => [term, ...(ALIASES_OF[term] || [])].some((value) => termRe(value).test(String(text || '')));
const listedTerm = (text, term) => new RegExp(`(?:^|[,;/|•(:]\\s*)${escapeRe(term)}\\s*(?=[,;/|•)]|$)`, 'im').test(text);
function directMatch(text, term) {
  const alias = (ALIASES_OF[term] || []).some((word) => termRe(word).test(text));
  if (AMBIGUOUS.has(term)) {
    return alias || listedTerm(text, term) || new RegExp(`\\b(?:programming(?: language)?|coding|proficien(?:t|cy) in|experience with|written in|developed in)\\s+${escapeRe(term)}(?=$|[^a-z0-9+#])`, 'i').test(text);
  }
  return hasTerm(text, term) || Boolean(SEMANTIC[term]?.test(text));
}
export const directHas = (value, term) => directMatch(claimText(value), term);
/** Explicit wording, conservative equivalent descriptions, or a specific skill that entails a broader one. */
export const textHas = (text, term) => directHas(text, term) || (IMPLIED_BY[term] || []).some((specific) => directHas(text, specific));

const TITLE_STOP = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'i', 'ii', 'iii', 'iv', 'v', 'and', 'of', 'the', 'for', 'to', 'a', 'an', 'with', 'in', 'at', 'remote', 'hybrid', 'us', 'usa', 'new', 'grad']);
export const titleWords = (title) => String(title || '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9+#.]+/).filter((word) => word.length > 1 && !TITLE_STOP.has(word) && !/^\d+$/.test(word));
const SECTION_NAMES = {
  summary: /^(professional\s+)?(summary|profile|objective|about( me)?)$/i,
  experience: /^(work\s+|professional\s+|relevant\s+)?(experience|employment( history)?|work history)$/i,
  education: /^(education|academic background|qualifications)$/i,
  skills: /^(technical\s+|key\s+|core\s+)?(skills|competencies|technologies|tech stack)$/i,
  projects: /^(personal\s+|key\s+|selected\s+)?projects$/i,
  certifications: /^(certifications?|licenses?( (and|&) certifications)?|courses)$/i,
  learning: /^(?:(?:currently\s+)?learning(?: goals| only)?|professional development(?:\s*\(.*\))?|skills in development|training in progress)$/i,
};
export const sectionOf = (line) => {
  const clean = String(line || '').replace(/^\s*#{1,6}\s*/, '').replace(/[:\s]+$/, '').trim();
  if (clean.length > 70) return null;
  return Object.keys(SECTION_NAMES).find((key) => SECTION_NAMES[key].test(clean)) || null;
};
function splitLearning(text) {
  const proficiency = [], learning = [];
  let inLearning = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    const inline = line.match(/^\s*(?:#{1,6}\s*)?(?:learning(?: goals| only)?|currently learning|professional development(?:\s*\([^)]*\))?|skills in development|training in progress)\s*:\s*(.*)$/i);
    const kind = sectionOf(line);
    if (inline || kind === 'learning') {
      inLearning = true;
      if (inline?.[1]) learning.push(inline[1]);
      continue;
    }
    if (kind || /^\s*#{1,6}\s+/.test(line)) inLearning = false;
    if (/\b(?:currently learning|currently studying|learning in progress)\b/i.test(line)) learning.push(line);
    else (inLearning ? learning : proficiency).push(line);
  }
  return { proficiency: proficiency.join('\n'), learning: learning.join('\n') };
}
export const proficiencyText = (text) => splitLearning(text).proficiency;

const CLAIM_CACHE = new Map();
const NEGATIVE_CLAIM = /\bno\b[^\n.!?]{0,60}\b(?:experience|knowledge|proficiency|exposure|expertise)\b|\b(?:not|never)\s+(?:yet\s+)?(?:used|worked|built|developed|experienced|proficient|familiar|skilled)\b|\b(?:not|no)\s+(?:required|necessary|needed|expected)\b|\b(?:without|lack(?:ing|s)?)\s+(?:experience|knowledge|proficiency|exposure)\b|\bunfamiliar with\b|\b(?:do not|don't)\s+(?:know|use|have)\b|^\s*(?:no|not(?!\s+only))\s+|:\s*(?:none|not yet)\b/i;
const LEARNING_CLAIM = /\b(?:currently|actively|presently)\s+(?:learning|studying)\b|\b(?:plan(?:ning)?|intend|hoping|want|eager)\s+to\s+(?:learn|study)\b|^\s*(?:learning|studying)\b|\b(?:course|training)\b[^\n.!?]{0,50}\bin progress\b/i;
function claimText(value) {
  const original = String(value || '');
  if (CLAIM_CACHE.has(original)) return CLAIM_CACHE.get(original);
  const result = proficiencyText(original).split(/\n+|;|(?<=[.!?])\s+|\bbut\b|\bhowever\b/i)
    .filter((clause) => !NEGATIVE_CLAIM.test(clause) && !LEARNING_CLAIM.test(clause)).join('\n');
  if (CLAIM_CACHE.size >= 256) CLAIM_CACHE.delete(CLAIM_CACHE.keys().next().value);
  CLAIM_CACHE.set(original, result);
  return result;
}

function descriptionText(value) {
  return String(value || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*\/?\s*>|<\/?h[1-6]\b[^>]*>|<\/?(?:p|div|section|ul|ol|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt|ndash|mdash|bull);|&#(?:x[a-f\d]+|\d+);/gi, (entity) => {
      const named = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&ndash;': '–', '&mdash;': '—', '&bull;': '•' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code = entity.slice(2, -1);
      const point = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number(code);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    })
    .replace(/\r/g, '')
    .replace(/\b((?:required|preferred|desired|nice[- ]to[- ]have|bonus)(?:\s+(?:skills|qualifications|experience))?|requirements?|qualifications?|benefits?|compensation|salary|perks|responsibilities|about (?:us|the company|the team))\s*:/gi, '\n$1:');
}
const REQUIRED_HEADING = /^(?:(?:(?:basic|minimum|required|essential|mandatory)\s+)?(?:qualifications?|requirements?|skills(?: and (?:experience|qualifications))?|experience)|required|mandatory|essential|what (?:you(?:'|’)ll|you will) (?:bring|need)|what we(?:'re| are) looking for|who you are|about you|must[- ]haves?)$/i;
const PREFERRED_HEADING = /^(?:preferred|desired|additional|bonus|nice[- ]to[- ]have)(?:\s+(?:qualifications?|requirements?|skills|experience|points))?$|^bonus points$/i;
const IGNORED_HEADING = /^(?:about (?:us|the company|the team)|who we are|benefits?|compensation|salary|perks|our (?:company|team|mission|values|culture)|why (?:join|work)|we offer|what we offer|life at\b|equal (?:employment )?opportunity)/i;
const ROLE_HEADING = /^(?:responsibilities|duties|what you(?:'|’)ll do|what you will do|the role|about the role|your impact|your responsibilities)$/i;
const BOILERPLATE = /recruiting partner|equal (?:employment )?opportunity|reasonable accommodation|e-verify|background check|veteran status|protected (?:class|characteristic)|pay transparency|base pay|salary range|privacy (?:notice|policy)|by applying|benefits include|401\(k\)|medical,? dental|disability accommodations?/i;
const BACKGROUND = /^\s*(?:we are (?:a|an|the|committed|proud)|we build\b|our (?:company|team|mission|platform|product)\b|founded in\b)/i;
const priorityRank = { required: 3, preferred: 2, unspecified: 1 };
function linePriority(text, fallback) {
  if (/\b(?:preferred|nice[- ]to[- ]have|bonus|desired|a plus|advantageous)\b/i.test(text)) return 'preferred';
  if (/\b(?:required|must(?: have| possess| demonstrate)?|mandatory|essential|minimum qualifications?)\b/i.test(text)) return 'required';
  return fallback;
}
function descriptionClauses(description) {
  const clauses = [];
  let priority = 'unspecified';
  let ignored = false;
  for (const raw of descriptionText(description).split(/\n+/)) {
    const line = raw.replace(/^\s*(?:[-*•▪]\s*|#{1,6}\s*)/, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    const label = (colon >= 0 ? line.slice(0, colon) : line).trim();
    const shortHeading = label.length < 110 && (colon >= 0 || line.length < 110);
    let nextPriority;
    if (shortHeading && PREFERRED_HEADING.test(label)) nextPriority = 'preferred';
    else if (shortHeading && REQUIRED_HEADING.test(label) && !/[.;]/.test(label)) nextPriority = 'required';
    else if (shortHeading && ROLE_HEADING.test(label)) nextPriority = 'unspecified';
    if (nextPriority) {
      priority = nextPriority;
      ignored = false;
      if (colon < 0) continue;
    } else if (shortHeading && IGNORED_HEADING.test(label)) {
      ignored = true;
      continue;
    }
    const content = nextPriority && colon >= 0 ? line.slice(colon + 1).trim() : line;
    if (!content || ignored || BOILERPLATE.test(content) || BACKGROUND.test(content)) continue;
    for (const text of content.replace(/\b(required|preferred|desired)\s*,\s*/gi, '$1; ').split(/;|(?<=[.!?])\s+(?=[A-Z])|\bbut\b|\bhowever\b/)) {
      if (text.trim() && !BOILERPLATE.test(text)) clauses.push({ source: text.trim().slice(0, 1000), priority: linePriority(text, priority) });
    }
  }
  return clauses;
}
export function requirementsText(description = '') {
  return descriptionClauses(description).filter((clause) => clause.priority !== 'unspecified').map((clause) => clause.source).join('\n');
}

function occurrences(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const term of ALL_TERMS) {
    const forms = [term, ...(ALIASES_OF[term] || [])];
    if (!forms.some((form) => lower.includes(form)) && !SEMANTIC[term]) continue;
    if (!directHas(text, term)) continue;
    let explicit = false;
    for (const form of forms) {
      const re = new RegExp(termRe(form).source, 'gi');
      for (const match of text.matchAll(re)) {
        const start = match.index + match[1].length;
        found.push({ term, start, end: start + form.length });
        explicit = true;
      }
    }
    if (!explicit && SEMANTIC[term]) {
      const match = SEMANTIC[term].exec(text);
      if (match) found.push({ term, start: match.index, end: match.index + match[0].length, semantic: true });
    }
  }
  const byPosition = new Map();
  for (const item of found) {
    const key = `${item.term}:${item.start}`;
    if (!byPosition.has(key) || byPosition.get(key).end < item.end) byPosition.set(key, item);
  }
  const unique = [...byPosition.values()];
  return unique.filter((item) => !unique.some((other) => !other.semantic && other.term !== item.term && other.start <= item.start && other.end >= item.end && other.end - other.start > item.end - item.start))
    .sort((left, right) => left.start - right.start || right.end - left.end);
}
function clauseGroups(clause) {
  const hits = occurrences(clause.source);
  const parents = hits.map((_, index) => index);
  const root = (index) => parents[index] === index ? index : (parents[index] = root(parents[index]));
  const join = (left, right) => { if (SOFT.has(hits[left].term) === SOFT.has(hits[right].term)) parents[root(right)] = root(left); };
  for (let index = 1; index < hits.length; index++) {
    const bridge = clause.source.slice(hits[index - 1].end, hits[index].start);
    if (/^\s*,?\s*(?:or|and\/or)\s*$/i.test(bridge)) {
      join(index - 1, index);
      if (/^\s*,/.test(bridge) || /\b(?:one of|either)\b/i.test(clause.source.slice(0, hits[index - 1].start))) {
        for (let previous = index - 1; previous > 0; previous--) {
          if (!/^\s*,\s*$/.test(clause.source.slice(hits[previous - 1].end, hits[previous].start))) break;
          join(previous - 1, previous);
        }
      }
    }
  }
  const grouped = new Map();
  hits.forEach((hit, index) => {
    const id = root(index);
    if (!grouped.has(id)) grouped.set(id, []);
    if (!grouped.get(id).includes(hit.term)) grouped.get(id).push(hit.term);
  });
  return [...grouped.values()].map((terms) => ({ terms, kind: SOFT.has(terms[0]) ? 'soft' : 'hard', priority: clause.priority, source: clause.source }));
}

const KEYWORD_CACHE = new Map();
export function jobKeywords(job = {}) {
  // Include actual source contents: identical lengths and shared IDs can still
  // describe different requirements. Keep this cache bounded during job syncs.
  const cacheKey = JSON.stringify([job.title || '', job.tags || '', job.description || '']);
  if (KEYWORD_CACHE.has(cacheKey)) return KEYWORD_CACHE.get(cacheKey);
  const groups = descriptionClauses(job.description).flatMap(clauseGroups);
  const described = new Set(groups.flatMap((group) => group.terms));
  for (const source of [String(job.title || ''), ...csv(job.tags)]) {
    for (const group of clauseGroups({ source, priority: 'unspecified' })) {
      group.terms = group.terms.filter((term) => !described.has(term));
      if (group.terms.length) groups.push(group);
    }
  }
  const distinct = new Map();
  for (const group of groups) {
    const id = `${group.kind}:${[...group.terms].sort().join('|')}`;
    const previous = distinct.get(id);
    if (!previous || priorityRank[group.priority] > priorityRank[previous.priority]) distinct.set(id, { id, ...group });
  }
  const ranked = [...distinct.values()].sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]);
  const hardGroups = ranked.filter((group) => group.kind === 'hard').slice(0, 25);
  const softGroups = ranked.filter((group) => group.kind === 'soft').slice(0, 6);
  const requirements = Object.freeze([...hardGroups, ...softGroups].map((group) => Object.freeze({ ...group, terms: Object.freeze([...group.terms]) })));
  const result = Object.freeze({
    hard: Object.freeze([...new Set(hardGroups.flatMap((group) => group.terms))]),
    soft: Object.freeze([...new Set(softGroups.flatMap((group) => group.terms))]),
    requirements,
  });
  if (KEYWORD_CACHE.size >= 2000) KEYWORD_CACHE.delete(KEYWORD_CACHE.keys().next().value);
  KEYWORD_CACHE.set(cacheKey, result);
  return result;
}

export const TARGET_SCORE = 85;
/** Heuristic matching, not an employer's proprietary ATS score or a hiring guarantee. */
export function atsReport(resumeText, job) {
  const text = String(resumeText || '');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sections = new Set(lines.map(sectionOf).filter(Boolean));
  const words = text.split(/\s+/).filter(Boolean).length;
  const separated = splitLearning(text);
  const evidence = separated.proficiency;
  const learningTerms = ALL_TERMS.filter((term) => directMatch(separated.learning, term)
    || (IMPLIED_BY[term] || []).some((specific) => directMatch(separated.learning, specific)));
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
  if (!job) return { checks, words, learningTerms };
  const { hard, soft, requirements: groups } = jobKeywords(job);
  const requirements = groups.map((group) => {
    const matchedTerms = group.terms.filter((term) => textHas(evidence, term));
    return { ...group, matchedTerms, status: matchedTerms.length ? 'matched' : 'missing' };
  });
  const hardGroups = requirements.filter((group) => group.kind === 'hard');
  const softGroups = requirements.filter((group) => group.kind === 'soft');
  const hardHit = hard.filter((term) => textHas(evidence, term));
  const softHit = soft.filter((term) => textHas(evidence, term));
  const tWords = titleWords(job.title);
  const lower = evidence.toLowerCase();
  const titleHit = tWords.filter((word) => new RegExp(`\\b${escapeRe(word)}(?=$|[^a-z0-9])`, 'i').test(lower));
  const parts = {
    hardSkills: { weight: 55, matched: hardGroups.filter((group) => group.status === 'matched').length, total: hardGroups.length },
    title: { weight: 15, matched: titleHit.length, total: tWords.length },
    softSkills: { weight: 10, matched: softGroups.filter((group) => group.status === 'matched').length, total: softGroups.length },
    format: { weight: 20, matched: checks.filter((check) => check.ok).length, total: checks.length },
  };
  const used = Object.values(parts).filter((part) => part.total > 0);
  const totalWeight = used.reduce((sum, part) => sum + part.weight, 0);
  const score = Math.round(used.reduce((sum, part) => sum + part.weight / totalWeight * part.matched / part.total, 0) * 100);
  const missingHard = [...new Set(hardGroups.filter((group) => group.status === 'missing').flatMap((group) => group.terms))];
  const missingSoft = [...new Set(softGroups.filter((group) => group.status === 'missing').flatMap((group) => group.terms))];
  return { score, matched: [...hardHit, ...softHit], missing: [...missingHard, ...missingSoft], missingHard, requirements, learningTerms, breakdown: parts, checks, words };
}

