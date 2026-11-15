import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from './api';
import ResumeExperience from './ResumeExperience.jsx';
import { chooseSkill, createResumeRequestGate, gapQuestions, hasPendingSkillChoices, mergeOriginalReport, priorityLabel, reviewKeywords, savedSkillChoices, selectResumeReport } from './resumeReport';

const TARGET = 85;
const scoreLabel = (s) => (s >= TARGET ? 'Target reached' : s >= 65 ? 'Good alignment' : s >= 45 ? 'Some alignment' : 'Limited alignment');
const tone = (s) => (s >= TARGET ? 'high' : s >= 45 ? 'mid' : 'low');
const PARTS = { hardSkills: 'Hard skills', title: 'Job title', softSkills: 'Soft skills', format: 'Document format' };

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

export function AtsScore({ score, label = 'Estimated alignment' }) {
  return (
    <div className={`ats-score m-${tone(score)}`}>
      <b>{score}%</b>
      <span>{label}<small>{scoreLabel(score)}</small></span>
    </div>
  );
}

/** ATS check of the user's resume against one job, plus creating and downloading a tailored version. */
export default function ResumeTailor({ jobId }) {
  // A different job receives fresh state immediately, before any asynchronous loading effects run.
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
    api(`/jobs/${jobId}/ats`).then((d) => {
      if (!requestGate.accepts(request)) return;
      setAts(d);
      setTailored(d.tailored || null);
      setChoices(savedSkillChoices(d.tailored));
    }).catch((e) => {
      if (!requestGate.accepts(request)) return;
      setError(e.message);
    });
    return () => {
      requestGate.invalidate();
      clearTimeout(copyTimer.current);
    };
  }, [jobId, requestGate]);

  const experienceSaved = async () => {
    const request = requestGate.begin(jobId);
    setTailored(null);
    setCopied(false);
    setBusy(false);
    setExperienceBusy(false);
    setRefreshing(true);
    setError('');
    try {
      const current = await api(`/jobs/${jobId}/ats`);
      if (requestGate.accepts(request)) setAts(current);
    } catch (failure) {
      if (requestGate.accepts(request)) setError(`Your experience is saved, but this assessment could not refresh. Reopen this job to try again. ${failure.message}`);
    } finally {
      if (requestGate.accepts(request)) setRefreshing(false);
    }
  };
  const working = busy || refreshing || experienceBusy;

  if (error && !ats) return <div className="error">{error}</div>;
  if (!ats) return <p className="muted small">Checking your resume against this job…</p>;
  if (!ats.hasResume) {
    return (
      <div className="tailor">
        <div className="banner"><b>See how your resume scores for this job.</b> <Link to="/profile">Upload your resume</Link> on the Profile page first (PDF or Word).</div>
        <ResumeExperience missingKeywords={ats.missing || []} disabled={busy || refreshing} onSaved={experienceSaved} onBusyChange={setExperienceBusy} />
        {error && <div className="error">{error}</div>}
      </div>
    );
  }

  const report = selectResumeReport(ats, tailored);
  const { confirmed, learning } = choices;
  const review = reviewKeywords(ats, tailored);
  const evidence = tailored?.report?.evidenceMap || [];
  const requirements = report.requirements || [];
  const pending = hasPendingSkillChoices(tailored, choices);
  const questions = gapQuestions(tailored);
  const tailoredScore = tailored?.report?.after?.score ?? tailored?.ats_after;
  const choose = (keyword, kind) => setChoices((current) => chooseSkill(current, keyword, kind));
  const tailor = async () => {
    const request = requestGate.begin(jobId);
    setBusy(true); setError('');
    try {
      const result = await api(`/jobs/${jobId}/tailor`, { method: 'POST', body: { confirmedSkills: confirmed, learningSkills: learning } });
      if (requestGate.accepts(request)) {
        setAts((current) => mergeOriginalReport(current, result));
        setTailored(result);
        setChoices(savedSkillChoices(result));
        setCopied(false);
      }
    } catch (e) {
      if (requestGate.accepts(request)) setError(e.message);
    } finally {
      if (requestGate.accepts(request)) setBusy(false);
    }
  };
  const copy = async () => {
    const request = requestGate.current;
    try {
      await navigator.clipboard.writeText(tailored.text);
      if (!requestGate.accepts(request)) return;
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => { if (requestGate.accepts(request)) setCopied(false); }, 2000);
    } catch (e) { if (requestGate.accepts(request)) setError(e.message); }
  };
  const downloadResume = async () => {
    const request = requestGate.current;
    try { await download(`/jobs/${jobId}/tailor/docx`, 'resume.docx'); }
    catch (e) { if (requestGate.accepts(request)) setError(e.message); }
  };
  const failing = (report.checks || []).filter((c) => !c.ok);

  return (
    <div className="tailor">
      <div className="tailor-head">
        <AtsScore score={ats.score} label="Original resume" />
        {tailored && <><span className="arrow" aria-hidden>→</span><AtsScore score={tailoredScore} label="Tailored resume" /></>}
        <span className="muted small target">Target: {TARGET}–95% when supported</span>
      </div>
      <p className="muted small">
        Estimated resume alignment with this job, separate from your profile-to-job match. A higher score does not guarantee an employer's ATS result or an interview. Include only skills you can support.
      </p>
      <Breakdown parts={report.breakdown} />

      <div className="kw">
        <h5>Keyword coverage in your {tailored ? 'tailored' : 'original'} resume</h5>
        <div className="tags">
          {(report.matched || []).map((k) => <span key={`matched-${k}`} className="tag kw-hit" title="Found in the latest assessed version">✓ {k}</span>)}
          {(report.missing || []).map((k) => <span key={`missing-${k}`} className="tag kw-miss" title="Not demonstrated in the latest assessed version">{k}</span>)}
          {(report.learningTerms || []).map((k) => <span key={`learning-${k}`} className="tag learning" title="Learning does not establish proficiency">Learning: {k}</span>)}
        </div>
        {requirements.length > 0 && <details className="ats-checks">
          <summary>Required, preferred, and alternative requirements</summary>
          <ul>{requirements.map((requirement, index) => <li key={requirement.id || index}>
            <b>{priorityLabel(requirement.priority)}: {(requirement.terms || []).join(' or ')}</b>
            {' — '}{requirement.status === 'matched' ? `Found: ${(requirement.matchedTerms || []).join(', ') || 'supported wording'}` : 'Not demonstrated yet'}
          </li>)}</ul>
        </details>}
      </div>

      <ResumeExperience missingKeywords={report.missing || []} disabled={busy || refreshing} onSaved={experienceSaved} onBusyChange={setExperienceBusy} />
      {refreshing && <p className="muted small" role="status">Updating this job's assessment with your saved experience…</p>}

      {review.length > 0 && <div className="kw">
        <h5>Confirm your experience, one skill at a time</h5>
        <p className="muted small">
          Choose <b>I have it</b> only for skills you can substantiate. Choose <b>Learning</b> only for active study; it appears as professional development and does not count as demonstrated proficiency.
        </p>
        <div className="tags">{review.map((keyword) => {
          const row = evidence.find((item) => item.keyword?.toLowerCase() === keyword.toLowerCase());
          return <span key={keyword} className={`tag kw-miss ${confirmed.includes(keyword) ? 'on' : ''} ${learning.includes(keyword) ? 'learning' : ''}`} title={row?.question}>
            {keyword}{row?.priority && <small> · {priorityLabel(row.priority)}</small>}
            <button type="button" disabled={working} className={confirmed.includes(keyword) ? 'on' : ''} onClick={() => choose(keyword, 'confirmed')} aria-pressed={confirmed.includes(keyword)}>I have it</button>
            <button type="button" disabled={working} className={learning.includes(keyword) ? 'on' : ''} onClick={() => choose(keyword, 'learning')} aria-pressed={learning.includes(keyword)}>Learning</button>
          </span>;
        })}</div>
        {pending && <div className="banner small" role="status">
          Your selections are pending. {tailored ? 'Re-tailor to update this saved version and its assessment.' : 'Tailor your resume to apply these selections.'} Keyword tags and formatting checks continue to describe the currently assessed version.
        </div>}
      </div>}

      {failing.length > 0 && (
        <details className="ats-checks">
          <summary>{failing.length} formatting {failing.length === 1 ? 'issue' : 'issues'} in the {tailored ? 'tailored' : 'original'} version</summary>
          <ul>{failing.map((c) => <li key={c.label}><b>{c.label}:</b> {c.tip}</li>)}</ul>
        </details>
      )}

      <div className="actions">
        <button type="button" className="btn primary" onClick={tailor} disabled={working}>
          {busy ? 'Tailoring and checking evidence…' : tailored ? '↻ Re-tailor resume' : '✨ Tailor my resume for this job'}
        </button>
        {tailored && <button type="button" className="btn" disabled={working} onClick={downloadResume}>⬇ Download Word (.docx)</button>}
        {tailored && <button type="button" className="btn" disabled={working} onClick={copy}>{copied ? 'Copied ✓' : 'Copy as text'}</button>}
      </div>
      {error && <div className="error">{error}</div>}

      {tailored && (
        <>
          {!tailored.ai && tailored.report?.aiNote && <div className="banner small"><b>Built-in tailoring used.</b> An AI revision was unavailable or did not improve the supported result. Review the evidence and preview below.</div>}
          {tailored.report?.gap && (
            <div className={`banner small ${tailored.report.gap.weakFit ? 'error-banner' : ''}`}>
              <b>Remaining gaps at {tailoredScore}% estimated alignment.</b> {tailored.report.gap.message}
              {tailored.report.gap.missing?.length > 0 && <> Missing: {tailored.report.gap.missing.join(', ')}.</>}
            </div>
          )}
          {tailoredScore >= TARGET && <div className="banner ok small">✓ The current estimate meets the {TARGET}% target. Review every claim before applying.</div>}
          {questions.length > 0 && <div className="banner small">
            <b>Details that could address the remaining gaps</b>
            <ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul>
            Add truthful examples to your <Link to="/profile">Profile</Link>, then re-tailor. Leave unsupported skills unselected.
          </div>}
          {evidence.length > 0 && <details className="ats-checks">
            <summary>Evidence and confirmations used for this version</summary>
            <ul>{evidence.map((row, index) => <li key={`${row.keyword}-${index}`}>
              <b>{row.keyword}</b> · {priorityLabel(row.priority)} · {({ demonstrated: 'Supported by your resume or profile', confirmed: 'Confirmed by you', learning: 'Learning only; no proficiency credit', unsupported: 'No supporting evidence yet' })[row.status] || 'Awaiting review'}
              {row.terms?.length > 1 && <p className="muted small">Alternatives: {row.terms.join(' or ')}</p>}
              {row.sources?.map((source, sourceIndex) => <blockquote key={sourceIndex}>{source.quote} <small className="muted">({source.source})</small></blockquote>)}
            </li>)}</ul>
          </details>}
          {tailored.report?.refinement && <p className="muted small">
            Refinement passes: {tailored.report.refinement.attempts} of {tailored.report.refinement.maxAttempts || 2}. {tailored.report.refinement.reason}
          </p>}
          <ul className="changes">{(tailored.changes || []).map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="muted small">
            {tailored.ai ? 'AI-assisted tailoring uses your resume, profile, and individual confirmations, with evidence checks and bounded refinement.' : 'Tailored with built-in rules using your resume, profile, and individual confirmations.'}
            {' '}Learning stays separate from experience. Standard sections and a simple layout improve readability; a higher estimate cannot replace missing qualifications. Review the preview and evidence before sending this version.
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
