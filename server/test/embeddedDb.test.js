import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const repoDir = path.resolve(serverDir, '..');
const dbUrl = new URL('../src/db.js', import.meta.url).href;
const authUrl = new URL('../src/auth.js', import.meta.url).href;
const childSource = `
  globalThis.fetch = () => { throw new Error('Network calls are forbidden in embedded database tests'); };
  let db;
  const report = (data) => new Promise(resolve => process.send(data, resolve));
  try {
    ({ db } = await import(process.argv[1]));
    const operation = process.argv[3];
    if (operation === 'hold') {
      process.on('message', async command => {
        if (command === 'query') return report({ ok: true, probe: (await db.get('SELECT 1 AS value')).value });
        await db.close();
        process.exit(0);
      });
      await report({ ok: true, holding: true, kind: db.kind });
    } else {
      if (operation === 'write') {
        const { hashPassword } = await import(process.argv[2]);
        const hash = await hashPassword('persistent-fixture-password');
        await db.transaction(async transaction => {
          const { id } = await transaction.get('INSERT INTO users (email, name, password_hash, verified) VALUES (?, ?, ?, 1) RETURNING id', 'persistent@fixture.invalid', 'Persistent user', hash);
          await transaction.run('INSERT INTO profiles (user_id, headline) VALUES (?, ?)', id, 'Retained profile');
        });
      }
      const user = await db.get('SELECT u.id, u.email, u.name, u.password_hash, p.user_id, p.headline FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.email = ?', 'persistent@fixture.invalid');
      await db.close();
      await report({ ok: true, kind: db.kind, user });
      process.exit(0);
    }
  } catch (error) {
    if (db) await db.close().catch(() => {});
    await report({ ok: false, code: error.code, message: error.message });
    process.exit(0);
  }
`;

function fixture(t, workspace = false) {
  const parent = workspace ? path.join(serverDir, 'test', '.tmp') : tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'yoursjobmate-embedded-test-'));
  const children = [];
  const extraRoots = [];
  t.after(async () => {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.all(children.map(({ exited }) => exited));
    for (const target of [root, ...extraRoots]) {
      assert.ok(path.basename(target).startsWith('yoursjobmate-embedded-test-'));
      assert.ok(path.resolve(target).startsWith(path.resolve(workspace ? repoDir : tmpdir()) + path.sep));
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
  return { root, directory: path.join(root, 'pgdata'), children, extraRoots };
}

async function launch(f, { operation = 'read', cwd = serverDir, dbPath = f.directory } = {}) {
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', childSource, dbUrl, authUrl, operation], {
    cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', TEST_DATABASE_URL: '', DB_PATH: dbPath,
      JWT_SECRET: 'embedded-database-fixture-secret', PASSWORD_PEPPER: 'embedded-database-fixture-pepper',
      BREVO_API_KEY: '', SMTP_HOST: '', ANTHROPIC_API_KEY: '' },
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-5_000); });
  const exited = once(child, 'exit');
  f.children.push({ child, exited });
  const [result] = await once(child, 'message', { signal: AbortSignal.timeout(30_000) });
  if (operation !== 'hold' || !result.ok) assert.equal((await exited)[0], 0, stderr);
  return { child, exited, result };
}

test('persistent accounts retain their id, password hash and profile after a separate-process reopen', async (t) => {
  const f = fixture(t);
  const initial = (await launch(f, { operation: 'write', cwd: repoDir })).result;
  assert.equal(initial.ok, true, initial.message);
  assert.equal(initial.kind, 'pglite');
  assert.match(initial.user.password_hash, /^pep1\$\$2[aby]\$/);
  assert.equal(initial.user.id, initial.user.user_id);
  assert.equal(initial.user.headline, 'Retained profile');
  assert.equal(fs.existsSync(`${f.directory}.yoursjobmate.lock`), false, 'clean close releases ownership');
  const reopened = (await launch(f)).result;
  assert.equal(reopened.ok, true, reopened.message);
  assert.deepEqual(reopened.user, initial.user);
});

test('the integrated database refuses a second process while its first owner remains usable', async (t) => {
  const f = fixture(t);
  const owner = await launch(f, { operation: 'hold' });
  assert.equal(owner.result.ok, true, owner.result.message);
  const competing = (await launch(f)).result;
  assert.equal(competing.ok, false);
  assert.match(competing.message, new RegExp(`already owned by process ${owner.child.pid}`));
  const nextMessage = once(owner.child, 'message', { signal: AbortSignal.timeout(5_000) });
  owner.child.send('query');
  assert.deepEqual((await nextMessage)[0], { ok: true, probe: 1 });
  owner.child.send('close');
  assert.equal((await owner.exited)[0], 0);
  assert.equal(fs.existsSync(`${f.directory}.yoursjobmate.lock`), false);
});

test('failed initialization releases ownership and preserves an invalid fixture instead of resetting it', async (t) => {
  const f = fixture(t);
  const initial = (await launch(f, { operation: 'write' })).result;
  assert.equal(initial.ok, true, initial.message);
  const invalid = path.join(f.root, 'invalid-copy');
  fs.cpSync(f.directory, invalid, { recursive: true });
  const originalVersion = fs.readFileSync(path.join(f.directory, 'PG_VERSION'), 'utf8');
  fs.writeFileSync(path.join(invalid, 'PG_VERSION'), '999\n');
  const failed = (await launch(f, { dbPath: invalid })).result;
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'PGLITE_STARTUP');
  assert.match(failed.message, /Embedded PostgreSQL could not open/);
  assert.match(failed.message, /No database was reset/);
  assert.equal(fs.existsSync(`${invalid}.yoursjobmate.lock`), false);
  assert.equal(fs.readFileSync(path.join(invalid, 'PG_VERSION'), 'utf8'), '999\n');
  assert.equal(fs.readFileSync(path.join(f.directory, 'PG_VERSION'), 'utf8'), originalVersion);
});

test('relative DB_PATH resolves to the same disposable database from repository and server working directories', async (t) => {
  const f = fixture(t, true);
  const dbPath = path.relative(serverDir, f.directory);
  const wrongRoot = path.join(repoDir, 'test', '.tmp', path.basename(f.root));
  f.extraRoots.push(wrongRoot);
  assert.equal(fs.existsSync(wrongRoot), false);
  const initial = (await launch(f, { operation: 'write', cwd: repoDir, dbPath })).result;
  assert.equal(initial.ok, true, initial.message);
  const reopened = (await launch(f, { cwd: serverDir, dbPath })).result;
  assert.equal(reopened.ok, true, reopened.message);
  assert.deepEqual(reopened.user, initial.user);
  assert.equal(fs.existsSync(wrongRoot), false, 'repository cwd must not create another database');
});
