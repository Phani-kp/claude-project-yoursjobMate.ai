import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hostname, tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assertDevelopmentDatabaseAvailable } from '../scripts/devPreflight.js';

function fixture(t, relative = 'data/pgdata') {
  const temporaryRoot = fs.realpathSync(tmpdir());
  const serverRoot = fs.mkdtempSync(path.join(temporaryRoot, 'yjm-preflight-test-'));
  const directory = path.join(serverRoot, relative);
  fs.mkdirSync(directory, { recursive: true });
  const lock = `${directory}.yoursjobmate.lock`;
  const raw = JSON.stringify({ pid: process.pid, token: randomUUID(), hostname: hostname() });
  fs.writeFileSync(lock, raw);
  const sentinel = path.join(directory, 'preserve.txt');
  fs.writeFileSync(sentinel, 'existing fixture data');
  t.after(() => {
    const target = path.resolve(serverRoot);
    assert.equal(path.dirname(target), temporaryRoot);
    assert.ok(path.basename(target).startsWith('yjm-preflight-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const check = (env = {}) => assertDevelopmentDatabaseAvailable({ serverRoot, env });
  const fileEnv = (text) => fs.writeFileSync(path.join(serverRoot, '.env'), text);
  const unchanged = () => {
    assert.equal(fs.readFileSync(lock, 'utf8'), raw);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'existing fixture data');
  };
  return { serverRoot, directory, lock, raw, sentinel, check, fileEnv, unchanged };
}

const inUse = (error) => error.code === 'DEV_DATABASE_IN_USE'
  && error.ownerPid === process.pid && /Ctrl\+C.*database to close/.test(error.message);

test('a live owner is blocked before database initialization without altering its lock or files', (t) => {
  const f = fixture(t);
  assert.throws(() => f.check(), inUse);
  f.unchanged();
  assert.equal(fs.existsSync(`${f.lock}.recovery`), false);
});

test('env file parsing handles quoted paths without loading any values into process.env', (t) => {
  const f = fixture(t, 'fixture database');
  const key = `YJM_PREFLIGHT_${randomUUID().replaceAll('-', '_')}`;
  f.fileEnv(`DB_PATH="fixture database" # a comment\n${key}=fixture-private-value\nBREVO_API_KEY=fixture-secret\n`);
  assert.throws(() => f.check(), (error) => inUse(error) && !/fixture-secret|fixture-private-value|fixture database/.test(error.message));
  assert.equal(Object.hasOwn(process.env, key), false);
  f.unchanged();
});

test('OS settings including empty values override file settings', (t) => {
  const f = fixture(t);
  f.fileEnv('DATABASE_URL=postgresql://fixture:private@db.invalid/app\nDB_PATH=another-directory\n');
  assert.doesNotThrow(() => f.check(), 'an external database from the file skips embedded checks');
  assert.throws(() => f.check({ DATABASE_URL: '', DB_PATH: '' }), inUse, 'empty OS values select the default embedded database');
  f.fileEnv('DB_PATH=:memory:\n');
  assert.throws(() => f.check({ DB_PATH: '' }), inUse);
  f.unchanged();
});

test('relative DB_PATH resolves against serverRoot even when the working directory is different', (t) => {
  const f = fixture(t, 'custom/pgdata');
  f.fileEnv('DB_PATH=custom/pgdata\n');
  const elsewhere = path.join(f.serverRoot, 'elsewhere');
  fs.mkdirSync(elsewhere);
  const previous = process.cwd();
  try {
    process.chdir(elsewhere);
    assert.throws(() => f.check(), inUse);
  } finally { process.chdir(previous); }
  f.unchanged();
});

test('external and in-memory configurations never probe the embedded owner', (t) => {
  const f = fixture(t);
  const probe = t.mock.method(process, 'kill', () => { throw new Error('Owner should not be probed'); });
  assert.doesNotThrow(() => f.check({ DATABASE_URL: ' postgresql://fixture:private@db.invalid/app ' }));
  assert.doesNotThrow(() => f.check({ DB_PATH: ':memory:' }));
  f.fileEnv('DB_PATH=:memory:\n');
  assert.doesNotThrow(() => f.check());
  assert.equal(probe.mock.callCount(), 0);
  f.unchanged();
});

test('missing env and database directories are normal and are never created by preflight', (t) => {
  const f = fixture(t);
  const absent = path.join(f.serverRoot, 'does-not-exist');
  assert.doesNotThrow(() => f.check({ DB_PATH: absent }));
  assert.equal(fs.existsSync(absent), false);
  assert.equal(fs.existsSync(`${absent}.yoursjobmate.lock`), false);
  assert.equal(fs.existsSync(path.join(f.serverRoot, '.env')), false);
});

test('an unreadable configuration is left to authoritative startup instead of guessing an embedded path', (t) => {
  const f = fixture(t);
  const readFile = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === path.join(f.serverRoot, '.env')) throw Object.assign(new Error('Private configuration error'), { code: 'EACCES' });
    return readFile(file, ...args);
  });
  const probe = t.mock.method(process, 'kill', () => { throw new Error('Unknown configuration must not probe an owner'); });
  assert.doesNotThrow(() => f.check());
  assert.equal(probe.mock.callCount(), 0);
  f.unchanged();
});

test('dead-owner locks stay untouched for authoritative database recovery', (t) => {
  const f = fixture(t);
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.equal(pid, process.pid);
    assert.equal(signal, 0);
    throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
  });
  assert.doesNotThrow(() => f.check());
  f.unchanged();
  assert.equal(fs.existsSync(`${f.lock}.recovery`), false);
});

test('malformed, foreign-host, and unrecognized owner metadata remain untouched without probing a PID', (t) => {
  const f = fixture(t);
  const probe = t.mock.method(process, 'kill', () => { throw new Error('Unrecognized owner must not be probed'); });
  const valid = JSON.parse(f.raw);
  for (const raw of ['', 'not-json', '{}', JSON.stringify({ ...valid, pid: 0 }), JSON.stringify({ ...valid, pid: 2_147_483_648 }), JSON.stringify({ ...valid, token: 'invalid' }), JSON.stringify({ ...valid, hostname: `${hostname()}-foreign` })]) {
    fs.writeFileSync(f.lock, raw);
    assert.doesNotThrow(() => f.check());
    assert.equal(fs.readFileSync(f.lock, 'utf8'), raw);
  }
  assert.equal(probe.mock.callCount(), 0);
  assert.equal(fs.readFileSync(f.sentinel, 'utf8'), 'existing fixture data');
});

test('EPERM from an owner probe is treated as a live owner', (t) => {
  const f = fixture(t);
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.equal(pid, process.pid);
    assert.equal(signal, 0);
    throw Object.assign(new Error('Access denied'), { code: 'EPERM' });
  });
  assert.throws(() => f.check(), inUse);
  f.unchanged();
});
