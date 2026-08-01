import type { ConnectionStatus, HealthResponse, MetaResponse, SensorReading } from '@/types';

/**
 * BACKEND SEAM — the only contract the UI depends on for data.
 *
 * Today: CsvDataSource replays the bundled July 2026 export.
 * Later: implement HttpDataSource against the real API and flip the
 * factory in ./index.ts (or set VITE_DATA_SOURCE=http). Nothing in the
 * UI layer changes.
 *
 * Structural-typing note: `onStatus` and the two optional methods are designed
 * so CsvDataSource, which implements none of them, still satisfies this interface.
 * In TypeScript a function with fewer parameters is assignable to a function
 * type with more optional parameters — CsvDataSource's single-arg `subscribe`
 * continues to compile without any changes to that class.
 */
export interface DataSource {
  /** Full history available at connect time (ordered by id asc). */
  fetchHistory(): Promise<SensorReading[]>;

  /**
   * Subscribe to new readings. Returns an unsubscribe function.
   *
   * `onStatus` is optional so existing implementations (CsvDataSource) stay
   * compatible — they simply never call it. For HttpDataSource it tracks the
   * EventSource connection lifecycle and feeds the header status badge.
   */
  subscribe(
    onReading: (r: SensorReading) => void,
    onStatus?: (s: ConnectionStatus) => void,
  ): () => void;

  /**
   * Returns summarised baseline limits, episode history, and alert-rule
   * performance from the backend. Optional so the CSV replay continues to
   * work as a demo fallback when the backend is absent.
   */
  fetchMeta?(): Promise<MetaResponse>;

  /**
   * Returns a lightweight health snapshot (subscriber count, uptime, latest
   * timestamp, etc.) suitable for polling every 30 s. Optional for the same
   * reason as fetchMeta.
   */
  fetchHealth?(): Promise<HealthResponse>;

  /** Human-readable label shown in the header (e.g. "replay · July 2026 export"). */
  describe(): string;
}
