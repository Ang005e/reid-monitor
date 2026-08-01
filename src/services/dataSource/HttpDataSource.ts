import type { ConnectionStatus, HealthResponse, MetaResponse, SensorReading } from '@/types';
import type { DataSource } from './DataSource';

/**
 * Production adapter: connects to the real backend over HTTP + SSE.
 *
 * Expected endpoints (all relative to baseUrl):
 *   GET  /readings              → SensorReading[]  (full history, or since=<id>)
 *   GET  /readings/stream       → SSE stream of SensorReading
 *   GET  /meta                  → MetaResponse
 *   GET  /health                → HealthResponse
 *
 * ## How the cursor works
 *
 * `lastId` is the highest reading id we have consumed. It is written by
 * fetchHistory() from the final row of the history response, and updated
 * incrementally inside the SSE message handler. The subscribe() call reads
 * lastId to build the `?since=` URL, so subscribe() MUST be called after
 * fetchHistory() resolves — the hook in useMonitor.ts guarantees this via
 * the `historyReady` gate.
 *
 * `since` is EXCLUSIVE per the API contract: ?since=41 → server returns id >= 42.
 *
 * ## Reconnect behaviour on Render's free tier
 *
 * The backend sleeps after 15 min idle; the first request after an idle period
 * takes ~30 s. EventSource retries automatically when the connection drops, which
 * surfaces as an `onerror` event followed (eventually) by an `onopen`. We classify
 * this as 'reconnecting', NOT 'error', to avoid a false alarm. 'error' is only
 * reported after 4+ consecutive failures with no intervening successful open — at
 * that point something is genuinely wrong.
 */
export class HttpDataSource implements DataSource {
  private readonly baseUrl: string;

  /**
   * The highest reading id we have seen. null = no readings consumed yet.
   * Written by both fetchHistory() and the SSE message handler; read by
   * subscribe() to build the resume cursor URL.
   */
  private lastId: number | null = null;

  constructor(baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? '/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetches the full reading history in one shot (no `since` param — we always
   * want everything on a cold start so SPC and the rule engine have a full
   * window). Records lastId so subscribe() can open a gapless SSE connection.
   */
  async fetchHistory(): Promise<SensorReading[]> {
    const res = await fetch(`${this.baseUrl}/readings`);
    if (!res.ok) throw new Error(`GET /readings failed: ${res.status}`);
    const rows = (await res.json()) as SensorReading[];
    // Update the cursor regardless of array length — even an empty history
    // is fine (lastId stays null and subscribe opens without a since param).
    if (rows.length > 0) {
      this.lastId = rows[rows.length - 1].id;
    }
    return rows;
  }

  /**
   * Opens an SSE connection at `?since=lastId`. Because subscribe() is called
   * AFTER fetchHistory() resolves (enforced by useMonitor's historyReady gate),
   * lastId already reflects the full history and the server sends only new rows.
   *
   * The unsubscribe function closes the EventSource and reports 'ended' to the
   * status callback so the header badge updates immediately (e.g. on pause).
   */
  subscribe(
    onReading: (r: SensorReading) => void,
    onStatus?: (s: ConnectionStatus) => void,
    onReset?: () => void,
  ): () => void {
    // Build the resume URL. If we have a cursor, pass it; otherwise let the
    // server replay everything (shouldn't happen in normal flow, but safe).
    const url =
      this.lastId != null
        ? `${this.baseUrl}/readings/stream?since=${this.lastId}`
        : `${this.baseUrl}/readings/stream`;

    const source = new EventSource(url);

    /**
     * Count consecutive onerror events with no intervening onopen.
     * Render free-tier wakeups cause a single transient error then a clean
     * open; real outages cause many. We escalate to 'error' only at 4+.
     */
    let consecutiveErrors = 0;

    onStatus?.('connecting');

    source.onopen = () => {
      consecutiveErrors = 0; // reset on any successful open
      onStatus?.('live');
    };

    source.onmessage = (ev: MessageEvent<string>) => {
      const reading = JSON.parse(ev.data) as SensorReading;
      // Keep our cursor fresh on every message so any future reconnect (whether
      // via EventSource's built-in retry or an explicit subscribe() call after
      // pause) starts from the right place.
      if (reading.id > (this.lastId ?? -1)) {
        this.lastId = reading.id;
      }
      onReading(reading);
    };

    // The server sends `reset` when the history we hold no longer belongs to
    // its timeline: the simulator looped, or the backend restarted (ids begin
    // at 0 again on boot, since the free tier has no persistent disk).
    //
    // Clearing `lastId` is essential, not tidy-up. It is the resume cursor AND
    // it seeds the duplicate fence in useMonitor; a reset means the ids that
    // follow may be LOWER than the ones we have seen, so a stale cursor would
    // make us ask for a position the server cannot place and make the fence
    // discard every row that arrives. That is precisely the freeze this fixes.
    source.addEventListener('reset', () => {
      this.lastId = null;
      onReset?.();
    });

    source.onerror = () => {
      consecutiveErrors++;
      // 'reconnecting' is a normal condition on Render's free tier — don't
      // alarm the user. Only escalate to 'error' after repeated failures.
      if (consecutiveErrors >= 4) {
        onStatus?.('error');
      } else {
        onStatus?.('reconnecting');
      }
    };

    return () => {
      source.close();
      // Notify the UI immediately so the header badge shows 'ended' (e.g.
      // the user hit Pause) rather than staying on the last connection state.
      onStatus?.('ended');
    };
  }

  /** Per-channel baseline limits, episode history, and rule-performance scorecard. */
  async fetchMeta(): Promise<MetaResponse> {
    const res = await fetch(`${this.baseUrl}/meta`);
    if (!res.ok) throw new Error(`GET /meta failed: ${res.status}`);
    return (await res.json()) as MetaResponse;
  }

  /** Lightweight health snapshot — subscriber count, uptime, latest timestamp. */
  async fetchHealth(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`GET /health failed: ${res.status}`);
    return (await res.json()) as HealthResponse;
  }

  describe(): string {
    return `live · ${this.baseUrl}`;
  }
}
