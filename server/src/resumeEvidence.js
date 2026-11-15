import { ALL_TERMS, ALIASES, jobKeywords, proficiencyText, textHas } from './resumeAnalysis.js';
import { normalizeExperienceEntries } from './resumeExperience.js';

const normal = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const canonical = (s) => ALIASES[normal(s)] || normal(s);
const termsIn = (s) => ALL_TERMS.filter((term) => textHas(s, term));
const numbers = (s) => String(s).match(/\b\d+(?:[.,]\d+)*(?:\s*%|\+|x\b)?/gi) || [];
const tokens = (s) => new Set(normal(s).match(/[a-z][a-z0-9+#]{2,}/g) || []);
const actionFamilies = [
  ['built', 'build', 'building', 'created', 'create', 'creating', 'developed', 'develop', 'developing', 'implemented', 'implement', 'implementing', 'delivered', 'deliver', 'delivering'],
  ['maintained', 'maintain', 'maintaining', 'supported', 'support', 'supporting', 'operated', 'operate', 'operating'],
  ['designed', 'design', 'designing', 'architected', 'architect', 'architecting'],
  ['reduced', 'reduce', 'reducing', 'cut', 'decreased', 'decrease', 'decreasing', 'lowered', 'lower', 'lowering', 'saved', 'save', 'saving'],
  ['increased', 'increase', 'increasing', 'grew', 'grow', 'growing', 'raised', 'raise', 'raising'],
  ['wrote', 'write', 'writing', 'authored', 'author', 'authoring'],
  ['process', 'processed', 'processing'],
  ['clean', 'cleaned', 'cleaning'],
  ['validate', 'validated', 'validating'],
];
const frameActions = [
  ...actionFamilies,
  ['move', 'moved', 'moving', 'transfer', 'transferred', 'transferring'],
  ['extract', 'extracted', 'extracting', 'extraction'],
  ['transform', 'transformed', 'transforming', 'transformation'],
  ['load', 'loaded', 'loading'],
  ['review', 'reviewed', 'reviewing'],
  ['document', 'documented', 'documenting'],
  ['deploy', 'deployed', 'deploying', 'deployment', 'deployments'],
  ['lead', 'led', 'leading', 'leadership'],
  ['manage', 'managed', 'managing', 'management'],
  ['automate', 'automated', 'automating', 'automation'],
  ['schedule', 'scheduled', 'scheduling'],
];
const actionOf = new Map(frameActions.flatMap((family, index) => family.map((word) => [word, `action:${index}`])));
const neutralWords = new Set(`a an and are as at be been being by can did do does during each for from had has have in including into is it its of on or our that the their these this those through to using use used via was were which while with within without
  experience experienced skill skills knowledge proficiency proficient professional background expertise capability capabilities technical practical hands hands-on include includes including
  reliable robust clear consistent repeatable useful maintainable effective efficiently successfully effectively collaboratively`.split(/\s+/));
const nounFamilies = [
  ['app', 'apps', 'application', 'applications'],
  ['database', 'databases', 'db'],
  ['record', 'records', 'data', 'dataset', 'datasets'],
  ['report', 'reports', 'reporting'],
  ['interface', 'interfaces'],
  ['query', 'queries'],
  ['script', 'scripts'],
  ['customer', 'customers'], ['client', 'clients'], ['user', 'users'],
  ['source', 'sources'], ['file', 'files'], ['team', 'teams'],
  ['check', 'checks'], ['metric', 'metrics'],
];
const nounOf = new Map(nounFamilies.flatMap((family) => family.map((word) => [word, family[0]])));
const metricOutcomes = [
  ['latency', /\b(?:latency|response times?|load times?|loading times?)\b/gi],
  ['review', /\breview (?:time|work|effort|duration)\b/gi],
  ['preparation', /\b(?:manual )?(?:data preparation|data prep|preparation)\b/gi],
  ['cost', /\b(?:costs?|spend|spending|expenses?)\b/gi],
  ['revenue', /\b(?:revenue|sales income)\b/gi],
  ['accuracy', /\baccuracy\b/gi], ['error', /\b(?:errors?|error rates?)\b/gi],
  ['throughput', /\bthroughput\b/gi], ['churn', /\bchurn\b/gi],
  ['retention', /\bretention\b/gi], ['conversion', /\bconversions?\b/gi],
];
const directionOf = (text) => {
  const hits = [...String(text).matchAll(/\b(reduc(?:e|ed|ing)|cut|decreas(?:e|ed|ing)|lower(?:ed|ing)?|sav(?:e|ed|ing)|increas(?:e|ed|ing)|grew|rais(?:e|ed|ing))\b/gi)];
  const last = hits.at(-1)?.[1]?.toLowerCase();
  return !last ? null : /^(?:increas|grew|rais)/.test(last) ? 'increase' : 'decrease';
};
function metricFacts(text) {
  const source = String(text || '');
  const found = [];
  const re = /\b(\d+(?:[.,]\d+)*)(\s*(?:%|percent\b|hours?\b|hrs?\b|minutes?\b|mins?\b|seconds?\b|secs?\b|ms\b|teams?\b|sources?\b|files?\b|users?\b|customers?\b|clients?\b|records?\b|rows?\b|projects?\b|days?\b|weeks?\b|months?\b|years?\b|million\b|billion\b|k\b|x\b|\+))?/gi;
  for (const match of source.matchAll(re)) {
    let unit = (match[2] || '').trim().toLowerCase();
    unit = unit === '%' || unit === 'percent' ? 'percent' : /^hrs?$/.test(unit) ? 'hour' : /^mins?$/.test(unit) ? 'minute' : /^secs?$/.test(unit) ? 'second' : unit.replace(/s$/, '');
    const before = source.slice(Math.max(0, match.index - 110), match.index).split(/[;.!?]|\b(?:and|while)\b/i).at(-1);
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 65).split(/[;.!?]|\b(?:and|while)\b/i)[0];
    const nearby = `${before} ${after}`;
    const outcomes = metricOutcomes.flatMap(([kind, pattern]) => [...nearby.matchAll(new RegExp(pattern.source, pattern.flags))].map((hit) => ({ kind, distance: Math.abs(hit.index + hit[0].length / 2 - before.length) })));
    outcomes.sort((left, right) => left.distance - right.distance);
    const scopedOutcome = ['', 'percent', 'hour', 'minute', 'second', 'ms'].includes(unit);
    found.push({ value: match[1].replace(/,/g, ''), unit, outcome: scopedOutcome ? outcomes[0]?.kind || null : null, direction: scopedOutcome ? directionOf(before) || directionOf(after) : null });
  }
  return found;
}
function sameMetric(left, right) {
  return left.value === right.value && left.unit === right.unit && left.outcome === right.outcome && left.direction === right.direction;
}
function metricClaimsSupported(text, original, preserveAll = false) {
  const next = metricFacts(text), prior = metricFacts(original);
  return next.every((fact) => prior.some((other) => sameMetric(fact, other)))
    && (!preserveAll || prior.every((fact) => next.some((other) => sameMetric(fact, other))));
}

function frames(text, original = text) {
  const dataWork = /\b(?:data|sql|python|etl|database|records?|cron)\b/i.test(original)
    && /\b(?:jobs?|tasks?|workflows?|pipelines?|scripts?)\b/i.test(original);
  const routine = dataWork && /\b(?:scheduled|scheduling|automated|automating|automation|cron)\b/i.test(original);
  const webWork = /\b(?:web|frontend|front-end|react|vue|angular)\b/i.test(original);
  let normalized = normal(text);
  for (const [alias, term] of Object.entries(ALIASES).sort((a, b) => b[0].length - a[0].length)) {
    normalized = normalized.replace(new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'gi'), `$1${term}`);
  }
  normalized = normalized.replace(/\bresponse time\b|\bload time\b|\bloading time\b/g, 'latency');
  const actions = new Set(), anchors = new Set();
  for (let word of normalized.match(/[a-z][a-z0-9+#.-]*/g) || []) {
    word = word.replace(/[.-]+$/, '');
    if (!word || neutralWords.has(word) || /ly$/.test(word)) continue;
    let action = actionOf.get(word);
    if (routine && /^(?:schedule|scheduled|scheduling|automate|automated|automating|automation)$/.test(word)) action = 'action:routine-data-work';
    if (action) { actions.add(action); continue; }
    if (dataWork && /^(?:jobs?|tasks?|workflows?|pipelines?)$/.test(word)) word = 'workflow';
    else if (webWork && /^(?:interfaces?|apps?|applications?)$/.test(word)) word = 'web-interface';
    else word = nounOf.get(word) || (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
    anchors.add(word);
  }
  // Equivalent descriptions may use a canonical skill instead of its original
  // phrase. Skills remain separately constrained to the correct source scope.
  for (const term of termsIn(text)) anchors.add(`skill:${term}`);
  return { actions, anchors };
}

function preservesMeaning(text, original, context = '', { summary = false, polarity = true } = {}) {
  if (normal(text) === normal(original)) return true;
  const negative = /\b(?:not(?!\s+only)|never|no (?:experience|knowledge|proficiency)|didn't|haven't|hasn't|unfamiliar|lack(?:ing|s)? (?:experience|knowledge))\b/i;
  const learning = /\b(?:learning|studying|training in progress|(?:plan|planning|hope|hoping|intend) to learn)\b/i;
  if (polarity && (negative.test(text) !== negative.test(original) || learning.test(text) !== learning.test(original))) return false;
  const source = frames(original);
  const candidate = frames(text, original);
  const contextual = frames(termsIn(context).join(', '), original);
  const allowed = new Set([...source.anchors, ...contextual.anchors]);
  for (const action of candidate.actions) if (!source.actions.has(action)) return false;
  // Match semantic objects and facts, rather than admitting only source words.
  // New scope, credentials, seniority and outcome nouns remain unsupported.
  for (const anchor of candidate.anchors) if (!allowed.has(anchor)) return false;
  if (!summary && source.anchors.size) {
    const retained = [...source.anchors].filter((anchor) => candidate.anchors.has(anchor)).length;
    if (retained / source.anchors.size < 0.6) return false;
  }
  return true;
}

/** Evidence is collected before generation. A self-attestation never establishes a past employment claim. */
export function buildEvidenceMap({ resumeText, profile = {}, job, experienceEntries = normalizeExperienceEntries(profile.resume_evidence), confirmedSkills = [], learningSkills = [] }) {
  const lines = proficiencyText(resumeText).split('\n').map((quote) => quote.trim()).filter(Boolean);
  const confirmed = new Set(confirmedSkills.map(canonical));
  const learning = new Set(learningSkills.map(canonical));
  const rows = [];
  for (const requirement of jobKeywords(job).requirements) {
    for (const keyword of requirement.terms) {
      const sources = lines.filter((line) => textHas(line, keyword)).slice(0, 3).map((quote) => ({ source: 'resume', quote }));
      for (const entry of experienceEntries) {
        const quote = `${entry.title}: ${entry.details}\nTools used: ${entry.skills.join(', ')}`;
        if (textHas(quote, keyword)) sources.push({ source: 'experience-bank', entryId: entry.id, kind: entry.kind, quote });
      }
      if (!sources.length) {
        for (const key of ['skills', 'headline', 'titles']) {
          if (textHas(proficiencyText(String(profile[key] || '')), keyword)) sources.push({ source: `profile.${key}`, quote: String(profile[key]) });
        }
        if (confirmed.has(keyword)) sources.push({ source: 'user-confirmation', quote: `Confirmed skill: ${keyword}` });
      }
      const status = sources.some((source) => ['resume', 'experience-bank'].includes(source.source)) ? 'demonstrated'
        : sources.length ? 'confirmed' : learning.has(keyword) ? 'learning' : 'unsupported';
      rows.push({
        id: `${requirement.id}:${keyword}`, keyword, terms: requirement.terms, priority: requirement.priority,
        kind: requirement.kind, requirement: requirement.source, status, sources,
        question: (status === 'unsupported' || status === 'learning') && !requirement.terms.some((term) => lines.some((line) => textHas(line, term)) || experienceEntries.some((entry) => textHas(`${entry.details}\n${entry.skills.join(', ')}`, term)) || confirmed.has(term) || ['skills', 'headline', 'titles'].some((key) => textHas(proficiencyText(String(profile[key] || '')), term)))
          ? `Describe how you used ${keyword} in a project, coursework, internship, or work, and what the outcome was. Rough notes are enough to start${status === 'learning' ? '; you can also describe your current study project' : ''}.`
          : null,
      });
    }
  }
  return rows;
}

/** A real quote must prove this particular skill, not just occur somewhere in the source. */
export function quoteSupportsSkill(keyword, quote, resumeText) {
  return String(quote || '').trim().length >= 12
    && normal(proficiencyText(resumeText)).includes(normal(quote))
    && textHas(quote, canonical(keyword));
}

export function summarySentenceSupported(sentence, originalText, headline, skillEvidence = originalText) {
  const source = `${originalText}\n${headline}`;
  const addedSkills = termsIn(sentence).filter((term) => !textHas(source, term));
  if (addedSkills.length) {
    if (!addedSkills.every((term) => textHas(skillEvidence, term))) return false;
    // Self-attested capabilities never establish an employer, deployment,
    // leadership event, credential, or other historical use of the new tool.
    const capability = /\b(?:skills? (?:include|includes|in|with)|knowledge of|proficien(?:t|cy) (?:in|with)|capabilities (?:include|in))\b/i.test(sentence);
    if (!capability || frames(sentence, source).actions.size || /\b(?:certified|certification|degree|licensed|senior|principal|director|staff|manager|at|during|since|throughout|employer|employment)\b/i.test(sentence)) return false;
  }
  // The initial vocabulary scope spans the resume; polarity is checked against
  // the specific historical statement below, not unrelated learning elsewhere.
  if (!preservesMeaning(sentence, source, addedSkills.join(', '), { summary: true, polarity: false })) return false;
  const historical = frames(sentence, source).actions.size || /\b(?:certified|certification|degree|licensed|senior|principal|director|staff|manager)\b/i.test(sentence);
  if (!numbers(sentence).length && !historical) return true;
  // Employment actions, credentials and numeric outcomes need one source
  // statement. A tool in one role cannot borrow another role's employer/action.
  return String(originalText).split(/\n+|;|(?<=[.!?])\s+|\b(?:while|whereas|but|however)\b/i).some((clause) =>
    metricClaimsSupported(sentence, clause) && preservesMeaning(sentence, `${clause}\n${headline}`, '', { summary: true }));
}

/** Restore source identities and accept rewrites only within the source item and its actual skills/metrics. */
export function preserveResumeFacts(candidate, source, experienceScopes = []) {
  const result = structuredClone(candidate);
  const changes = [];
  result.name = source.name;
  result.contact = [...source.contact];
  // The rule-based headline is chosen using the candidate's own title family.
  result.headline = source.headline;
  for (const sentence of source.summary.split(/(?<=[.!?])\s+/)) {
    if ((numbers(sentence).length || /\b(certified|certification|degree|licensed)\b/i.test(sentence))
      && !normal(result.summary).includes(normal(sentence))) result.summary = `${result.summary} ${sentence}`.trim();
  }
  result.sections = source.sections.map((section) => {
    const proposed = candidate.sections.find((s) => s.title === section.title);
    return {
      ...section,
      items: section.items.map((item) => {
        const scoped = experienceScopes.filter((scope) => scope.section === section.title && normal(scope.heading) === normal(item.heading)
          && normal(scope.subheading) === normal(item.subheading) && scope.dates === item.dates);
        const revised = proposed?.items.find((it) => normal(it.heading) === normal(item.heading)
          && (!it.subheading || normal(it.subheading) === normal(item.subheading)));
        if (!revised) return structuredClone(item);
        const used = new Set();
        const bullets = item.bullets.map((original) => {
          const context = scoped.filter((scope) => scope.notes.some((note) => normal(note) === normal(original)) || scope.toolsLine === original)
            .map((scope) => `${scope.skills.join(', ')}\n${scope.notes.join('\n')}`).join('\n');
          const proof = `${original}\n${context}`;
          const originalTerms = termsIn(original);
          const originalTokens = tokens(original);
          const eligible = revised.bullets.map((text, index) => {
            const words = tokens(text);
            const overlap = [...words].filter((word) => originalTokens.has(word)).length;
            const exact = normal(text) === normal(original);
            const valid = exact || (preservesMeaning(text, original, context)
              && termsIn(text).every((term) => textHas(proof, term))
              && originalTerms.every((term) => textHas(text, term))
              && metricClaimsSupported(text, original, true));
            return { text, index, overlap, valid };
          }).filter((b) => b.valid && !used.has(b.index)).sort((a, b) => b.overlap - a.overlap);
          const best = eligible[0];
          if (!best) return original;
          used.add(best.index);
          return best.text;
        });
        if (revised.bullets.length > used.size) changes.push(`Kept source facts for ${item.heading}; unverified additions were omitted.`);
        const cohesive = bullets.filter((bullet, index) => !scoped.some((scope) => scope.toolsLine === bullet
          && scope.skills.every((skill) => textHas(bullets.filter((_, position) => position !== index).join('\n'), skill))));
        return { ...item, bullets: cohesive };
      }),
    };
  });
  return { resume: result, changes: [...new Set(changes)] };
}

export function supportedNumbers(text, evidence) {
  return metricClaimsSupported(text, evidence);
}
