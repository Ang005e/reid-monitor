import { CLEANED_CSV, META_REFRESH_MS, PIPELINE_POLL_MS, RAW_CSV } from '../config.js';
import {
  appendLines,
  ensureHeader,
  fileSize,
  readRange,
  readText,
  resetFile,
} from '../csv/appendOnly.js';
import { parseRawLine, rawColumns, type RawColumns } from '../csv/parse.js';
import { CLEANED_HEADER, parseCleanedCsv, serializeCleaned } from '../csv/serialize.js';
import type { ReadingStore } from '../store.js';
import type { CleanedReading } from '../types.js';
import { computeBaselineLimits } from './baseline.js';
import { summariseEpisodes } from './episodes.js';
import { computeRulePerformance } from './performance.js';
import { StreamingPipeline } from './runPipeline.js';

export * from './runPipeline.js';
export * from './clean.js';
export * from './calibrate.js';
export * from './alerts.js';
export * from './episodes.js';
export * from './baseline.js';
export * from './performance.js';

/**
 * The long-running pipeline: watches raw-sensor-data.csv, appends every row it
 * finalises to cleaned-sensor-data.csv, and pushes it into the store for the API
 * to serve.
 *
 * Both files are append-only history. Nothing here ever rewrites a published
 * line, which is exactly why the streaming pipeline holds a row back until its
 * successor lands — see StreamingPipeline for why cell 9 forces that.
 */
export class PipelineRunner {
  private readonly store: ReadingStore;
  private pipeline = new StreamingPipeline();
  private timer: NodeJS.Timeout | null = null;

  /** Raw rows already fed into the pipeline. */
  private rawConsumed = 0;

  // --- Raw-file tail cursor ---------------------------------------------------
  // The raw feed is append-only, so each poll reads only the bytes added since
  // the last one. See poll() and csv/appendOnly.readRange.

  /** Bytes of RAW_CSV already read (including any partial trailing line). */
  private rawBytes = 0;

  /** Trailing partial line from the last chunk, awaiting its newline. */
  private rawLeftover = '';

  /** Column positions, resolved once from the header line. */
  private rawColumns: RawColumns | null = null;

  /** Cleaned rows already on disk when we booted; used to avoid re-appending. */
  private alreadyPersisted = 0;

  /** Wall clock of the last /meta recomputation — see refreshMeta's throttle. */
  private lastMetaMs = 0;

  constructor(store: ReadingStore) {
    this.store = store;
  }

  /**
   * Restores prior state, catches up on anything the raw file gained while we
   * were down, then begins polling.
   *
   * Recovery is a full deterministic replay: we re-feed every raw row through a
   * fresh pipeline and simply discard the rows already on disk. That costs a
   * pass over a small file and makes a half-finished tick, a crash, or a wiped
   * ephemeral disk all converge on the same correct state.
   */
  start(): void {
    ensureHeader(CLEANED_CSV, CLEANED_HEADER);

    const existing = parseCleanedCsv(readText(CLEANED_CSV));
    this.alreadyPersisted = existing.length;
    this.store.hydrate(existing);

    if (existing.length > 0) {
      console.log(`[pipeline] restored ${existing.length} cleaned row(s) from disk`);
    }

    this.poll();

    this.timer = setInterval(() => this.poll(), PIPELINE_POLL_MS);
    this.timer.unref();
    console.log(`[pipeline] watching ${RAW_CSV} every ${PIPELINE_POLL_MS}ms`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Consumes any raw rows that have appeared since the last pass.
   *
   * Safe to call directly — the simulator nudges it on each tick so a new row
   * reaches the dashboard without waiting for the poll interval.
   */
  poll(): void {
    const size = fileSize(RAW_CSV);

    // The file shrank, so it was truncated under us — the simulator starting a
    // new pass. Drop our byte cursor and re-read from the top; resetForLoop has
    // already reset everything else.
    if (size < this.rawBytes) this.resyncRaw();
    if (size === 0 || size === this.rawBytes) return;

    // Read ONLY the new bytes. See readRange for why this is not a whole-file
    // read: at 30,000 rows and four polls a second, re-parsing the file each
    // time is quadratic over a pass and visibly slows the feed.
    const text = this.rawLeftover + readRange(RAW_CSV, this.rawBytes, size);
    this.rawBytes = size;

    // A chunk boundary can land mid-line. Keep any trailing partial line back
    // until the rest of it arrives, or it would parse as a short row.
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) {
      this.rawLeftover = text;
      return;
    }
    this.rawLeftover = text.slice(lastNewline + 1);

    const lines = text
      .slice(0, lastNewline)
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;

    // The first complete line of the file is the header.
    let start = 0;
    if (this.rawColumns === null) {
      const headerLine = lines[0];
      if (headerLine === undefined) return;
      this.rawColumns = rawColumns(headerLine.split(','));
      start = 1;
    }
    const at = this.rawColumns;

    const finalised: CleanedReading[] = [];
    for (let i = start; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) continue;
      finalised.push(...this.pipeline.push(parseRawLine(line, at, this.rawConsumed)));
      this.rawConsumed += 1;
    }

    // Rows below the restore point are already on disk and already in the store;
    // re-deriving them was how we rebuilt pipeline state, not new work.
    const fresh = finalised.filter((r) => r.id >= this.alreadyPersisted);
    if (fresh.length === 0) return;

    appendLines(CLEANED_CSV, fresh.map(serializeCleaned));
    for (const reading of fresh) this.store.push(reading);

    this.refreshMeta();
  }

  /**
   * Publishes everything still held back.
   *
   * Only correct at the end of a finite replay: a trailing gap has no following
   * reading, so it stays null — the same answer pandas gives for a dataset's
   * last row.
   */
  flush(): void {
    const remaining = this.pipeline.flush().filter((r) => r.id >= this.alreadyPersisted);
    if (remaining.length === 0) return;

    appendLines(CLEANED_CSV, remaining.map(serializeCleaned));
    for (const reading of remaining) this.store.push(reading);
    this.refreshMeta(true);
  }

  /**
   * Handles the simulator looping back to the first row of the dataset.
   *
   * Called BEFORE the raw file is truncated, so the order here matters:
   *
   *  1. flush() — publish the row the pipeline is still holding for lookahead,
   *     so the run ends on the dataset's last reading instead of one short.
   *  2. Clear the cleaned file and the store, so the dashboard starts the new
   *     pass with an empty chart rather than a timeline that jumps backwards.
   *  3. Start a fresh pipeline whose ids CONTINUE from the current cursor.
   *
   * Step 3 is the subtle one. Ids are the SSE resume cursor and the dashboard
   * discards any id it has already seen, so restarting them at 0 would make the
   * entire second pass look like duplicate data. Timestamps repeat across loops;
   * ids never do.
   */
  resetForLoop(): void {
    this.flush();

    const continueFromId = this.pipeline.cursor;

    resetFile(CLEANED_CSV);
    ensureHeader(CLEANED_CSV, CLEANED_HEADER);
    this.store.reset();

    this.pipeline = new StreamingPipeline(continueFromId);
    this.rawConsumed = 0;
    // The simulator truncates and re-headers the raw file immediately after
    // this returns, so the tail cursor has to start over with it.
    this.resyncRaw();
    // Nothing from this pass is on disk yet. Ids no longer equal row indices
    // after a loop, so this must track the id offset, not zero.
    this.alreadyPersisted = continueFromId;

    console.log(`[pipeline] history cleared for new pass — ids continue from ${continueFromId}`);
  }

  /**
   * Rewinds the raw-file tail cursor so the next poll reads from byte 0.
   *
   * Used whenever the file underneath us is replaced rather than appended to:
   * a loop truncates and re-headers it, so the old byte offset, the buffered
   * partial line and the resolved header all belong to a file that no longer
   * exists.
   */
  private resyncRaw(): void {
    this.rawBytes = 0;
    this.rawLeftover = '';
    this.rawColumns = null;
  }

  /**
   * Recomputes the derived summaries served by /api/meta.
   *
   * Throttled, because all three are whole-history scans and history is now
   * ~30,000 minute rows rather than 500 hourly ones: the baseline sorts every
   * stable value per channel to take percentiles, and rows arrive in batches
   * four times a second. Recomputing on every batch was affordable at hourly
   * resolution and is simply wasted work at this one — /meta is polled by the
   * dashboard every few minutes and its numbers move slowly by construction
   * (an expanding window over stable rows).
   *
   * `force` bypasses the throttle for end-of-pass flushes, so the summaries a
   * run finishes on always include its final rows.
   */
  private refreshMeta(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastMetaMs < META_REFRESH_MS) return;
    this.lastMetaMs = now;

    const all = this.store.since();
    this.store.setMeta({
      baseline: computeBaselineLimits(all),
      episodes: summariseEpisodes(all),
      performance: computeRulePerformance(all),
    });
  }

  get cleanedCount(): number {
    return this.store.count;
  }

  /** Rows received but held back for lookahead. */
  get pendingCount(): number {
    return this.pipeline.pendingCount;
  }
}
