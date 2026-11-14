import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDevSupervisor, manageChild } from '../scripts/devSupervisor.js';

const quiet = { log() {}, error() {} };
function fakeChild() {
  const child = new EventEmitter();
  child.connected = true;
  child.sent = [];
  child.send = (message, callback) => { child.sent.push(message); callback?.(); };
  child.kill = () => { throw new Error('Graceful shutdown must never use child.kill on Windows'); };
  child.finish = (code = 0, signal = null) => { child.connected = false; child.emit('exit', code, signal); };
  return child;
}

test('shutdown waits for a child still initializing to install its IPC listener', async () => {
  const child = fakeChild();
  const managed = manageChild(child, { timeoutMs: 200 });
  const pending = managed.stop();
  assert.equal(managed.stop(), pending);
  assert.deepEqual(child.sent, []);
  child.emit('message', { type: 'ready' });
  assert.deepEqual(child.sent, [{ type: 'shutdown' }]);
  child.finish();
  await pending;
});

test('shutdown-ready is distinct from HTTP readiness and only the bound port is forwarded', async () => {
  const child = fakeChild();
  const states = [];
  const supervisor = createDevSupervisor({ entry: 'fixture.js', cwd: '.', logger: quiet, forkChild: () => child, onState: (state) => states.push(state) });
  assert.deepEqual(states, [{ state: 'starting' }]);
  child.emit('message', { type: 'ready' });
  assert.deepEqual(states, [{ state: 'starting' }], 'an installed shutdown listener does not mean the API is listening');
  for (const port of ['4111', 0, -1, 65536, 1.5]) child.emit('message', { type: 'listening', port });
  assert.equal(states.length, 1);
  child.emit('message', { type: 'listening', port: 4111, environment: { secret: 'do-not-forward' } });
  assert.deepEqual(states.at(-1), { state: 'listening', port: 4111 }, 'a non-default API port must reach the parent without extra fields');
  const stop = supervisor.stop();
  assert.deepEqual(states.at(-1), { state: 'stopping' });
  child.emit('message', { type: 'listening', port: 4999 });
  assert.deepEqual(states.at(-1), { state: 'stopping' }, 'late readiness during shutdown must be ignored');
  child.finish();
  await stop;
  assert.deepEqual(states.at(-1), { state: 'exited', code: 0 });
  assert.equal(JSON.stringify(states).includes('do-not-forward'), false);
});

test('a failed API reports unavailable while its file watcher can remain alive for an explicit retry', async () => {
  const children = [];
  const states = [];
  const supervisor = createDevSupervisor({ entry: 'fixture.js', cwd: '.', logger: quiet, onState: (state) => states.push(state), forkChild: () => {
    const child = fakeChild(); children.push(child); return child;
  } });
  children[0].finish(1);
  await Promise.resolve();
  assert.deepEqual(states, [{ state: 'starting' }, { state: 'exited', code: 1 }]);
  assert.equal(children.length, 1, 'startup failures must not start an automatic retry loop');
  await supervisor.restart();
  assert.equal(children.length, 2);
  assert.deepEqual(states.at(-1), { state: 'starting' });
  children[0].emit('message', { type: 'listening', port: 4000 });
  assert.deepEqual(states.at(-1), { state: 'starting' }, 'a stale failed child cannot make a replacement appear ready');
  children[1].emit('message', { type: 'ready' });
  children[1].emit('message', { type: 'listening', port: 4222 });
  assert.deepEqual(states.at(-1), { state: 'listening', port: 4222 });
  const stop = supervisor.stop();
  children[1].finish();
  await stop;
});

test('restart reports stopping, exited, and starting in order before accepting replacement readiness', async () => {
  const children = [];
  const states = [];
  const supervisor = createDevSupervisor({ entry: 'fixture.js', cwd: '.', logger: quiet, onState: (state) => states.push(state), forkChild: () => {
    const child = fakeChild(); children.push(child); return child;
  } });
  children[0].emit('message', { type: 'ready' });
  children[0].emit('message', { type: 'listening', port: 4000 });
  const restart = supervisor.restart();
  children[0].emit('message', { type: 'listening', port: 4999 });
  children[0].finish();
  await restart;
  assert.deepEqual(states.map((state) => state.state), ['starting', 'listening', 'stopping', 'exited', 'starting']);
  children[0].emit('message', { type: 'listening', port: 4999 });
  children[1].emit('message', { type: 'ready' });
  assert.deepEqual(states.at(-1), { state: 'starting' });
  children[1].emit('message', { type: 'listening', port: 4333 });
  assert.deepEqual(states.at(-1), { state: 'listening', port: 4333 });
  const stop = supervisor.stop();
  children[1].finish();
  await stop;
});

test('restart waits for the previous process to exit and coalesces duplicate file events', async () => {
  const children = [];
  const options = [];
  const supervisor = createDevSupervisor({ entry: 'fixture.js', cwd: 'fixture-root', logger: quiet, forkChild: (_entry, _args, configuration) => {
    options.push(configuration);
    const child = fakeChild(); children.push(child); return child;
  } });
  children[0].emit('message', { type: 'ready' });
  const restart = supervisor.restart();
  assert.equal(supervisor.restart(), restart);
  assert.equal(children.length, 1);
  assert.deepEqual(children[0].sent, [{ type: 'shutdown' }]);
  children[0].finish();
  await restart;
  assert.equal(children.length, 2);
  assert.deepEqual(options[0].execArgv, ['--no-warnings', '--env-file-if-exists=.env'], 'each API process reloads its own env file');
  assert.equal(options[0].cwd, 'fixture-root');
  assert.equal(options[0].env, undefined, 'the supervisor must not cache values loaded from an env file');
  children[1].emit('message', { type: 'ready' });
  const stop = supervisor.stop();
  children[1].finish();
  await stop;
});

test('a timed-out shutdown blocks replacement permanently and leaves the old process alive', async () => {
  const child = fakeChild();
  let forks = 0;
  const supervisor = createDevSupervisor({ entry: 'fixture.js', cwd: '.', timeoutMs: 15, logger: quiet, forkChild: () => { forks++; return child; } });
  child.emit('message', { type: 'ready' });
  await assert.rejects(supervisor.restart(), /old process was left running.*no replacement/);
  assert.equal(child.connected, true);
  await supervisor.restart();
  assert.equal(forks, 1);
  child.finish();
});

test('stop during an in-progress restart cannot launch another API process', async () => {
  const child = fakeChild();
  let forks = 0;
  const supervisor = createDevSupervisor({ entry: 'fixture.js', cwd: '.', logger: quiet, forkChild: () => { forks++; return child; } });
  child.emit('message', { type: 'ready' });
  const restart = supervisor.restart();
  const stop = supervisor.stop();
  child.finish();
  await Promise.all([restart, stop]);
  assert.equal(forks, 1);
});

test('real IPC child completes graceful close before the replacement is forked', async (t) => {
  const timeline = [];
  const children = [];
  const supervisor = createDevSupervisor({ entry: fileURLToPath(new URL('./fixtures/graceful-child.js', import.meta.url)), cwd: process.cwd(), timeoutMs: 2000, logger: quiet, forkChild: (entry) => {
    const number = children.length;
    timeline.push(`fork ${number}`);
    const child = fork(entry, [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    children.push(child);
    child.on('message', (message) => timeline.push(`${message.type} ${number}`));
    child.on('exit', () => timeline.push(`exit ${number}`));
    return child;
  } });
  t.after(() => supervisor.stop());
  await once(children[0], 'message');
  await supervisor.restart();
  assert.ok(timeline.indexOf('closed 0') < timeline.indexOf('exit 0'));
  assert.ok(timeline.indexOf('exit 0') < timeline.indexOf('fork 1'));
  await supervisor.stop();
  assert.equal(children.length, 2);
});
