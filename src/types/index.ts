/**
 * Core domain types shared across the app.
 * These mirror the shape the backend team should expose — see CLAUDE.md
 * ("Backend contract") before changing anything here.
 */

/**
 * Output vocabulary of the data team's single-row rule engine, computed by the
 * backend pipeline. Strings are reproduced VERBATIM (note the spacing around
 * the slash) — the backend parity-checks them against the notebook export.
 *
 * This is NOT a replacement for src/lib/interpret.ts: `derived_alert` classifies
 * one reading in isolation, our rule engine reasons over a rolling window and
 * predicts. Both are shown.
 */
export type DerivedAlert =
  | 'normal'
  | 'ventilation warning'
  | 'plumbing warning'
  | 'critical / failure alert';

/** One hourly sensor reading. Numeric fields are null when the sensor dropped out. */
export interface SensorReading {
  /** Row index from the source dataset (stable unique id, monotonic, gapless). */
  id: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  power_kw: number | null;
  airflow_m3s: number | null;
  /** Calibrated value when it comes from the backend — chart this one. */
  water_pressure_kpa: number | null;
  water_flow_lps: number | null;
  temperature_c: number | null;
  vibration_level: number | null;
  sound_event: 'normal' | 'hum' | 'rattle';
  system_status: 'stable' | 'warning' | 'critical' | 'failed' | 'recovering';
  sensor_source: string;

  // --- Backend pipeline output. Optional: CsvDataSource does not produce these,
  // so the bundled replay still type-checks and works as a demo fallback.
  derived_alert?: DerivedAlert;
  alert_raised?: boolean;
  /** True when the Barry J pressure offset was removed from this row. */
  pressure_calibrated?: boolean;
  /** Pre-calibration pressure, for audit/tooltips. */
  water_pressure_kpa_raw?: number | null;

  /**
   * True when the value was absent in the raw feed and has been interpolated.
   * The pipeline fills dropouts, so these flags are the ONLY live signal that a
   * sensor went quiet — see the sensor-dropout rule in lib/interpret.ts.
   * Only the four interpolated channels have flags; power_kw and temperature_c
   * are never gap-filled and still arrive as real nulls.
   */
  airflow_m3s_was_missing?: boolean;
  water_pressure_kpa_was_missing?: boolean;
  water_flow_lps_was_missing?: boolean;
  vibration_level_was_missing?: boolean;

  /** Running segment id: increments whenever system_status changes. */
  episode_id?: number;
}

/** Numeric channels we chart and compute SPC stats for. */
export type ChannelKey =
  | 'power_kw'
  | 'airflow_m3s'
  | 'water_pressure_kpa'
  | 'water_flow_lps'
  | 'temperature_c'
  | 'vibration_level'
  | 'airflow_per_kw'; // derived: airflow / power (Cloudy's Entry 3)

export interface ChannelConfig {
  key: ChannelKey;
  label: string;
  unit: string;
  /** Which physical system this channel belongs to (drives community grouping). */
  system: 'water' | 'ventilation' | 'power' | 'environment';
  /** Engineering spec limits for Cp/Cpk. Editable by engineers — see src/config/channels.ts. */
  lsl: number;
  usl: number;
  /** Decimal places for display. */
  precision: number;
  /** Derived channels are computed client-side, not present in raw data. */
  derived?: boolean;
}

export interface ChannelStats {
  key: ChannelKey;
  mean: number;
  stdDev: number;
  /** Control limits (mean ± 3σ from the stable baseline). */
  ucl: number;
  lcl: number;
  /** Process capability vs the spec limits in ChannelConfig. */
  cp: number | null;
  cpk: number | null;
  sampleCount: number;
}

export type Severity = 'info' | 'watch' | 'warning' | 'critical';

/**
 * Output of the interpretation rule engine (src/lib/interpret.ts).
 * Carries BOTH the engineer-facing detail and the community-facing guidance,
 * so the same object renders in either view mode.
 */
export interface Interpretation {
  ruleId: string;
  severity: Severity;
  title: string;
  /** Technical detail for the engineer view. */
  engineerDetail: string;
  /** Plain-language explanation for the community view. */
  communityMessage: string;
  /** What a community member should do right now. */
  action: string;
  /** Who to inform. */
  notifyWho: string;
  /** Channels implicated, for cross-linking to charts. */
  channels: ChannelKey[];
  /** Timestamp of the reading that triggered the rule. */
  triggeredAt: string;
}

export interface AppAlert extends Interpretation {
  id: string;
  acknowledged: boolean;
  createdAt: string;
}

export type ViewMode = 'engineer' | 'community';

/**
 * Live-stream health, surfaced in the header.
 * `reconnecting` is NORMAL, not a failure: the backend sleeps after idle on a
 * free tier and EventSource retries by itself. Only escalate to `error` after
 * repeated failures.
 */
export type ConnectionStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'ended'
  | 'error';

/** Per-channel operating envelope from the backend's stable baseline. */
export interface BaselineLimits {
  low_alert_threshold: number;
  normal_median: number;
  high_alert_threshold: number;
}

/** A contiguous run of one system_status. */
export interface EpisodeSummary {
  episode_id: number;
  start: string;
  end: string;
  status: SensorReading['system_status'];
  sound: SensorReading['sound_event'];
  readings: number;
  duration_hours: number;
}

/** Alert-rule scorecard vs the dataset's ground-truth labels. Demo material. */
export interface RulePerformance {
  true_positives: number;
  false_positives: number;
  false_negatives: number;
  true_negatives: number;
  precision: number | null;
  recall: number | null;
  accuracy: number | null;
}

/** GET /meta. Baselines use an EXPANDING window — they tighten as hours accrue. */
export interface MetaResponse {
  baseline: Partial<Record<ChannelKey, BaselineLimits>>;
  episodes: EpisodeSummary[];
  performance: RulePerformance | null;
  simSpeed: number;
  cleanedRows: number;
}

/** GET /health. */
export interface HealthResponse {
  status: string;
  simSpeed: number;
  cleanedRows: number;
  latestTimestamp: string | null;
  subscribers: number;
  uptimeSeconds: number;
}

/**
 * Who is looking at the dashboard. Maps 1:1 onto ViewMode: facilities staff
 * ('engineer') may switch between both views, the public ('community') may not.
 */
export type UserRole = 'engineer' | 'community';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

/** A signed-in session. `token` is opaque to the UI — it is whatever the backend issues. */
export interface AuthSession {
  user: AuthUser;
  token: string;
  /** ISO-8601. The UI treats an expired session as signed out. */
  expiresAt: string;
}

export interface Credentials {
  username: string;
  password: string;
}
