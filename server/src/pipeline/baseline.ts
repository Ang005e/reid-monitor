import type { BaselineLimits, CleanedReading } from '../types.js';

/**
 * Stable-period operating envelope — port of notebook cell 17.
 *
 * The data team took the 5th percentile, median and 95th percentile of every
 * numeric channel across `stable` rows only, so faults never contaminate the
 * definition of normal.
 *
 * Batch code computed this once over the finished dataset. Live, it is an
 * expanding window: the envelope tightens as more stable hours accumulate. That
 * is a feature, not a compromise — it is what a real monitoring system does —
 * but it means values served early in a run are drawn from a small sample.
 */

/** Channels the notebook profiles. Derived ratios are the dashboard's business. */
const BASELINE_CHANNELS = [
  'power_kw',
  'airflow_m3s',
  'water_pressure_kpa',
  'water_flow_lps',
  'temperature_c',
  'vibration_level',
] as const;

type BaselineChannel = (typeof BASELINE_CHANNELS)[number];

/**
 * Linear-interpolated quantile, matching pandas' `.quantile()` default.
 *
 * pandas positions the quantile at `q * (n - 1)` in the sorted values and
 * interpolates between the two straddling entries. The nearest-rank definition
 * taught more often would give visibly different thresholds on small samples.
 */
export function quantile(sortedValues: readonly number[], q: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const first = sortedValues[0];
  if (sortedValues.length === 1 && first !== undefined) return first;

  const position = q * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lower === undefined || upper === undefined) return Number.NaN;
  if (lowerIndex === upperIndex) return lower;

  return lower + (upper - lower) * (position - lowerIndex);
}

/** Computes low/median/high thresholds per channel from the stable rows only. */
export function computeBaselineLimits(
  readings: readonly CleanedReading[],
): Record<string, BaselineLimits> {
  const stable = readings.filter((r) => r.system_status === 'stable');
  const limits: Record<string, BaselineLimits> = {};

  for (const channel of BASELINE_CHANNELS) {
    const values = stable
      .map((r) => r[channel as BaselineChannel])
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    if (values.length === 0) continue;

    limits[channel] = {
      low_alert_threshold: quantile(values, 0.05),
      normal_median: quantile(values, 0.5),
      high_alert_threshold: quantile(values, 0.95),
    };
  }

  return limits;
}
