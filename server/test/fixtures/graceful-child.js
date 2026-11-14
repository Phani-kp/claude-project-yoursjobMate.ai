// Isolated IPC fixture: never opens the app database or loads an env file.
process.on('message', (message) => {
  if (message?.type !== 'shutdown') return;
  setTimeout(() => {
    process.send({ type: 'closed' }, () => process.exit(0));
  }, 25);
});
process.send({ type: 'ready' });
