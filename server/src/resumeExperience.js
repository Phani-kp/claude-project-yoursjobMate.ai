import { createHash, randomUUID } from 'node:crypto';
import { ALIASES } from './resumeAnalysis.js';

const kinds = new Set(['project', 'experience', 'coursework']);
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const invalid = message => Object.assign(new Error(message), { status: 400, expose: true });
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function text(value, label, maxLength, { required = false, multiline = false } = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw invalid(`${label} must be text.`);
  const result = value.trim();
  if (required && !result) throw invalid(`${label} is required.`);
  if (result.length > maxLength) throw invalid(`${label} must be at most ${maxLength} characters.`);
  if (controls.test(result) || (!multiline && /[\r\n\t]/.test(result))) throw invalid(`${label} contains unsupported control characters.`);
  return result;
}

function stableId(entry) {
  const hex = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Validate user-authored facts. Lenient reads never change storage or invent experience. */
export function normalizeExperienceEntries(entries, { strict = false } = {}) {
  if (!strict && typeof entries === 'string') {
    try { entries = JSON.parse(entries); } catch { return []; }
  }
  if (!Array.isArray(entries)) {
    if (strict) throw invalid('Experience entries must be an array.');
    return [];
  }
  if (strict && entries.length > 20) throw invalid('Save at most 20 experience entries.');
  const result = [];
  const ids = new Set();
  for (const entry of entries.slice(0, 20)) {
    try {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid('Each experience entry must be an object.');
      const kind = typeof entry.kind === 'string' ? entry.kind.trim().toLowerCase() : '';
      if (!kinds.has(kind)) throw invalid('Experience kind must be project, experience, or coursework.');
      const title = text(entry.title, 'Experience title', 100, { required: true });
      const organization = text(entry.organization, 'Organization', 100);
      const dates = text(entry.dates, 'Dates', 80);
      const details = text(entry.details, 'Experience details', 2000, { required: true, multiline: true });
      if (entry.skills !== undefined && !Array.isArray(entry.skills)) throw invalid('Experience skills must be an array.');
      if ((entry.skills || []).length > 25) throw invalid('Save at most 25 skills per experience entry.');
      const skills = [...new Set((entry.skills || []).map(value => {
        const skill = text(value, 'Skill', 80, { required: true }).replace(/\s+/g, ' ').toLowerCase();
        return Object.hasOwn(ALIASES, skill) ? ALIASES[skill] : skill;
      }))];
      const normalized = { kind, title, organization, dates, skills, details };
      const missingId = entry.id === undefined || entry.id === null || entry.id === '';
      const id = missingId ? (strict ? randomUUID() : stableId(normalized))
        : typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : '';
      if (!uuid.test(id)) throw invalid('Experience id must be a UUID.');
      if (ids.has(id)) throw invalid('Experience entry ids must be unique.');
      ids.add(id);
      result.push({ id, ...normalized });
    } catch (error) {
      if (strict) throw error;
    }
  }
  return result;
}
