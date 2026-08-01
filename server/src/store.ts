import type { BaselineLimits, CleanedReading, EpisodeSummary, RulePerformance } from './types.js';

/**
 * In-memory index over cleaned-sensor-data.csv, plus a subscriber hub.
 *
 * SEAM: the API layer depends only on this class, never on the pipeline or the
 * filesystem. The pipeline pushes; the API reads and subscribes. Swapping the
 * CSV for a database later means reimplementing this one file.
 *
 * The dataset is ~500 rows and grows one row per simulated hour, so holding it
 * all in memory is the right call; the CSV on disk remains the durable record.
 */
export class ReadingStore {
  private readings: CleanedReading[] = [];
  private listeners = new Set<(reading: CleanedReading) => void>();
  private resetListeners = new Set<() => void>();

  /** Derived summaries, recomputed by the pipeline as rows land. */
  private meta: {
    baseline: Record<string, BaselineLimits>;
    episodes: EpisodeSummary[];
    performance: RulePerformance | null;
  } = { baseline: {}, episodes: [], performance: null };

  /** Restores prior history on boot without notifying subscribers. */
  hydrate(readings: CleanedReading[]): void {
    this.readings = [...readings];
  }

  /** Appends a reading and fans it out to every live subscriber. */
  push(reading: CleanedReading): void {
    this.readings.push(reading);
    for (const listener of this.listeners) {
      try {
        listener(reading);
      } catch {
        // A failing subscriber (e.g. a client that vanished mid-write) must
        // never stop the others from receiving the row.
      }
    }
  }

  /**
   * Readings after `since`, ascending. `since` is EXCLUSIVE and is a reading
   * `id`, so a client that saw id 41 asks for `?since=41` and gets 42 onward.
   * Omit `since` for the full history.
   */
  since(since?: number): CleanedReading[] {
    if (since === undefined || Number.isNaN(since)) return [...this.readings];
    return this.readings.filter((r) => r.id > since);
  }

  get count(): number {
    return this.readings.length;
  }

  get latest(): CleanedReading | undefined {
    return this.readings[this.readings.length - 1];
  }

  /** Oldest reading still held. Undefined when history is empty. */
  get first(): CleanedReading | undefined {
    return this.readings[0];
  }

  /**
   * Can we honour `since` as a resume cursor, or is the client's position
   * outside the history we currently hold?
   *
   * A cursor goes out of range two ways, and both leave the dashboard frozen if
   * we serve them as an ordinary resume:
   *
   *  - `since` is ABOVE our latest id. The client outlived this process. Ids
   *    restart at 0 on boot (the ephemeral disk means nothing is restored), so
   *    every live row we push is below the client's duplicate fence and gets
   *    dropped until our ids climb back past it — minutes of a stuck chart.
   *  - `since` is BELOW our oldest id. The client was disconnected across a
   *    loop, so it holds rows from a previous pass and never saw the `reset`
   *    event. Appending this pass onto those sends its time axis backwards.
   *
   * Either way the honest answer is "start over", not "here is the tail".
   */
  canResumeFrom(since: number): boolean {
    const first = this.first;
    const latest = this.latest;
    // Empty history: we have no timeline to place the cursor in, and any
    // non-cold cursor must predate the rows we are about to generate.
    if (first === undefined || latest === undefined) return false;
    return since >= first.id - 1 && since <= latest.id;
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: (reading: CleanedReading) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Drops all history and tells every live subscriber to do the same.
   *
   * Used when the simulator loops back to the start of the dataset: the new run
   * begins at the dataset's first timestamp, so keeping the old rows would leave
   * the dashboard's time axis jumping backwards mid-series.
   *
   * Reading ids are NOT reset — the pipeline carries on counting up. See
   * SIM_LOOP in config.ts for why that matters.
   */
  reset(): void {
    this.readings = [];
    this.meta = { baseline: {}, episodes: [], performance: null };
    for (const listener of this.resetListeners) {
      try {
        listener();
      } catch {
        // As with push(): one broken subscriber must not stop the rest.
      }
    }
  }

  /** Subscribe to history-cleared events. Returns an unsubscribe function. */
  subscribeReset(listener: () => void): () => void {
    this.resetListeners.add(listener);
    return () => this.resetListeners.delete(listener);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  setMeta(meta: Partial<typeof this.meta>): void {
    this.meta = { ...this.meta, ...meta };
  }

  getMeta(): typeof this.meta {
    return this.meta;
  }
}
