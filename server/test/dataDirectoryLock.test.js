import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acquireDataDirectoryLock } from '../src/dataDirectoryLock.js';

const moduleUrl = new URL('../src/dataDirectoryLock.js', import.meta.url).href;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'yoursjobmate-lock-test-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const directory = path.join(root, 'pgdata');
  return { root, directory, lockPath: `${directory}.yoursjobmate.lock` };
}

async function childOwner(t, directory, abandon = false) {
  const source = `const { acquireDataDirectoryLock } = await import(process.argv[1]);
    const release = acquireDataDirectoryLock(process.argv[2]);
    process.send('locked');
    if (process.argv[3] === 'abandon') process.exit(0);
    process.on('message', () => { release(); process.exit(0); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, moduleUrl, directory, abandon ? 'abandon' : 'hold'], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true,
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  await once(child, 'message', { signal: AbortSignal.timeout(5_000) });
  return { child, exited };
}

test('a live child process exclusively owns the canonical database directory', async (t) => {
  const { directory, lockPath } = fixture(t);
  const { child, exited } = await childOwner(t, directory);
  assert.throws(() => acquireDataDirectoryLock(directory), new RegExp(`already owned by process ${child.pid}`));
  child.send('release');
  assert.equal((await exited)[0], 0);
  const release = acquireDataDirectoryLock(directory);
  assert.equal(typeof release, 'function');
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, process.pid);
  release();
  release();
  assert.equal(fs.existsSync(lockPath), false);
});

test('a dead child owner is safely replaced without changing database contents', async (t) => {
  const { directory, lockPath } = fixture(t);
  const { exited } = await childOwner(t, directory, true);
  assert.equal((await exited)[0], 0);
  const old = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const sentinel = path.join(directory, 'preserve.txt');
  fs.writeFileSync(sentinel, 'existing database content');
  const release = acquireDataDirectoryLock(directory);
  const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(current.pid, process.pid);
  assert.notEqual(current.token, old.token);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'existing database content');
  assert.equal(fs.existsSync(`${lockPath}.recovery`), false);
  release();
});

test('malformed or unrecognized lock files remain unchanged', (t) => {
  const { directory, lockPath } = fixture(t);
  fs.mkdirSync(directory);
  for (const content of ['', 'not json', '{}', JSON.stringify({ pid: -1, token: 'unknown' })]) {
    fs.writeFileSync(lockPath, content);
    assert.throws(() => acquireDataDirectoryLock(directory), /malformed or unrecognized.*left unchanged/);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), content);
  }
});

test('release never erases a replacement ownership token', (t) => {
  const { directory, lockPath } = fixture(t);
  const release = acquireDataDirectoryLock(directory);
  const replacement = { ...JSON.parse(fs.readFileSync(lockPath, 'utf8')), token: randomUUID() };
  fs.writeFileSync(lockPath, JSON.stringify(replacement));
  release();
  release();
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), replacement);
});

test('EPERM while checking an owner is treated as a live process', (t) => {
  const { directory, lockPath } = fixture(t);
  const release = acquireDataDirectoryLock(directory);
  t.mock.method(process, 'kill', () => { throw Object.assign(new Error('Access denied'), { code: 'EPERM' }); });
  assert.throws(() => acquireDataDirectoryLock(directory), /already owned by process/);
  assert.equal(fs.existsSync(lockPath), true);
  release();
});

test('directory aliases share a lock', (t) => {
  const { root, directory } = fixture(t);
  const release = acquireDataDirectoryLock(directory);
  const alias = path.join(root, 'alias');
  try { fs.symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    release();
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('Directory aliases are not permitted'); return; }
    throw error;
  }
  assert.throws(() => acquireDataDirectoryLock(alias), /already owned by process/);
  release();
});
