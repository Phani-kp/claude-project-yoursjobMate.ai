import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../App';

export default function Profile() {
  const { ai } = useAuth();
  const [p, setP] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { api('/profile').then(setP); }, []);
  if (!p) return <p className="muted">Loading…</p>;

  const set = (k, cast = (v) => v) => (e) => setP({ ...p, [k]: cast(e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value) });
  const save = async (e) => {
    e.preventDefault();
    setP(await api('/profile', { method: 'PUT', body: p }));
    setMsg('Saved ✓');
    setTimeout(() => setMsg(''), 2500);
  };
  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('resume', file);
    const updated = await api('/profile/resume', { method: 'POST', form });
    setP(updated);
    setMsg(/\.(txt|md)$/i.test(file.name) ? 'Resume imported ✓' : 'File saved. Paste your resume text below so the AI can use it.');
  };

  return (
    <form onSubmit={save}>
      <div className="page-head">
        <div>
          <h1>Profile & Resume</h1>
          <p className="muted">This drives job matching, cover letters and the auto-apply agent.</p>
        </div>
        <div className="actions">{msg && <span className="muted small">{msg}</span>}<button className="btn primary">Save changes</button></div>
      </div>

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
        <p className="muted small">Cover letters are written by {ai ? 'Claude (AI)' : 'a built-in template. Set ANTHROPIC_API_KEY on the server for AI-tailored letters'}.</p>
      </section>

      <section className="card form">
        <div className="row-between">
          <h3>Resume</h3>
          <label className="btn sm">Upload file<input type="file" accept=".pdf,.doc,.docx,.txt,.md" hidden onChange={upload} /></label>
        </div>
        {p.resume_file && <p className="muted small">Current file: {p.resume_file}</p>}
        <textarea rows={12} value={p.resume_text} onChange={set('resume_text')} placeholder="Paste your resume text here…" />
      </section>
    </form>
  );
}
