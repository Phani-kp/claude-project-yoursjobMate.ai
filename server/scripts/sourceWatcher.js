import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sourceFile = /\.(?:[cm]?js|json)$/i;
const missing = (error) => error.code === 'ENOENT' || error.code === 'ENOTDIR';
const same = (left, right) => left.size === right.size && [...left].every(([file, hash]) => right.get(file) === hash);

/** Native events are hints: only a stable change to file contents can restart the API. */
export function createSourceWatcher({ sourceDirectory, configFiles = [], onChange, onError = () => {}, debounceMs = 200, settleMs = 50, watch = fs.watch }) {
  const sourceRoot = path.resolve(sourceDirectory);
  const configs = configFiles.map((file) => path.resolve(file));
  function snapshot() {
    const files = [];
    const visit = (directory) => {
      let entries;
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
      catch (error) { if (missing(error)) return; throw error; }
      for (const entry of entries) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(filename);
        else if (entry.isFile() && sourceFile.test(entry.name)) files.push(filename);
      }
    };
    visit(sourceRoot);
    files.push(...configs);
    const hashes = new Map();
    for (const file of files) {
      try { hashes.set(file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')); }
      catch (error) { if (!missing(error)) throw error; }
    }
    return hashes;
  }
  let previous = snapshot();
  let candidate;
  let timer;
  let closed = false;
  const watchers = [];
  function check() {
    if (closed) return;
    try {
      const next = snapshot();
      if (same(previous, next)) { candidate = undefined; return; }
      // Wait for a second matching snapshot, so atomic saves and short partial writes settle.
      if (!candidate || !same(candidate, next)) {
        candidate = next;
        timer = setTimeout(check, settleMs);
        return;
      }
      previous = next;
      candidate = undefined;
      onChange();
    } catch (error) { onError(error); }
  }
  function changed() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(check, debounceMs);
  }
  try {
    watchers.push(watch(sourceRoot, { recursive: true }, changed));
    const directories = new Map();
    for (const file of configs) {
      const parent = path.dirname(file);
      if (!directories.has(parent)) directories.set(parent, new Set());
      directories.get(parent).add(path.basename(file));
    }
    for (const [directory, names] of directories) {
      watchers.push(watch(directory, {}, (_event, filename) => {
        if (filename == null || names.has(String(filename))) changed();
      }));
    }
    for (const watcher of watchers) watcher.on('error', onError);
  } catch (error) {
    for (const watcher of watchers) watcher.close();
    throw error;
  }
  // Covers the small interval between taking the baseline and installing native watchers.
  changed();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}
