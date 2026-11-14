import path from 'node:path';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { manageChild } from '../server/scripts/devSupervisor.js';
import { createDevProxy } from '../client/devProxy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const clientRoot = path.join(root, 'client');
const require = createRequire(path.join(clientRoot, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const gateway = createDevProxy({ target: 'http://127.0.0.1:4000' });
gateway.setState('starting');
let vite;
let api;
let stopping;
let exitCode = 0;
let firstListening = false;
let apiPhase = 'starting';
let apiPort;
let resolveStartup;
let rejectStartup;
const startup = new Promise((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject; });
// A very early child failure can arrive before the main flow awaits startup.
startup.catch(() => {});
function apiState(message) {
  if (stopping || message?.type !== 'api-state') return;
  const previousPhase = apiPhase;
  apiPhase = message.state;
  if (message.state === 'listening' && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) {
    apiPort = message.port;
    gateway.setTarget(`http://127.0.0.1:${apiPort}`);
    gateway.setState('ready');
    firstListening = true;
    resolveStartup();
    return;
  }
  gateway.setState(message.state);
  if (message.state === 'exited') {
    // A source change can request a graceful restart during initial DB startup.
    // Wait for that replacement; an unexpected exit still fails immediately.
    if (previousPhase !== 'stopping') {
      if (!firstListening) rejectStartup(new Error('The API exited before it began listening. Fix the API error above, then run npm run dev again.'));
      else console.error('[dev] The API is unavailable. Waiting for a source/configuration change; requests will receive a service-unavailable response.');
    }
  }
}
function stop(code = 0) {
  exitCode = Math.max(exitCode, code);
  if (stopping) return stopping;
  stopping = (async () => {
    const results = await Promise.allSettled([vite?.close(), api?.stop()]);
    for (const result of results) if (result.status === 'rejected') {
      exitCode = 1;
      console.error(`[dev] ${result.reason.message}`);
    }
    if (api && results.some((result) => result.status === 'rejected')) {
      await api.exited; // A timeout reports failure, while the old API retains its database lock.
    }
    process.exit(exitCode);
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, () => stop());
process.on('message', (message) => { if (message?.type === 'shutdown') stop(); });
if (process.connected) process.send({ type: 'ready' }, () => {});
try {
  vite = await createServer({ root: clientRoot, plugins: [gateway.plugin], server: { proxy: gateway.proxy } });
  if (!stopping) {
    api = manageChild(fork(path.join(root, 'server/scripts/dev.js'), [], {
      cwd: path.join(root, 'server'),
      execArgv: ['--no-warnings'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    }), { timeoutMs: 40_000 });
    api.child.on('message', apiState);
    api.exited.then(({ code }) => {
      if (!stopping) {
        rejectStartup(new Error('The API development supervisor exited before startup completed.'));
        stop(code || 1);
      }
    });
    const deadline = setTimeout(() => rejectStartup(new Error('The API did not begin listening within 35 seconds. Check its startup errors above.')), 35_000);
    try { await startup; } finally { clearTimeout(deadline); }
    if (!stopping) {
      await vite.listen();
      console.log(`[dev] API ready at http://127.0.0.1:${apiPort}`);
      vite.printUrls();
      if (process.connected) process.send({ type: 'dev-ready', apiPort, frontendUrls: vite.resolvedUrls?.local || [] }, () => {});
    }
  } else {
    await vite.close();
  }
} catch (error) {
  console.error(`[dev] Could not start development servers: ${error.message}`);
  await stop(1);
}
