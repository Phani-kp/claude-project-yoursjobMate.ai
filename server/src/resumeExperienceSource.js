import { jobKeywords, textHas } from './resumeAnalysis.js';
import { normalizeExperienceEntries } from './resumeExperience.js';

const normal = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
const sectionFor = { project: 'Projects', experience: 'Experience', coursework: 'Coursework' };

/** Turn user-authored context into resume source facts before either rules or AI run. */
export function addExperienceSource(source, entries, job, normalizeDates) {
  const keywords = jobKeywords(job);
  const requirements = keywords.requirements;
  const selected = normalizeExperienceEntries(entries).map((entry, index) => ({
    entry, index,
    relevance: requirements.reduce((total, requirement) => total + (requirement.terms.some((term) =>
      textHas(`${entry.title}\n${entry.skills.join(', ')}\n${entry.details}`, term)) ? (requirement.priority === 'required' ? 3 : 1) : 0), 0),
  })).filter((row) => row.relevance > 0).sort((a, b) => b.relevance - a.relevance || a.index - b.index).slice(0, 6).map((row) => row.entry);
  const resume = structuredClone(source);
  const scopes = [];
  for (const entry of selected) {
    const sectionTitle = sectionFor[entry.kind];
    let section = resume.sections.find((s) => s.title === sectionTitle);
    if (!section) { section = { title: sectionTitle, items: [] }; resume.sections.push(section); }
    const dates = normalizeDates(entry.dates);
    let item = section.items.find((it) => normal(it.heading) === normal(entry.title)
      && normal(it.subheading) === normal(entry.organization) && (!dates || it.dates === dates));
    if (!item) {
      item = { heading: entry.title, subheading: entry.organization, dates, bullets: [] };
      section.items.push(item);
    }
    const notes = entry.details.split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/).map((line) => line.replace(/^[•*\-]\s*/, '').trim()).filter(Boolean);
    const toolsLine = entry.skills.length ? `Tools used: ${entry.skills.join(', ')}.` : '';
    item.bullets.push(...notes.filter((note) => !item.bullets.includes(note)));
    if (toolsLine && !item.bullets.includes(toolsLine)) item.bullets.push(toolsLine);
    resume.skills.push(...entry.skills);
    if (resume.skillGroups.length) resume.skillGroups[0].items.push(...entry.skills);
    scopes.push({ id: entry.id, section: sectionTitle, heading: item.heading, subheading: item.subheading, dates: item.dates, notes, skills: entry.skills, toolsLine });
  }
  return { resume, selected, scopes };
}
