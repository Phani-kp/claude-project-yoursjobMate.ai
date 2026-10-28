import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';

export default function Login() {
  const { user, login } = useAuth();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState('/');
  if (user) return <Navigate to={dest} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: form });
      setDest(mode === 'signup' ? '/profile' : '/');
      login(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="brand"><span className="logo">J</span> YoursJobMate</div>
        <h1>Your AI job-search co-pilot.</h1>
        <p>Set your preferences once. YoursJobMate finds matching roles, tailors a cover letter for each one, applies for you and tracks every application live.</p>
        <ul>
          <li>Smart job matching with match scores</li>
          <li>AI-tailored cover letters</li>
          <li>Auto-apply with daily limits</li>
          <li>Real-time applied-jobs tracker</li>
        </ul>
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        {mode === 'signup' && <label>Full name<input value={form.name} onChange={set('name')} required /></label>}
        <label>Email<input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>Password<input type="password" value={form.password} onChange={set('password')} minLength={6} required /></label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
        <p className="muted small">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </a>
        </p>
      </form>
    </div>
  );
}
