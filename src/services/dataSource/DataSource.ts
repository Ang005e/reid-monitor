import type { SensorReading } from '@/types';

/**
 * BACKEND SEAM — the only contract the UI depends on for data.
 *
 * Today: CsvDataSource replays the bundled July 2026 export.
 * Later: implement HttpDataSource against the real API and flip the
 * factory in ./index.ts (or set VITE_DATA_SOURCE=http). Nothing in the
 * UI layer changes.
 */
export interface DataSource {
  /** Full history available at connect time (ordered by timestamp asc). */
  fetchHistory(): Promise<SensorReading[]>;

  /**
   * Subscribe to new readings. Returns an unsubscribe function.
   * CsvDataSource emits replayed rows on a timer; an HTTP implementation
   * would back this with SSE/WebSocket/polling.
   */
  subscribe(onReading: (reading: SensorReading) => void): () => void;

  /** Human-readable label shown in the header (e.g. "replay · July 2026 export"). */
  describe(): string;
}
