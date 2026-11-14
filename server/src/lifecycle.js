/** Stop incoming work, drain it, then close storage exactly once. A timeout never kills a database write. */
export function createShutdown({ stopWork, closeServer, closeDatabase, logger = console, exit = (code) => process.exit(code), timeoutMs = 30_000 }) {
  let pending;
  let exitCode = 0;
  return function shutdown(reason, code = 0) {
    exitCode = Math.max(exitCode, code);
    if (pending) return pending;
    logger.log(`${reason}: stopping the API and closing its database...`);
    const deadline = setTimeout(() => {
      exitCode = 1;
      logger.error('[shutdown] Still waiting for active work or database close. The API remains alive to protect its data; no forced exit was performed.');
    }, timeoutMs);
    const report = (error) => {
      exitCode = 1;
      logger.error('[shutdown] Could not finish cleanly:', error.message);
    };
    pending = (async () => {
      // Both functions start immediately: stop the timer and stop accepting requests before waiting.
      const drained = await Promise.allSettled([
        Promise.resolve().then(stopWork),
        Promise.resolve().then(closeServer),
      ]);
      for (const result of drained) if (result.status === 'rejected') report(result.reason);
      try {
        await closeDatabase();
      } catch (error) {
        report(error);
      }
      clearTimeout(deadline);
      exit(exitCode);
    })();
    return pending;
  };
}

/** IPC supports graceful restarts on Windows, where child.kill() cannot deliver a catchable signal. */
export function installShutdownHandlers(shutdown, processObject = process) {
  const handlers = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].map((signal) => [signal, () => shutdown(signal)]);
  handlers.push(['message', (message) => { if (message?.type === 'shutdown') shutdown('Development supervisor requested shutdown'); }]);
  handlers.push(['disconnect', () => shutdown('Development supervisor disconnected')]);
  for (const [event, handler] of handlers) processObject.on(event, handler);
  return () => { for (const [event, handler] of handlers) processObject.off(event, handler); };
}
