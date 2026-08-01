import type { SensorReading } from '@/types';

/**
 * Minimal CSV parser for the Reid Library sensor export.
 * The file has no quoted fields, so a plain split is safe.
 * Swapped out entirely once the backend serves JSON — see services/dataSource.
 */
export function parseSensorCsv(text: string): SensorReading[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const col = (name: string) => header.indexOf(name);

  const idx = {
    id: 0, // first (unnamed) column is the row index
    timestamp: col('timestamp'),
    power_kw: col('power_kw'),
    airflow_m3s: col('airflow_m3s'),
    water_pressure_kpa: col('water_pressure_kpa'),
    water_flow_lps: col('water_flow_lps'),
    temperature_c: col('temperature_c'),
    vibration_level: col('vibration_level'),
    sound_event: col('sound_event'),
    system_status: col('system_status'),
    sensor_source: col('sensor_source'),
  };

  const num = (v: string): number | null => (v === '' || v === undefined ? null : Number(v));

  return lines.slice(1).map((line) => {
    const f = line.split(',');
    return {
      id: Number(f[idx.id]),
      // Source timestamps are naive "YYYY-MM-DD HH:MM:SS"; normalise to ISO.
      timestamp: f[idx.timestamp].replace(' ', 'T'),
      power_kw: num(f[idx.power_kw]),
      airflow_m3s: num(f[idx.airflow_m3s]),
      water_pressure_kpa: num(f[idx.water_pressure_kpa]),
      water_flow_lps: num(f[idx.water_flow_lps]),
      temperature_c: num(f[idx.temperature_c]),
      vibration_level: num(f[idx.vibration_level]),
      sound_event: f[idx.sound_event] as SensorReading['sound_event'],
      system_status: f[idx.system_status] as SensorReading['system_status'],
      sensor_source: f[idx.sensor_source],
    };
  });
}
