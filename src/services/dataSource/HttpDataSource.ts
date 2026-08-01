import type { SensorReading } from '@/types';
import type { DataSource } from './DataSource';

/**
 * STUB for the real backend. Fill in when the API exists.
 *
 * Expected endpoints (agree with backend team, then update here only):
 *   GET  {baseUrl}/readings              → SensorReading[] (history)
 *   GET  {baseUrl}/readings/stream       → SSE stream of SensorReading
 *
 * If the backend prefers WebSocket or polling, only `subscribe` changes.
 */
export class HttpDataSource implements DataSource {
  constructor(private baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? '/api') {}

  async fetchHistory(): Promise<SensorReading[]> {
    const res = await fetch(`${this.baseUrl}/readings`);
    if (!res.ok) throw new Error(`GET /readings failed: ${res.status}`);
    return (await res.json()) as SensorReading[];
  }

  subscribe(onReading: (reading: SensorReading) => void): () => void {
    const source = new EventSource(`${this.baseUrl}/readings/stream`);
    source.onmessage = (ev) => onReading(JSON.parse(ev.data) as SensorReading);
    return () => source.close();
  }

  describe(): string {
    return `live · ${this.baseUrl}`;
  }
}
