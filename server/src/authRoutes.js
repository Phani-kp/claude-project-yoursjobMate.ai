import { Router } from 'express';
import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { db } from './db.js';
import { checkPassword, hashPassword, hmac, signToken } from './auth.js';
import { sendPasswordChangedEmail, sendPasswordResetEmail, sendVerificationEmail } from './mailer.js';

const OTP_TTL_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EXISTS = 'An account with this email already exists. Try logging in.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });
const normEmail = (email) => String(email || '').trim().toLowerCase();
const findUser = (email) => db.get('SELECT * FROM users WHERE email = ?', normEmail(email));
const getUser = (id) => db.get('SELECT * FROM users WHERE id = ?', id);
const passwordError = (p) =>
  typeof p !== 'string' || p.length < PASSWORD_MIN ? `Password must be at least ${PASSWORD_MIN} characters`
  : Buffer.byteLength(p) > PASSWORD_MAX ? `Password must be at most ${PASSWORD_MAX} characters`
  : null;

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const otpCooldown = (u) => Math.max(0, Math.ceil(((u.otp_sent_at || 0) + OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000));
const otpHash = (userId, purpose, code) => hmac(`${userId}:${purpose}:${code}`);

async function issueOtp(user, purpose) {
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  await db.run('UPDATE users SET otp_hash = ?, otp_purpose = ?, otp_expires_at = ?, otp_sent_at = ?, otp_attempts = 0 WHERE id = ?',
    otpHash(user.id, purpose, code), purpose, now + OTP_TTL_MINUTES * 60_000, now, user.id);
  try {
    const send = purpose === 'reset' ? sendPasswordResetEmail : sendVerificationEmail;
    await send(user.email, user.name, code, OTP_TTL_MINUTES);
  } catch (err) {
    console.error(`[mail] failed to send ${purpose} code to user ${user.id}:`, err.message);
    await db.run('UPDATE users SET otp_sent_at = NULL WHERE id = ?', user.id);
    throw Object.assign(new Error("We couldn't send the email. Please try again in a moment."), { status: 502, expose: true });
  }
}

/** Checks a submitted code. Returns an error response body, or null if the code is correct (and consumes it). */
async function checkOtp(user, purpose, code) {
  if (!user.otp_hash || user.otp_purpose !== purpose || Date.now() > user.otp_expires_at) return { status: 400, error: 'This code has expired. Request a new one.' };
  if (user.otp_attempts >= OTP_MAX_ATTEMPTS) return { status: 429, error: 'Too many wrong attempts. Request a new code.' };
  if (!safeEqual(otpHash(user.id, purpose, String(code || '').trim()), user.otp_hash)) {
    await db.run('UPDATE users SET otp_attempts = otp_attempts + 1 WHERE id = ?', user.id);
    const left = OTP_MAX_ATTEMPTS - user.otp_attempts - 1;
    return { status: 400, error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many wrong attempts. Request a new code.' };
  }
  await db.run('UPDATE users SET otp_hash = NULL, otp_purpose = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?', user.id);
  return null;
}

const limiter = (windowMinutes, limit) => rateLimit({
  windowMs: windowMinutes * 60_000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

export function authRouter() {
  const r = Router();
  // Per-IP limits on top of the per-account code limits, against credential stuffing and email spam.
  const strict = limiter(15, 10);
  const normal = limiter(15, 30);

  r.post('/signup', strict, wrap(async (req, res) => {
    const { password } = req.body || {};
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const email = normEmail(req.body?.email);
    if (!name) return res.status(400).json({ error: 'Please enter your name' });
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Please enter a valid email address' });
    const pwErr = passwordError(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const existing = await findUser(email);
    if (existing?.verified) return res.status(409).json({ error: EXISTS });
    const hash = await hashPassword(password);
    let id;
    if (existing) {
      // Sign-up retried before verifying: take the new details and send a fresh code.
      await db.run('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', name, hash, existing.id);
      id = existing.id;
    } else {
      try {
        id = await db.transaction(async (t) => {
          const [row] = (await t.run('INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, 0) RETURNING id', email, name, hash)).rows;
          await t.run('INSERT INTO profiles (user_id) VALUES (?)', row.id);
          return row.id;
        });
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: EXISTS }); // same email signed up at the same moment
        throw err;
      }
    }
    const user = await getUser(id);
    if (otpCooldown(user) === 0) await issueOtp(user, 'verify');
    res.status(201).json({ needsVerification: true, email, retryAfter: otpCooldown(await getUser(id)) });
  }));

  r.post('/verify', normal, wrap(async (req, res) => {
    const user = await findUser(req.body?.email);
    if (!user || user.verified) return res.status(400).json({ error: 'This email is already verified or has no pending sign-up. Try logging in.' });
    const err = await checkOtp(user, 'verify', req.body?.code);
    if (err) return res.status(err.status).json({ error: err.error });
    await db.run('UPDATE users SET verified = 1 WHERE id = ?', user.id);
    res.json({ token: signToken(user), user: publicUser(user) });
  }));

  r.post('/resend-otp', strict, wrap(async (req, res) => {
    const user = await findUser(req.body?.email);
    if (!user || user.verified) return res.status(400).json({ error: 'This email is already verified or has no pending sign-up. Try logging in.' });
    const wait = otpCooldown(user);
    if (wait) return res.status(429).json({ error: `Please wait ${wait}s before requesting another code`, retryAfter: wait });
    await issueOtp(user, 'verify');
    res.json({ ok: true, retryAfter: OTP_RESEND_SECONDS });
  }));

  r.post('/login', strict, wrap(async (req, res) => {
    const user = await findUser(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const check = user ? await checkPassword(password, user.password_hash) : { ok: false };
    if (!check.ok) return res.status(401).json({ error: 'Invalid email or password' });
    // Upgrade hashes created before the password pepper existed.
    if (check.needsRehash) await db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
    if (!user.verified) {
      if (otpCooldown(user) === 0) await issueOtp(user, 'verify');
      return res.status(403).json({ error: 'Please verify your email first. We sent you a code.', needsVerification: true, email: user.email, retryAfter: otpCooldown(await getUser(user.id)) });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  }));

  // Always answers the same way, so it can't be used to find out who has an account.
  r.post('/forgot-password', strict, wrap(async (req, res) => {
    const user = await findUser(req.body?.email);
    if (user && otpCooldown(user) === 0) await issueOtp(user, 'reset');
    res.json({ ok: true, retryAfter: OTP_RESEND_SECONDS });
  }));

  r.post('/reset-password', normal, wrap(async (req, res) => {
    const { code, password } = req.body || {};
    const pwErr = passwordError(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    const user = await findUser(req.body?.email);
    if (!user) return res.status(400).json({ error: 'This code has expired. Request a new one.' });
    const err = await checkOtp(user, 'reset', code);
    if (err) return res.status(err.status).json({ error: err.error });
    // The code proves the user owns the email, so this also verifies an unverified account.
    await db.run('UPDATE users SET password_hash = ?, verified = 1, token_version = token_version + 1 WHERE id = ?', await hashPassword(password), user.id);
    sendPasswordChangedEmail(user.email, user.name).catch((e) => console.error('[mail] password-changed notice failed:', e.message));
    const updated = await getUser(user.id);
    res.json({ token: signToken(updated), user: publicUser(updated) });
  }));

  return r;
}
