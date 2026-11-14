import { fork } from 'node:child_process';

/** A child must announce that its shutdown listener is installed before we send a stop request. */
export function manageChild(child, { timeoutMs = 35_000 } = {}) {
  let ready = false;
  let stopping = false;
  let sent = false;
  let stopPromise;
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: 1, error }));
  });
  const request = () => {
    if (stopping && ready && !sent && child.connected) {
      sent = true;
      child.send({ type: 'shutdown' }, () => {});
    }
  };
  child.on('message', (message) => {
    if (message?.type === 'ready') { ready = true; request(); }
  });
  return {
    child,
    exited,
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      request();
      stopPromise = new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error(`API shutdown exceeded ${timeoutMs}ms. The old process was left running to protect its database; no replacement will be started.`)), timeoutMs);
        exited.then((result) => { clearTimeout(deadline); resolve(result); });
      });
      return stopPromise;
    },
  };
}

/** Serialize API restarts; a failed/slow close permanently blocks replacement in this supervisor. */
export function createDevSupervisor({ entry, cwd, forkChild = fork, logger = console, timeoutMs = 35_000, execArgv = ['--no-warnings', '--env-file-if-exists=.env'], onState = () => {} }) {
  let current;
  let phase;
  let stopping = false;
  let failed = false;
  let restarting;
  let stopPromise;
  function state(value) {
    phase = value.state;
    onState(value);
  }
  function launch() {
    state({ state: 'starting' });
    try {
      current = manageChild(forkChild(entry, [], { cwd, execArgv, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }), { timeoutMs });
    } catch (error) {
      state({ state: 'exited', code: 1 });
      throw error;
    }
    const started = current;
    started.child.on('message', (message) => {
      if (started !== current || stopping || phase === 'stopping' || phase === 'exited') return;
      // "ready" only means IPC shutdown is installed. HTTP readiness needs a bound listening socket.
      if (message?.type === 'listening' && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) {
        state({ state: 'listening', port: message.port });
      }
    });
    started.exited.then(({ code, signal, error }) => {
      if (started === current) state({ state: 'exited', ...(Number.isInteger(code) && { code }), ...(signal && { signal }) });
      if (!stopping && !restarting && started === current) {
        logger.error(`[dev] API exited (${error?.message || signal || code}). Waiting for a source/configuration change; existing data was preserved.`);
      }
    });
  }
  launch();
  return {
    get child() { return current.child; },
    restart() {
      if (stopping || failed) return Promise.resolve();
      if (restarting) return restarting;
      state({ state: 'stopping' });
      logger.log('[dev] Change detected; waiting for the API to close its database before restarting.');
      restarting = (async () => {
        try {
          await current.stop();
          if (!stopping) launch();
        } catch (error) {
          failed = true;
          logger.error(`[dev] ${error.message}`);
          throw error;
        } finally {
          restarting = undefined;
        }
      })();
      return restarting;
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      state({ state: 'stopping' });
      stopPromise = current.stop();
      return stopPromise;
    },
  };
}
