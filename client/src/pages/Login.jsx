import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';

const RESEND_SECONDS = 60;
const PASSWORD_MIN = 8;
// The server only sends the code back when it has no email service (development).
function DevCode({ code }) {
  return (
    <div className="notice dev-code" role="status">
      Email sending isn't set up on this server yet, so no email was sent. Your code is:{' '}
      <strong>{code}</strong>
    </div>
  );
}

/** Password box with a Show/Hide toggle, so autofilled passwords can be checked. */
function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="btn ghost sm" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
    </span>
  );
}

function CodeInput({ value, onChange }) {
  return (
    <label>6-digit code
      <input
        className="otp-input"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        placeholder="••••••"
        autoFocus
        required
      />
    </label>
  );
}

export default function Login() {
  const { user, login } = useAuth();
  // login | signup | verify (email code after sign-up) | forgot (ask for reset code) | reset (code + new password)
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState('/');

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (user) return <Navigate to={dest} replace />;

  const go = (m, { keepNotice = false } = {}) => { setMode(m); setError(''); if (!keepNotice) setNotice(''); setCode(''); setDevCode(''); };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const run = (fn) => async (e) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message); if (err.data?.retryAfter) setCooldown(err.data.retryAfter); } finally { setBusy(false); }
  };

  const startVerify = (data, fromSignup) => {
    setPendingEmail(data.email);
    setCooldown(data.retryAfter ?? RESEND_SECONDS);
    setDest(fromSignup ? '/profile' : '/');
    go('verify');
    setDevCode(data.devCode || '');
  };

  const submit = run(async () => {
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: form });
      if (data.needsVerification) return startVerify(data, true);
      setDest('/');
      login(data);
    } catch (err) {
      if (!err.data?.needsVerification) throw err;
      startVerify(err.data, false);
    }
  });

  const verify = run(async () => login(await api('/auth/verify', { method: 'POST', body: { email: pendingEmail, code } })));

  const resendVerify = run(async () => {
    const data = await api('/auth/resend-otp', { method: 'POST', body: { email: pendingEmail } });
    setCooldown(data.retryAfter || RESEND_SECONDS);
    setDevCode(data.devCode || '');
    setNotice(data.devCode ? '' : 'A new code is on its way.');
  });

  const requestReset = run(async () => {
    const email = (pendingEmail || form.email).trim();
    const data = await api('/auth/forgot-password', { method: 'POST', body: { email } });
    setPendingEmail(email);
    setCooldown(data.retryAfter || RESEND_SECONDS);
    setNotice(data.devCode ? '' : `If an account exists for ${email}, we've sent it a reset code.`);
    if (mode !== 'reset') go('reset', { keepNotice: true });
    setDevCode(data.devCode || '');
  });

  const reset = run(async () => {
    const data = await api('/auth/reset-password', { method: 'POST', body: { email: pendingEmail, code, password: newPassword } });
    setDest('/');
    login(data);
  });

  const resendLink = (onClick) => (cooldown > 0
    ? <span>resend in {cooldown}s</span>
    : <a href="#" onClick={(e) => { e.preventDefault(); onClick(); }}>resend the code</a>);
  const backToLogin = <p className="muted small"><a href="#" onClick={(e) => { e.preventDefault(); setPendingEmail(''); go('login'); }}>Back to log in</a></p>;
  const messages = <>{error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice small" role="status">{notice}</div>}</>;

  let card;
  if (mode === 'verify') {
    card = (
      <form className="card auth-card" onSubmit={verify}>
        <h2>Check your email</h2>
        {devCode ? <DevCode code={devCode} /> : <p className="muted small">We sent a 6-digit code to <strong>{pendingEmail}</strong>. It expires in 10 minutes.</p>}
        <CodeInput value={code} onChange={setCode} />
        {messages}
        <button className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify email'}</button>
        <p className="muted small">Didn't get it? Check your spam folder or {resendLink(resendVerify)}.</p>
        {backToLogin}
      </form>
    );
  } else if (mode === 'forgot') {
    card = (
      <form className="card auth-card" onSubmit={requestReset}>
        <h2>Reset your password</h2>
        <p className="muted small">Enter your account email and we'll send you a code to set a new password.</p>
        <label>Email<input type="email" value={form.email} onChange={set('email')} autoComplete="email" autoFocus required /></label>
        {messages}
        <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send reset code'}</button>
        {backToLogin}
      </form>
    );
  } else if (mode === 'reset') {
    card = (
      <form className="card auth-card" onSubmit={reset}>
        <h2>Set a new password</h2>
        {devCode ? <DevCode code={devCode} /> : <p className="muted small">Enter the code we emailed to <strong>{pendingEmail}</strong> and choose a new password.</p>}
        <CodeInput value={code} onChange={setCode} />
        <label>New password<PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={PASSWORD_MIN} maxLength={128} autoComplete="new-password" required /></label>
        {messages}
        <button className="btn primary" disabled={busy || code.length !== 6}>{busy ? 'Saving…' : 'Reset password and log in'}</button>
        <p className="muted small">Didn't get it? Check your spam folder or {resendLink(requestReset)}.</p>
        {backToLogin}
      </form>
    );
  } else {
    const signup = mode === 'signup';
    card = (
      <form className="card auth-card" onSubmit={submit}>
        <h2>{signup ? 'Create your account' : 'Welcome back'}</h2>
        {signup && <label>Full name<input value={form.name} onChange={set('name')} autoComplete="name" maxLength={100} required /></label>}
        <label>Email<input type="email" value={form.email} onChange={set('email')} autoComplete="email" required /></label>
        <label>
          <span className="label-row">Password
            {!signup && <a href="#" className="small" onClick={(e) => { e.preventDefault(); setPendingEmail(''); go('forgot'); }}>Forgot password?</a>}
          </span>
          <PasswordInput value={form.password} onChange={set('password')} minLength={signup ? PASSWORD_MIN : undefined} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} required />
          {signup && <span className="muted small">At least {PASSWORD_MIN} characters</span>}
        </label>
        {messages}
        {!signup && error === 'Invalid email or password' && (
          <p className="muted small">Your browser may have filled in an old saved password. Click <b>Show</b> to check it, or use <b>Forgot password?</b> to set a new one.</p>
        )}
        <button className="btn primary" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Sign up' : 'Log in'}</button>
        <p className="muted small">
          {signup ? 'Already have an account? ' : "Don't have an account? "}
          <a href="#" onClick={(e) => { e.preventDefault(); go(signup ? 'login' : 'signup'); }}>{signup ? 'Log in' : 'Sign up'}</a>
        </p>
      </form>
    );
  }

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
      {card}
    </div>
  );
}
