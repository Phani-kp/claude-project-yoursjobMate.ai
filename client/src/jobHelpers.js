import { api } from './api';

export const placeOf = (j) => {
  if (j.city && j.states?.length) return `${j.city}, ${j.states[0]}${j.states.length > 1 ? ` +${j.states.length - 1}` : ''}`;
  if (j.states?.length) return j.states.join(', ');
  return j.remote ? 'United States' : j.location || 'United States';
};

/** Saves or unsaves a job, optimistically. */
export async function toggleSave(job, onChange) {
  const saved = !job.saved;
  onChange({ ...job, saved });
  try {
    await api(`/jobs/${job.id}/save`, { method: saved ? 'PUT' : 'DELETE' });
  } catch {
    onChange({ ...job, saved: !saved });
  }
}

const BOARDS = { 'remoteok.com': 'Remote OK', 'remotive.com': 'Remotive', 'themuse.com': 'The Muse', 'adzuna.com': 'Adzuna', 'usajobs.gov': 'USAJOBS' };

/** Where "Apply" leads: the company's own site, or the job board that listed it. */
export function applySite(job) {
  let host = '';
  try { host = new URL(job.url).hostname.replace(/^www\./, ''); } catch { /* no link */ }
  const board = Object.entries(BOARDS).find(([h]) => host.toLowerCase().endsWith(h));
  return { host, label: board ? board[1] : `${job.company}'s site` };
}
