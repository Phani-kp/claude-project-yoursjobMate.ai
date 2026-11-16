import { ALIASES, SOFT, hasTerm, textHas } from './resumeAnalysis.js';

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

/**
 * Keeps the candidate's own skill categories, names, order and wording, and files each added skill under the
 * existing category that already holds the most skills of the same kind. No category is created, renamed or reordered.
 */
export function addToOwnSkillGroups(resume, ownGroups, additions, resumeText = '') {
  const groups = ownGroups.map((group) => ({ ...group, items: [...group.items] }));
  // A term the resume already spells out anywhere needs no extra Skills entry.
  const written = `${groups.map((group) => `${group.text || ''}\n${group.items.join('\n')}`).join('\n')}\n${resumeText}`.toLowerCase();
  const seen = new Set(groups.flatMap((group) => group.items.map(key)));
  const kindOf = (skill) => (SOFT.has(key(skill)) ? 'soft' : categories.find(([, pattern]) => pattern.test(key(skill)))?.[0] || null);
  for (const skill of additions.map((value) => String(value).trim()).filter(Boolean)) {
    const canonical = key(skill);
    // Already there in the candidate's own words ("REST APIs" for "REST API", "Glue" for "AWS Glue").
    // Whole terms only: "ELT" is not already there just because "Delta Lake" contains those letters.
    if (seen.has(canonical) || hasTerm(written, canonical) || hasTerm(written, skill.toLowerCase())) continue;
    seen.add(canonical);
    const kind = kindOf(skill);
    const fit = (group) => (kind === 'soft'
      ? group.items.filter((item) => SOFT.has(key(item))).length + (/collab|leader|soft|deliver|people|team/i.test(group.name) ? 2 : 0)
      : kind ? group.items.filter((item) => kindOf(item) === kind).length : 0);
    const best = groups.reduce((top, group) => (fit(group) > fit(top) ? group : top), groups.at(-1));
    best.items.push(skill);
  }
  resume.skillGroups = groups;
  resume.skills = groups.flatMap((group) => group.items);
}

/** A confirmed capability is enough for a skill summary, without claiming an employer or achievement. */
export function includeSummarySkills(resume, supported, pretty = (skill) => skill) {
  const missing = [...new Set(supported)].filter((skill) => !textHas(resume.summary, skill)).slice(0, 6);
  if (missing.length) resume.summary = `${resume.summary} Skills include ${missing.map(pretty).join(', ')}.`.trim();
}
