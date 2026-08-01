/**
 * Domain types for the backend.
 *
 * `CleanedReading` is the wire contract — it is what /api/readings returns and
 * what each SSE frame carries. It must stay in sync with `SensorReading` in the
 * frontend's src/types/index.ts. See API_CONTRACT.md before changing anything
 * here; the frontend engineer treats that document as authoritative.
 */

/** Ground-truth status label from the dataset. */
export type SystemStatus = 'stable' | 'warning' | 'critical' | 'failed' | 'recovering';

/** Dragon-observed machinery sound. */
export type SoundEvent = 'normal' | 'hum' | 'rattle';

/**
 * Output vocabulary of the data team's rule engine (notebook cell 18).
 * Note the spacing/casing: these strings are reproduced verbatim so the parity
 * check against their export passes.
 */
export type DerivedAlert =
  | 'normal'
  | 'ventilation warning'
  | 'plumbing warning'
  | 'critical / failure alert';

/** One row exactly as it appears in raw-sensor-data.csv. Nulls are real dropouts. */
export interface RawReading {
  /** 0-based row index in the raw file. Stable, monotonic, gapless. */
  id: number;
  /** ISO-8601, no timezone: "2026-07-12T11:00:00". */
  timestamp: string;
  power_kw: number | null;
  airflow_m3s: number | null;
  water_pressure_kpa: number | null;
  water_flow_lps: number | null;
  temperature_c: number | null;
  vibration_level: number | null;
  sound_event: SoundEvent;
  system_status: SystemStatus;
  sensor_source: string;
}

/**
 * Channels the pipeline interpolates (notebook cell 9).
 * `power_kw` and `temperature_c` are deliberately excluded — the data team does
 * not gap-fill them, and neither do we.
 */
export const INTERPOLATED_CHANNELS = [
  'airflow_m3s',
  'water_pressure_kpa',
  'water_flow_lps',
  'vibration_level',
] as const;

export type InterpolatedChannel = (typeof INTERPOLATED_CHANNELS)[number];

/** One row of cleaned-sensor-data.csv, and one SSE frame. */
export interface CleanedReading {
  /** 0-based row index in the cleaned file. This is the SSE resume cursor. */
  id: number;
  timestamp: string;

  // --- Sensor channels (post-interpolation, post-calibration) ---
  power_kw: number | null;
  airflow_m3s: number | null;
  /** Calibrated: PRESSURE_OFFSET_KPA subtracted on non-`original` sources. */
  water_pressure_kpa: number | null;
  water_flow_lps: number | null;
  temperature_c: number | null;
  vibration_level: number | null;

  // --- Labels ---
  sound_event: SoundEvent;
  system_status: SystemStatus;
  sensor_source: string;

  // --- Pipeline output ---
  derived_alert: DerivedAlert;
  alert_raised: boolean;
  /** True when this row's pressure had the Barry J offset removed. */
  pressure_calibrated: boolean;
  /** Pre-calibration pressure, kept for auditability (notebook cell 13). */
  water_pressure_kpa_raw: number | null;

  /**
   * True when the value was absent in the raw feed and has been interpolated.
   * The notebook computes these at cell 9 but drops them at export; we keep
   * them so dropouts stay visible to the dashboard now that there are no nulls.
   */
  airflow_m3s_was_missing: boolean;
  water_pressure_kpa_was_missing: boolean;
  water_flow_lps_was_missing: boolean;
  vibration_level_was_missing: boolean;

  /** Running segment id: increments whenever system_status changes (cell 15). */
  episode_id: number;
}

/** Per-channel operating envelope from the stable baseline (notebook cell 17). */
export interface BaselineLimits {
  low_alert_threshold: number;
  normal_median: number;
  high_alert_threshold: number;
}

/** A contiguous run of one system_status (notebook cell 15). */
export interface EpisodeSummary {
  episode_id: number;
  start: string;
  end: string;
  status: SystemStatus;
  sound: SoundEvent;
  readings: number;
  duration_hours: number;
}

/** Alert-rule scorecard against the ground-truth labels (notebook cell 21). */
export interface RulePerformance {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  true_negatives: number;
  precision: number | null;
  recall: number | null;
  accuracy: number | null;
}
