import fs from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { parseEnv } from 'node:util';

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

/** Read-only early duplicate check. db.js remains responsible for acquiring and recovering locks. */
export function assertDevelopmentDatabaseAvailable({ serverRoot, env = process.env }) {
  const root = path.resolve(serverRoot);
  let fileEnv = {};
  try { fileEnv = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') return; // Leave unknown configuration failures to the real startup path.
  }
  // Empty OS values deliberately override file values; never load file settings into process.env.
  const setting = (key) => String(env[key] !== undefined ? env[key] : fileEnv[key] || '').trim();
  if (setting('DATABASE_URL') || setting('DB_PATH') === ':memory:') return;
  const directory = path.resolve(root, setting('DB_PATH') || 'data/pgdata');
  let canonical;
  try { canonical = fs.realpathSync(directory); }
  catch { return; } // Missing/inaccessible paths are left to authoritative database initialization.
  let owner;
  try { owner = JSON.parse(fs.readFileSync(`${canonical}.yoursjobmate.lock`, 'utf8')); }
  catch { return; }
  if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1 || owner.pid > 2_147_483_647
    || typeof owner.token !== 'string' || !uuid.test(owner.token) || owner.hostname !== hostname()) return;
  try { process.kill(owner.pid, 0); }
  catch (error) { if (error.code !== 'EPERM') return; }
  throw Object.assign(new Error(`The embedded database is already used by process ${owner.pid}. Stop the existing npm run dev in its original terminal with Ctrl+C and wait for the database to close before starting again. Database files were left untouched.`), {
    code: 'DEV_DATABASE_IN_USE',
    ownerPid: owner.pid,
  });
}
