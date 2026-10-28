import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { verifyToken } from './auth.js';
import { setIo, startAgent } from './agent.js';

const PORT = Number(process.env.PORT) || 4000;
const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Each signed-in browser tab joins its user's room and receives live updates.
io.use((socket, next) => {
  try {
    socket.data.user = verifyToken(socket.handshake.auth?.token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => socket.join(`user:${socket.data.user.id}`));

app.set('io', io);
setIo(io);

server.listen(PORT, () => {
  console.log(`YoursJobMate API on http://localhost:${PORT}`);
  startAgent({ intervalMs: Number(process.env.AGENT_INTERVAL_MS) || 60_000 });
});
