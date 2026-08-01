import type { ChannelConfig, ChannelKey, ChannelStats, SensorReading } from '@/types';

/** Extract a channel value from a reading (handles the derived ratio channel). */
export function channelValue(r: SensorReading, key: ChannelKey): number | null {
  if (key === 'airflow_per_kw') {
    if (r.airflow_m3s == null || r.power_kw == null || r.power_kw === 0) return null;
    return r.airflow_m3s / r.power_kw;
  }
  return r[key];
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Sample standard deviation (n-1). */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * How many readings make up one hour of this feed.
 *
 * The dataset is hourly, but the live backend serves it at 1-minute resolution,
 * so "the last 8 readings" and "the last 8 hours" are the same thing in one and
 * differ by 60x in the other. Everything time-based — SPC windows, ramp slopes,
 * persistence checks — asks this rather than assuming.
 *
 * Measured from the data instead of configured, so the CSV replay fallback and
 * the live stream both work with no flag to keep in sync. The median gap is used
 * rather than the mean because a loop boundary or a resume backfill can put one
 * freak delta in the window, and a median ignores it.
 *
 * Returns 1 for anything it cannot measure, which is the historical behaviour.
 */
export function samplesPerHour(readings: readonly SensorReading[]): number {
  if (readings.length < 2) return 1;

  // A short tail is enough to establish cadence and keeps this O(1) on a
  // 30,000-reading history.
  const tail = readings.slice(-25);
  const deltas: number[] = [];
  for (let i = 1; i < tail.length; i += 1) {
    const a = Date.parse(`${tail[i - 1].timestamp}Z`);
    const b = Date.parse(`${tail[i].timestamp}Z`);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) deltas.push(b - a);
  }
  if (deltas.length === 0) return 1;

  deltas.sort((x, y) => x - y);
  const medianMs = deltas[Math.floor(deltas.length / 2)];
  if (!Number.isFinite(medianMs) || medianMs <= 0) return 1;

  return Math.max(1, Math.round(3_600_000 / medianMs));
}

/** Least-squares slope of xs per unit index (used for trend/ramp detection). */
export function slope(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (xs[i] - my);
    den += (i - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Cp = (USL − LSL) / 6σ. Null when σ is unusable. */
export function cp(cfg: ChannelConfig, sigma: number): number | null {
  if (!isFinite(sigma) || sigma <= 0) return null;
  return (cfg.usl - cfg.lsl) / (6 * sigma);
}

/** Cpk = min(USL − μ, μ − LSL) / 3σ. Null when σ is unusable. */
export function cpk(cfg: ChannelConfig, mu: number, sigma: number): number | null {
  if (!isFinite(sigma) || sigma <= 0 || !isFinite(mu)) return null;
  return Math.min(cfg.usl - mu, mu - cfg.lsl) / (3 * sigma);
}

/**
 * Compute stats for one channel over a set of readings.
 * `baseline` (stable-period readings) drives the control limits;
 * `window` (recent readings) drives Cp/Cpk so capability reflects *current* behaviour.
 */
export function computeChannelStats(
  cfg: ChannelConfig,
  baseline: SensorReading[],
  window: SensorReading[],
): ChannelStats {
  const baseVals = baseline
    .map((r) => channelValue(r, cfg.key))
    .filter((v): v is number => v != null);
  const winVals = window
    .map((r) => channelValue(r, cfg.key))
    .filter((v): v is number => v != null);

  const baseMean = mean(baseVals);
  const baseSd = stdDev(baseVals);
  const winMean = mean(winVals);
  const winSd = stdDev(winVals);

  return {
    key: cfg.key,
    mean: winMean,
    stdDev: winSd,
    ucl: baseMean + 3 * baseSd,
    lcl: baseMean - 3 * baseSd,
    cp: cp(cfg, winSd),
    cpk: cpk(cfg, winMean, winSd),
    sampleCount: winVals.length,
  };
}

/** Readings usable as a control-limit baseline: labelled stable by the system. */
export function stableBaseline(readings: SensorReading[]): SensorReading[] {
  const stable = readings.filter((r) => r.system_status === 'stable');
  // Fallback: if labels are missing in a future dataset, use everything.
  return stable.length >= 30 ? stable : readings;
}

/** Cpk quality bands used across the UI. */
export function cpkBand(value: number | null): 'good' | 'marginal' | 'poor' | 'unknown' {
  if (value == null) return 'unknown';
  if (value >= 1.33) return 'good';
  if (value >= 1.0) return 'marginal';
  return 'poor';
}
