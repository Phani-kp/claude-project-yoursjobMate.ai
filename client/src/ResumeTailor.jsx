import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from './api';

const TARGET = 85;
const scoreLabel = (s) => (s >= TARGET ? 'Target met' : s >= 65 ? 'Good' : s >= 45 ? 'Fair' : 'Low');
const tone = (s) => (s >= TARGET ? 'high' : s >= 45 ? 'mid' : 'low');
const PARTS = { hardSkills: 'Hard skills', title: 'Job title', softSkills: 'Soft skills', format: 'ATS format' };

/** How the score is made up: each part's matches and its weight. */
function Breakdown({ parts }) {
  if (!parts) return null;
  return (
    <ul className="breakdown">
      {Object.entries(PARTS).filter(([k]) => parts[k]?.total).map(([k, label]) => (
        <li key={k} title={`Worth ${parts[k].weight}% of the score`}>
          <span>{label}</span>
          <span className="bar-track"><i style={{ width: `${Math.round((parts[k].matched / parts[k].total) * 100)}%` }} /></span>
          <b>{parts[k].matched}/{parts[k].total}</b>
        </li>
      ))}
    </ul>
  );
}

export function AtsScore({ score, label = 'ATS match' }) {
  return (
    <div className={`ats-score m-${tone(score)}`}>
      <b>{score}%</b>
      <span>{label}<small>{scoreLabel(score)}</small></span>
    </div>
  );
}

/** ATS check of the user's resume against one job, plus creating and downloading a tailored version. */
export default function ResumeTailor({ jobId }) {
  const [ats, setAts] = useState(null);
  const [tailored, setTailored] = useState(null);
  const [confirmed, setConfirmed] = useState([]);
  const [learning, setLearning] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api(`/jobs/${jobId}/ats`).then((d) => {
      setAts(d);
      setTailored(d.tailored);
    }).catch((e) => setError(e.message));
  }, [jobId]);

  if (error && !ats) return <div className="error">{error}</div>;
  if (!ats) return <p className="muted small">Checking your resume against this job…</p>;
  if (!ats.hasResume) {
    return (
      <div className="banner">
        <b>See how your resume scores for this job.</b> <Link to="/profile">Upload your resume</Link> on the Profile page first (PDF or Word).
      </div>
    );
  }

  // Each missing skill is either one you have, one you're learning, or neither.
  const choose = (k, kind) => {
    const [mine, other, setMine, setOther] = kind === 'have' ? [confirmed, learning, setConfirmed, setLearning] : [learning, confirmed, setLearning, setConfirmed];
    setMine(mine.includes(k) ? mine.filter((x) => x !== k) : [...mine, k]);
    if (other.includes(k)) setOther(other.filter((x) => x !== k));
  };
  const missingAll = [...(ats.missingHard || ats.missing), ...ats.missing.filter((k) => !(ats.missingHard || []).includes(k))];
  const tailor = async () => {
    setBusy(true); setError('');
    try { setTailored(await api(`/jobs/${jobId}/tailor`, { method: 'POST', body: { confirmedSkills: confirmed, learningSkills: learning } })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const copy = async () => { await navigator.clipboard.writeText(tailored.text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const failing = ats.checks.filter((c) => !c.ok);

  return (
    <div className="tailor">
      <div className="tailor-head">
        <AtsScore score={ats.score} label="Your resume" />
        {tailored && <><span className="arrow" aria-hidden>→</span><AtsScore score={tailored.ats_after} label="Tailored resume" /></>}
        <span className="muted small target">Target: {TARGET}–95%</span>
      </div>
      <Breakdown parts={(tailored?.report?.after || ats).breakdown} />

      <div className="kw">
        <h5>Keywords this job screens for</h5>
        <div className="tags">
          {ats.matched.map((k) => <span key={k} className="tag kw-hit" title="Found in your resume">✓ {k}</span>)}
          {missingAll.map((k) => (
            <span key={k} className={`tag kw-miss ${confirmed.includes(k) ? 'on' : ''} ${learning.includes(k) ? 'learning' : ''}`}>
              {k}
              <button type="button" className={confirmed.includes(k) ? 'on' : ''} onClick={() => choose(k, 'have')} aria-pressed={confirmed.includes(k)} title="I already have this skill">I have it</button>
              <button type="button" className={learning.includes(k) ? 'on' : ''} onClick={() => choose(k, 'learn')} aria-pressed={learning.includes(k)} title="I'm actively learning this (shown as Currently learning)">Learning</button>
            </span>
          ))}
        </div>
        {ats.missing.length > 0 && (
          <div className="kw-help">
            <p className="muted small">
              Not in your resume yet. <b>I have it</b> adds the skill to your Skills section. <b>Learning</b> lists it under
              "Professional Development: Currently learning", which ATS software can count. Pick Learning only for skills you're actually studying.
            </p>
            {missingAll.some((k) => !confirmed.includes(k) && !learning.includes(k)) && (
              <button type="button" className="btn sm" onClick={() => setLearning(missingAll.filter((k) => !confirmed.includes(k)))}>
                Add missing keywords as learning
              </button>
            )}
          </div>
        )}
      </div>

      {failing.length > 0 && (
        <details className="ats-checks">
          <summary>{failing.length} formatting {failing.length === 1 ? 'issue' : 'issues'} an ATS may trip on</summary>
          <ul>{failing.map((c) => <li key={c.label}><b>{c.label}:</b> {c.tip}</li>)}</ul>
        </details>
      )}

      <div className="actions">
        <button type="button" className="btn primary" onClick={tailor} disabled={busy}>
          {busy ? 'Tailoring… (can take up to a minute)' : tailored ? '↻ Re-tailor resume' : '✨ Tailor my resume for this job'}
        </button>
        {tailored && <button type="button" className="btn" onClick={() => download(`/jobs/${jobId}/tailor/docx`, 'resume.docx').catch((e) => setError(e.message))}>⬇ Download Word (.docx)</button>}
        {tailored && <button type="button" className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy as text'}</button>}
      </div>
      {error && <div className="error">{error}</div>}

      {tailored && (
        <>
          {tailored.report?.gap && (
            <div className={`banner small ${tailored.report.gap.weakFit ? 'error-banner' : ''}`}>
              <b>Target not reached: {tailored.ats_after}%.</b> {tailored.report.gap.message}
              {tailored.report.gap.missing?.length > 0 && <> Missing: {tailored.report.gap.missing.join(', ')}.</>}
            </div>
          )}
          {tailored.ats_after >= TARGET && <div className="banner ok small">✓ {tailored.ats_after}% match, from your real experience only.</div>}
          <ul className="changes">{tailored.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="muted small">
            {tailored.ai ? "Rewritten by Claude (AI) from facts in your resume, then checked: any claim your resume doesn't support is removed." : 'Tailored with built-in rules from your own resume and profile only (no AI). Set ANTHROPIC_API_KEY on the server for a full AI rewrite.'}
            {' '}Every job gets its own version: supported job keywords are placed in Skills, relevant Experience and Projects are prioritised, and unsupported skills are never invented. Standard ATS format: Summary, Skills, Experience, Projects, Education, Certifications, in one column with one date style and no tables or graphics. Review it before you send it.
          </p>
          <details className="preview">
            <summary>Preview tailored resume</summary>
            <pre className="letter">{tailored.text}</pre>
          </details>
        </>
      )}
    </div>
  );
}
