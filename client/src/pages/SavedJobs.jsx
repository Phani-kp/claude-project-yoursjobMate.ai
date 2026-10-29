import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api';
import { useLive } from '../useLive';
import { StatusBadge } from '../components';
import { ApplyLink, JobModal } from '../jobsUi';
import { placeOf, toggleSave } from '../jobHelpers';

export default function SavedJobs() {
  const [jobs, setJobs] = useState(null);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api('/saved').then(setJobs).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  // Progress while applications are prepared.
  const refresh = useCallback((app) => { if (jobs?.some((j) => j.id === app.job_id)) load(); }, [jobs, load]);
  useLive({ 'application:new': refresh, 'application:update': refresh });

  const pending = (jobs || []).filter((j) => !j.application_status);
  const applyAll = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api('/saved/apply-all', { method: 'POST' });
      setMsg(r.queued ? `Tailoring your resume and cover letter for ${r.queued} ${r.queued === 1 ? 'job' : 'jobs'}… Progress shows below and on Applied Jobs.` : 'Every saved job has already been applied to.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const apply = (job) => api(`/jobs/${job.id}/apply`, { method: 'POST' }).then(load);
  const unsave = (job) => toggleSave({ ...job, saved: true }, () => setJobs((list) => list.filter((j) => j.id !== job.id)));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Saved Jobs</h1>
          <p className="muted">Save jobs from Job Matches, then tailor your resume and apply to all of them in one click.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={applyAll} disabled={busy || !pending.length}>
            ⚡ Tailor resume & apply to all{pending.length ? ` (${pending.length})` : ''}
          </button>
        </div>
      </div>
      {msg && <div className="banner ok">{msg}</div>}
      {error && <div className="banner error-banner">{error} {/resume/i.test(error) && <Link to="/profile">Go to Profile →</Link>}</div>}

      {!jobs && <p className="muted">Loading…</p>}
      {jobs?.length === 0 && <div className="card empty">No saved jobs yet. Open <Link to="/jobs">Job Matches</Link> and click ☆ on the jobs you like.</div>}
      {jobs?.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Job</th><th>Location</th><th>Posted</th><th>Resume ATS match</th><th>Status</th><th /></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><button type="button" className="link-btn job-link" onClick={() => setOpen(j.id)} title="View job, keywords and tailored resume"><b>{j.title}</b><span className="muted small">{j.company} · via {j.source}</span></button></td>
                  <td className="small">{placeOf(j)}{j.remote ? ' · Remote' : ''}</td>
                  <td className="small muted">{timeAgo(j.posted_at)}</td>
                  <td className="small ats-cell">
                    {j.ats_after != null && <span><b>{j.ats_after}%</b> <span className="muted">(was {j.ats_before}%)</span></span>}
                    {/* Always reopenable: view the job, its keywords, re-tailor or download the resume again. */}
                    <button type="button" className="btn sm" onClick={() => setOpen(j.id)}>{j.ats_after != null ? 'View & re-tailor' : 'Tailor resume'}</button>
                  </td>
                  <td>{j.application_status ? <StatusBadge status={j.application_status} /> : <span className="muted small">Not applied</span>}</td>
                  <td className="row-actions">
                    <ApplyLink job={j} onApply={apply} />
                    <button type="button" className="btn ghost sm" onClick={() => unsave(j)} title="Remove from saved">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <JobModal jobId={open} onClose={() => { setOpen(null); load(); }} onChange={(job) => !job.saved && setJobs((l) => l.filter((x) => x.id !== job.id))} onApply={apply} />}
    </>
  );
}
