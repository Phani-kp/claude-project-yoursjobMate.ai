import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, timeAgo } from '../api';
import { useLive } from '../useLive';
import { JobCard, JobModal } from '../jobsUi';

const PAGE = 30;

/** Adds any company's career site, by name or by a link to its careers page. */
function AddCompany({ initial = '', onAdded }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setResult(null);
    try {
      const r = await api('/companies/discover', { method: 'POST', body: { query: value } });
      setResult(r);
      // Jump to the company's jobs, unless none were posted recently (then the message explains).
      const withJobs = r.found.find((f) => f.recent > 0);
      if (withJobs) onAdded(withJobs.name);
    } catch (err) { setResult({ found: [], message: err.message }); } finally { setBusy(false); }
  };
  return (
    <form className="card add-company" onSubmit={submit}>
      <div>
        <b>Can't find a company?</b>
        <p className="muted small">Type its name, or paste the link to its careers page (Greenhouse, Lever, Ashby, Workday, SmartRecruiters or Workable). We'll pull its US jobs now and keep them updated.</p>
      </div>
      <div className="add-company-row">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Rivian, or https://jobs.lever.co/company" required minLength={2} />
        <button className="btn primary" disabled={busy}>{busy ? 'Searching career sites…' : 'Find jobs'}</button>
      </div>
      {result && (result.found.length
        ? <div className="banner ok small">✓ Added {result.found.map((f) => `${f.name} (${f.platform})`).join(', ')}. {result.found.some((f) => f.recent > 0) ? 'Showing its jobs now.' : `It has ${result.found[0].jobs} US ${result.found[0].jobs === 1 ? 'opening' : 'openings'}, but none posted in the last 30 days. New postings will appear here automatically.`}</div>
        : <div className="banner small">{result.message}</div>)}
    </form>
  );
}
const split = (v) => (v ? v.split('|').filter(Boolean) : []);

/** A LinkedIn-style filter button that opens a menu of options with counts. */
function FilterMenu({ label, options, selected, onChange, multi = true, searchable = false }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shown = options.filter((o) => !find || o.label.toLowerCase().includes(find.toLowerCase())).slice(0, 300);
  const active = selected.length > 0;
  const pick = (value) => {
    if (!multi) { onChange(selected[0] === value ? [] : [value]); setOpen(false); return; }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  const title = !active ? label : multi ? `${label} (${selected.length})` : options.find((o) => o.value === selected[0])?.label || label;
  return (
    <div className="filter" ref={ref}>
      <button type="button" className={`filter-btn ${active ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{title} ▾</button>
      {open && (
        <div className="filter-menu card" role="listbox">
          {searchable && <input autoFocus placeholder={`Search ${label.toLowerCase()}…`} value={find} onChange={(e) => setFind(e.target.value)} />}
          <div className="filter-options">
            {shown.map((o) => (
              <label key={o.value} className={`filter-option ${selected.includes(o.value) ? 'on' : ''}`}>
                <input type={multi ? 'checkbox' : 'radio'} checked={selected.includes(o.value)} onChange={() => pick(o.value)} />
                <span>{o.label}</span><small className="muted">{o.count?.toLocaleString()}</small>
              </label>
            ))}
            {!shown.length && <p className="muted small">No matches</p>}
          </div>
          {multi && (
            <div className="filter-foot">
              <button type="button" className="btn ghost sm" onClick={() => onChange([])} disabled={!active}>Clear</button>
              <button type="button" className="btn primary sm" onClick={() => setOpen(false)}>Done</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => ({
    q: params.get('q') || '',
    posted: params.get('posted') || '30',
    company: split(params.get('company')),
    state: split(params.get('state')),
    remote: params.get('remote') === '1',
    onlyNew: params.get('onlyNew') !== '0',
    sort: params.get('sort') || 'recent',
  }), [params]);
  const [search, setSearch] = useState(filters.q);
  const [data, setData] = useState(null);
  const [facets, setFacets] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);

  const set = useCallback((changes) => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(changes)) {
        const value = Array.isArray(v) ? v.join('|') : v === true ? '1' : v === false ? '' : v;
        if (value === '' || value == null || (k === 'posted' && value === '30') || (k === 'sort' && value === 'recent')) next.delete(k);
        else next.set(k, value);
      }
      if ('onlyNew' in changes) {
        if (changes.onlyNew) next.delete('onlyNew');
        else next.set('onlyNew', '0');
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  // Search box: wait until typing pauses.
  useEffect(() => { const t = setTimeout(() => search !== filters.q && set({ q: search }), 350); return () => clearTimeout(t); }, [search, filters.q, set]);

  const query = useCallback((offset = 0) => {
    const p = new URLSearchParams({ posted: filters.posted, sort: filters.sort, offset, limit: PAGE });
    if (filters.q) p.set('q', filters.q);
    if (filters.company.length) p.set('company', filters.company.join('|'));
    if (filters.state.length) p.set('state', filters.state.join('|'));
    if (filters.remote) p.set('remote', '1');
    if (filters.onlyNew) p.set('onlyNew', '1');
    return p.toString();
  }, [filters]);

  const load = useCallback(() => {
    setData(null);
    api(`/jobs?${query()}`).then(setData).catch((e) => setData({ total: 0, jobs: [], error: e.message }));
    api(`/jobs/facets?${query()}`).then(setFacets).catch(() => {});
  }, [query]);
  useEffect(load, [load]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const page = await api(`/jobs?${query(data.jobs.length)}`);
      setData((d) => ({ ...d, jobs: [...d.jobs, ...page.jobs.filter((j) => !d.jobs.some((x) => x.id === j.id))] }));
    } finally { setLoadingMore(false); }
  };

  const replace = (job) => setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id === job.id ? { ...j, ...job } : j)) });
  const markJob = (app) => setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.id === app.job_id ? { ...j, application_id: app.id, application_status: app.status } : j)) });
  useLive({ 'application:new': markJob, 'application:update': markJob });
  const apply = (job) => api(`/jobs/${job.id}/apply`, { method: 'POST' }).then(() => markJob({ job_id: job.id, id: -1, status: 'queued' }));

  const sync = async () => {
    setSyncing('Fetching the latest postings from every source… (about 30 seconds)');
    try {
      const r = await api('/jobs/sync', { method: 'POST' });
      setSyncing(`Done: ${r.total.toLocaleString()} US jobs, ${r.added.toLocaleString()} new${r.errors.length ? `, ${r.errors.length} source(s) unreachable` : ''}`);
      load();
    } catch (e) {
      setSyncing(e.message);
    }
  };

  const dateOptions = (facets?.dates || []).map((d) => ({ value: String(d.days), label: d.label, count: d.count }));
  const companyOptions = (facets?.companies || []).map((c) => ({ value: c.name, label: c.name, count: c.count }));
  // Keep selected companies visible even if the other filters leave them with no jobs.
  for (const c of filters.company) if (!companyOptions.some((o) => o.value === c)) companyOptions.unshift({ value: c, label: c, count: 0 });
  const stateOptions = (facets?.states || []).map((s) => ({ value: s.code, label: s.code === 'REMOTE' ? s.name : `${s.name} (${s.code})`, count: s.count }));
  const anyFilter = filters.q || filters.posted !== '30' || filters.company.length || filters.state.length || filters.remote;
  const last = facets?.lastSync;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Job Matches</h1>
          <p className="muted">
            {facets?.totals ? `${facets.totals.jobs.toLocaleString()} US jobs` : 'US jobs'} posted in the last 30 days from {facets?.totals?.companies?.toLocaleString() || 'top'} companies' own career sites and job boards
            {last ? ` · updated ${timeAgo(last.at)}` : ''}.
          </p>
        </div>
        <div className="actions">
          {syncing && <span className="muted small">{syncing}</span>}
          <button type="button" className="btn" onClick={() => setAdding((a) => !a)}>＋ Add a company</button>
          <button type="button" className="btn" onClick={sync}>↻ Refresh jobs</button>
        </div>
      </div>

      <div className="toolbar">
        <input className="search" type="search" placeholder="Search by title, skill or company (e.g. react engineer)" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filters.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort by">
          <option value="recent">Most recent</option>
          <option value="match">Best match for me</option>
        </select>
      </div>
      <div className="filters">
        <FilterMenu label="Date posted" multi={false} options={dateOptions} selected={filters.posted === '30' ? [] : [filters.posted]} onChange={([v]) => set({ posted: v || '30' })} />
        <FilterMenu label="Company" searchable options={companyOptions} selected={filters.company} onChange={(v) => set({ company: v })} />
        <FilterMenu label="Location" searchable options={stateOptions} selected={filters.state} onChange={(v) => set({ state: v })} />
        <button type="button" className={`filter-btn ${filters.remote ? 'on' : ''}`} onClick={() => set({ remote: !filters.remote })} aria-pressed={filters.remote}>Remote</button>
        <label className="check small"><input type="checkbox" checked={filters.onlyNew} onChange={(e) => set({ onlyNew: e.target.checked })} /> Hide jobs I've applied to</label>
        {anyFilter && <button type="button" className="btn ghost sm" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear all</button>}
      </div>

      {(adding || (data && filters.q && data.total < 5)) && (
        <AddCompany key={filters.q} initial={adding ? '' : filters.q} onAdded={(name) => { setSearch(''); setAdding(false); set({ q: '', company: [name] }); }} />
      )}
      {!data && <p className="muted">Loading jobs…</p>}
      {data?.error && <div className="error">{data.error}</div>}
      {data && !data.error && (
        <p className="muted small results-count">
          <b>{data.total.toLocaleString()}</b> {data.total === 1 ? 'job' : 'jobs'}{anyFilter ? ' match your filters' : ''}
        </p>
      )}
      {data?.total === 0 && !data.error && (
        <div className="card empty">
          {anyFilter ? <>No jobs match these filters. Try a wider date range or fewer filters.</> : <>No jobs yet. Click <b>Refresh jobs</b> to pull the latest postings.</>}
        </div>
      )}
      <div className="job-list">
        {data?.jobs.map((j) => <JobCard key={j.id} job={j} onOpen={(job) => setOpen(job.id)} onChange={replace} onApply={apply} />)}
      </div>
      {data && data.jobs.length < data.total && (
        <button type="button" className="btn load-more" onClick={more} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : `Show more (${(data.total - data.jobs.length).toLocaleString()} more)`}
        </button>
      )}
      {open && <JobModal jobId={open} onClose={() => setOpen(null)} onChange={replace} onApply={apply} />}
    </>
  );
}
