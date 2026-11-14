import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevSupervisor } from './devSupervisor.js';
import { createSourceWatcher } from './sourceWatcher.js';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
let supervisor;
let stopping = false;
let exitCode = 0;
const watcher = createSourceWatcher({
  sourceDirectory: path.join(serverRoot, 'src'),
  configFiles: [path.join(serverRoot, '.env'), path.join(serverRoot, 'package.json')],
  onChange: () => {
    if (stopping) return;
    supervisor.restart().catch(() => {
      exitCode = process.exitCode = 1;
      watcher.close();
      supervisor.child.once('exit', () => process.exit(1));
    });
  },
  onError: (error) => {
    console.error(`[dev] File watcher failed: ${error.message}`);
    stop(1);
  },
});
// Finish configuring the watcher before forking, so a watcher setup error cannot orphan an API process.
supervisor = createDevSupervisor({
  entry: path.join(serverRoot, 'src/index.js'),
  cwd: serverRoot,
  onState: (state) => {
    if (process.connected) process.send({ type: 'api-state', ...state }, () => {});
  },
});
async function stop(code = 0) {
  exitCode = Math.max(exitCode, code);
  if (stopping) return;
  stopping = true;
  watcher.close();
  try {
    await supervisor.stop();
    process.exit(exitCode);
  } catch (error) {
    console.error(`[dev] ${error.message}`);
    process.exitCode = 1;
    // Keep supervising the old process after a timeout; never abandon or force-kill it.
    supervisor.child.once('exit', () => process.exit(1));
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, () => stop());
process.on('message', (message) => { if (message?.type === 'shutdown') stop(); });
process.on('disconnect', () => stop());
if (process.connected) process.send({ type: 'ready' }, () => {});
