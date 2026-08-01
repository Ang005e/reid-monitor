import { CLEANED_CSV, PIPELINE_POLL_MS, RAW_CSV } from '../config.js';
import { appendLines, ensureHeader, readText, resetFile } from '../csv/appendOnly.js';
import { parseRawCsv } from '../csv/parse.js';
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

  /** Cleaned rows already on disk when we booted; used to avoid re-appending. */
  private alreadyPersisted = 0;

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
    const rawText = readText(RAW_CSV);
    if (rawText.trim() === '') return;

    const rawRows = parseRawCsv(rawText);
    if (rawRows.length <= this.rawConsumed) return;

    const finalised: CleanedReading[] = [];
    for (let i = this.rawConsumed; i < rawRows.length; i += 1) {
      const row = rawRows[i];
      if (row === undefined) continue;
      finalised.push(...this.pipeline.push(row));
    }
    this.rawConsumed = rawRows.length;

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
    this.refreshMeta();
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
    // Nothing from this pass is on disk yet. Ids no longer equal row indices
    // after a loop, so this must track the id offset, not zero.
    this.alreadyPersisted = continueFromId;

    console.log(`[pipeline] history cleared for new pass — ids continue from ${continueFromId}`);
  }

  /**
   * Recomputes the derived summaries served by /api/meta.
   *
   * Cheap enough to redo wholesale on every batch at this scale, and doing so
   * keeps the expanding-window semantics honest: the stable baseline genuinely
   * tightens as more stable hours accumulate.
   */
  private refreshMeta(): void {
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
