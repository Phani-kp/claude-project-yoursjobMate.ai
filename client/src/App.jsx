import { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api, closeSocket, getSocket, getToken, setToken } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import SavedJobs from './pages/SavedJobs';
import AppliedJobs from './pages/AppliedJobs';
import Profile from './pages/Profile';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ai, setAi] = useState(false);
  const [loading, setLoading] = useState(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api('/me').then((d) => { setUser(d.user); setAi(d.ai); }).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = ({ token, user }) => { setToken(token); setUser(user); };
  const logout = () => { setToken(null); closeSocket(); setUser(null); };
  return <AuthContext.Provider value={{ user, ai, loading, login, logout }}>{children}</AuthContext.Provider>;
}

function Shell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [live, setLive] = useState(false);
  const [agent, setAgent] = useState({ running: false });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const s = getSocket();
    const on = () => setLive(true);
    const off = () => setLive(false);
    s.on('connect', on); s.on('disconnect', off); s.on('agent:status', setAgent);
    if (s.connected) on();
    return () => { s.off('connect', on); s.off('disconnect', off); s.off('agent:status', setAgent); };
  }, [user]);

  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  const nav = [
    ['/', 'Dashboard', '◧'],
    ['/jobs', 'Job Matches', '⌕'],
    ['/saved', 'Saved Jobs', '★'],
    ['/applied-jobs', 'Applied Jobs', '✓'],
    ['/profile', 'Profile & Resume', '☺'],
  ];
  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand"><span className="logo">J</span> YoursJobMate</div>
        <nav>
          {nav.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)}>
              <span className="nav-icon">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">{user.name}<small>{user.email}</small></div>
          <button className="btn ghost sm" onClick={() => { logout(); navigate('/login'); }}>Log out</button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="btn ghost sm menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">☰</button>
          <div className="spacer" />
          {agent.running && <span className="pill pulse">Agent applying{agent.queued ? ` · ${agent.queued} queued` : ''}…</span>}
          <span className={`live ${live ? 'on' : ''}`}><i /> {live ? 'Live' : 'Offline'}</span>
        </header>
        <div className="content"><Outlet /></div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/saved" element={<SavedJobs />} />
            <Route path="/applied-jobs" element={<AppliedJobs />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
