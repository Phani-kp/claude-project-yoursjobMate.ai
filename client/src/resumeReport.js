const key = (value) => String(value || '').trim().toLowerCase();
const unique = (values) => [...new Map(values.filter(Boolean).map((value) => [key(value), String(value).trim()])).values()];
const evidenceRows = (tailored) => Array.isArray(tailored?.report?.evidenceMap) ? tailored.report.evidenceMap : [];

/** Coverage and formatting always describe the most recently assessed tailored version. */
export function selectResumeReport(original, tailored) {
  const after = tailored?.report?.after;
  return after && typeof after === 'object' && !Array.isArray(after) ? after : original;
}

/** A tailor response reassesses the original inputs, which may have changed since the initial GET. */
export function mergeOriginalReport(original, tailored) {
  const before = tailored?.report?.before;
  return before && typeof before === 'object' && !Array.isArray(before)
    ? { ...original, ...before, ...(tailored?.report?.skillChoices ? { skillChoices: tailored.report.skillChoices } : {}), hasResume: original?.hasResume ?? true }
    : original;
}

export function savedSkillChoices(tailored) {
  const saved = tailored?.report?.skillChoices;
  if (saved && Array.isArray(saved.confirmed) && Array.isArray(saved.learning)) {
    const confirmed = unique(saved.confirmed);
    const selected = new Set(confirmed.map(key));
    return { confirmed, learning: unique(saved.learning).filter((term) => !selected.has(key(term))) };
  }
  const rows = evidenceRows(tailored);
  return {
    confirmed: unique(rows.filter((row) => row.status === 'confirmed').map((row) => row.keyword)),
    learning: unique(rows.filter((row) => row.status === 'learning').map((row) => row.keyword)),
  };
}

/** Prefill relevant known skills while leaving undocumented skills available for an optional review. */
export function initialSkillChoices(original, tailored) {
  const saved = original?.skillChoices ? savedSkillChoices({ report: { skillChoices: original.skillChoices } }) : savedSkillChoices(tailored);
  const known = new Set((original?.knownSkills || []).map(key));
  const confirmed = unique([...saved.confirmed, ...reviewKeywords(original, tailored).filter((term) => known.has(key(term)))]);
  const selected = new Set(confirmed.map(key));
  return { confirmed, learning: saved.learning.filter((term) => !selected.has(key(term))) };
}

/** Keep earlier confirmations editable even when tailoring removed a term from the latest missing list. */
export function reviewKeywords(original, tailored) {
  const rows = evidenceRows(tailored);
  const saved = original?.skillChoices || savedSkillChoices(tailored);
  const persisted = [...(saved.confirmed || []), ...(saved.learning || [])];
  const explicit = new Set([...persisted, ...rows.filter((row) => ['confirmed', 'learning'].includes(row.status)).map((row) => row.keyword)].map(key));
  const groups = selectResumeReport(original, tailored)?.requirements || [];
  return unique([
    ...(original?.missingHard || []), ...(original?.missing || []),
    ...persisted,
    ...rows.filter((row) => row.status !== 'demonstrated').map((row) => row.keyword),
  ]).filter((keyword) => {
    if (explicit.has(key(keyword))) return true;
    const row = rows.find((value) => key(value.keyword) === key(keyword));
    if (row && row.status !== 'unsupported') return true;
    return !groups.some((group) => group.status === 'matched' && group.terms?.length > 1
      && group.terms.some((term) => key(term) === key(keyword))
      && group.matchedTerms?.some((term) => key(term) !== key(keyword)));
  });
}

export function chooseSkill(choices, keyword, kind) {
  const selected = kind === 'confirmed' ? 'confirmed' : 'learning';
  const other = selected === 'confirmed' ? 'learning' : 'confirmed';
  const exists = choices[selected].some((value) => key(value) === key(keyword));
  return {
    ...choices,
    [selected]: exists ? choices[selected].filter((value) => key(value) !== key(keyword)) : [...choices[selected], keyword],
    [other]: choices[other].filter((value) => key(value) !== key(keyword)),
  };
}

export function hasPendingSkillChoices(tailored, choices) {
  const saved = savedSkillChoices(tailored);
  return ['confirmed', 'learning'].some((kind) => {
    const previous = new Set(saved[kind].map(key));
    const selected = new Set(choices[kind].map(key));
    return previous.size !== selected.size || [...selected].some((value) => !previous.has(value));
  });
}

export function gapQuestions(tailored) {
  const supplied = tailored?.report?.gap?.questions;
  const after = tailored?.report?.after;
  const missing = new Set((after?.missing || []).map(key));
  return unique([
    ...(Array.isArray(supplied) ? supplied.map((value) => typeof value === 'string' ? value : value?.question) : []),
    ...evidenceRows(tailored).filter((row) => row.status === 'unsupported' && (!after || missing.has(key(row.keyword)))).map((row) => row.question),
  ]);
}

export function priorityLabel(priority) {
  return priority === 'required' ? 'Required' : priority === 'preferred' ? 'Preferred' : 'Priority unspecified';
}

/** A later request or a job switch invalidates every earlier response, even when returning to the same job. */
export function createResumeRequestGate() {
  let current;
  return {
    begin(jobId) { current = { jobId }; return current; },
    get current() { return current; },
    accepts(request) { return Boolean(request) && current === request; },
    invalidate() { current = undefined; },
  };
}
