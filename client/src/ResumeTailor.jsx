import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from './api';
import ResumeExperience from './ResumeExperience.jsx';
import { chooseSkill, createResumeRequestGate, gapQuestions, hasPendingSkillChoices, initialSkillChoices, mergeOriginalReport, priorityLabel, reviewKeywords, selectResumeReport } from './resumeReport';

const PARTS = { hardSkills: 'Hard skills', title: 'Job title', softSkills: 'Soft skills', format: 'Document format' };
const list = (value) => Array.isArray(value) ? value : [];
const normal = (value) => String(value || '').trim().toLowerCase();

function Breakdown({ parts }) {
  if (!parts) return null;
  return <ul className="breakdown">{Object.entries(PARTS).filter(([key]) => parts[key]?.total).map(([key, label]) => <li key={key} title={`Worth ${parts[key].weight}% of the score`}>
    <span>{label}</span><span className="bar-track"><i style={{ width: `${Math.round((parts[key].matched / parts[key].total) * 100)}%` }} /></span><b>{parts[key].matched}/{parts[key].total}</b>
  </li>)}</ul>;
}

export function AtsScore({ score, label = 'Estimated alignment' }) {
  return <div className="ats-score"><b>{score}%</b><span>{label}<small>Estimated alignment</small></span></div>;
}

/** Render the same final fields used by Word export, with plain-text fallback for older saved versions. */
export function ResumePreview({ tailored }) {
  const resume = tailored?.resume;
  if (!resume || typeof resume !== 'object') return <article className="resume-document"><pre className="resume-plain">{tailored?.text}</pre></article>;
  return <article className="resume-document" aria-label="Tailored resume preview">
    <header>
      {resume.name && <h3>{resume.name}</h3>}
      {resume.headline && <p className="resume-headline">{resume.headline}</p>}
      {list(resume.contact).length > 0 && <p className="resume-contact">{resume.contact.join(' · ')}</p>}
    </header>
    {resume.summary && <section><h4>Professional Summary</h4><p>{resume.summary}</p></section>}
    {(list(resume.skillGroups).length > 0 || list(resume.skills).length > 0) && <section>
      <h4>Skills</h4>
      {list(resume.skillGroups).length > 0
        ? resume.skillGroups.map((group, index) => <p key={`${group.name}-${index}`}><b>{group.name}:</b> {list(group.items).join(', ')}</p>)
        : <p>{list(resume.skills).join(', ')}</p>}
    </section>}
    {list(resume.sections).map((section, sectionIndex) => <section key={`${section.title}-${sectionIndex}`}>
      <h4>{section.title}</h4>
      {list(section.items).map((item, itemIndex) => <div className="resume-role" key={`${item.heading}-${itemIndex}`}>
        <div className="resume-role-heading"><b>{item.heading}</b>{item.dates && <span>{item.dates}</span>}</div>
        {item.subheading && <p className="resume-role-subheading">{item.subheading}</p>}
        {list(item.bullets).length > 0 && <ul>{item.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>}
      </div>)}
    </section>)}
  </article>;
}

function AdditionalDetails({ missingKeywords, disabled, onSaved, onBusyChange }) {
  const [mounted, setMounted] = useState(false);
  // Lazy-mount once on first open. Keeping drafts mounted thereafter lets an in-flight save finish safely.
  return <details className="resume-disclosure" onToggle={(event) => { if (event.currentTarget.open) setMounted(true); }}>
    <summary>Additional details <span className="muted small">(optional)</span></summary>
    {mounted && <div className="resume-disclosure-content"><ResumeExperience missingKeywords={missingKeywords} disabled={disabled} onSaved={onSaved} onBusyChange={onBusyChange} /></div>}
  </details>;
}

/** The default view keeps tailoring and the finished document together; all review tools are optional. */
export function ResumeTailorView({ ats, tailored = null, choices = { confirmed: [], learning: [] }, busy = false, refreshing = false, working = false, copied = false, error = '', onTailor, onChoose, onDownload, onCopy, onExperienceSaved, onExperienceBusy }) {
  const blocked = working || busy || refreshing;
  const report = selectResumeReport(ats, tailored);
  const review = reviewKeywords(ats, tailored);
  const selected = new Set(choices.confirmed.map(normal));
  const pending = hasPendingSkillChoices(tailored, choices);
  const evidence = list(tailored?.report?.evidenceMap);
  const requirements = list(report?.requirements);
  const questions = gapQuestions(tailored);
  const afterScore = tailored?.report?.after?.score ?? tailored?.ats_after;
  if (!ats.hasResume) return <div className="tailor resume-tailor">
    <div className="banner"><b>Start with your resume.</b> <Link to="/profile">Upload a resume</Link> to create a version for this job.</div>
    <AdditionalDetails missingKeywords={list(ats.missing)} disabled={blocked} onSaved={onExperienceSaved} onBusyChange={onExperienceBusy} />
    {error && <div className="error" role="alert">{error}</div>}
  </div>;
  return <div className="tailor resume-tailor">
    <div className="tailor-head">
      <AtsScore score={ats.score} label="Original" />
      {tailored && <><span className="arrow" aria-hidden="true">→</span><AtsScore score={afterScore} label="Tailored" /></>}
    </div>
    <div className="actions resume-main-actions">
      <button type="button" className="btn primary" onClick={onTailor} disabled={blocked}>{busy ? 'Tailoring your resume…' : tailored ? 'Re-tailor resume' : 'Tailor my resume'}</button>
      {tailored && <>
        <button type="button" className="btn" disabled={blocked} onClick={onDownload}>Download Word</button>
        <button type="button" className="btn" disabled={blocked} onClick={onCopy}>{copied ? 'Copied' : 'Copy text'}</button>
      </>}
    </div>
    {busy && <p className="muted small" role="status">Creating a resume for this role using your saved experience and selected skills.</p>}
    {refreshing && <p className="muted small" role="status">Updating your saved details…</p>}
    {error && <div className="error" role="alert">{error}</div>}
    {tailored && <section className="resume-preview"><h3>Your tailored resume</h3><ResumePreview tailored={tailored} /></section>}

    {review.length > 0 && <details className="resume-disclosure">
      <summary>Review skills <span className="muted small">(optional)</span></summary>
      <div className="resume-disclosure-content form">
        <p className="muted small">Choose any job skills you have that your resume does not mention yet. Skills already in your profile or saved confirmations are selected for you.</p>
        <div className="resume-skill-options">{review.map((keyword) => <label className="check" key={keyword}>
          <input type="checkbox" checked={selected.has(normal(keyword))} disabled={blocked} onChange={() => onChoose?.(keyword, 'confirmed')} />{keyword}
        </label>)}</div>
        {choices.learning.length > 0 && <details>
          <summary className="small">Currently learning</summary>
          <p className="muted small">These remain separate from the skills you selected above.</p>
          <div className="resume-skill-options">{choices.learning.map((keyword) => <label className="check" key={keyword}>
            <input type="checkbox" checked disabled={blocked} onChange={() => onChoose?.(keyword, 'learning')} />{keyword}
          </label>)}</div>
        </details>}
        {pending && <p className="muted small" role="status">Your selections will be used the next time you tailor.</p>}
        <div className="actions"><button type="button" className="btn" disabled={blocked} onClick={onTailor}>Use selected skills and tailor</button></div>
      </div>
    </details>}

    <AdditionalDetails missingKeywords={list(report?.missing)} disabled={blocked} onSaved={onExperienceSaved} onBusyChange={onExperienceBusy} />

    <details className="resume-disclosure resume-analysis">
      <summary>Analysis details</summary>
      <div className="resume-disclosure-content form">
        <p className="muted small">Estimated resume alignment, separate from your profile-to-job match. Target: 85–95% when supported. Employer systems may score differently.</p>
        <Breakdown parts={report?.breakdown} />
        <div className="kw"><h5>Keyword coverage in this {tailored?.report?.after ? 'tailored' : 'original'} version</h5><div className="tags">
          {list(report?.matched).map((keyword) => <span className="tag kw-hit" key={`matched-${keyword}`}>✓ {keyword}</span>)}
          {list(report?.missing).map((keyword) => <span className="tag kw-miss" key={`missing-${keyword}`} title="Not mentioned in this version">{keyword}</span>)}
          {list(report?.learningTerms).map((keyword) => <span className="tag learning" key={`learning-${keyword}`}>Learning: {keyword}</span>)}
        </div></div>
        {requirements.length > 0 && <div><h5>Job requirements</h5><ul className="changes">{requirements.map((requirement, index) => <li key={requirement.id || index}>
          <b>{priorityLabel(requirement.priority)}: {list(requirement.terms).join(' or ')}</b>{' · '}{requirement.status === 'matched' ? `Matched: ${list(requirement.matchedTerms).join(', ') || 'related wording'}` : 'Not mentioned in this version'}
        </li>)}</ul></div>}
        {list(report?.checks).length > 0 && <div><h5>Formatting checks</h5><ul className="changes">{report.checks.map((check) => <li key={check.label}><b>{check.ok ? '✓ ' : ''}{check.label}</b>{!check.ok && check.tip ? `: ${check.tip}` : ''}</li>)}</ul></div>}
        {tailored?.changes?.length > 0 && <div><h5>What changed</h5><ul className="changes">{tailored.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></div>}
        {questions.length > 0 && <div><h5>Optional context for another revision</h5><ul className="changes">{questions.map((question) => <li key={question}>{question}</li>)}</ul><p className="muted small">You can add context under Additional details.</p></div>}
        {evidence.length > 0 && <details className="ats-checks"><summary>Sources used</summary><ul>{evidence.map((row, index) => <li key={`${row.keyword}-${index}`}>
          <b>{row.keyword}</b> · {priorityLabel(row.priority)} · {({ demonstrated: 'From your saved experience', confirmed: 'Confirmed skill', learning: 'Currently learning', unsupported: 'Not documented yet' })[row.status] || 'Available for review'}
          {list(row.sources).map((source, sourceIndex) => <blockquote key={sourceIndex}>{source.quote}</blockquote>)}
        </li>)}</ul></details>}
        {tailored?.report?.refinement && <p className="muted small">Refinement passes: {tailored.report.refinement.attempts}/{tailored.report.refinement.maxAttempts || 2}. {tailored.report.refinement.reason}</p>}
        {tailored && !tailored.ai && <p className="muted small">Built-in tailoring was used for this version.</p>}
      </div>
    </details>
  </div>;
}

export default function ResumeTailor({ jobId }) {
  return <ResumeTailorJob key={jobId} jobId={jobId} />;
}

function ResumeTailorJob({ jobId }) {
  const [ats, setAts] = useState(null);
  const [tailored, setTailored] = useState(null);
  const [choices, setChoices] = useState({ confirmed: [], learning: [] });
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [experienceBusy, setExperienceBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [requestGate] = useState(createResumeRequestGate);
  const copyTimer = useRef(null);

  useEffect(() => {
    const request = requestGate.begin(jobId);
    api(`/jobs/${jobId}/ats`).then((data) => {
      if (!requestGate.accepts(request)) return;
      setAts(data); setTailored(data.tailored || null); setChoices(initialSkillChoices(data, data.tailored));
    }).catch((failure) => { if (requestGate.accepts(request)) setError(failure.message); });
    return () => { requestGate.invalidate(); clearTimeout(copyTimer.current); };
  }, [jobId, requestGate]);

  const experienceSaved = async () => {
    if (!requestGate.current) return;
    const request = requestGate.begin(jobId);
    setTailored(null); setCopied(false); setBusy(false); setExperienceBusy(false); setRefreshing(true); setError('');
    try {
      const current = await api(`/jobs/${jobId}/ats`);
      if (requestGate.accepts(request)) { setAts(current); setChoices(initialSkillChoices(current, null)); }
    } catch (failure) {
      if (requestGate.accepts(request)) setError(`Your details are saved. Reopen this job to refresh its assessment. ${failure.message}`);
    } finally { if (requestGate.accepts(request)) setRefreshing(false); }
  };
  const tailor = async () => {
    const request = requestGate.begin(jobId);
    setBusy(true); setError('');
    try {
      const result = await api(`/jobs/${jobId}/tailor`, { method: 'POST', body: { confirmedSkills: choices.confirmed, learningSkills: choices.learning } });
      if (requestGate.accepts(request)) {
        const original = mergeOriginalReport(ats, result);
        setAts(original); setTailored(result); setChoices(initialSkillChoices(original, result)); setCopied(false);
      }
    } catch (failure) { if (requestGate.accepts(request)) setError(failure.message); }
    finally { if (requestGate.accepts(request)) setBusy(false); }
  };
  const copy = async () => {
    const request = requestGate.current;
    try {
      await navigator.clipboard.writeText(tailored.text);
      if (!requestGate.accepts(request)) return;
      setCopied(true); clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => { if (requestGate.accepts(request)) setCopied(false); }, 2000);
    } catch (failure) { if (requestGate.accepts(request)) setError(failure.message); }
  };
  const downloadResume = async () => {
    const request = requestGate.current;
    try { await download(`/jobs/${jobId}/tailor/docx`, 'resume.docx'); }
    catch (failure) { if (requestGate.accepts(request)) setError(failure.message); }
  };
  if (error && !ats) return <div className="error">{error}</div>;
  if (!ats) return <p className="muted small">Loading your resume…</p>;
  return <ResumeTailorView ats={ats} tailored={tailored} choices={choices} busy={busy} refreshing={refreshing} working={busy || refreshing || experienceBusy} copied={copied} error={error}
    onTailor={tailor} onChoose={(keyword, kind) => setChoices((current) => chooseSkill(current, keyword, kind))} onDownload={downloadResume} onCopy={copy} onExperienceSaved={experienceSaved} onExperienceBusy={setExperienceBusy} />;
}
