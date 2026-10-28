import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo } from '../api';
import { useLive } from '../useLive';
import { Stat } from '../components';
import { useAuth } from '../App';

const FUNNEL = ['applied', 'viewed', 'interview', 'offer', 'rejected'];

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);

  const load = useCallback(() => {
    api('/stats').then(setStats);
    api('/events?limit=15').then(setEvents);
  }, []);
  useEffect(load, [load]);

  useLive({
    'event:new': (e) => { setEvents((list) => [e, ...list].slice(0, 15)); api('/stats').then(setStats); },
  });

  const toggleAgent = async () => {
    await api('/profile', { method: 'PUT', body: { auto_apply: !stats.agent.enabled } });
    load();
  };

  if (!stats) return <div className="muted">Loading…</div>;
  const max = Math.max(1, ...stats.perDay.map((d) => d.count));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Hi {user.name.split(' ')[0]} 👋</h1>
          <p className="muted">Here's your job search at a glance.</p>
        </div>
        <div className="actions">
          <button className={`btn ${stats.agent.enabled ? '' : 'primary'}`} onClick={toggleAgent}>
            {stats.agent.enabled ? 'Pause auto-apply' : 'Start auto-apply'}
          </button>
          {stats.agent.enabled && <button className="btn" onClick={() => api('/agent/run', { method: 'POST' })}>Run now</button>}
        </div>
      </div>

      <div className={`banner ${stats.agent.enabled ? 'ok' : ''}`}>
        {stats.agent.enabled
          ? <>Auto-apply is <b>on</b>: up to {stats.agent.dailyLimit} applications/day for jobs at or above a {stats.agent.minMatch}% match.</>
          : <>Auto-apply is <b>off</b>. Fill in your <Link to="/profile">profile</Link>, then start the agent.</>}
      </div>

      <div className="grid stats">
        <Stat label="Total applied" value={stats.total} hint={`${stats.today} today`} />
        <Stat label="Interviews" value={stats.interviews} />
        <Stat label="Offers" value={stats.offers} />
        <Stat label="Response rate" value={`${stats.responseRate}%`} hint="viewed, interview, offer or rejected" />
      </div>

      <div className="grid two">
        <section className="card">
          <h3>Applications, last 14 days</h3>
          <div className="bars" role="img" aria-label="Applications per day">
            {stats.perDay.map((d) => (
              <div key={d.day} className="bar-col" title={`${d.day}: ${d.count}`}>
                <span className="bar-val">{d.count || ''}</span>
                <div className="bar" style={{ height: `${(d.count / max) * 100}%` }} />
                <span className="bar-lbl">{new Date(`${d.day}T00:00`).getDate()}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>Pipeline</h3>
          <div className="funnel">
            {FUNNEL.map((s) => (
              <Link key={s} to={`/applied-jobs?status=${s}`} className="funnel-row">
                <span className={`dot s-${s}`} />
                <span className="cap">{s}</span>
                <span className="funnel-track"><span className={`funnel-fill s-${s}`} style={{ width: `${stats.total ? (stats.byStatus[s] / stats.total) * 100 : 0}%` }} /></span>
                <b>{stats.byStatus[s]}</b>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="row-between"><h3>Live activity</h3><Link to="/applied-jobs">View all applications →</Link></div>
        {events.length === 0 && <p className="muted">No activity yet. Apply to a job or start the agent.</p>}
        <ul className="feed">
          {events.map((e) => (
            <li key={e.id} className="feed-item">
              <span className={`dot t-${e.type}`} />
              <span>{e.message}</span>
              <span className="muted small">{timeAgo(e.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
