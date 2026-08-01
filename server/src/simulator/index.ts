/**
 * Simulator — turns the static source CSV into a live-looking append-only feed.
 *
 * WHY VERBATIM COPY: source lines are copied as raw strings, never parsed into
 * numbers and re-serialised. JavaScript's Number would silently alter tokens like
 * "49.0" → 49 (dropping the decimal), corrupting raw-sensor-data.csv. The CSV
 * parser (csv/parse.ts) makes the same assumption: the raw file is byte-faithful.
 *
 * WHY RESUME CURSOR: on ephemeral filesystems (Render free tier) data/live/ may
 * be wiped between deploys. countDataLines tells us how many rows are already
 * present, so we continue from exactly that position — no duplicates, no gaps.
 * Deleting data/live/ and restarting must produce a byte-identical file; this
 * cursor logic is what guarantees that.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  SOURCE_CSV,
  RAW_CSV,
  BASE_TICK_MS,
  SIM_SPEED,
  SEED_ROWS,
  SIM_RESET,
} from '../config.js';
import {
  ensureHeader,
  appendLines,
  countDataLines,
  resetFile,
} from '../csv/appendOnly.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SimulatorOptions {
  speed?: number;
  seedRows?: number;
  reset?: boolean;
}

type TickListener = (rowsAppended: number) => void;

/**
 * Drives the live sensor feed by copying source rows one at a time into the
 * append-only raw-sensor-data.csv. Construct via `startSimulator()` unless you
 * need fine-grained control.
 */
export class Simulator {
  private _cursor: number = 0;
  private readonly _totalRows: number;
  private readonly _sourceLines: readonly string[];
  private readonly _sourceHeader: string;
  private readonly _speed: number;
  private readonly _seedRows: number;
  private readonly _tickMs: number;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private readonly _listeners = new Set<TickListener>();

  constructor(
    sourceHeader: string,
    sourceLines: readonly string[],
    speed: number,
    seedRows: number,
  ) {
    this._sourceHeader = sourceHeader;
    this._sourceLines = sourceLines;
    this._totalRows = sourceLines.length;
    this._speed = speed;
    this._seedRows = seedRows;
    this._tickMs = BASE_TICK_MS / speed;
  }

  /** Rows emitted so far (seed batch + individual ticks). */
  get cursor(): number {
    return this._cursor;
  }

  /** Total data rows available in the source file. */
  get totalRows(): number {
    return this._totalRows;
  }

  /**
   * Subscribe to row-write events. The listener receives the count of rows
   * appended (SEED_ROWS on a cold-start seed, 1 for each subsequent tick).
   * Returns an unsubscribe function.
   */
  onTick(listener: TickListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Seeds history if needed, then begins ticking one row per interval.
   * Calling start() on an already-started simulator is a no-op.
   */
  start(): void {
    if (this._timer !== null) return; // already running

    // RESUME CURSOR: how many data rows already exist in the live file?
    // This is the mechanism that makes ephemeral-filesystem restarts safe.
    ensureHeader(RAW_CSV, this._sourceHeader);
    const existing = countDataLines(RAW_CSV);
    this._cursor = existing;

    if (existing === 0) {
      // Cold start: instantly write seed rows so the dashboard opens with history
      // rather than an empty chart.
      const seedCount = Math.min(this._seedRows, this._totalRows);
      if (seedCount > 0) {
        // slice() on ReadonlyArray returns a plain array — no undefined risk.
        appendLines(RAW_CSV, this._sourceLines.slice(0, seedCount));
        this._cursor = seedCount;
        console.log(
          `[simulator] cold start: seeded ${seedCount}/${this._totalRows} rows` +
            `  speed=${this._speed}x  tick=${this._tickMs}ms`,
        );
        this._emit(seedCount);
      }
    } else {
      // Warm resume: pick up from exactly where we left off.
      console.log(
        `[simulator] resuming: cursor=${existing}/${this._totalRows}` +
          `  speed=${this._speed}x  tick=${this._tickMs}ms` +
          `  remaining=${this._totalRows - existing}`,
      );
    }

    if (this._cursor >= this._totalRows) {
      console.log('[simulator] source exhausted — all rows already emitted, nothing to tick');
      return;
    }

    this._scheduleTick();
  }

  /** Stops the tick timer. Safe to call multiple times. */
  stop(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Snapshot listeners before iterating so unsubscribe inside a callback is safe. */
  private _emit(count: number): void {
    for (const listener of [...this._listeners]) {
      listener(count);
    }
  }

  private _scheduleTick(): void {
    this._timer = setTimeout(() => this._tick(), this._tickMs);
  }

  private _tick(): void {
    this._timer = null;

    // noUncheckedIndexedAccess: the cursor-bounds check above guards this, but
    // TypeScript still needs a narrowing path.
    if (this._cursor >= this._totalRows) {
      console.log('[simulator] replay complete — all source rows emitted, stopping');
      return;
    }

    const line = this._sourceLines[this._cursor];
    if (line === undefined) {
      // Should be unreachable given the bounds check, but satisfies the type checker.
      console.log('[simulator] replay complete — source exhausted, stopping');
      return;
    }

    // Verbatim append: the string is the raw CSV line, never re-serialised.
    appendLines(RAW_CSV, [line]);
    this._cursor++;
    this._emit(1);

    if (this._cursor >= this._totalRows) {
      console.log('[simulator] replay complete — all source rows emitted, stopping');
      return;
    }

    this._scheduleTick();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Reads the source CSV verbatim, optionally resets the live file, constructs
 * and starts a Simulator, and returns it.
 *
 * This is the normal entry-point for the main server process.
 */
export function startSimulator(options?: SimulatorOptions): Simulator {
  const speed = options?.speed ?? SIM_SPEED;
  const seedRows = options?.seedRows ?? SEED_ROWS;
  const reset = options?.reset ?? SIM_RESET;

  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(
      `[simulator] speed must be a positive finite number, got ${String(speed)}`,
    );
  }

  // Read source verbatim. We never parse into numbers — see module-level WHY note.
  const sourceText = fs.readFileSync(SOURCE_CSV, 'utf8');
  // Strip BOM if present (matches splitCsv behaviour in csv/parse.ts).
  const cleanText = sourceText.replace(/^﻿/, '');
  const allLines = cleanText.trim().split(/\r?\n/);
  // The first line is the header; remainder are data lines.
  const headerLine = allLines[0] ?? '';
  const dataLines = allLines.slice(1).filter((l) => l.length > 0);

  console.log(
    `[simulator] source: ${SOURCE_CSV}` +
      `  rows=${dataLines.length}  speed=${speed}x  tick=${BASE_TICK_MS / speed}ms  seedRows=${seedRows}`,
  );

  if (reset) {
    // DESTRUCTIVE: explicitly wipe history so the simulator rebuilds from row 0.
    // This is the only place resetFile is ever called — always behind an explicit
    // flag, never as part of normal (append-only) operation.
    console.warn(
      '[simulator] WARNING: reset flag is set — DESTROYING live history and starting from scratch',
    );
    resetFile(RAW_CSV);
  }

  const sim = new Simulator(headerLine, dataLines, speed, seedRows);
  sim.start();
  return sim;
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

interface ParsedArgs {
  speed: number | undefined;
  seedRows: number | undefined;
  reset: boolean;
  once: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let speed: number | undefined;
  let seedRows: number | undefined;
  let reset = false;
  let once = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';

    if (arg === '--reset') {
      reset = true;
      continue;
    }
    if (arg === '--once') {
      once = true;
      continue;
    }

    // --speed=<n> or --speed <n>
    const speedEq = arg.match(/^--speed=(.+)$/);
    if (speedEq !== null) {
      const val = speedEq[1];
      speed = val !== undefined ? Number(val) : NaN;
      continue;
    }
    if (arg === '--speed') {
      const next = argv[++i];
      speed = next !== undefined ? Number(next) : NaN;
      continue;
    }

    // --seed-rows=<n> or --seed-rows <n>
    const seedEq = arg.match(/^--seed-rows=(.+)$/);
    if (seedEq !== null) {
      const val = seedEq[1];
      seedRows = val !== undefined ? Number(val) : NaN;
      continue;
    }
    if (arg === '--seed-rows') {
      const next = argv[++i];
      seedRows = next !== undefined ? Number(next) : NaN;
      continue;
    }
  }

  return { speed, seedRows, reset, once };
}

// ---------------------------------------------------------------------------
// Standalone entry-point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.speed !== undefined && (!Number.isFinite(args.speed) || args.speed <= 0)) {
    console.error(
      `[simulator] ERROR: --speed must be a positive finite number, got ${String(args.speed)}`,
    );
    process.exit(1);
  }

  if (
    args.seedRows !== undefined &&
    (!Number.isFinite(args.seedRows) || args.seedRows < 0)
  ) {
    console.error(
      `[simulator] ERROR: --seed-rows must be a non-negative finite number, got ${String(args.seedRows)}`,
    );
    process.exit(1);
  }

  // Build options — only override keys that were explicitly supplied on the CLI,
  // so env-derived defaults (SIM_SPEED, SEED_ROWS, SIM_RESET) apply otherwise.
  const options: SimulatorOptions = {};
  if (args.speed !== undefined) options.speed = args.speed;
  if (args.seedRows !== undefined) options.seedRows = args.seedRows;
  if (args.reset) options.reset = true;

  const sim = startSimulator(options);

  if (args.once) {
    // --once: exit after the first individual tick (not the seed batch).
    if (sim.cursor >= sim.totalRows) {
      // Source was already exhausted by the seed — nothing more to tick.
      console.log('[simulator] --once: source exhausted after seed, exiting');
      process.exit(0);
    }
    const unsubscribe = sim.onTick(() => {
      unsubscribe();
      sim.stop();
      console.log('[simulator] --once: one row emitted, exiting');
      process.exit(0);
    });
  }
}

// Guard: only run main() when this file is invoked directly as a script.
// Importing from the main server entrypoint must NOT auto-start the simulator.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
