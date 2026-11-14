export const SERVICE_UNAVAILABLE = 'The service is temporarily unavailable. Please try again shortly.';
const routes = ['/api', '/socket.io'];

function isServiceRequest(url = '') {
  const pathname = url.split(/[?#]/, 1)[0];
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function targetOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The development API target must be an HTTP origin');
  }
  return url.origin;
}

function unavailable(res, status) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: SERVICE_UNAVAILABLE }));
}

export function createDevProxy({ target = 'http://127.0.0.1:4000' } = {}) {
  let currentTarget = targetOrigin(target);
  let state;
  const configuredOptions = new Set();
  const available = () => state === undefined || ['ready', 'running', 'listening'].includes(state);

  const proxy = Object.fromEntries(routes.map((route) => [route, {
    target: currentTarget,
    ws: route === '/socket.io',
    changeOrigin: true,
    // Vite matches proxy contexts by string prefix; let non-service paths such
    // as /apiculture continue to its normal middleware instead of the API.
    bypass(req, _res, options) {
      options.target = currentTarget;
      if (!isServiceRequest(req.url)) return req.url;
    },
    configure(server, options) {
      configuredOptions.add(options);
      configuredOptions.add(server.options);
      for (const option of [options, server.options]) option.target = currentTarget;
      // Vite registers its fallback after configure(). Handle HTTP first so
      // its empty text/plain 502 cannot replace this JSON response. A WS error
      // supplies a socket instead of a ServerResponse; never call writeHead.
      server.prependListener('error', (_error, _req, response) => {
        if (typeof response?.writeHead === 'function') unavailable(response, 502);
        else if (response && !response.destroyed && !response.writableEnded) response.end();
      });
    },
  }]));

  return {
    proxy,
    plugin: {
      name: 'yoursjobmate-api-availability',
      apply: 'serve',
      configureServer(server) {
        // configureServer hooks run before Vite installs its proxy middleware.
        server.middlewares.use((req, res, next) => {
          if (isServiceRequest(req.url) && !available()) return unavailable(res, 503);
          next();
        });
      },
    },
    setTarget(value) {
      currentTarget = targetOrigin(value);
      for (const options of [...Object.values(proxy), ...configuredOptions]) options.target = currentTarget;
      // Vite copies route options internally. Its http-proxy instance retains
      // the actual options captured by web()/ws(); configure records those
      // live objects, so future HTTP and WS requests use the updated target.
    },
    setState(value) {
      state = value;
    },
  };
}
