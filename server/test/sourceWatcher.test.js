import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSourceWatcher } from '../scripts/sourceWatcher.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const temporaryRoot = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'yjm-source-watcher-'));
  const source = path.join(directory, 'src');
  fs.mkdirSync(source);
  const code = path.join(source, 'app.js');
  const env = path.join(directory, '.env');
  fs.writeFileSync(code, 'export const value = 1;\n');
  fs.writeFileSync(env, 'FIXTURE_SECRET=first-known-test-value\n');
  fs.writeFileSync(path.join(directory, 'package.json'), '{"name":"fixture"}\n');
  let changes = 0;
  const errors = [];
  const watchers = new Map();
  const watcher = createSourceWatcher({
    sourceDirectory: source,
    configFiles: [env, path.join(directory, 'package.json')],
    onChange: () => { changes++; },
    onError: (error) => errors.push(error),
    debounceMs: 10,
    settleMs: 5,
    watch: (watchedPath, _options, listener) => {
      const native = new EventEmitter();
      native.fire = listener;
      native.close = () => { native.closed = true; };
      watchers.set(watchedPath, native);
      return native;
    },
  });
  t.after(() => {
    watcher.close();
    const target = path.resolve(directory);
    // Cleanup is restricted to the unique temporary directory created by this test.
    assert.equal(path.dirname(target), temporaryRoot);
    assert.ok(path.basename(target).startsWith('yjm-source-watcher-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const settle = () => { t.mock.timers.tick(10); t.mock.timers.tick(5); };
  settle();
  return { directory, source, code, env, watcher, watchers, errors, settle, changes: () => changes };
}

test('read/hydration, timestamp-only, and repeated notifications cannot restart unchanged source or env files', (t) => {
  const fixture = setup(t);
  fs.readFileSync(fixture.code);
  fs.readFileSync(fixture.env);
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(fixture.code, later, later);
  fs.utimesSync(fixture.env, later, later);
  for (let index = 0; index < 5; index++) {
    fixture.watchers.get(fixture.source).fire('change', 'app.js');
    fixture.watchers.get(fixture.directory).fire('change', '.env');
  }
  fixture.settle();
  assert.equal(fixture.changes(), 0);
  assert.deepEqual(fixture.errors, []);
});

test('a genuine source edit restarts once after stable content, while duplicate events are ignored', (t) => {
  const fixture = setup(t);
  fs.writeFileSync(fixture.code, 'export const value = 2;\n');
  fixture.watchers.get(fixture.source).fire('change', 'app.js');
  t.mock.timers.tick(10);
  assert.equal(fixture.changes(), 0, 'the content must settle before requesting restart');
  t.mock.timers.tick(5);
  assert.equal(fixture.changes(), 1);
  fixture.watchers.get(fixture.source).fire('change', 'app.js');
  fixture.watchers.get(fixture.source).fire('rename', 'app.js');
  fixture.settle();
  assert.equal(fixture.changes(), 1);
});

test('an atomic env replacement and its duplicate events restart once without exposing its contents', (t) => {
  const fixture = setup(t);
  const replacement = path.join(fixture.directory, '.env.tmp');
  fs.writeFileSync(replacement, 'FIXTURE_SECRET=second-known-test-value\n');
  fixture.watchers.get(fixture.directory).fire('change', '.env.tmp');
  fs.renameSync(replacement, fixture.env);
  fixture.watchers.get(fixture.directory).fire('rename', '.env');
  fixture.watchers.get(fixture.directory).fire('change', '.env');
  fixture.settle();
  assert.equal(fixture.changes(), 1);
  assert.deepEqual(fixture.errors, []);
  fixture.watchers.get(fixture.directory).fire('change', '.env');
  fixture.settle();
  assert.equal(fixture.changes(), 1);
});

test('partial writes that change again during settling produce one restart for final env contents', (t) => {
  const fixture = setup(t);
  fs.writeFileSync(fixture.env, 'FIXTURE_SECRET=partial');
  fixture.watchers.get(fixture.directory).fire('change', '.env');
  t.mock.timers.tick(10);
  fs.writeFileSync(fixture.env, 'FIXTURE_SECRET=finished-known-test-value\n');
  fixture.watchers.get(fixture.directory).fire('change', '.env');
  fixture.settle();
  assert.equal(fixture.changes(), 1);
});

test('creating and deleting nested source files each request one restart', (t) => {
  const fixture = setup(t);
  const nested = path.join(fixture.source, 'nested');
  const added = path.join(nested, 'feature.mjs');
  fs.mkdirSync(nested);
  fs.writeFileSync(added, 'export default true;\n');
  fixture.watchers.get(fixture.source).fire('rename', 'nested/feature.mjs');
  fixture.settle();
  assert.equal(fixture.changes(), 1);
  fs.unlinkSync(added);
  fixture.watchers.get(fixture.source).fire('rename', 'nested/feature.mjs');
  fixture.settle();
  assert.equal(fixture.changes(), 2);
});

test('env creation/deletion and package configuration edits are detected by contents', (t) => {
  const fixture = setup(t);
  fs.unlinkSync(fixture.env);
  fixture.watchers.get(fixture.directory).fire('rename', '.env');
  fixture.settle();
  assert.equal(fixture.changes(), 1);
  fs.writeFileSync(fixture.env, 'FIXTURE_SECRET=recreated-known-test-value\n');
  fixture.watchers.get(fixture.directory).fire('rename', '.env');
  fixture.settle();
  assert.equal(fixture.changes(), 2);
  fs.writeFileSync(path.join(fixture.directory, 'package.json'), '{"name":"updated-fixture"}\n');
  fixture.watchers.get(fixture.directory).fire('change', 'package.json');
  fixture.settle();
  assert.equal(fixture.changes(), 3);
});

test('data, dependencies, env examples, and non-code source files do not request API restarts', (t) => {
  const fixture = setup(t);
  fs.mkdirSync(path.join(fixture.directory, 'data'));
  fs.writeFileSync(path.join(fixture.directory, 'data', 'fixture.txt'), 'not a real database');
  fs.mkdirSync(path.join(fixture.directory, 'node_modules'));
  fs.writeFileSync(path.join(fixture.source, 'notes.md'), 'documentation');
  fs.writeFileSync(path.join(fixture.directory, '.env.example'), 'EXAMPLE=value');
  for (const filename of ['data', 'node_modules', '.env.example']) fixture.watchers.get(fixture.directory).fire('rename', filename);
  fixture.watchers.get(fixture.source).fire('change', 'notes.md');
  fixture.settle();
  assert.equal(fixture.changes(), 0);
});

test('closing the watcher cancels pending content checks and closes its native watchers', (t) => {
  const fixture = setup(t);
  fs.writeFileSync(fixture.code, 'export const value = 3;\n');
  fixture.watchers.get(fixture.source).fire('change', 'app.js');
  fixture.watcher.close();
  fixture.settle();
  assert.equal(fixture.changes(), 0);
  assert.ok([...fixture.watchers.values()].every((watcher) => watcher.closed));
});
