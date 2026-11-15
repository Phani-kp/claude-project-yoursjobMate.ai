export const EXPERIENCE_LIMITS = { entries: 20, title: 100, organization: 100, dates: 80, skills: 25, skillLength: 80, details: 2000 };
const kinds = ['project', 'experience', 'coursework'];

export function experienceDraft(entry) {
  return {
    id: entry?.id || '', kind: entry?.kind || 'project', title: entry?.title || '',
    organization: entry?.organization || '', dates: entry?.dates || '',
    skillsText: (entry?.skills || []).join(', '), details: entry?.details || '',
  };
}

export function experienceSkills(value) {
  const unique = new Map();
  for (const skill of String(value || '').split(',').map((part) => part.trim()).filter(Boolean)) {
    if (!unique.has(skill.toLowerCase())) unique.set(skill.toLowerCase(), skill);
  }
  return [...unique.values()];
}

/** Preserve the user's own factual text; blank optional context remains blank. */
export function experienceEntry(draft, id) {
  const entry = {
    id: draft.id || id,
    kind: draft.kind,
    title: String(draft.title || '').trim(),
    organization: String(draft.organization || '').trim(),
    dates: String(draft.dates || '').trim(),
    skills: experienceSkills(draft.skillsText),
    details: String(draft.details || '').trim(),
  };
  if (!kinds.includes(entry.kind)) throw new Error('Choose a project, work or internship, or coursework.');
  if (!entry.title) throw new Error('Add a title for this experience.');
  if (!entry.details) throw new Error('Describe what you actually did and the actual outcome.');
  for (const [field, label] of [['title', 'Title'], ['organization', 'Organization'], ['dates', 'Dates'], ['details', 'Experience details']]) {
    if (entry[field].length > EXPERIENCE_LIMITS[field]) throw new Error(`${label} must be ${EXPERIENCE_LIMITS[field]} characters or fewer.`);
  }
  if (entry.skills.length > EXPERIENCE_LIMITS.skills) throw new Error(`Add no more than ${EXPERIENCE_LIMITS.skills} skills to one example.`);
  if (entry.skills.some((skill) => skill.length > EXPERIENCE_LIMITS.skillLength)) throw new Error(`Each skill must be ${EXPERIENCE_LIMITS.skillLength} characters or fewer.`);
  return entry;
}

export function upsertExperience(entries, entry) {
  if (entries.some((current) => current.id === entry.id)) return entries.map((current) => current.id === entry.id ? entry : current);
  if (entries.length >= EXPERIENCE_LIMITS.entries) throw new Error(`You can save up to ${EXPERIENCE_LIMITS.entries} examples. Edit or delete an existing one to add another.`);
  return [...entries, entry];
}
