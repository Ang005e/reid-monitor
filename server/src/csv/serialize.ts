import type { CleanedReading, DerivedAlert, SoundEvent, SystemStatus } from '../types.js';
import { parseNullableNumber, splitCsv, toIsoTimestamp } from './parse.js';

/**
 * Writer/reader for cleaned-sensor-data.csv.
 *
 * Column order is frozen: the file is append-only, so a reordering would make
 * every historical line unreadable. Add new columns at the END only.
 *
 * The first 13 columns are exactly the data team's notebook export (cell 22),
 * in their order. The remaining 6 are fields the notebook computes at cell 9/15
 * but drops before writing; we keep them so dropouts stay visible downstream.
 */
export const CLEANED_COLUMNS = [
  'timestamp',
  'power_kw',
  'airflow_m3s',
  'water_pressure_kpa',
  'water_flow_lps',
  'temperature_c',
  'vibration_level',
  'sound_event',
  'system_status',
  'sensor_source',
  'derived_alert',
  'alert_raised',
  'pressure_calibrated',
  // --- beyond the notebook's export ---
  'water_pressure_kpa_raw',
  'airflow_m3s_was_missing',
  'water_pressure_kpa_was_missing',
  'water_flow_lps_was_missing',
  'vibration_level_was_missing',
  'episode_id',
] as const;

export const CLEANED_HEADER = CLEANED_COLUMNS.join(',');

/**
 * Number formatting.
 *
 * JavaScript's Number->string and Python's repr both emit the shortest string
 * that round-trips a float64, so values written here are byte-identical to what
 * pandas would have written for the same double. Nulls become an empty field.
 */
function num(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * Booleans are written lowercase (`true`/`false`) rather than pandas' `True`/
 * `False`. This file is our artifact, not the notebook's, and lowercase keeps it
 * directly JSON-parseable. The parity check normalises both spellings.
 */
function bool(value: boolean): string {
  return value ? 'true' : 'false';
}

/** Serialises one cleaned reading to a CSV line, in CLEANED_COLUMNS order. */
export function serializeCleaned(r: CleanedReading): string {
  return [
    r.timestamp.replace('T', ' '),
    num(r.power_kw),
    num(r.airflow_m3s),
    num(r.water_pressure_kpa),
    num(r.water_flow_lps),
    num(r.temperature_c),
    num(r.vibration_level),
    r.sound_event,
    r.system_status,
    r.sensor_source,
    r.derived_alert,
    bool(r.alert_raised),
    bool(r.pressure_calibrated),
    num(r.water_pressure_kpa_raw),
    bool(r.airflow_m3s_was_missing),
    bool(r.water_pressure_kpa_was_missing),
    bool(r.water_flow_lps_was_missing),
    bool(r.vibration_level_was_missing),
    String(r.episode_id),
  ].join(',');
}

function parseBool(token: string | undefined): boolean {
  return token === 'true' || token === 'True';
}

/**
 * Reads cleaned-sensor-data.csv back into memory.
 *
 * Used on boot to restore state from a previous run (or from a mounted disk)
 * without re-deriving anything — the file is the source of truth for what has
 * already been published to clients.
 */
export function parseCleanedCsv(text: string): CleanedReading[] {
  const { header, lines } = splitCsv(text);
  if (lines.length === 0) return [];

  const at = Object.fromEntries(CLEANED_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof CLEANED_COLUMNS)[number],
    number
  >;
  const get = (f: string[], c: (typeof CLEANED_COLUMNS)[number]): string | undefined =>
    at[c] === -1 ? undefined : f[at[c]];

  return lines.map((line, i) => {
    const f = line.split(',');
    const timestamp = get(f, 'timestamp');
    if (timestamp === undefined) throw new Error(`Cleaned row ${i} has no timestamp`);
    return {
      id: i,
      timestamp: toIsoTimestamp(timestamp),
      power_kw: parseNullableNumber(get(f, 'power_kw')),
      airflow_m3s: parseNullableNumber(get(f, 'airflow_m3s')),
      water_pressure_kpa: parseNullableNumber(get(f, 'water_pressure_kpa')),
      water_flow_lps: parseNullableNumber(get(f, 'water_flow_lps')),
      temperature_c: parseNullableNumber(get(f, 'temperature_c')),
      vibration_level: parseNullableNumber(get(f, 'vibration_level')),
      sound_event: (get(f, 'sound_event') ?? 'normal') as SoundEvent,
      system_status: (get(f, 'system_status') ?? 'stable') as SystemStatus,
      sensor_source: get(f, 'sensor_source') ?? '',
      derived_alert: (get(f, 'derived_alert') ?? 'normal') as DerivedAlert,
      alert_raised: parseBool(get(f, 'alert_raised')),
      pressure_calibrated: parseBool(get(f, 'pressure_calibrated')),
      water_pressure_kpa_raw: parseNullableNumber(get(f, 'water_pressure_kpa_raw')),
      airflow_m3s_was_missing: parseBool(get(f, 'airflow_m3s_was_missing')),
      water_pressure_kpa_was_missing: parseBool(get(f, 'water_pressure_kpa_was_missing')),
      water_flow_lps_was_missing: parseBool(get(f, 'water_flow_lps_was_missing')),
      vibration_level_was_missing: parseBool(get(f, 'vibration_level_was_missing')),
      episode_id: Number(get(f, 'episode_id') ?? 0),
    } satisfies CleanedReading;
  });
}
