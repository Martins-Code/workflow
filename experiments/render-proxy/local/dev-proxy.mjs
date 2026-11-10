// Local stand-in for the Render static site and its rewrite rules.
//
// It serves ../frontend and forwards /api/* and /sanctum/* to the PHP backend,
// the way the Render rewrites are expected to. Passing locally only proves the
// test page and backend work. It says nothing about Render itself.
//
// Usage: node local/dev-proxy.mjs
// Optional environment variables: PORT (default 5180), BACKEND_URL (default http://127.0.0.1:8090)

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '..', 'frontend');
const port = Number(process.env.PORT || 5180);
const backend = new URL(process.env.BACKEND_URL || 'http://127.0.0.1:8090');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function forward(req, res) {
  const clientIp = req.socket.remoteAddress ?? '';
  const headers = {
    ...req.headers,
    host: backend.host,
    'x-forwarded-for': req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${clientIp}` : clientIp,
    'x-forwarded-proto': 'http',
    'x-forwarded-host': req.headers.host ?? '',
  };
  const upstream = http.request(
    { hostname: backend.hostname, port: backend.port || 80, path: req.url, method: req.method, headers },
    (upstreamRes) => {
      // Node keeps multiple Set-Cookie headers as an array, so both test cookies survive.
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Dev proxy could not reach ${backend.origin}: ${error.message}`);
  });
  req.pipe(upstream);
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/config.js') {
    // Mirrors what frontend/build.sh generates on Render.
    res.writeHead(200, { 'content-type': contentTypes['.js'], 'cache-control': 'no-store' });
    res.end(`window.PROXY_TEST_CONFIG = ${JSON.stringify({ directBackendUrl: backend.origin })};\n`);
    return;
  }
  // Any path that isn't a real file gets index.html, like the Render "/* → /index.html" rule.
  let file = path.join(frontendDir, 'index.html');
  const requested = path.resolve(frontendDir, `.${decodeURIComponent(url.pathname)}`);
  if (requested.startsWith(frontendDir + path.sep)) {
    try {
      if ((await fs.stat(requested)).isFile()) file = requested;
    } catch {
      // Not a file: fall back to index.html.
    }
  }
  const body = await fs.readFile(file);
  res.writeHead(200, { 'content-type': contentTypes[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}

http
  .createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname.startsWith('/api/') || pathname.startsWith('/sanctum/')) {
      forward(req, res);
      return;
    }
    serveStatic(req, res).catch((error) => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error));
    });
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Dev proxy: http://127.0.0.1:${port}  ->  ${backend.origin}`);
  });
