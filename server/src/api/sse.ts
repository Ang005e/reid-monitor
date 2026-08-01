import type { ServerResponse } from 'node:http';
import { SSE_HEARTBEAT_MS } from '../config.js';
import type { CleanedReading } from '../types.js';
import type { ReadingStore } from '../store.js';

/**
 * Writes one SSE data frame.
 *
 * The `id:` field is what the browser uses to set Last-Event-ID on reconnect,
 * enabling the client to resume from where it left off without a full replay.
 */
function writeFrame(res: ServerResponse, reading: CleanedReading): void {
  res.write(`id: ${reading.id}\ndata: ${JSON.stringify(reading)}\n\n`);
}

/**
 * Attaches `res` as a persistent SSE client, replaying catch-up history then
 * forwarding live readings in real time.
 *
 * @param since  Exclusive cursor: only readings with id > since are sent.
 *               Undefined or NaN means "send all history" (cold connect).
 */
export function attachSseClient(
  res: ServerResponse,
  store: ReadingStore,
  since?: number,
): void {
  // --- SSE headers ---
  // X-Accel-Buffering: no — Render's nginx proxy buffers upstream responses by
  // default. Without this header every frame would be held until the buffer
  // fills, making the stream useless. This one header tells nginx to pass
  // bytes through immediately.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Disable Nagle's algorithm — without this, the OS can coalesce small TCP
  // segments and delay delivery of short SSE frames.
  res.socket?.setNoDelay(true);

  // --- Gap-free catch-up + live subscription ---
  //
  // The ordering problem: a reading can arrive between "read history" and
  // "subscribe to live pushes". If we replay first then subscribe, that reading
  // is lost (gap). If we subscribe first and also replay, the same reading could
  // appear in both the replay and the subscriber callback (duplicate).
  //
  // Fix: subscribe FIRST, buffer incoming live readings during replay, then drain
  // the buffer — skipping any reading whose id was already covered by catch-up.
  //
  // Node.js is single-threaded: the simulator's setInterval cannot fire while
  // synchronous code runs, so the buffer is always empty in practice. We keep
  // it as an explicit, tested invariant rather than an invisible assumption.

  const liveBuffer: CleanedReading[] = [];
  let streaming = false;

  const unsubscribe = store.subscribe((reading) => {
    if (streaming) {
      // Normal live path: write directly to the response.
      writeFrame(res, reading);
    } else {
      // Catch-up replay still in progress — buffer for dedup below.
      liveBuffer.push(reading);
    }
  });

  // Replay history — synchronous, no event-loop yield.
  const catchUp = store.since(since);
  for (const r of catchUp) {
    writeFrame(res, r);
  }

  // The highest id we sent during replay. Anything in liveBuffer at or below
  // this mark was already sent; anything above it is genuinely new.
  const lastCatchUpItem = catchUp[catchUp.length - 1];
  const highWaterMark =
    lastCatchUpItem !== undefined ? lastCatchUpItem.id : (since ?? -1);

  for (const r of liveBuffer) {
    if (r.id > highWaterMark) {
      writeFrame(res, r);
    }
  }

  // Switch to direct-write mode; future subscriber callbacks go straight to
  // the wire.
  streaming = true;

  // --- Heartbeat ---
  // Proxies and load-balancers idle-close connections with no traffic. A
  // comment frame (`:` prefix) is invisible to EventSource but resets the
  // proxy's inactivity timer.
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, SSE_HEARTBEAT_MS);

  // --- Cleanup ---
  // Both `close` (clean disconnect) and `error` (network failure) must release
  // the interval and the store subscription; failing to do so leaks both.
  function cleanup(): void {
    clearInterval(heartbeat);
    unsubscribe();
  }

  res.on('close', cleanup);
  res.on('error', cleanup);
}
