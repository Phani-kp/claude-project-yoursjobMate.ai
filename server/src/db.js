import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('data', 'jobmate.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  linkedin TEXT DEFAULT '',
  resume_text TEXT DEFAULT '',
  resume_file TEXT DEFAULT '',
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, job_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_apps_user ON applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);
`);

export const STATUSES = ['queued', 'applying', 'applied', 'viewed', 'interview', 'offer', 'rejected', 'failed'];

export const csv = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
