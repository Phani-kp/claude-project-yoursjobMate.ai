import { useEffect, useState } from 'react';
import { api, timeAgo } from './api';
import { applySite, placeOf, toggleSave } from './jobHelpers';
import { MatchBadge, Modal, StatusBadge } from './components';
import ResumeTailor from './ResumeTailor';

export function SaveButton({ job, onChange, label }) {
  return (
    <button type="button" className={`btn sm save-btn ${job.saved ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSave(job, onChange); }}
      aria-pressed={!!job.saved} title={job.saved ? 'Remove from saved jobs' : 'Save to tailor and apply later'}>
      {job.saved ? '★' : '☆'}{label ? ` ${job.saved ? 'Saved' : 'Save'}` : ''}
    </button>
  );
}

/**
 * Opens the employer's real application page in a new tab, and records the application
 * (with a tailored resume and cover letter prepared) in Applied Jobs.
 */
export function ApplyLink({ job, onApply, big }) {
  const site = applySite(job);
  if (!job.url) return null;
  return (
    <a className={`btn primary ${big ? '' : 'sm'}`} href={job.url} target="_blank" rel="noopener noreferrer"
      onClick={(e) => { e.stopPropagation(); if (!job.application_status) onApply?.(job); }}
      title={`Opens ${site.host} in a new tab. Your tailored resume and cover letter are prepared and the job is added to Applied Jobs.`}>
      {big ? `Apply on ${site.label} ↗` : 'Apply ↗'}
    </a>
  );
}

export function JobCard({ job, onOpen, onChange, onApply }) {
  return (
    <article className="card job">
      <div className="job-main" onClick={() => onOpen(job)}>
        <div className="avatar">{(job.company || '?')[0]}</div>
        <div className="job-info">
          <h4>{job.title}</h4>
          <div className="muted small">
            <b className="company">{job.company}</b> · {placeOf(job)}{job.remote ? ' · Remote' : ''}{job.salary ? ` · ${job.salary}` : ''}
          </div>
          <div className="tags">
            {job.job_type && <span className="tag">{job.job_type}</span>}
            <span className="tag" title="Where this posting came from">via {job.source}</span>
          </div>
        </div>
      </div>
      <div className="job-side">
        <div className="job-side-top"><MatchBadge score={job.match_score ?? 0} /><SaveButton job={job} onChange={onChange} /></div>
        <span className="muted small" title={new Date(job.posted_at).toLocaleString()}>Posted {timeAgo(job.posted_at)}</span>
        <div className="job-side-top">
          {job.application_status && <StatusBadge status={job.application_status} />}
          <ApplyLink job={job} onApply={onApply} />
        </div>
      </div>
    </article>
  );
}

/** Full job details: description, ATS resume tailoring, save and apply. */
export function JobModal({ jobId, onClose, onChange, onApply }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/jobs/${jobId}`).then(setJob).catch((e) => setError(e.message)); }, [jobId]);
  const update = (j) => { setJob(j); onChange?.(j); };
  const apply = (j) => { onApply(j); update({ ...j, application_status: 'queued' }); };

  if (error) return <Modal title="Job" onClose={onClose}><p className="error">{error}</p></Modal>;
  if (!job) return <Modal title="Loading…" onClose={onClose}><p className="muted">Loading job…</p></Modal>;
  return (
    <Modal title={`${job.title} · ${job.company}`} onClose={onClose} wide>
      <p className="muted small">
        {job.location || placeOf(job)}{job.remote ? ' · Remote' : ''}{job.job_type ? ` · ${job.job_type}` : ''}{job.salary ? ` · ${job.salary}` : ''}
        {' · '}Posted {timeAgo(job.posted_at)} · via {job.source} · Match <MatchBadge score={job.match_score} />
      </p>
      <div className="actions">
        <ApplyLink job={job} onApply={apply} big />
        <SaveButton job={job} onChange={update} label />
        {job.application_status && <StatusBadge status={job.application_status} />}
      </div>
      <p className="muted small">Tip: tailor your resume below and download the Word file first, then upload it on the application page.</p>
      <h4>Resume for this job</h4>
      <ResumeTailor jobId={job.id} />
      <h4>Job description</h4>
      <div className="prose">{job.description || 'The full description is on the application page.'}</div>
    </Modal>
  );
}
