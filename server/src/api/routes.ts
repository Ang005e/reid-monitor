import type { IncomingMessage, ServerResponse } from 'node:http';
import { SIM_SPEED } from '../config.js';
import type { ReadingStore } from '../store.js';
import { attachSseClient } from './sse.js';

/**
 * Returns a request handler that routes /api/* requests to the correct logic.
 *
 * All paths are wrapped in a try/catch so a bug in a handler produces a 500
 * JSON response rather than an unhandled exception that crashes the process.
 */
export function createRoutes(
  store: ReadingStore,
): (req: IncomingMessage, res: ServerResponse) => void {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Parse once up-front; using the URL constructor avoids fragile hand-rolled
    // path and query-string splitting.
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;
    const method = req.method ?? 'GET';

    try {
      // /api/readings/stream is checked before /api/readings so the longer
      // path is matched first (both share the /api/readings prefix).
      if (pathname === '/api/readings/stream' && method === 'GET') {
        // Last-Event-ID (sent automatically by EventSource on reconnect) takes
        // precedence over the ?since query param so the client resumes cleanly.
        const since = parseSince(req, url);
        attachSseClient(res, store, since);
        return;
      }

      if (pathname === '/api/health' && method === 'GET') {
        // This is Render's health-check endpoint — it must never throw.
        // Every value here comes from synchronous getters on stable primitives.
        sendJson(res, 200, {
          status: 'ok',
          simSpeed: SIM_SPEED,
          cleanedRows: store.count,
          latestTimestamp: store.latest?.timestamp ?? null,
          subscribers: store.subscriberCount,
          uptimeSeconds: Math.floor(process.uptime()),
        });
        return;
      }

      if (pathname === '/api/readings' && method === 'GET') {
        const sinceParam = url.searchParams.get('since');
        // store.since() treats both undefined and NaN as "full history".
        const since = sinceParam !== null ? Number(sinceParam) : undefined;
        sendJson(res, 200, store.since(since));
        return;
      }

      if (pathname === '/api/meta' && method === 'GET') {
        sendJson(res, 200, {
          ...store.getMeta(),
          simSpeed: SIM_SPEED,
          cleanedRows: store.count,
        });
        return;
      }

      // Unknown path (or wrong method on a known path) → 404.
      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[api/routes] unhandled error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: String(err) });
      }
    }
  };
}

/**
 * Resolves the `since` cursor for history and SSE requests.
 *
 * Precedence: Last-Event-ID header > ?since query param > undefined (all history).
 * `Last-Event-ID` is set automatically by EventSource on reconnect, so it
 * represents the client's actual last-received position.
 */
function parseSince(req: IncomingMessage, url: URL): number | undefined {
  const rawLastEventId = req.headers['last-event-id'];
  // IncomingHttpHeaders types generic headers as string | string[] | undefined.
  const lastEventId: string | undefined =
    typeof rawLastEventId === 'string'
      ? rawLastEventId
      : Array.isArray(rawLastEventId)
        ? rawLastEventId[0]
        : undefined;

  const sinceStr = lastEventId ?? url.searchParams.get('since') ?? undefined;
  return sinceStr !== undefined ? Number(sinceStr) : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
