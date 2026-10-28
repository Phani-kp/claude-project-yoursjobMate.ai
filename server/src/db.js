import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/**
 * PostgreSQL storage.
 * - DATABASE_URL set: connects to that server (Neon, Supabase, AWS RDS, Render, Railway…). Use this in production.
 * - Not set: runs an embedded Postgres (PGlite) stored in server/data/pgdata, for local development without installing anything.
 *   DB_PATH=':memory:' keeps it in memory (tests).
 * Queries use `?` placeholders, which are converted to Postgres's $1, $2…
 */

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set in production');

// BIGINT and COUNT(*) come back as JS numbers (all our values fit safely).
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

async function connect() {
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    if (/\[YOUR-PASSWORD\]/i.test(url)) throw new Error('DATABASE_URL still contains [YOUR-PASSWORD]: replace it (brackets included) with your database password');
    // Cloud databases need an encrypted connection. If the URL doesn't say how (Supabase's don't), encrypt it anyway.
    const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    const ssl = /[?&]sslmode=/.test(url) || local ? undefined : { rejectUnauthorized: false };
    const pool = new pg.Pool({
      connectionString: url,
      ssl,
      max: Number(process.env.DB_POOL_SIZE) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => console.error('[db] idle client error:', err.message));
    const wrapClient = (c) => ({ query: async (sql, params = []) => { const r = await c.query(toPg(sql), params); return { rows: r.rows, count: r.rowCount }; } });
    return {
      kind: 'postgres',
      ...wrapClient(pool),
      exec: (sql) => pool.query(sql),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(wrapClient(client));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  const { PGlite, types } = await import('@electric-sql/pglite');
  const dir = process.env.DB_PATH === ':memory:' ? undefined : path.resolve(process.env.DB_PATH || 'data/pgdata');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const lite = await PGlite.create(dir, { parsers: { [types.INT8]: Number } });
  const wrapClient = (c) => ({ query: async (sql, params = []) => { const r = await c.query(toPg(sql), params); return { rows: r.rows, count: r.affectedRows ?? r.rows.length }; } });
  return {
    kind: 'pglite',
    ...wrapClient(lite),
    exec: (sql) => lite.exec(sql),
    transaction: (fn) => lite.transaction((tx) => fn(wrapClient(tx))),
    close: () => lite.close(),
  };
}

const conn = await connect();

export const db = {
  kind: conn.kind,
  /** All matching rows. */
  all: async (sql, ...params) => (await conn.query(sql, params)).rows,
  /** First matching row, or undefined. */
  get: async (sql, ...params) => (await conn.query(sql, params)).rows[0],
  /** Runs a statement. Returns { count, rows } (rows holds anything from RETURNING). */
  run: (sql, ...params) => conn.query(sql, params),
  /** Runs fn inside a transaction; fn receives an object with the same get/all/run helpers. */
  transaction: (fn) => conn.transaction((c) => fn({
    all: async (sql, ...p) => (await c.query(sql, p)).rows,
    get: async (sql, ...p) => (await c.query(sql, p)).rows[0],
    run: (sql, ...p) => c.query(sql, p),
  })),
  close: () => conn.close(),
};

// Schema. Every statement is safe to re-run, so existing databases upgrade in place on startup.
await conn.exec(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  otp_hash TEXT,
  otp_purpose TEXT,                -- 'verify' | 'reset'
  otp_expires_at BIGINT,           -- ms since epoch
  otp_sent_at BIGINT,
  otp_attempts INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0, -- bumped on password reset to sign out every session
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  linkedin TEXT DEFAULT '',
  resume_text TEXT DEFAULT '',
  resume_file TEXT DEFAULT '',
  resume_mime TEXT DEFAULT '',
  resume_data BYTEA,
  skills TEXT DEFAULT '',
  titles TEXT DEFAULT '',
  locations TEXT DEFAULT '',
  remote_only INTEGER DEFAULT 0,
  experience_years INTEGER DEFAULT 0,
  min_salary INTEGER DEFAULT 0,
  auto_apply INTEGER DEFAULT 0,
  daily_limit INTEGER DEFAULT 10,
  min_match INTEGER DEFAULT 60
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  external_id TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT DEFAULT '',
  remote INTEGER DEFAULT 0,
  salary TEXT DEFAULT '',
  job_type TEXT DEFAULT '',
  url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  posted_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT DEFAULT '',
  url TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  match_score INTEGER DEFAULT 0,
  cover_letter TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  method TEXT NOT NULL DEFAULT 'auto',
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, job_id)
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs(posted_at DESC);

-- Row-level security with no policies: blocks hosted auto-generated APIs (such as Supabase's public Data API)
-- from reading these tables. The app's own connection owns the tables, so it is unaffected.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
`);

export const STATUSES = ['queued', 'applying', 'applied', 'viewed', 'interview', 'offer', 'rejected', 'failed'];

export const csv = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
