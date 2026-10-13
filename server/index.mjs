import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import adminUsers from './dist/api/admin-users.js';
import googleMapsLocation from './dist/api/google-maps-location.js';
import passwordRecoveryV2 from './dist/api/password-recovery-v2.js';
import pushConfig from './dist/api/push-config.js';
import pushNotifications from './dist/api/push-notifications.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const staticRoot = join(root, 'client', 'dist');
const port = Number(process.env.PORT || 8080);

const apiHandlers = new Map([
  ['/api/admin-users', adminUsers],
  ['/api/google-maps-location', googleMapsLocation],
  ['/api/password-recovery-v2', passwordRecoveryV2],
  ['/api/push-config', pushConfig],
  ['/api/push-notifications', pushNotifications],
]);

const contentTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error('Request body exceeds 1 MiB.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function apiResponse(response) {
  return {
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(body) {
      if (!response.hasHeader('Content-Type')) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      response.end(JSON.stringify(body));
    },
    setHeader(name, value) {
      response.setHeader(name, value);
    },
  };
}

async function serveStatic(pathname, request, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: 'Invalid URL path.' });
    return;
  }

  const requestedPath = resolve(staticRoot, `.${decodedPath}`);
  if (requestedPath !== staticRoot && !requestedPath.startsWith(`${staticRoot}${sep}`)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }

  let filePath = requestedPath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    await access(filePath);
  } catch {
    if (extname(decodedPath)) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    filePath = join(staticRoot, 'index.html');
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', contentTypes.get(extname(filePath)) || 'application/octet-stream');
  response.setHeader('Content-Length', info.size);
  if (filePath.endsWith(`${sep}sw.js`)) {
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    response.setHeader('Service-Worker-Allowed', '/');
  } else if (filePath.endsWith(`${sep}manifest.webmanifest`)) {
    response.setHeader('Cache-Control', 'public, max-age=3600');
  } else if (filePath === join(staticRoot, 'index.html')) {
    response.setHeader('Cache-Control', 'no-cache');
  } else if (urlPathIsHashedAsset(filePath, staticRoot)) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    response.setHeader('Cache-Control', 'public, max-age=3600');
  }

  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', (error) => {
    console.error('[static] file read failed', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Unable to read requested file.' });
    else response.destroy(error);
  });
  stream.pipe(response);
}

function urlPathIsHashedAsset(filePath, rootPath) {
  return filePath.startsWith(join(rootPath, 'assets') + sep);
}

const server = createServer(async (request, response) => {
  applySecurityHeaders(response);

  let url;
  try {
    url = new URL(request.url || '/', 'http://localhost');
  } catch {
    sendJson(response, 400, { error: 'Invalid request URL.' });
    return;
  }

  if (url.pathname === '/healthz') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const handler = apiHandlers.get(url.pathname.replace(/\/+$/, '') || url.pathname);
    if (!handler) {
      sendJson(response, 404, { error: 'API endpoint not found.' });
      return;
    }

    try {
      const body = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readJsonBody(request);
      await handler({ method: request.method, headers: request.headers, body }, apiResponse(response));
      if (!response.writableEnded) response.end();
    } catch (error) {
      console.error('[api] request failed', error);
      if (!response.headersSent) {
        sendJson(response, error.statusCode || 500, {
          error: error.statusCode === 400
            ? 'Request body must be valid JSON.'
            : error.statusCode === 413
              ? 'Request body is too large.'
              : 'Internal server error.',
        });
      } else {
        response.destroy(error);
      }
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  try {
    await serveStatic(url.pathname, request, response);
  } catch (error) {
    console.error('[static] request failed', error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Unable to serve requested page.' });
    else response.destroy(error);
  }
});

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must be configured.');
}

server.listen(port, '0.0.0.0', () => {
  console.log(`HRM server listening on port ${port}`);
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
