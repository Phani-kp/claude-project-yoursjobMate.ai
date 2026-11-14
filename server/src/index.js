import './startupConfig.js';
import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { verifyToken } from './auth.js';
import { db } from './db.js';
import { verifyMailer } from './mailer.js';
import { setIo, startAgent, stopAgent } from './agent.js';
import { createShutdown, installShutdownHandlers } from './lifecycle.js';

const PORT = Number(process.env.PORT) || 4000;
const app = createApp();
const server = http.createServer(app);
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
const io = new Server(server, { cors: { origin: origins.length ? origins : process.env.NODE_ENV !== 'production' } });

// Each signed-in browser tab joins its user's room and receives live updates.
io.use(async (socket, next) => {
  try {
    socket.data.user = await verifyToken(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => socket.join(`user:${socket.data.user.id}`));

app.set('io', io);
setIo(io);

let agentTimer;
const shutdown = createShutdown({
  stopWork: () => stopAgent(agentTimer),
  closeServer: () => new Promise((resolve, reject) => {
    io.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  }),
  closeDatabase: () => db.close(),
});
installShutdownHandlers(shutdown);
// The watcher waits for this before requesting shutdown, including during initial database startup.
if (process.connected) process.send({ type: 'ready' }, () => {});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`
Port ${PORT} is already in use, probably by another copy of this server that is still running.
Stop it (Ctrl+C in its terminal, or close that terminal), then start again. Or set PORT to a different number.
`);
  else console.error(`[server] Could not listen: ${err.message}`);
  shutdown('Server startup failed', 1);
});
server.listen(PORT, () => {
  if (process.connected) process.send({ type: 'listening', port: server.address().port }, () => {});
  console.log(`YoursJobMate API on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'}, database: ${db.kind === 'postgres' ? 'PostgreSQL' : 'embedded Postgres (local dev)'})`);
  verifyMailer();
  agentTimer = startAgent({ intervalMs: Number(process.env.AGENT_INTERVAL_MS) || 60_000 });
});
