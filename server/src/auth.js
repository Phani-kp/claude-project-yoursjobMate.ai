import jwt from 'jsonwebtoken';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export const signToken = (user) => jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: '7d' });

export const verifyToken = (token) => jwt.verify(token, SECRET);

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}
