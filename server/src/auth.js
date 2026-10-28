import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const prod = process.env.NODE_ENV === 'production';
if (prod && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
if (prod && !process.env.PASSWORD_PEPPER) throw new Error('PASSWORD_PEPPER must be set in production');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
// Secret key mixed into every password before hashing. It lives only in the server's environment, never in the
// database, so a stolen copy of the database can't be used to guess passwords. Never change it once users exist.
const PEPPER = process.env.PASSWORD_PEPPER || 'dev-pepper-change-me';

export const signToken = (user) => jwt.sign({ id: user.id, email: user.email, tv: user.token_version || 0 }, SECRET, { expiresIn: '7d' });

// Keyed hash for one-time codes, so a leaked database can't be brute-forced offline.
export const hmac = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('hex');

// ---- Passwords: bcrypt(HMAC-SHA256(pepper, password)), stored as "pep1$<bcrypt hash>" ----
const PEPPERED = 'pep1$';
const pepper = (password) => crypto.createHmac('sha256', PEPPER).update(password).digest('base64');

export const hashPassword = async (password) => PEPPERED + (await bcrypt.hash(pepper(password), 12));

/** Checks a password. needsRehash is true for hashes from before the pepper was added, so they can be upgraded. */
export async function checkPassword(password, stored) {
  if (stored.startsWith(PEPPERED)) return { ok: await bcrypt.compare(pepper(password), stored.slice(PEPPERED.length)), needsRehash: false };
  const ok = await bcrypt.compare(password, stored);
  return { ok, needsRehash: ok };
}

/** Verifies the JWT and that the session is still valid (account exists, verified, not signed out by a password reset). */
export async function verifyToken(token) {
  const payload = jwt.verify(token, SECRET);
  const user = await db.get('SELECT verified, token_version FROM users WHERE id = ?', payload.id);
  if (!user || !user.verified || user.token_version !== (payload.tv || 0)) throw new Error('Session revoked');
  return payload;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = await verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  next();
}
