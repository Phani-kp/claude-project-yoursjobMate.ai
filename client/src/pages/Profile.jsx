import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../api';
import { useAuth } from '../App';

const ACCEPT = '.pdf,.docx,.txt,.md';

function ResumeUpload({ p, onUploaded, ats }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);

  const send = async (file) => {
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024) return setError('That file is over 5 MB. Please upload a smaller PDF or Word file.');
    const form = new FormData();
    form.append('resume', file);
    setBusy(true);
    try { onUploaded(await api('/profile/resume', { method: 'POST', form })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const words = (p.resume_text || '').split(/\s+/).filter(Boolean).length;
  const passed = ats?.checks.filter((c) => c.ok).length ?? 0;

  return (
    <section className="card form">
      <div className="row-between">
        <h3>Your resume</h3>
        {p.resume_file && <button type="button" className="btn sm ghost" onClick={() => download('/profile/resume', p.resume_file)}>⬇ {p.resume_file}</button>}
      </div>
      <label
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files[0]); }}
      >
        <input type="file" accept={ACCEPT} hidden onChange={(e) => { send(e.target.files[0]); e.target.value = ''; }} />
        <b>{busy ? 'Reading your resume…' : p.resume_file ? 'Upload a new version' : 'Upload your resume'}</b>
        <span className="muted small">Drag a file here or click to choose. PDF, Word (.docx) or TXT, up to 5 MB.</span>
      </label>
      {error && <div className="error">{error}</div>}
      {words > 0 && (
        <div className="banner ok small">
          ✓ We read <b>{words} words</b> from your resume. Open any job on <b>Job Matches</b> to see your ATS score and get a version tailored to it.
        </div>
      )}
      {ats && words > 0 && (
        <div>
          <h4 className="ats-title">ATS readiness: {passed} of {ats.checks.length} checks passed</h4>
          <ul className="checklist">
            {ats.checks.map((c) => <li key={c.label} className={c.ok ? 'ok' : 'bad'}><span>{c.ok ? '✓' : '!'}</span><div><b>{c.label}</b>{!c.ok && <div className="muted small">{c.tip}</div>}</div></li>)}
          </ul>
        </div>
      )}
      <details>
        <summary className="small">Resume text the AI reads{words ? '' : ' (or paste it here instead of uploading)'}</summary>
        <p className="muted small">If anything was read wrongly, fix it here and click <b>Save changes</b>.</p>
        <textarea rows={14} value={p.resume_text} onChange={(e) => onUploaded({ ...p, resume_text: e.target.value }, true)} placeholder="Paste your resume text here…" />
      </details>
    </section>
  );
}

export default function Profile() {
  const { ai } = useAuth();
  const [p, setP] = useState(null);
  const [ats, setAts] = useState(null);
  const [msg, setMsg] = useState('');

  const loadAts = useCallback(() => api('/profile/ats').then(setAts).catch(() => {}), []);
  useEffect(() => { api('/profile').then(setP); loadAts(); }, [loadAts]);
  if (!p) return <p className="muted">Loading…</p>;

  const set = (k, cast = (v) => v) => (e) => setP({ ...p, [k]: cast(e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value) });
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };
  const save = async (e) => {
    e.preventDefault();
    setP(await api('/profile', { method: 'PUT', body: p }));
    loadAts();
    flash('Saved ✓');
  };
  const onResume = (updated, localEdit) => {
    setP(updated);
    if (!localEdit) { loadAts(); flash('Resume uploaded ✓'); }
  };

  return (
    <form onSubmit={save}>
      <div className="page-head">
        <div>
          <h1>Profile & Resume</h1>
          <p className="muted">This drives job matching, tailored resumes, cover letters and the auto-apply agent.</p>
        </div>
        <div className="actions">{msg && <span className="muted small">{msg}</span>}<button className="btn primary">Save changes</button></div>
      </div>

      <ResumeUpload p={p} ats={ats} onUploaded={onResume} />

      <div className="grid two">
        <section className="card form">
          <h3>About you</h3>
          <label>Headline<input value={p.headline} onChange={set('headline')} placeholder="Full-stack engineer focused on React & Node" /></label>
          <div className="grid two tight">
            <label>Years of experience<input type="number" min="0" value={p.experience_years} onChange={set('experience_years', Number)} /></label>
            <label>Phone<input value={p.phone} onChange={set('phone')} /></label>
          </div>
          <label>LinkedIn URL<input value={p.linkedin} onChange={set('linkedin')} placeholder="https://linkedin.com/in/…" /></label>
          <label>Skills <small className="muted">(comma separated)</small><input value={p.skills} onChange={set('skills')} placeholder="react, node.js, typescript, sql" /></label>
        </section>

        <section className="card form">
          <h3>Job preferences</h3>
          <label>Target job titles <small className="muted">(comma separated)</small><input value={p.titles} onChange={set('titles')} placeholder="Frontend Engineer, Full Stack Developer" /></label>
          <label>Preferred locations<input value={p.locations} onChange={set('locations')} placeholder="Hyderabad, Bengaluru, Remote" /></label>
          <label className="check"><input type="checkbox" checked={!!p.remote_only} onChange={set('remote_only')} /> Remote jobs only</label>
          <label>Minimum salary (yearly)<input type="number" min="0" value={p.min_salary} onChange={set('min_salary', Number)} /></label>
        </section>
      </div>

      <section className="card form">
        <h3>Auto-apply agent</h3>
        <label className="check big"><input type="checkbox" checked={!!p.auto_apply} onChange={set('auto_apply')} /> Let YoursJobMate apply to matching jobs for me</label>
        <div className="grid two tight">
          <label>Max applications per day<input type="number" min="1" max="100" value={p.daily_limit} onChange={set('daily_limit', Number)} /></label>
          <label>Minimum match score: <b>{p.min_match}%</b><input type="range" min="0" max="100" step="5" value={p.min_match} onChange={set('min_match', Number)} /></label>
        </div>
        <p className="muted small">
          For every application the agent tailors your resume to the job's ATS keywords and writes a cover letter,
          using {ai ? 'Claude (AI)' : 'built-in rules. Set ANTHROPIC_API_KEY on the server for AI-written resumes and letters'}.
        </p>
      </section>
    </form>
  );
}
