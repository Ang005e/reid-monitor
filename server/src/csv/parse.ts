import type { RawReading, SoundEvent, SystemStatus } from '../types.js';

/**
 * Parsers for the sensor CSVs.
 *
 * The files have no quoted fields, so a plain split is safe — same assumption
 * the frontend's src/lib/csv.ts makes.
 *
 * The source export carries an unnamed leading index column; raw-sensor-data.csv
 * inherits it verbatim because the simulator copies source lines byte-for-byte.
 * We therefore locate columns by header name and never by position.
 */

/** Splits a CSV document into a header token list plus its data lines. */
export function splitCsv(text: string): { header: string[]; lines: string[] } {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const first = lines[0];
  if (first === undefined) return { header: [], lines: [] };
  return { header: first.split(','), lines: lines.slice(1).filter((l) => l.length > 0) };
}

/** Empty string means the sensor dropped out; every other token must be numeric. */
export function parseNullableNumber(token: string | undefined): number | null {
  if (token === undefined || token === '') return null;
  const n = Number(token);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got ${JSON.stringify(token)}`);
  return n;
}

/**
 * Normalises "2026-07-12 11:00:00" to ISO "2026-07-12T11:00:00".
 *
 * Deliberately timezone-naive: the dataset has no offset and the whole system
 * reasons in dataset-local hours. Keeping it naive avoids a DST-shift class of
 * bug that would silently corrupt the hourly cadence.
 */
export function toIsoTimestamp(token: string): string {
  return token.trim().replace(' ', 'T');
}

/** Milliseconds since epoch for a naive timestamp, used for time-interpolation. */
export function timestampToMs(iso: string): number {
  const ms = Date.parse(`${iso}Z`);
  if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp: ${JSON.stringify(iso)}`);
  return ms;
}

function columnIndex(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i === -1) throw new Error(`Missing required column "${name}" in CSV header`);
  return i;
}

/** Resolved column positions for the raw schema. Columns are found by name. */
export type RawColumns = ReturnType<typeof rawColumns>;

/**
 * Locates every raw column by header name.
 *
 * Split out so a caller tailing an append-only file can resolve the header once
 * and then parse each new chunk of lines against it, instead of re-reading the
 * whole file to rediscover the same positions.
 */
export function rawColumns(header: string[]) {
  return {
    timestamp: columnIndex(header, 'timestamp'),
    power_kw: columnIndex(header, 'power_kw'),
    airflow_m3s: columnIndex(header, 'airflow_m3s'),
    water_pressure_kpa: columnIndex(header, 'water_pressure_kpa'),
    water_flow_lps: columnIndex(header, 'water_flow_lps'),
    temperature_c: columnIndex(header, 'temperature_c'),
    vibration_level: columnIndex(header, 'vibration_level'),
    sound_event: columnIndex(header, 'sound_event'),
    system_status: columnIndex(header, 'system_status'),
    sensor_source: columnIndex(header, 'sensor_source'),
  };
}

/**
 * Parses one raw data line.
 *
 * `id` is supplied by the caller rather than taken from the unnamed index
 * column, so ids stay gapless even if the source index is ever rewritten.
 */
export function parseRawLine(line: string, at: RawColumns, id: number): RawReading {
  const f = line.split(',');
  const timestamp = f[at.timestamp];
  if (timestamp === undefined) throw new Error(`Row ${id} has no timestamp`);
  return {
    id,
    timestamp: toIsoTimestamp(timestamp),
    power_kw: parseNullableNumber(f[at.power_kw]),
    airflow_m3s: parseNullableNumber(f[at.airflow_m3s]),
    water_pressure_kpa: parseNullableNumber(f[at.water_pressure_kpa]),
    water_flow_lps: parseNullableNumber(f[at.water_flow_lps]),
    temperature_c: parseNullableNumber(f[at.temperature_c]),
    vibration_level: parseNullableNumber(f[at.vibration_level]),
    sound_event: (f[at.sound_event] ?? 'normal') as SoundEvent,
    system_status: (f[at.system_status] ?? 'stable') as SystemStatus,
    sensor_source: f[at.sensor_source] ?? '',
  } satisfies RawReading;
}

/**
 * Parses the raw sensor export (or raw-sensor-data.csv, same shape) in full.
 *
 * Used by the batch path and by boot-time recovery. The live pipeline tails the
 * file instead — see PipelineRunner.poll.
 */
export function parseRawCsv(text: string): RawReading[] {
  const { header, lines } = splitCsv(text);
  if (lines.length === 0) return [];
  const at = rawColumns(header);
  return lines.map((line, i) => parseRawLine(line, at, i));
}
