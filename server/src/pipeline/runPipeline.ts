import type { CleanedReading, RawReading } from '../types.js';
import { STREAM_LOOKAHEAD_ROWS, cleanRow } from './clean.js';
import { calibratePressure } from './calibrate.js';
import { deriveAlert, isAlertRaised } from './alerts.js';
import { EpisodeTracker } from './episodes.js';

/**
 * The pipeline itself: raw reading in, cleaned reading out.
 *
 * Order matters and matches the notebook exactly — interpolate (cell 9), then
 * calibrate (cell 13), then segment (cell 15), then alert (cells 18/21). The
 * alerts must see calibrated pressure, or every Barry J row sits 10 kPa on the
 * wrong side of the 320 threshold.
 */

/**
 * Assembles one cleaned row.
 *
 * `series` supplies the interpolation context and `index` selects the row within
 * it. The caller decides how much context to provide, which is the single
 * difference between the batch and streaming paths.
 */
function buildCleanedReading(
  series: readonly RawReading[],
  index: number,
  id: number,
  episodes: EpisodeTracker,
): CleanedReading {
  const raw = series[index];
  if (raw === undefined) throw new Error(`buildCleanedReading: no row at index ${index}`);

  const { values, wasMissing } = cleanRow(series, index);
  const calibration = calibratePressure(values.water_pressure_kpa, raw.sensor_source);

  const channels = {
    power_kw: raw.power_kw,
    airflow_m3s: values.airflow_m3s,
    water_pressure_kpa: calibration.water_pressure_kpa,
    water_flow_lps: values.water_flow_lps,
    temperature_c: raw.temperature_c,
    vibration_level: values.vibration_level,
  };

  const derived_alert = deriveAlert(channels);

  return {
    id,
    timestamp: raw.timestamp,
    ...channels,
    sound_event: raw.sound_event,
    system_status: raw.system_status,
    sensor_source: raw.sensor_source,
    derived_alert,
    alert_raised: isAlertRaised(derived_alert),
    pressure_calibrated: calibration.pressure_calibrated,
    water_pressure_kpa_raw: calibration.water_pressure_kpa_raw,
    airflow_m3s_was_missing: wasMissing.airflow_m3s,
    water_pressure_kpa_was_missing: wasMissing.water_pressure_kpa,
    water_flow_lps_was_missing: wasMissing.water_flow_lps,
    vibration_level_was_missing: wasMissing.vibration_level,
    episode_id: episodes.next(raw.system_status),
  };
}

/**
 * Batch mode: process an entire raw dataset at once.
 *
 * Every row sees the whole series as interpolation context, so this reproduces
 * the notebook's output exactly. It backs `npm run parity` and the cold-start
 * rebuild, and it is the definition the streaming path is checked against.
 */
export function runPipelineBatch(rows: readonly RawReading[]): CleanedReading[] {
  const episodes = new EpisodeTracker();
  return rows.map((_, i) => buildCleanedReading(rows, i, i, episodes));
}

/**
 * Streaming mode: process rows as they land, one at a time.
 *
 * The catch is cell 9. `limit_area="inside"` fills a gap from the readings on
 * BOTH sides, so row N cannot be finalised until row N+1 exists. Because the
 * cleaned file is append-only — we publish a row once and never rewrite it — the
 * pipeline holds each row back until its successor arrives.
 *
 * The hold applies to every row, not just rows with gaps, so latency is a
 * constant one simulated hour and the output is identical to the batch run
 * rather than subtly different around dropouts.
 */
export class StreamingPipeline {
  private readonly episodes = new EpisodeTracker();

  /** Rows received but not yet published, oldest first. */
  private pending: RawReading[] = [];

  /**
   * Already-published rows kept purely as interpolation context — a gap needs to
   * look backwards for the last valid reading. Trimmed to the lookahead depth,
   * since nothing older can affect a fill.
   */
  private context: RawReading[] = [];

  private nextId: number;

  constructor(startingId = 0) {
    this.nextId = startingId;
  }

  /** Feeds one raw row in; returns any rows that became publishable. */
  push(raw: RawReading): CleanedReading[] {
    this.pending.push(raw);
    const ready: CleanedReading[] = [];

    // Keep STREAM_LOOKAHEAD_ROWS rows in hand at all times; anything older than
    // that has seen its successors and can be finalised.
    while (this.pending.length > STREAM_LOOKAHEAD_ROWS) {
      const emitted = this.emitOldest();
      if (emitted) ready.push(emitted);
    }

    return ready;
  }

  /**
   * Publishes everything still held, without lookahead.
   *
   * Only for the end of a finite replay. A trailing gap has no reading after it,
   * so `limit_area="inside"` correctly leaves it null — the same answer pandas
   * gives for the last row of a dataset.
   */
  flush(): CleanedReading[] {
    const ready: CleanedReading[] = [];
    while (this.pending.length > 0) {
      const emitted = this.emitOldest();
      if (emitted) ready.push(emitted);
    }
    return ready;
  }

  private emitOldest(): CleanedReading | null {
    const row = this.pending[0];
    if (row === undefined) return null;

    // Interpolation context is [already published ... , this row, lookahead].
    const series = [...this.context, ...this.pending];
    const index = this.context.length;

    const cleaned = buildCleanedReading(series, index, this.nextId, this.episodes);
    this.nextId += 1;

    this.pending.shift();
    this.context.push(row);
    if (this.context.length > STREAM_LOOKAHEAD_ROWS + 1) this.context.shift();

    return cleaned;
  }

  /** Id the next published row will receive. */
  get cursor(): number {
    return this.nextId;
  }

  /** Rows received but still held for lookahead. */
  get pendingCount(): number {
    return this.pending.length;
  }
}
