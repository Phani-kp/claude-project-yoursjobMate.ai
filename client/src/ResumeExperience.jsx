import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api';
import { createResumeRequestGate } from './resumeReport';
import { EXPERIENCE_LIMITS, experienceDraft, experienceEntry, upsertExperience } from './resumeExperience.js';

const kindLabel = { project: 'Project', experience: 'Work or internship', coursework: 'Coursework' };

/** Saved factual examples belong to the user and can support tailoring across every job. */
export default function ResumeExperience({ missingKeywords = [], disabled = false, onSaved, onBusyChange }) {
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState(experienceDraft);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [requests] = useState(createResumeRequestGate);
  const savingRef = useRef(false);
  const headingId = useId();

  useEffect(() => {
    const request = requests.begin('load');
    api('/profile/resume-experience').then((response) => {
      if (!requests.accepts(request)) return;
      if (!Array.isArray(response.entries)) throw new Error('Your saved experience could not be loaded. Please try again.');
      const saved = response.entries;
      setEntries(saved);
      setLoaded(true);
      setOpen(saved.length === 0);
    }).catch((failure) => {
      if (requests.accepts(request)) setError(failure.message);
    }).finally(() => {
      if (requests.accepts(request)) setLoading(false);
    });
    return () => requests.invalidate();
  }, [reload, requests]);

  const locked = disabled || saving || loading || !loaded;
  const set = (field) => (event) => setDraft((current) => ({ ...current, [field]: event.target.value }));
  const edit = (entry) => {
    setDraft(experienceDraft(entry));
    setOpen(true);
    setError('');
    setNotice('');
  };
  const persist = async (next, resetDraft) => {
    if (locked || savingRef.current) return;
    savingRef.current = true;
    const request = requests.begin('save');
    setSaving(true); setError(''); setNotice(''); onBusyChange?.(true);
    try {
      const response = await api('/profile/resume-experience', { method: 'PUT', body: { entries: next } });
      if (!requests.accepts(request)) return;
      setEntries(Array.isArray(response.entries) ? response.entries : next);
      if (resetDraft) { setDraft(experienceDraft()); setOpen(false); }
      setNotice('Experience saved for all jobs. Click Tailor or Re-tailor when you are ready to include these facts in this resume.');
      await onSaved?.();
    } catch (failure) {
      if (requests.accepts(request)) setError(failure.message);
    } finally {
      savingRef.current = false;
      if (requests.accepts(request)) { setSaving(false); onBusyChange?.(false); }
    }
  };
  const save = async (event) => {
    event.preventDefault();
    if (locked) return;
    try {
      const entry = experienceEntry(draft, draft.id || crypto.randomUUID());
      await persist(upsertExperience(entries, entry), true);
    } catch (failure) { setError(failure.message); }
  };
  const remove = (entry) => persist(entries.filter((current) => current.id !== entry.id), draft.id === entry.id);
  const retry = () => { setError(''); setLoading(true); setReload((current) => current + 1); };

  return <section className="card form" aria-labelledby={headingId}>
    <div className="row-between">
      <h3 id={headingId}>Add experience missing from your resume</h3>
      {!open && <button type="button" className="btn sm" disabled={locked || entries.length >= EXPERIENCE_LIMITS.entries} onClick={() => edit()}>Add example</button>}
    </div>
    <p className="muted small">
      Your resume may leave out relevant projects, internships, work, or coursework. Rough notes are fine—we will turn your real work into resume bullets when you tailor. Save your notes first; they are reusable across jobs and do not change your uploaded file.
    </p>
    {missingKeywords.length > 0 && <p className="muted small">
      This job still has gaps such as <b>{missingKeywords.slice(0, 8).join(', ')}</b>. Include a skill only if you actually used it in the example.
    </p>}
    {loading && <p className="muted small">Loading your saved experience…</p>}
    {error && <div className="error" role="alert">{error}{!loading && !loaded && <button type="button" className="btn sm" onClick={retry} disabled={disabled || saving || loading}>Try loading again</button>}</div>}
    {notice && <div className="banner ok small" role="status">{notice}</div>}
    {entries.length > 0 && <div className="form">
      <h4>Saved experience · {entries.length}/{EXPERIENCE_LIMITS.entries}</h4>
      {entries.map((entry) => <details key={entry.id}>
        <summary><b>{entry.title}</b> <span className="muted small">· {kindLabel[entry.kind] || 'Experience'}</span></summary>
        {(entry.organization || entry.dates) && <p className="muted small">{[entry.organization, entry.dates].filter(Boolean).join(' · ')}</p>}
        {entry.skills?.length > 0 && <p className="small"><b>Skills used:</b> {entry.skills.join(', ')}</p>}
        <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{entry.details}</p>
        <div className="actions">
          <button type="button" className="btn sm" disabled={locked} onClick={() => edit(entry)}>Edit</button>
          <button type="button" className="btn sm ghost" disabled={locked} onClick={() => remove(entry)}>Delete</button>
        </div>
      </details>)}
    </div>}
    {entries.length >= EXPERIENCE_LIMITS.entries && !draft.id && <p className="muted small">You have {EXPERIENCE_LIMITS.entries} examples. Edit or delete one before adding another.</p>}
    {open && !loading && <form className="form" onSubmit={save}>
      <h4>{draft.id ? 'Edit your example' : 'Add a factual example'}</h4>
      <div className="grid two tight">
        <label>Type<select value={draft.kind} onChange={set('kind')} disabled={locked}>
          <option value="project">Project</option><option value="experience">Work or internship</option><option value="coursework">Coursework</option>
        </select></label>
        <label>{draft.kind === 'experience' ? 'Role or internship title' : draft.kind === 'coursework' ? 'Course or assignment title' : 'Project title'}<input required maxLength={EXPERIENCE_LIMITS.title} value={draft.title} onChange={set('title')} disabled={locked} /></label>
      </div>
      {draft.kind === 'experience' && <p className="muted small">For work already on your resume, use the same role title and organization so these details stay with the correct role. Dates are optional.</p>}
      <div className="grid two tight">
        <label>Organization or school <small className="muted">(optional)</small><input maxLength={EXPERIENCE_LIMITS.organization} value={draft.organization} onChange={set('organization')} disabled={locked} /></label>
        <label>Dates <small className="muted">(optional)</small><input maxLength={EXPERIENCE_LIMITS.dates} value={draft.dates} onChange={set('dates')} disabled={locked} placeholder="Use the dates you know, or leave blank" /></label>
      </div>
      <label>Skills you used <small className="muted">(comma separated, optional)</small><input maxLength={EXPERIENCE_LIMITS.skills * (EXPERIENCE_LIMITS.skillLength + 2)} value={draft.skillsText} onChange={set('skillsText')} disabled={locked} placeholder="Tools and skills you actually used in this example" /></label>
      <label>What you actually did and the actual outcome<textarea required rows={5} maxLength={EXPERIENCE_LIMITS.details} value={draft.details} onChange={set('details')} disabled={locked} placeholder="Describe your role, the work you completed, the tools you used, and what happened. Include measured results only when you know the real values." /></label>
      <p className="muted small">{draft.details.length}/{EXPERIENCE_LIMITS.details} characters. Leave unknown dates and measurements out; qualitative results are useful too.</p>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={locked || (!draft.id && entries.length >= EXPERIENCE_LIMITS.entries)}>{saving ? 'Saving experience…' : draft.id ? 'Save example changes' : 'Save experience'}</button>
        <button type="button" className="btn" disabled={locked} onClick={() => { setDraft(experienceDraft()); setOpen(false); setError(''); }}>Cancel</button>
      </div>
    </form>}
  </section>;
}
