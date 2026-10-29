import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { verifyToken } from './auth.js';
import { db } from './db.js';
import { verifyMailer } from './mailer.js';
import { setIo, startAgent } from './agent.js';

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
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`
Port ${PORT} is already in use, probably by another copy of this server that is still running.
Stop it (Ctrl+C in its terminal, or close that terminal), then start again. Or set PORT to a different number.
`);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`YoursJobMate API on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'}, database: ${db.kind === 'postgres' ? 'PostgreSQL' : 'embedded Postgres (local dev)'})`);
  verifyMailer();
  agentTimer = startAgent({ intervalMs: Number(process.env.AGENT_INTERVAL_MS) || 60_000 });
});

// Hosts send SIGTERM on deploys and restarts: stop taking work, finish open requests, close the database.
function shutdown(signal) {
  console.log(`${signal} received, shutting down…`);
  clearInterval(agentTimer);
  // Closes the sockets and the HTTP server, waiting for open requests.
  io.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
