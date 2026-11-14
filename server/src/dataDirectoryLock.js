import fs from 'node:fs';
import path from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

const tokenPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
function metadata(raw) {
  try {
    const value = JSON.parse(raw);
    return value && Number.isInteger(value.pid) && value.pid > 0 && value.pid <= 2_147_483_647
      && typeof value.token === 'string' && tokenPattern.test(value.token)
      && typeof value.hostname === 'string' && value.hostname ? value : null;
  } catch { return null; }
}

function ownerIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

/** Hold one app process per embedded database directory. Release only after closing the database. */
export function acquireDataDirectoryLock(directory) {
  fs.mkdirSync(path.resolve(directory), { recursive: true });
  const canonicalDir = fs.realpathSync(directory);
  const lockPath = `${canonicalDir}.yoursjobmate.lock`;
  const recoveryPath = `${lockPath}.recovery`;
  const owner = { pid: process.pid, token: randomUUID(), hostname: hostname() };
  const explain = (detail) => new Error(`${detail} Embedded database: ${canonicalDir}. Stop the other YoursJobMate process or inspect ${lockPath} before retrying. Database files were not reset.`);
  function readOwner() {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const value = metadata(raw);
    if (!value) throw explain('The database ownership lock is malformed or unrecognized; it was left unchanged.');
    if (value.hostname !== owner.hostname) throw explain('The database lock belongs to another computer; it was left unchanged.');
    return { raw, value };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    let fd;
    try { fd = fs.openSync(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (fd !== undefined) {
      try { fs.writeFileSync(fd, JSON.stringify(owner)); }
      finally { fs.closeSync(fd); }
      let released = false;
      return () => {
        if (released) return;
        let current;
        try { current = metadata(fs.readFileSync(lockPath, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current?.token === owner.token && current.pid === owner.pid && current.hostname === owner.hostname) {
          fs.unlinkSync(lockPath);
        }
        released = true;
      };
    }

    let observed;
    try { observed = readOwner(); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (ownerIsAlive(observed.value.pid)) throw explain(`The database is already owned by process ${observed.value.pid}.`);

    // Serialize stale-owner removal: two recoveries must not unlink a newly acquired lock.
    try { fs.mkdirSync(recoveryPath); }
    catch (error) {
      if (error.code === 'EEXIST') throw explain(`Lock recovery is already in progress; inspect ${recoveryPath} if it persists.`);
      throw error;
    }
    try {
      let current;
      try { current = readOwner(); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (current.raw !== observed.raw) continue;
      if (ownerIsAlive(current.value.pid)) throw explain(`The database is already owned by process ${current.value.pid}.`);
      fs.unlinkSync(lockPath);
    } finally {
      fs.rmdirSync(recoveryPath);
    }
  }
  throw explain('Database ownership changed repeatedly during startup; retry after the other process finishes.');
}
