import { PRESSURE_OFFSET_KPA, REFERENCE_SENSOR_SOURCE } from '../config.js';

/**
 * Sensor calibration — port of notebook cell 13.
 *
 * Barry J's smart sensor reads water pressure consistently high. The data team
 * compared stable-period medians per source and subtracted a flat offset from
 * the non-reference source, keeping the uncorrected value for auditability.
 *
 * Pressure is the ONLY channel corrected. The same comparison showed an airflow
 * difference of just +0.077 m³/s, which the data team judged to be noise rather
 * than miscalibration, so it is deliberately left alone.
 */

export interface Calibration {
  /** Pressure after correction — what the dashboard charts. */
  water_pressure_kpa: number | null;
  /** Pressure as the sensor reported it, kept so the correction is auditable. */
  water_pressure_kpa_raw: number | null;
  /** True when this row's source is not the reference sensor. */
  pressure_calibrated: boolean;
}

/**
 * Any source other than `original` is treated as the miscalibrated sensor.
 *
 * Matching on "not the reference" rather than on Barry's name is what the
 * notebook does, and it matters: the dataset README calls the source
 * `barry_j_smart_sensor` while the CSV actually says `barry_j_`. Matching the
 * literal name would have silently skipped every correction.
 */
export function calibratePressure(
  pressure: number | null,
  sensorSource: string,
): Calibration {
  const isReference = sensorSource.trim() === REFERENCE_SENSOR_SOURCE;

  if (isReference || pressure === null) {
    return {
      water_pressure_kpa: pressure,
      water_pressure_kpa_raw: pressure,
      pressure_calibrated: !isReference,
    };
  }

  return {
    water_pressure_kpa: pressure - PRESSURE_OFFSET_KPA,
    water_pressure_kpa_raw: pressure,
    pressure_calibrated: true,
  };
}
