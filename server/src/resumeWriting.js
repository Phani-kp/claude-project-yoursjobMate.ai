import { ALIASES, SOFT, textHas } from './resumeAnalysis.js';

const key = (skill) => ALIASES[String(skill).trim().toLowerCase()] || String(skill).trim().toLowerCase();
const categories = [
  ['Languages', /^(?:sql|python|javascript|typescript|java|c#|c\+\+|c|go|rust|ruby|php|kotlin|swift|scala|r|matlab|perl|bash|t-sql|pl\/sql)$/],
  ['Cloud and infrastructure', /\b(?:aws|azure|gcp|cloud|docker|kubernetes|terraform|linux|serverless|amazon s3|redshift|bigquery)\b/],
  ['Data and databases', /\b(?:data|etl|elt|sql|pandas|numpy|spark|airflow|dbt|kafka|snowflake|databricks|tableau|power bi|mongodb|redis|oracle|looker|hadoop|flink|prefect|dagster)\b/],
  ['Frameworks and libraries', /\b(?:react|angular|vue|svelte|next|node|express|django|flask|spring|tensorflow|pytorch|scikit-learn|\.net)\b/],
  ['Delivery and testing', /\b(?:git|ci\/cd|jenkins|devops|testing|test|jest|cypress|playwright|selenium|agile|scrum|jira|tdd)\b/],
];

/** Group supplied skills, without adding any new skill or changing an existing category. */
export function addWritingSkills(resume, additions) {
  const seen = new Set();
  const unique = (values) => values.map((value) => String(value).trim()).filter((value) => {
    const canonical = key(value);
    if (!value || seen.has(canonical)) return false;
    seen.add(canonical); return true;
  });
  const existingGroups = (resume.skillGroups || []).map((group) => ({ ...group, items: unique(group.items) })).filter((group) => group.items.length);
  const extra = unique([...(existingGroups.length ? [] : resume.skills || []), ...additions]);
  for (const skill of extra) {
    const canonical = key(skill);
    const name = SOFT.has(canonical) ? 'Collaboration and leadership'
      : categories.find(([, pattern]) => pattern.test(canonical))?.[0] || 'Additional skills';
    let group = existingGroups.find((current) => current.name.toLowerCase() === name.toLowerCase());
    if (!group) { group = { name, items: [] }; existingGroups.push(group); }
    group.items.push(skill);
  }
  resume.skillGroups = existingGroups;
  resume.skills = existingGroups.flatMap((group) => group.items);
}

/** A confirmed capability is enough for a skill summary, without claiming an employer or achievement. */
export function includeSummarySkills(resume, supported, pretty = (skill) => skill) {
  const missing = [...new Set(supported)].filter((skill) => !textHas(resume.summary, skill)).slice(0, 6);
  if (missing.length) resume.summary = `${resume.summary} Skills include ${missing.map(pretty).join(', ')}.`.trim();
}
