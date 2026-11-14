import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
async function launch(t, invalid = false) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'yoursjobmate-launcher-test-'));
  const database = path.join(temporary, 'pgdata');
  if (invalid) {
    fs.mkdirSync(database);
    fs.writeFileSync(path.join(database, 'PG_VERSION'), '999');
  }
  const probe = http.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = fork(path.join(repo, 'scripts/dev.js'), [], {
    cwd: repo, execArgv: ['--no-warnings'], windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', DB_PATH: database,
      BREVO_API_KEY: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '', ANTHROPIC_API_KEY: '',
      JWT_SECRET: 'launcher-test-jwt-secret', PASSWORD_PEPPER: 'launcher-test-pepper',
      CORS_ORIGIN: '', TRUST_PROXY: '', SYNC_EVERY_MS: '0', PORT: String(port) },
  });
  let output = '';
  const messages = [];
  child.stdout.on('data', (data) => { output = (output + data).slice(-6000); });
  child.stderr.on('data', (data) => { output = (output + data).slice(-6000); });
  child.on('message', (message) => messages.push(message));
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null && child.connected) child.send({ type: 'shutdown' });
    await Promise.race([exited, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Launcher did not close its isolated test database')), 45_000);
      timer.unref();
    })]);
    assert.equal(fs.existsSync(`${database}.yoursjobmate.lock`), false);
    assert.equal(path.dirname(temporary), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('yoursjobmate-launcher-test-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  return { child, exited, messages, port, database, output: () => output };
}

test('the complete dev launcher waits for a listening API and proxies signup to its actual non-default port', async (t) => {
  const running = await launch(t);
  let ready;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && running.child.exitCode === null) {
    ready = running.messages.find((message) => message.type === 'dev-ready');
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, running.output());
  assert.equal(ready.apiPort, running.port);
  assert.notEqual(ready.apiPort, 4000);
  const base = ready.frontendUrls[0];
  const health = await fetch(new URL('/api/health', base));
  assert.equal(health.status, 200);
  assert.equal((await health.json()).db, 'pglite');
  // Invalid input proves that signup reaches Express without creating accounts or sending mail.
  const signup = await fetch(new URL('/api/auth/signup', base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Fixture', email: 'invalid', password: 'fixture-password' }),
  });
  assert.equal(signup.status, 400);
  assert.equal((await signup.json()).error, 'Please enter a valid email address');
});

test('the dev launcher exits clearly when the API fails before listening instead of advertising a broken frontend', async (t) => {
  const running = await launch(t, true);
  const [code] = await running.exited;
  assert.equal(code, 1);
  assert.equal(running.messages.some((message) => message.type === 'dev-ready'), false);
  assert.match(running.output(), /API exited before it began listening/);
  assert.equal(fs.readFileSync(path.join(running.database, 'PG_VERSION'), 'utf8'), '999');
});
