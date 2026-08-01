import type { DataSource } from './DataSource';
import { CsvDataSource } from './CsvDataSource';
import { HttpDataSource } from './HttpDataSource';

export type { DataSource };

/**
 * Factory — the single switch between mock and real backend.
 * Set VITE_DATA_SOURCE=http in .env when the API is ready.
 */
export function createDataSource(): DataSource {
  const kind = import.meta.env.VITE_DATA_SOURCE ?? 'csv';
  switch (kind) {
    case 'http':
      return new HttpDataSource();
    case 'csv':
    default:
      return new CsvDataSource();
  }
}
