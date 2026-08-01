import { ALERT_RULES } from '../config.js';
import type { CleanedReading, DerivedAlert } from '../types.js';

/**
 * Rule-based alerting — port of notebook cells 18 and 21.
 *
 * These run on values that are already interpolated AND calibrated, matching the
 * notebook's ordering (df_alerts descends from df_calibrated). Feeding them raw
 * pressure would shift every Barry J row by 10 kPa across the 320 threshold.
 *
 * This is the data team's independent opinion of each reading. It is NOT a
 * replacement for the dashboard's own rule engine (src/lib/interpret.ts), which
 * looks at trends over a window rather than at single rows — the two are meant
 * to be shown side by side.
 */

/**
 * Null-safe comparisons.
 *
 * pandas evaluates every comparison against NaN as False, so a dropped-out
 * sensor never raises an alert. Reproducing that exactly matters: treating null
 * as 0 would make `pressure < 100` fire on every dropout and invent a critical
 * failure out of a missing reading.
 */
const below = (value: number | null, threshold: number): boolean =>
  value !== null && value < threshold;
const above = (value: number | null, threshold: number): boolean =>
  value !== null && value > threshold;

type AlertInputs = Pick<
  CleanedReading,
  'power_kw' | 'airflow_m3s' | 'water_pressure_kpa' | 'water_flow_lps' | 'vibration_level'
>;

/** Low pressure and low flow together with raised vibration. */
export function isPlumbingWarning(r: AlertInputs): boolean {
  const { plumbing } = ALERT_RULES;
  return (
    below(r.water_pressure_kpa, plumbing.maxPressureKpa) &&
    below(r.water_flow_lps, plumbing.maxFlowLps) &&
    above(r.vibration_level, plumbing.minVibration)
  );
}

/** Normal power draw but poor airflow — the fan working harder for less. */
export function isVentilationWarning(r: AlertInputs): boolean {
  const { ventilation } = ALERT_RULES;
  return (
    above(r.power_kw, ventilation.minPowerKw) &&
    below(r.airflow_m3s, ventilation.maxAirflowM3s) &&
    above(r.vibration_level, ventilation.minVibration)
  );
}

/** Any single one of these is severe enough on its own. */
export function isCriticalFailure(r: AlertInputs): boolean {
  const { critical } = ALERT_RULES;
  return (
    below(r.water_pressure_kpa, critical.pressureKpaBelow) ||
    below(r.water_flow_lps, critical.flowLpsBelow) ||
    above(r.vibration_level, critical.vibrationAbove)
  );
}

/**
 * Collapses the three rules into one label per reading.
 *
 * Precedence mirrors the notebook's assignment order, where each `.loc[]` write
 * overwrites the previous: normal, then ventilation, then plumbing, then
 * critical. So critical wins over plumbing, which wins over ventilation.
 */
export function deriveAlert(r: AlertInputs): DerivedAlert {
  if (isCriticalFailure(r)) return 'critical / failure alert';
  if (isPlumbingWarning(r)) return 'plumbing warning';
  if (isVentilationWarning(r)) return 'ventilation warning';
  return 'normal';
}

export function isAlertRaised(alert: DerivedAlert): boolean {
  return alert !== 'normal';
}
