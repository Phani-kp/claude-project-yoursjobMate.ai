import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDevProxy, SERVICE_UNAVAILABLE } from '../../client/devProxy.js';

const clientRequire = createRequire(new URL('../../client/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(clientRequire.resolve('vite')).href);
const unavailable = { error: SERVICE_UNAVAILABLE };

async function upstream(t, name) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/mail-failed')) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'We could not send your verification email. Please try again later.' }));
    } else res.end(JSON.stringify({ upstream: name, path: req.url }));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\nX-Fixture-Upstream: ${name}\r\n\r\n`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  t.after(stop);
  return { server, stop, origin: `http://127.0.0.1:${server.address().port}` };
}

async function proxyServer(t, gateway) {
  const server = await createServer({
    configFile: false,
    envDir: false,
    root: fileURLToPath(new URL('../../client/', import.meta.url)),
    appType: 'custom',
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [gateway.plugin, {
      name: 'fixture-fallback',
      configureServer(vite) {
        return () => vite.middlewares.use((_req, res) => res.end('frontend fallback'));
      },
    }],
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, proxy: gateway.proxy },
  });
  t.after(() => server.close());
  await server.listen();
  return { server, origin: `http://127.0.0.1:${server.httpServer.address().port}` };
}

function upgrade(origin) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${origin}/socket.io/?transport=websocket`, { headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': Buffer.alloc(16, 7).toString('base64'),
    } });
    request.on('error', reject);
    request.setTimeout(2_000, () => request.destroy(new Error('WebSocket fixture timed out')));
    request.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.headers['x-fixture-upstream']);
    });
    request.on('response', (response) => {
      response.resume();
      reject(new Error(`Unexpected WebSocket HTTP status ${response.statusCode}`));
    });
    request.end();
  });
}

test('Vite proxy returns JSON for connection failures and preserves upstream email errors', async (t) => {
  const first = await upstream(t, 'first');
  const gateway = createDevProxy({ target: first.origin });
  const vite = await proxyServer(t, gateway);
  let response = await fetch(`${vite.origin}/api/health`);
  assert.deepEqual(await response.json(), { upstream: 'first', path: '/api/health' });

  response = await fetch(`${vite.origin}/api/mail-failed`);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'We could not send your verification email. Please try again later.' });

  await first.stop();
  response = await fetch(`${vite.origin}/api/auth/login`);
  assert.equal(response.status, 502);
  assert.match(response.headers.get('Content-Type'), /application\/json/);
  assert.deepEqual(await response.json(), unavailable);
});

test('one running Vite server follows target port changes for HTTP and WebSocket requests', async (t) => {
  const first = await upstream(t, 'first');
  const second = await upstream(t, 'second');
  const gateway = createDevProxy({ target: first.origin });
  const vite = await proxyServer(t, gateway);
  assert.equal(await upgrade(vite.origin), 'first');
  gateway.setTarget(second.origin);
  assert.deepEqual(await (await fetch(`${vite.origin}/api/health`)).json(), { upstream: 'second', path: '/api/health' });
  assert.equal(await upgrade(vite.origin), 'second');

  await second.stop();
  await assert.rejects(upgrade(vite.origin), /socket hang up|ECONNRESET/);
  gateway.setTarget(first.origin);
  assert.deepEqual(await (await fetch(`${vite.origin}/api/health`)).json(), { upstream: 'first', path: '/api/health' });
});

test('availability gates only service paths with JSON 503 and recovers without restarting Vite', async (t) => {
  const api = await upstream(t, 'ready');
  const gateway = createDevProxy({ target: api.origin });
  const vite = await proxyServer(t, gateway);
  for (const state of ['starting', 'restarting', 'exited']) {
    gateway.setState(state);
    for (const pathname of ['/api', '/api/health', '/api?query=fixture', '/socket.io', '/socket.io/?transport=polling']) {
      const response = await fetch(vite.origin + pathname);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), unavailable);
    }
  }
  for (const pathname of ['/apiculture', '/socket.io-other', '/frontend']) {
    assert.equal(await (await fetch(vite.origin + pathname)).text(), 'frontend fallback');
  }
  for (const state of ['ready', 'listening', 'running']) {
    gateway.setState(state);
    assert.deepEqual(await (await fetch(`${vite.origin}/api/health`)).json(), { upstream: 'ready', path: '/api/health' });
  }
});
