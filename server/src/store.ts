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

  /** Returns an unsubscribe function. */
  subscribe(listener: (reading: CleanedReading) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
