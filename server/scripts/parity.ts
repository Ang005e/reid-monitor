import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT, SOURCE_CSV } from '../src/config.js';
import { parseRawCsv, splitCsv } from '../src/csv/parse.js';
import { runPipelineBatch } from '../src/pipeline/runPipeline.js';
import { StreamingPipeline } from '../src/pipeline/runPipeline.js';
import { computeRulePerformance } from '../src/pipeline/performance.js';
import { summariseEpisodes } from '../src/pipeline/episodes.js';
import type { CleanedReading } from '../src/types.js';

/**
 * PARITY GATE — proves the TypeScript port reproduces the data team's pandas
 * notebook. Run it after touching anything in src/pipeline/ or src/config.ts.
 *
 * It checks three things:
 *   1. Batch output vs the notebook's committed export, cell by cell.
 *   2. Streaming output vs batch output — the live path must not drift from the
 *      offline definition.
 *   3. The scorecard in alert_rule_performance.csv.
 *
 * Exits non-zero on any failure so it can gate a build.
 */

const FIXTURE = path.join(SERVER_ROOT, 'fixtures/reid_library_dashboard_data.csv');
const PERFORMANCE_FIXTURE = path.join(SERVER_ROOT, 'fixtures/alert_rule_performance.csv');

/** The 13 columns the notebook actually exported — the shared surface to compare. */
const COMPARED_COLUMNS = [
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
] as const;

/**
 * Numeric tolerance.
 *
 * Values are compared as numbers, not strings, with a tiny absolute tolerance.
 * One cell genuinely needs it: the interpolated pressure at 2026-07-03 07:00 is
 * 349.09999999999997 in the data team's export where pandas 2.2.3 on this
 * machine produces 349.1 — a 5.7e-14 difference from their numpy build's
 * rounding. No arithmetic ordering reproduces it, and 5.7e-14 kPa is far below
 * the sensor's 3-decimal resolution, so matching bit patterns would mean
 * contorting the code to imitate a specific binary. Every other cell is exact.
 */
const TOLERANCE = 1e-9;

interface Diff {
  row: number;
  timestamp: string;
  column: string;
  expected: string;
  actual: string;
}

/** Normalises pandas' True/False and our true/false to one spelling. */
function normaliseBool(token: string): string {
  return token.toLowerCase();
}

function cellOf(reading: CleanedReading, column: string): string {
  switch (column) {
    case 'timestamp':
      return reading.timestamp.replace('T', ' ');
    case 'alert_raised':
      return String(reading.alert_raised);
    case 'pressure_calibrated':
      return String(reading.pressure_calibrated);
    default: {
      const value = (reading as unknown as Record<string, unknown>)[column];
      return value === null || value === undefined ? '' : String(value);
    }
  }
}

function compare(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  if (normaliseBool(expected) === normaliseBool(actual)) return true;

  const a = Number(expected);
  const b = Number(actual);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) <= TOLERANCE;

  return false;
}

function diffAgainstFixture(actual: readonly CleanedReading[]): {
  diffs: Diff[];
  rowsCompared: number;
  cellsCompared: number;
} {
  const { header, lines } = splitCsv(fs.readFileSync(FIXTURE, 'utf8'));
  const diffs: Diff[] = [];
  let cellsCompared = 0;

  if (lines.length !== actual.length) {
    diffs.push({
      row: -1,
      timestamp: '-',
      column: 'ROW COUNT',
      expected: String(lines.length),
      actual: String(actual.length),
    });
  }

  const rowsCompared = Math.min(lines.length, actual.length);

  for (let i = 0; i < rowsCompared; i += 1) {
    const fields = (lines[i] ?? '').split(',');
    const reading = actual[i];
    if (reading === undefined) continue;

    for (const column of COMPARED_COLUMNS) {
      const at = header.indexOf(column);
      if (at === -1) continue;
      const expected = fields[at] ?? '';
      const got = cellOf(reading, column);
      cellsCompared += 1;
      if (!compare(expected, got)) {
        diffs.push({ row: i, timestamp: reading.timestamp, column, expected, actual: got });
      }
    }
  }

  return { diffs, rowsCompared, cellsCompared };
}

/** Replays the same rows through the live path to prove it matches batch. */
function diffStreamingAgainstBatch(
  rawRows: ReturnType<typeof parseRawCsv>,
  batch: readonly CleanedReading[],
): Diff[] {
  const pipeline = new StreamingPipeline();
  const streamed: CleanedReading[] = [];
  for (const row of rawRows) streamed.push(...pipeline.push(row));
  streamed.push(...pipeline.flush());

  const diffs: Diff[] = [];
  if (streamed.length !== batch.length) {
    diffs.push({
      row: -1,
      timestamp: '-',
      column: 'ROW COUNT',
      expected: String(batch.length),
      actual: String(streamed.length),
    });
  }

  for (let i = 0; i < Math.min(streamed.length, batch.length); i += 1) {
    const a = batch[i];
    const b = streamed[i];
    if (a === undefined || b === undefined) continue;
    for (const column of Object.keys(a)) {
      const expected = cellOf(a, column);
      const got = cellOf(b, column);
      if (!compare(expected, got)) {
        diffs.push({ row: i, timestamp: a.timestamp, column, expected, actual: got });
      }
    }
  }

  return diffs;
}

function checkPerformance(readings: readonly CleanedReading[]): string[] {
  const { lines } = splitCsv(fs.readFileSync(PERFORMANCE_FIXTURE, 'utf8'));
  const expected = new Map<string, number>();
  for (const line of lines) {
    const [metric, value] = line.split(',');
    if (metric !== undefined && value !== undefined) expected.set(metric, Number(value));
  }

  const actual = computeRulePerformance(readings);
  const pairs: [string, number | null][] = [
    ['True positives', actual.true_positives],
    ['False positives', actual.false_positives],
    ['False negatives', actual.false_negatives],
    ['True negatives', actual.true_negatives],
    ['Precision', actual.precision],
    ['Recall', actual.recall],
    ['Accuracy', actual.accuracy],
  ];

  const failures: string[] = [];
  for (const [metric, got] of pairs) {
    const want = expected.get(metric);
    if (want === undefined) continue;
    if (got === null || Math.abs(want - got) > 1e-6) {
      failures.push(`  ${metric}: expected ${want}, got ${got}`);
    }
  }
  return failures;
}

function main(): void {
  const rawRows = parseRawCsv(fs.readFileSync(SOURCE_CSV, 'utf8'));
  const batch = runPipelineBatch(rawRows);

  console.log(`Source rows        : ${rawRows.length}`);
  console.log(`Pipeline output    : ${batch.length}`);

  const { diffs, rowsCompared, cellsCompared } = diffAgainstFixture(batch);
  console.log(`Rows compared      : ${rowsCompared}`);
  console.log(`Cells compared     : ${cellsCompared} (${COMPARED_COLUMNS.length} shared columns)`);

  const streamDiffs = diffStreamingAgainstBatch(rawRows, batch);
  const performanceFailures = checkPerformance(batch);
  const episodes = summariseEpisodes(batch);

  console.log(`Episodes derived   : ${episodes.length}`);
  console.log(`Interpolated cells : ${batch.reduce(
    (n, r) =>
      n +
      Number(r.airflow_m3s_was_missing) +
      Number(r.water_pressure_kpa_was_missing) +
      Number(r.water_flow_lps_was_missing) +
      Number(r.vibration_level_was_missing),
    0,
  )}`);
  console.log(`Calibrated rows    : ${batch.filter((r) => r.pressure_calibrated).length}`);
  console.log('');

  let failed = false;

  if (diffs.length > 0) {
    failed = true;
    console.error(`FAIL  batch vs notebook export: ${diffs.length} differing cell(s)`);
    for (const d of diffs.slice(0, 20)) {
      console.error(`  row ${d.row} ${d.timestamp} ${d.column}: expected ${d.expected}, got ${d.actual}`);
    }
    if (diffs.length > 20) console.error(`  ... and ${diffs.length - 20} more`);
  } else {
    console.log('PASS  batch output matches the data team\'s export on all shared columns');
  }

  if (streamDiffs.length > 0) {
    failed = true;
    console.error(`FAIL  streaming vs batch: ${streamDiffs.length} differing cell(s)`);
    for (const d of streamDiffs.slice(0, 20)) {
      console.error(`  row ${d.row} ${d.timestamp} ${d.column}: expected ${d.expected}, got ${d.actual}`);
    }
  } else {
    console.log('PASS  streaming path is identical to batch');
  }

  if (performanceFailures.length > 0) {
    failed = true;
    console.error('FAIL  alert-rule scorecard differs from the notebook:');
    for (const f of performanceFailures) console.error(f);
  } else {
    console.log('PASS  alert-rule scorecard matches the notebook');
  }

  if (failed) process.exit(1);
  console.log('\nParity OK.');
}

main();
