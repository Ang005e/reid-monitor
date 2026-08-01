/**
 * Core domain types shared across the app.
 * These mirror the shape the backend team should expose — see CLAUDE.md
 * ("Backend contract") before changing anything here.
 */

/** One hourly sensor reading. Numeric fields are null when the sensor dropped out. */
export interface SensorReading {
  /** Row index from the source dataset (stable unique id). */
  id: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  power_kw: number | null;
  airflow_m3s: number | null;
  water_pressure_kpa: number | null;
  water_flow_lps: number | null;
  temperature_c: number | null;
  vibration_level: number | null;
  sound_event: 'normal' | 'hum' | 'rattle';
  system_status: 'stable' | 'warning' | 'critical' | 'failed';
  sensor_source: string;
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
