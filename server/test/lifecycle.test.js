import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createShutdown, installShutdownHandlers } from '../src/lifecycle.js';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const logger = () => ({ messages: [], log(...args) { this.messages.push(args.join(' ')); }, error(...args) { this.messages.push(args.join(' ')); } });

test('shutdown stops HTTP and background work before closing the database exactly once', async () => {
  const work = deferred();
  const http = deferred();
  const calls = [];
  const shutdown = createShutdown({
    stopWork: () => { calls.push('stop work'); return work.promise; },
    closeServer: () => { calls.push('close HTTP'); return http.promise; },
    closeDatabase: async () => { calls.push('close DB'); },
    logger: logger(),
    exit: (code) => { calls.push(`exit ${code}`); },
  });
  const pending = shutdown('IPC');
  assert.equal(shutdown('SIGINT'), pending);
  await Promise.resolve();
  assert.deepEqual(calls, ['stop work', 'close HTTP']);
  http.resolve();
  await Promise.resolve();
  assert.equal(calls.includes('close DB'), false, 'HTTP closing must not interrupt background writes');
  work.resolve();
  await pending;
  assert.deepEqual(calls, ['stop work', 'close HTTP', 'close DB', 'exit 0']);
});

test('a shutdown timeout reports the wait without exiting or releasing a still-closing database', async () => {
  const db = deferred();
  const log = logger();
  const exits = [];
  const shutdown = createShutdown({ stopWork: async () => {}, closeServer: async () => {}, closeDatabase: () => db.promise, logger: log, exit: (code) => exits.push(code), timeoutMs: 15 });
  const pending = shutdown('IPC');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(exits, []);
  assert.match(log.messages.join(' '), /no forced exit was performed/);
  db.resolve();
  await pending;
  assert.deepEqual(exits, [1]);
});

test('startup/listen failure still closes the database and exits unsuccessfully', async () => {
  let closed = 0;
  const exits = [];
  const shutdown = createShutdown({ stopWork: async () => {}, closeServer: async () => {}, closeDatabase: async () => { closed++; }, logger: logger(), exit: (code) => exits.push(code) });
  await shutdown('Server startup failed', 1);
  assert.equal(closed, 1);
  assert.deepEqual(exits, [1]);
});

test('IPC, Windows console events, and parent disconnect request the same graceful shutdown', () => {
  const processObject = new EventEmitter();
  const reasons = [];
  const uninstall = installShutdownHandlers((reason) => reasons.push(reason), processObject);
  processObject.emit('message', { type: 'unrelated' });
  processObject.emit('message', { type: 'shutdown' });
  processObject.emit('SIGINT');
  processObject.emit('SIGTERM');
  processObject.emit('SIGBREAK');
  processObject.emit('SIGHUP');
  processObject.emit('disconnect');
  assert.equal(reasons.length, 6);
  assert.match(reasons[0], /supervisor requested/);
  uninstall();
  assert.equal(processObject.eventNames().length, 0);
});
