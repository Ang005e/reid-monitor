import type { ChannelConfig, ChannelKey } from '@/types';

/**
 * Channel metadata + engineering spec limits.
 *
 * SPEC LIMITS (lsl/usl) drive Cp/Cpk. Defaults below were derived from the
 * stable-period baseline of the July 2026 dataset (mean ± 4σ, rounded), except
 * where Cloudy's notes imply a hard physical limit. Engineers: tune these here —
 * nothing else needs to change.
 */
export const CHANNELS: ChannelConfig[] = [
  {
    key: 'power_kw',
    label: 'Power draw',
    unit: 'kW',
    system: 'power',
    lsl: 37,
    usl: 59,
    precision: 1,
  },
  {
    key: 'airflow_m3s',
    label: 'Airflow',
    unit: 'm³/s',
    system: 'ventilation',
    lsl: 3.1,
    usl: 5.9,
    precision: 2,
  },
  {
    key: 'airflow_per_kw',
    label: 'Airflow / power efficiency',
    unit: 'm³/s per kW',
    system: 'ventilation',
    lsl: 0.086,
    usl: 0.102,
    precision: 4,
    derived: true,
  },
  {
    key: 'water_pressure_kpa',
    label: 'Water pressure',
    unit: 'kPa',
    system: 'water',
    lsl: 303,
    usl: 399,
    precision: 0,
  },
  {
    key: 'water_flow_lps',
    label: 'Water flow',
    unit: 'L/s',
    system: 'water',
    lsl: 1.5,
    usl: 2.73,
    precision: 2,
  },
  {
    key: 'temperature_c',
    label: 'Temperature',
    unit: '°C',
    system: 'environment',
    lsl: 17,
    usl: 21,
    precision: 1,
  },
  {
    key: 'vibration_level',
    label: 'Vibration',
    unit: 'index',
    system: 'ventilation',
    lsl: 0,
    usl: 0.27,
    precision: 3,
  },
];

export const CHANNEL_MAP: Record<ChannelKey, ChannelConfig> = Object.fromEntries(
  CHANNELS.map((c) => [c.key, c]),
) as Record<ChannelKey, ChannelConfig>;

export const SYSTEM_LABELS: Record<ChannelConfig['system'], string> = {
  water: 'Water system',
  ventilation: 'Ventilation system',
  power: 'Power system',
  environment: 'Shelter environment',
};

/** Sound → vibration bands observed in the dataset (hand labels match these 1:1). */
export const VIBRATION_BANDS = {
  normalMax: 0.25, // above this ≈ "hum"
  humMax: 0.46, //   above this ≈ "rattle"
};

/** Rolling window (hours) for live SPC stats & Cpk trend. */
export const ROLLING_WINDOW = 24;
