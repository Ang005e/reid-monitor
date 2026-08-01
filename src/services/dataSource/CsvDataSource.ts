import type { ConnectionStatus, SensorReading } from '@/types';
import type { DataSource } from './DataSource';
import { parseSensorCsv } from '@/lib/csv';

/**
 * Mock adapter: loads the bundled CSV and replays it as if live.
 *
 * `historySplit` controls how much of the file is treated as pre-existing
 * history vs. replayed as "incoming" readings, so the live layer and the
 * alert pipeline can be demoed without a backend.
 */
export class CsvDataSource implements DataSource {
  private rows: SensorReading[] = [];
  private loaded: Promise<void> | null = null;
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(r: SensorReading) => void>();
  private onStatus?: (s: ConnectionStatus) => void;

  constructor(
    private url: string = `${import.meta.env.BASE_URL}data/reid_library_sensor_data.csv`,
    /** Fraction of rows served as initial history (rest are replayed live). */
    private historySplit = 0.55,
    /** Milliseconds between replayed readings (1 simulated hour per tick). */
    public tickMs = 1500,
  ) {}

  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = fetch(this.url)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load sensor CSV: ${r.status}`);
          return r.text();
        })
        .then((text) => {
          this.rows = parseSensorCsv(text);
          this.cursor = Math.floor(this.rows.length * this.historySplit);
        });
    }
    return this.loaded;
  }

  async fetchHistory(): Promise<SensorReading[]> {
    await this.ensureLoaded();
    return this.rows.slice(0, this.cursor);
  }

  subscribe(
    onReading: (reading: SensorReading) => void,
    onStatus?: (s: ConnectionStatus) => void,
  ): () => void {
    this.listeners.add(onReading);
    // The replay has no network to fail, so it is "live" the moment it starts.
    // Reporting this matters: without it the header would sit on "connecting…"
    // forever whenever we fall back to the bundled replay.
    this.onStatus = onStatus;
    onStatus?.('live');
    if (!this.timer) this.startReplay();
    return () => {
      this.listeners.delete(onReading);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      onStatus?.('ended');
    };
  }

  private startReplay() {
    this.timer = setInterval(async () => {
      await this.ensureLoaded();
      if (this.cursor >= this.rows.length) {
        // Replay finished; hold the last state. Report it so the header stops
        // claiming a live feed once the bundled dataset runs out.
        this.onStatus?.('ended');
        return;
      }
      const next = this.rows[this.cursor++];
      this.listeners.forEach((fn) => fn(next));
    }, this.tickMs);
  }

  describe(): string {
    return 'replay · July 2026 export (swap to live backend in services/dataSource)';
  }
}
