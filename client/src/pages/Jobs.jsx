import { useCallback, useEffect, useState } from 'react';
import { api, timeAgo } from '../api';
import { useLive } from '../useLive';
import { MatchBadge, Modal, StatusBadge } from '../components';

export default function Jobs() {
  const [jobs, setJobs] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const [syncing, setSyncing] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    api(`/jobs?limit=100&search=${encodeURIComponent(search)}&onlyNew=${onlyNew ? 1 : 0}`).then(setJobs);
  }, [search, onlyNew]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const markJob = (app) => setJobs((list) => list?.map((j) => (j.id === app.job_id ? { ...j, application_id: app.id, application_status: app.status } : j)));
  useLive({ 'application:new': markJob, 'application:update': markJob });

  const sync = async () => {
    setSyncing('Fetching new jobs…');
    try {
      const r = await api('/jobs/sync', { method: 'POST' });
      setSyncing(`Added ${r.added} new jobs${r.errors.length ? ` (${r.errors.length} source(s) unreachable)` : ''}`);
      load();
    } catch (e) {
      setSyncing(e.message);
    }
  };

  const apply = (job) => api(`/jobs/${job.id}/apply`, { method: 'POST' }).then(() => markJob({ job_id: job.id, id: -1, status: 'queued' }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Job Matches</h1>
          <p className="muted">Jobs ranked by how well they fit your profile.</p>
        </div>
        <div className="actions">
          {syncing && <span className="muted small">{syncing}</span>}
          <button className="btn" onClick={sync}>↻ Fetch new jobs</button>
        </div>
      </div>
      <div className="toolbar">
        <input className="search" placeholder="Search title, company or skill…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Hide jobs I've applied to</label>
      </div>
      {!jobs && <p className="muted">Loading…</p>}
      {jobs?.length === 0 && <div className="card empty">No jobs yet. Click <b>Fetch new jobs</b>.</div>}
      <div className="job-list">
        {jobs?.map((j) => (
          <article key={j.id} className="card job">
            <div className="job-main" onClick={() => setOpen(j)}>
              <div className="avatar">{j.company[0]}</div>
              <div>
                <h4>{j.title}</h4>
                <div className="muted small">{j.company} · {j.location || '—'}{j.remote ? ' · Remote' : ''}{j.salary ? ` · ${j.salary}` : ''}</div>
                <div className="tags">{(j.tags || '').split(',').filter(Boolean).slice(0, 5).map((t) => <span key={t} className="tag">{t}</span>)}</div>
              </div>
            </div>
            <div className="job-side">
              <MatchBadge score={j.match_score} />
              <span className="muted small">{timeAgo(j.posted_at)} · {j.source}</span>
              {j.application_status
                ? <StatusBadge status={j.application_status} />
                : <button className="btn primary sm" onClick={() => apply(j)}>Apply</button>}
            </div>
          </article>
        ))}
      </div>
      {open && (
        <Modal title={`${open.title} · ${open.company}`} onClose={() => setOpen(null)} wide>
          <p className="muted small">{open.location}{open.job_type ? ` · ${open.job_type}` : ''} · Match <MatchBadge score={open.match_score} /></p>
          <div className="prose">{open.description}</div>
          <div className="actions">
            {open.url && <a className="btn" href={open.url} target="_blank" rel="noreferrer">View original posting ↗</a>}
            {!open.application_status && <button className="btn primary" onClick={() => { apply(open); setOpen(null); }}>Apply with AI cover letter</button>}
          </div>
        </Modal>
      )}
    </>
  );
}
