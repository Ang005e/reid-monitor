import http from 'node:http';
import { CORS_ORIGINS, IS_PRODUCTION, PORT } from '../config.js';
import type { ReadingStore } from '../store.js';
import { createRoutes } from './routes.js';

/**
 * Creates an HTTP server wired to the given store.
 * Does not start listening — call startApiServer() or server.listen() directly.
 */
export function createApiServer(store: ReadingStore): http.Server {
  const handleRoute = createRoutes(store);

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // --- CORS ---
    // The dashboard is served from Vercel; this API runs on Render. Different
    // origins mean EventSource needs an explicit Access-Control-Allow-Origin
    // grant, otherwise the browser blocks the response entirely.
    const rawOrigin = req.headers['origin'];
    // IncomingHttpHeaders types generic headers as string | string[] | undefined.
    const origin = typeof rawOrigin === 'string' ? rawOrigin : undefined;
    const allowedOrigin = resolveAllowedOrigin(origin);

    // Vary: Origin must always be present so intermediate caches do not serve
    // one client's CORS-granted response to a different-origin client.
    res.setHeader('Vary', 'Origin');

    if (allowedOrigin !== null) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      // Last-Event-ID is sent by EventSource on reconnect — it must be an
      // allowed request header for the browser to include it.
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }

    // Handle CORS preflight before routing — OPTIONS never reaches a handler.
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // This process serves only the API; anything outside /api is a mistake.
    if (!url.pathname.startsWith('/api')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    // Outer safety net: if the route handler's own try/catch is somehow
    // bypassed (e.g., a synchronous throw before any branching), we still
    // return a 500 rather than letting the server crash with an unhandled
    // exception.
    try {
      handleRoute(req, res);
    } catch (err) {
      console.error('[api/server] unhandled error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
  });
}

/**
 * Creates the API server and starts listening on PORT, logging the bound URL.
 */
export function startApiServer(store: ReadingStore): void {
  const server = createApiServer(store);
  server.listen(PORT, () => {
    // Use the OS-assigned address in case PORT was 0 (e.g., in tests).
    const addr = server.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : PORT;
    console.log(`[api] listening on http://localhost:${port}`);
  });
}

/**
 * Resolves the CORS origin to reflect, or null to omit the header entirely.
 *
 * Rules (in priority order):
 * 1. Request Origin is in CORS_ORIGINS → reflect it exactly.
 * 2. CORS_ORIGINS contains '*' AND not production → allow any origin (dev convenience).
 * 3. CORS_ORIGINS contains '*' AND IS_PRODUCTION → refuse with a loud warning.
 *    A wildcard in production would open this API to any browser origin and
 *    defeat Same-Origin Policy protections on Render. Set CORS_ORIGIN to
 *    explicit Vercel domain(s) in the deployment environment instead.
 * 4. No match → null (no CORS header; non-browser requests are unaffected).
 */
function resolveAllowedOrigin(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  if (CORS_ORIGINS.includes(origin)) return origin;

  if (CORS_ORIGINS.includes('*')) {
    if (IS_PRODUCTION) {
      console.warn(
        '[cors] CORS_ORIGINS contains "*" in production — refusing wildcard; ' +
          'set CORS_ORIGIN env var to explicit allowed origin(s)',
      );
      return null;
    }
    return '*';
  }

  return null;
}
