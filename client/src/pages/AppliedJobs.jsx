import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmtDate, STATUSES, timeAgo } from '../api';
import { useLive } from '../useLive';
import { MatchBadge, Modal, Stat, StatusBadge } from '../components';
import ResumeTailor from '../ResumeTailor';

const TABS = ['all', 'applied', 'viewed', 'interview', 'offer', 'rejected', 'queued', 'failed'];

function exportCsv(rows) {
  const cols = ['title', 'company', 'location', 'status', 'match_score', 'method', 'applied_at', 'url', 'notes'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'applied-jobs.csv' });
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function AppliedJobs() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'all';
  const [apps, setApps] = useState(null);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('all');
  const [sort, setSort] = useState('created_at');
  const [flash, setFlash] = useState({});
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api(`/applications?sort=${sort}&method=${method}&search=${encodeURIComponent(search)}`).then(setApps);
  }, [sort, method, search]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const ping = (id) => {
    setFlash((f) => ({ ...f, [id]: true }));
    setTimeout(() => setFlash((f) => ({ ...f, [id]: false })), 1500);
  };
  useLive({
    'application:new': (a) => { setApps((list) => (list && !list.some((x) => x.id === a.id) ? [a, ...list] : list)); ping(a.id); },
    'application:update': (a) => { setApps((list) => list?.map((x) => (x.id === a.id ? a : x))); setDetail((d) => (d?.id === a.id ? { ...d, ...a } : d)); ping(a.id); },
    'application:delete': ({ id }) => setApps((list) => list?.filter((x) => x.id !== id)),
  });

  const counts = useMemo(() => {
    const c = Object.fromEntries(TABS.map((t) => [t, 0]));
    for (const a of apps || []) { c.all++; c[a.status] = (c[a.status] || 0) + 1; }
    return c;
  }, [apps]);
  const rows = (apps || []).filter((a) => status === 'all' || a.status === status);
  const submitted = counts.applied + counts.viewed + counts.interview + counts.offer + counts.rejected;

  const setStatus = (a, s) => api(`/applications/${a.id}`, { method: 'PATCH', body: { status: s } });
  const remove = async (a) => {
    if (!confirm(`Remove ${a.title} at ${a.company} from your tracker?`)) return;
    await api(`/applications/${a.id}`, { method: 'DELETE' });
    setApps((list) => list.filter((x) => x.id !== a.id));
    setDetail(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Applied Jobs</h1>
          <p className="muted">Every application, updated in real time.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => exportCsv(rows)} disabled={!rows.length}>Export CSV</button>
          <button className="btn primary" onClick={() => setAdding(true)}>+ Add application</button>
        </div>
      </div>

      <div className="grid stats">
        <Stat label="Applications" value={submitted} hint={`${counts.queued + (counts.applying || 0)} in progress`} />
        <Stat label="Viewed" value={counts.viewed} />
        <Stat label="Interviews" value={counts.interview} />
        <Stat label="Offers" value={counts.offer} />
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={status === t} className={`tab ${status === t ? 'active' : ''}`}
            onClick={() => setParams(t === 'all' ? {} : { status: t })}>
            <span className="cap">{t}</span> <span className="count">{counts[t] || 0}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Search by title, company or location…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
          <option value="all">All methods</option>
          <option value="auto">Auto-applied</option>
          <option value="one-click">One-click</option>
          <option value="manual">Added manually</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="created_at">Newest first</option>
          <option value="match_score">Best match</option>
          <option value="company">Company</option>
          <option value="updated_at">Recently updated</option>
        </select>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr><th>Job</th><th>Location</th><th>Match</th><th>Method</th><th>Applied</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {!apps && <tr><td colSpan="7" className="muted">Loading…</td></tr>}
            {apps && rows.length === 0 && <tr><td colSpan="7" className="empty">No applications here yet.</td></tr>}
            {rows.map((a) => (
              <tr key={a.id} className={flash[a.id] ? 'flash' : ''}>
                <td data-label="Job">
                  <button className="link-btn" onClick={() => api(`/applications/${a.id}`).then(setDetail)}>
                    <b>{a.title}</b><span className="muted small">{a.company}</span>
                  </button>
                </td>
                <td data-label="Location">{a.location || '—'}</td>
                <td data-label="Match">{a.method === 'manual' ? '—' : <MatchBadge score={a.match_score} />}</td>
                <td data-label="Method" className="cap small">{a.method}</td>
                <td data-label="Applied" title={a.applied_at || ''}>{a.applied_at ? fmtDate(a.applied_at) : <span className="muted">—</span>}</td>
                <td data-label="Status">
                  <select className={`status-select s-${a.status}`} value={a.status} onChange={(e) => setStatus(a, e.target.value)} aria-label="Status">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="row-actions">
                  {a.url && <a className="btn ghost sm" href={a.url} target="_blank" rel="noreferrer" title="Open posting">↗</a>}
                  <button className="btn ghost sm" onClick={() => remove(a)} title="Remove">🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && <Detail app={detail} onClose={() => setDetail(null)} onRemove={() => remove(detail)} />}
      {adding && <AddApplication onClose={() => setAdding(false)} />}
    </>
  );
}

function Detail({ app, onClose, onRemove }) {
  const [notes, setNotes] = useState(app.notes || '');
  const [saved, setSaved] = useState(false);
  const save = async () => { await api(`/applications/${app.id}`, { method: 'PATCH', body: { notes } }); setSaved(true); };
  return (
    <Modal title={`${app.title} · ${app.company}`} onClose={onClose} wide>
      <div className="detail-meta">
        <StatusBadge status={app.status} />
        {app.method !== 'manual' && <MatchBadge score={app.match_score} />}
        <span className="muted small">{app.location} · Applied {fmtDate(app.applied_at)} · via {app.method}</span>
      </div>
      {app.job_id && (<><h4>Resume for this job</h4><ResumeTailor jobId={app.job_id} /></>)}
      {app.cover_letter && (<><h4>Cover letter sent</h4><pre className="letter">{app.cover_letter}</pre></>)}
      <h4>Notes</h4>
      <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} placeholder="Recruiter name, interview dates, follow-ups…" />
      <div className="actions">
        <button className="btn" onClick={save}>{saved ? 'Saved ✓' : 'Save notes'}</button>
        {app.url && <a className="btn" href={app.url} target="_blank" rel="noreferrer">Open posting ↗</a>}
        <button className="btn danger" onClick={onRemove}>Remove</button>
      </div>
      {app.events?.length > 0 && (
        <>
          <h4>Timeline</h4>
          <ul className="feed">
            {app.events.map((e) => <li key={e.id} className="feed-item"><span className={`dot t-${e.type}`} /><span>{e.message}</span><span className="muted small">{timeAgo(e.created_at)}</span></li>)}
          </ul>
        </>
      )}
    </Modal>
  );
}

function AddApplication({ onClose }) {
  const [form, setForm] = useState({ title: '', company: '', location: '', url: '', status: 'applied', notes: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try { await api('/applications', { method: 'POST', body: form }); onClose(); } catch (err) { setError(err.message); }
  };
  return (
    <Modal title="Track an application" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted small">Log a job you applied to somewhere else so everything lives in one place.</p>
        <label>Job title<input value={form.title} onChange={set('title')} required /></label>
        <label>Company<input value={form.company} onChange={set('company')} required /></label>
        <div className="grid two tight">
          <label>Location<input value={form.location} onChange={set('location')} /></label>
          <label>Status<select value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <label>Posting URL<input type="url" value={form.url} onChange={set('url')} placeholder="https://" /></label>
        <label>Notes<textarea rows={2} value={form.notes} onChange={set('notes')} /></label>
        {error && <div className="error">{error}</div>}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Add</button></div>
      </form>
    </Modal>
  );
}
