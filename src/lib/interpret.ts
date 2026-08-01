import type { ChannelKey, Interpretation, SensorReading, Severity } from '@/types';
import { VIBRATION_BANDS } from '@/config/channels';
import { channelValue, samplesPerHour, slope } from './spc';

/**
 * Interpretation rule engine — Cloudy's handwritten patterns, made executable.
 *
 * Each rule inspects the recent window of readings and, when it fires, emits
 * an Interpretation carrying BOTH the engineer detail and the community
 * guidance (what it means / what to do / who to tell). The UI renders the
 * side matching the active view mode; the alert pipeline dispatches them
 * to devices.
 *
 * Validated against the July 2026 dataset:
 *  - Valve failures (Jul 5, Jul 15): pressure ramps ≈ −9.7 kPa/h for ~21 h
 *    before failure. (Cloudy, Entry 1: "check the pressure before trusting
 *    the valves.")
 *  - Ventilation faults (Jul 10, Jul 18): airflow/power ratio collapses
 *    below ~0.086 while pressure stays flat; self-limits at "warning".
 *    (Entry 3: "working harder but achieving less.")
 *  - Vibration bands map 1:1 to the dragons' sound labels: ≤0.25 normal,
 *    ≤0.46 hum, above = rattle. (Entry 2: "every machine has its own voice.")
 *  - Temperature only moves AFTER failure (drops to ~15 °C). It is a
 *    confirmation signal, never a warning. (Entry 4: "the cold arrives later.")
 */

/**
 * Pressure-ramp tuning. Channel noise is σ≈12 kPa, so a slope estimate over
 * PRESSURE_WINDOW_H hours has σ_slope ≈ 1.85 kPa/h. The trigger sits at ~2.7σ
 * AND requires the level itself to be below baseline−1σ, which suppressed the
 * noise-only firings seen at looser settings while still catching the real
 * ramps (−9.7 kPa/h) within ~5 h of onset → ~19 h of warning before failure.
 */
const PRESSURE_RAMP_KPA_PER_H = -5;
const PRESSURE_WINDOW_H = 8;
const PRESSURE_LEVEL_CONFIRM_KPA = 340; // stable baseline 351.4 − 1σ (12.0)
const RATIO_LOW = 0.086; // stable baseline is 0.0941 ± 0.0020
const TEMP_FAILURE_C = 17;
const TREND_MIN_POINTS = 4;

interface RuleContext {
  /** Most recent readings, oldest → newest. At least ~24 h for full fidelity. */
  window: SensorReading[];
  latest: SensorReading;
  /**
   * Readings per hour in this window — 1 for the hourly CSV replay, 60 for the
   * live minute-resolution stream. Every threshold below is expressed in HOURS
   * and converted through this, so both feeds fire on the same physical trend
   * rather than on the same number of samples.
   */
  perHour: number;
}

type Rule = (ctx: RuleContext) => Interpretation | null;

/** The last `hours` of a channel, in whatever resolution the feed is running at. */
function values(ctx: RuleContext, key: ChannelKey, hours: number): number[] {
  return ctx.window
    .slice(-Math.max(1, Math.round(hours * ctx.perHour)))
    .map((r) => channelValue(r, key))
    .filter((v): v is number => v != null);
}

/**
 * Least-squares slope in units PER HOUR.
 *
 * slope() works per sample, which equals per hour only on an hourly feed. On the
 * minute feed a −9.7 kPa/h ramp is −0.162 kPa per sample, so comparing the raw
 * slope against a kPa/h threshold would under-read it by 60x and the ramp rule
 * would never fire.
 */
function slopePerHour(ctx: RuleContext, xs: number[]): number {
  return slope(xs) * ctx.perHour;
}

function make(
  ctx: RuleContext,
  partial: Omit<Interpretation, 'triggeredAt'>,
): Interpretation {
  return { ...partial, triggeredAt: ctx.latest.timestamp };
}

/** R1 — Cloudy Entry 1: falling pressure precedes valve failure by ~21 h. */
const pressureRamp: Rule = (ctx) => {
  // Persistence: the ramp must hold for 2 consecutive hours. Single-hour
  // noise runs (e.g. Jul 3 20:00 in the reference dataset) don't survive this;
  // real ramps fire continuously, so it costs only 1 h of the ~19 h window.
  // Window and step are expressed in hours, then converted to samples — on the
  // minute feed one "hour ago" is 60 readings back, not one.
  const windowLen = Math.max(TREND_MIN_POINTS, Math.round(PRESSURE_WINDOW_H * ctx.perHour));
  const oneHour = Math.max(1, ctx.perHour);

  const fires = (xs: number[]): { s: number; level: number } | null => {
    if (xs.length < TREND_MIN_POINTS) return null;
    const s = slopePerHour(ctx, xs);
    const level = xs[xs.length - 1];
    return s <= PRESSURE_RAMP_KPA_PER_H && level <= PRESSURE_LEVEL_CONFIRM_KPA
      ? { s, level }
      : null;
  };
  const all = values(ctx, 'water_pressure_kpa', PRESSURE_WINDOW_H + 1);
  const now = fires(all.slice(-windowLen));
  const prev = fires(all.slice(0, -oneHour).slice(-windowLen));
  if (!now || !prev) return null;
  const { s } = now;
  const xs = all.slice(-windowLen);

  const severity: Severity = s <= -7 ? 'critical' : 'warning';
  const etaH = Math.max(2, Math.round((xs[xs.length - 1] - 240) / -s)); // ~240 kPa = observed failure level
  return make(ctx, {
    ruleId: 'pressure-ramp',
    severity,
    title: 'Water pressure is falling steadily',
    engineerDetail: `Linear slope over last ${PRESSURE_WINDOW_H} h: ${s.toFixed(1)} kPa/h (trigger ≤ ${PRESSURE_RAMP_KPA_PER_H}). July incidents ramped at −9.7 kPa/h with valve failure ~21 h after warning onset. Projected time to ~240 kPa: ~${etaH} h.`,
    communityMessage:
      'The water system is losing pressure the same way it did before the last two valve failures. This is the earliest reliable warning sign we know — the pipes "complain first".',
    action: `Conserve water now and prepare stored reserves. Expect valve trouble within roughly ${etaH} hours if the trend continues.`,
    notifyWho: 'The engineering team immediately, and shelter coordinators so reserves are readied.',
    channels: ['water_pressure_kpa', 'water_flow_lps'],
  });
};

/** R2 — Cloudy Entry 3: airflow/power efficiency collapse = ventilation fault. */
const efficiencyCollapse: Rule = (ctx) => {
  const xs = values(ctx, 'airflow_per_kw', 3);
  if (xs.length < 2) return null;
  const latest = xs[xs.length - 1];
  if (latest >= RATIO_LOW) return null;

  // Distinguish from a valve event: pressure stays flat in ventilation faults.
  const pSlope = slopePerHour(ctx, values(ctx, 'water_pressure_kpa', PRESSURE_WINDOW_H));
  const pressureFlat = Math.abs(pSlope) < 2;

  return make(ctx, {
    ruleId: 'efficiency-collapse',
    severity: 'warning',
    title: 'Ventilation is working harder but moving less air',
    engineerDetail: `airflow/power = ${latest.toFixed(4)} (stable baseline 0.0941 ± 0.0020, trigger < ${RATIO_LOW}). Pressure slope ${pSlope.toFixed(1)} kPa/h → ${pressureFlat ? 'flat, consistent with a fan-side fault (July 10/18 signature; those self-resolved in ~30 h without escalating)' : 'also moving — check for a compound event'}. Raw airflow alone under-detects this by ~3× (5σ vs 14σ).`,
    communityMessage:
      'The fans are drawing normal power but delivering much less air — "running in circles". In July this pattern meant a fan problem, not a water problem, and it cleared up on its own within about a day.',
    action:
      'Keep vulnerable dragons away from poorly ventilated rooms and open internal doors to help air move. No evacuation needed based on past behaviour of this fault.',
    notifyWho: 'The engineering team (routine priority) and whoever manages room assignments.',
    channels: ['airflow_per_kw', 'airflow_m3s', 'power_kw'],
  });
};

/** R3 — Cloudy Entry 2: vibration bands match the dragons' sound labels 1:1. */
const vibrationBand: Rule = (ctx) => {
  const v = ctx.latest.vibration_level;
  if (v == null || v <= VIBRATION_BANDS.normalMax) return null;

  const rattle = v > VIBRATION_BANDS.humMax;
  return make(ctx, {
    ruleId: 'vibration-band',
    severity: rattle ? 'critical' : 'watch',
    title: rattle ? 'Machinery is rattling' : 'Machinery hum has changed',
    engineerDetail: `vibration_level = ${v.toFixed(3)} → ${rattle ? `"rattle" band (> ${VIBRATION_BANDS.humMax}); in July this band appeared ONLY during critical/failed hours` : `"hum" band (${VIBRATION_BANDS.normalMax}–${VIBRATION_BANDS.humMax}); appeared only during warning hours`}. The young dragons' sound reports matched these bands with zero exceptions across 500 h — treat their reports as valid sensor input.`,
    communityMessage: rattle
      ? 'The machines are shaking the way they did right before the last failures. The young dragons who reported rattles were right every single time.'
      : 'The machines are humming differently — an early caution sign. The listeners have been reliable about this.',
    action: rattle
      ? 'Move away from machinery rooms and check on elderly and young dragons now.'
      : 'Nothing urgent, but tell an engineer what you heard and where.',
    notifyWho: rattle
      ? 'Engineering team urgently. Log which room the sound came from.'
      : 'Any engineer, plus note it for the listeners’ log.',
    channels: ['vibration_level'],
  });
};

/** R4 — Cloudy Entry 4: cold = failure already happened, not a warning. */
const temperatureDrop: Rule = (ctx) => {
  const t = ctx.latest.temperature_c;
  if (t == null || t >= TEMP_FAILURE_C) return null;
  return make(ctx, {
    ruleId: 'temperature-drop',
    severity: 'critical',
    title: 'Shelter temperature is dropping — system already down',
    engineerDetail: `temperature_c = ${t.toFixed(1)} °C (< ${TEMP_FAILURE_C}). In July, temperature held at 19.0 °C through entire warning AND critical phases, only falling (to ~15 °C) once status = failed. Cold is a lagging confirmation, ~24 h behind the first warning signs.`,
    communityMessage:
      'It is getting cold because the ventilation has already failed — this is not an early warning, the failure has happened. Cloudy warned that "the cold arrives later".',
    action:
      'Start cold-night protocol: gather blankets, move the youngest and oldest dragons to the warmest interior rooms, and do not wait for it to get colder.',
    notifyWho: 'Everyone — shelter coordinators, engineering, and carers for vulnerable dragons.',
    channels: ['temperature_c', 'airflow_m3s'],
  });
};

/**
 * How far back the dropout rule looks, in hours.
 *
 * A dropout is a single reading. On the hourly feed that rounds to 1 reading —
 * `latest` — which is exactly the historical behaviour and what keeps the
 * regression count at 6. On the minute feed it is 15 readings, and it has to be:
 * readings arrive 120/s and are flushed to the UI in batches, so only the last
 * reading of each batch is ever `latest`. Looking at `latest` alone would miss
 * roughly 23 of every 24 dropouts by luck of batch alignment — and a dropout
 * that did land would be on screen for one frame. Fifteen minutes of memory
 * makes it both reliably detected and readable.
 */
const DROPOUT_LOOKBACK_H = 0.25;

/** R5 — sensor dropout notice (Entry 5, reframed honestly: gaps ≠ omens, but log them). */
const sensorDropout: Rule = (ctx) => {
  const hasGap = (x: SensorReading): boolean =>
    x.airflow_m3s_was_missing === true ||
    x.water_pressure_kpa_was_missing === true ||
    x.water_flow_lps_was_missing === true ||
    x.vibration_level_was_missing === true ||
    x.power_kw == null ||
    x.airflow_m3s == null ||
    x.water_pressure_kpa == null ||
    x.water_flow_lps == null ||
    x.temperature_c == null ||
    x.vibration_level == null;

  // Most recent reading carrying a gap, within the lookback. On the hourly feed
  // the lookback is one reading, so this is just `latest`.
  const lookback = Math.max(1, Math.round(DROPOUT_LOOKBACK_H * ctx.perHour));
  const recent = ctx.window.slice(-lookback);
  let r: SensorReading | undefined;
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    if (hasGap(recent[i])) {
      r = recent[i];
      break;
    }
  }
  if (r === undefined) return null;

  /*
   * Two orthogonal dropout signals, both required:
   *
   * Branch 1 — `*_was_missing` flags set by the backend pipeline.
   *   The pipeline interpolates isolated gaps in exactly four channels
   *   (airflow_m3s, water_pressure_kpa, water_flow_lps, vibration_level) and
   *   marks each filled row with a boolean flag. On live data these flags are
   *   the ONLY evidence a sensor dropped out — the pipeline has already
   *   replaced the null with an estimated value before the reading reaches us.
   *   power_kw and temperature_c are deliberately never interpolated
   *   (see INTERPOLATED_CHANNELS in server/src/types.ts), so they have no flags.
   *
   * Branch 2 — literal null values.
   *   Needed for two reasons:
   *   (a) power_kw and temperature_c are never interpolated and still arrive as
   *       real nulls from the live backend.
   *   (b) CsvDataSource (the bundled CSV replay) produces real nulls for ALL
   *       channels and never sets *_was_missing, so this branch keeps
   *       scripts/verify-rules.ts passing against the raw CSV and preserves
   *       the required ×6 count for regression testing.
   *
   * We take the UNION of both branches and deduplicate — a channel that is
   * both flagged AND null (possible only during a multi-hour gap the pipeline
   * cannot bridge) is reported exactly once.
   */

  // Branch 1: channels the pipeline interpolated (live backend only).
  // Explicit field access avoids a string-template type cast and is exhaustive.
  const interpolated: ChannelKey[] = [];
  if (r.airflow_m3s_was_missing)        interpolated.push('airflow_m3s');
  if (r.water_pressure_kpa_was_missing) interpolated.push('water_pressure_kpa');
  if (r.water_flow_lps_was_missing)     interpolated.push('water_flow_lps');
  if (r.vibration_level_was_missing)    interpolated.push('vibration_level');

  // Branch 2: channels still arriving as literal null — either never-interpolated
  // channels (power_kw, temperature_c) on the live backend, or any channel
  // in the CSV replay path where *_was_missing flags are never set.
  const stillNull: ChannelKey[] = (
    ['power_kw', 'airflow_m3s', 'water_pressure_kpa', 'water_flow_lps', 'temperature_c', 'vibration_level'] as const
  ).filter((k) => r[k] == null);

  // Union, insertion-order deduplicated via Set.
  const missing: ChannelKey[] = [...new Set([...interpolated, ...stillNull])];
  if (missing.length === 0) return null;

  // Per-channel context so engineers can tell which path fired for each channel:
  //   "pipeline-estimated" = the value was gap-filled; the raw reading was absent.
  //   "null"               = no reading arrived at all (or CSV replay path).
  //   both                 = multi-hour gap (pipeline could not fill it).
  const interpolatedSet = new Set(interpolated);
  const nullSet = new Set(stillNull);
  const channelDetail = missing
    .map((k) => {
      if (interpolatedSet.has(k) && nullSet.has(k))
        return `${k} (pipeline-estimated AND null — suspected multi-hour gap)`;
      if (interpolatedSet.has(k))
        return `${k} (pipeline-estimated: raw reading was absent, value was interpolated)`;
      return `${k} (null: no reading arrived)`;
    })
    .join('; ');

  return make(ctx, {
    ruleId: 'sensor-dropout',
    severity: 'info',
    title: `Sensor dropout: ${missing.join(', ')}`,
    engineerDetail: `Gap at ${r.timestamp} — ${channelDetail}. The 6 dropouts in the July export all occurred in stable periods (isolated single-cell, ±4 h surroundings within 2σ) — attack damage, not fault precursors. Pipeline-estimated values are plausible midpoints, not real readings; a null means no reading arrived at all. Still worth a physical check.`,
    communityMessage:
      'One of the damaged sensors went quiet for a moment. Based on past data this is leftover damage from the attack, not a sign of trouble — but engineers track every gap.',
    action: 'No action needed. Engineers will verify the sensor on their next round.',
    notifyWho: 'Engineering team, routine priority.',
    channels: missing,
  });
};

/** R6 — sensor source change: recalibrate before trusting thresholds. */
let lastSource: string | null = null;
const sourceChange: Rule = (ctx) => {
  const src = ctx.latest.sensor_source;
  const changed = lastSource !== null && src !== lastSource;
  lastSource = src;
  if (!changed) return null;
  return make(ctx, {
    ruleId: 'sensor-source-change',
    severity: 'watch',
    title: `Sensor source changed to "${src}"`,
    engineerDetail: `Readings now originate from "${src}". In July, barry_j_ read water pressure ~8.7 kPa higher and airflow ~0.14 m³/s higher than the original sensors (baseline ratio 0.0941 → 0.0970). Recalibrate baselines/spec limits (src/config/channels.ts) before trusting threshold alerts on this source.`,
    communityMessage:
      'The readings are now coming from a different sensor. Numbers may look slightly different for a while — engineers are recalibrating.',
    action: 'Nothing to do. Treat alerts in the next few hours with mild caution.',
    notifyWho: 'Engineering team.',
    channels: ['water_pressure_kpa', 'airflow_m3s'],
  });
};

const RULES: Rule[] = [
  pressureRamp,
  efficiencyCollapse,
  vibrationBand,
  temperatureDrop,
  sensorDropout,
  sourceChange,
];

/**
 * Run all rules against the recent window. Newest reading = window[window.length-1].
 *
 * Feed cadence is measured from the window itself rather than configured, so the
 * same thresholds hold whether readings arrive hourly (the bundled CSV replay)
 * or every minute (the live backend).
 */
export function interpret(window: SensorReading[]): Interpretation[] {
  if (window.length === 0) return [];
  const ctx: RuleContext = {
    window,
    latest: window[window.length - 1],
    perHour: samplesPerHour(window),
  };
  return RULES.map((rule) => rule(ctx)).filter((i): i is Interpretation => i !== null);
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  watch: 1,
  info: 0,
};
