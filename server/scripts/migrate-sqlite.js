/**
 * One-time copy of an old SQLite database (server/data/jobmate.db) into PostgreSQL.
 *
 *   DATABASE_URL=postgres://… npm run migrate:sqlite [-- path/to/jobmate.db]
 *
 * Without DATABASE_URL it copies into the local embedded database (server/data/pgdata) instead.
 *
 * Run it once, before real users sign up on the new database. Rows that already exist (same id) are skipped,
 * so re-running is safe. Uploaded resume files aren't copied; resume text is.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.argv[2] || 'data/jobmate.db');
if (!fs.existsSync(file)) {
  console.error(`No SQLite database at ${file}`);
  process.exit(1);
}

const { db } = await import('../src/db.js'); // connects and creates the tables
const lite = new DatabaseSync(file, { readOnly: true });
console.log(`Copying ${file} into ${db.kind === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : 'the local embedded database'}…`);
const columnsOf = (table) => lite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// Parents before children, so foreign keys are satisfied.
const TABLES = ['users', 'profiles', 'jobs', 'applications', 'events'];
const pgColumns = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t,
  (await db.all('SELECT column_name FROM information_schema.columns WHERE table_name = ?', t)).map((c) => c.column_name)])));

for (const table of TABLES) {
  // Only columns that exist on both sides; e.g. old databases have no verification columns.
  const cols = columnsOf(table).filter((c) => pgColumns[table].includes(c));
  // Accounts from before email verification existed count as verified.
  const extra = table === 'users' && !cols.includes('verified') ? [1] : [];
  const insertCols = extra.length ? [...cols, 'verified'] : cols;
  const rows = lite.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
  let copied = 0;
  for (const row of rows) {
    const values = cols.map((c) => {
      const v = row[c];
      // SQLite stored timestamps as "YYYY-MM-DD HH:MM:SS" in UTC.
      if (typeof v === 'string' && /_at$/.test(c) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return `${v.replace(' ', 'T')}Z`;
      return v;
    });
    const r = await db.run(`INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`, ...values, ...extra);
    copied += r.count;
  }
  // Move the id counter past the copied ids so new rows don't collide.
  if (table !== 'profiles') await db.run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`);
  console.log(`${table}: copied ${copied} of ${rows.length}`);
}

lite.close();
await db.close();
console.log('Done. Users keep their passwords: old hashes are upgraded with the password pepper the next time each user logs in.');
