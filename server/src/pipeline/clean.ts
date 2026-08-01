import { INTERPOLATION_LIMIT } from '../config.js';
import { timestampToMs } from '../csv/parse.js';
import { INTERPOLATED_CHANNELS, type InterpolatedChannel, type RawReading } from '../types.js';

/**
 * Gap filling — a faithful port of notebook cell 9:
 *
 *   df[cols].interpolate(method="time", limit=1, limit_area="inside")
 *
 * Verified against pandas 2.2.3 rather than assumed. The exact semantics are
 * subtler than "average the neighbours":
 *
 *  - `limit_area="inside"` means a gap is filled only when there is a valid
 *    reading on BOTH sides. Leading and trailing gaps are never filled.
 *  - `limit=1` caps how many CONSECUTIVE nulls get filled, and pandas fills them
 *    from the front. So a run of three nulls fills only the first one — and it
 *    interpolates across the whole run, i.e. between the valid readings that
 *    bracket the run, not between immediate neighbours.
 *  - `method="time"` interpolates linearly against the timestamp. The dataset is
 *    uniformly hourly, so for an isolated gap this reduces to the midpoint.
 */

/**
 * Value pandas would produce for `channel` at `index`, or null if it leaves the
 * cell empty.
 *
 * `series` must be ordered by timestamp ascending. Callers control the lookahead
 * by controlling how much of the series they pass: the batch path passes every
 * row, the streaming path passes a bounded window (see runPipeline.ts).
 */
export function interpolateAt(
  series: readonly RawReading[],
  index: number,
  channel: InterpolatedChannel,
  limit: number = INTERPOLATION_LIMIT,
): number | null {
  const target = series[index];
  if (target === undefined) return null;
  if (target[channel] !== null) return target[channel];

  // How far into the run of consecutive nulls this cell sits. pandas fills only
  // the first `limit` of them, so anything beyond that stays empty.
  let runStart = index;
  while (runStart > 0 && series[runStart - 1]?.[channel] === null) runStart -= 1;
  if (index - runStart >= limit) return null;

  // Nearest valid reading before the run, and after it. Absent either one, the
  // gap is at an edge of the available data and `limit_area="inside"` declines.
  let before = runStart - 1;
  while (before >= 0 && series[before]?.[channel] === null) before -= 1;
  let after = index;
  while (after < series.length && series[after]?.[channel] === null) after += 1;

  const prev = series[before];
  const next = series[after];
  if (prev === undefined || next === undefined) return null;

  const vPrev = prev[channel];
  const vNext = next[channel];
  if (vPrev === null || vNext === null) return null;

  const tPrev = timestampToMs(prev.timestamp);
  const tNext = timestampToMs(next.timestamp);
  const tHere = timestampToMs(target.timestamp);
  if (tNext === tPrev) return vPrev;

  // Slope form, matching numpy.interp — the arithmetic ordering pandas uses.
  return vPrev + ((vNext - vPrev) * (tHere - tPrev)) / (tNext - tPrev);
}

export interface CleanedChannels {
  values: Record<InterpolatedChannel, number | null>;
  /** True where the raw feed had no reading and the value above was derived. */
  wasMissing: Record<InterpolatedChannel, boolean>;
}

/** Runs every interpolated channel for one row and records what was filled. */
export function cleanRow(series: readonly RawReading[], index: number): CleanedChannels {
  const row = series[index];
  if (row === undefined) throw new Error(`cleanRow: no row at index ${index}`);

  const values = {} as Record<InterpolatedChannel, number | null>;
  const wasMissing = {} as Record<InterpolatedChannel, boolean>;

  for (const channel of INTERPOLATED_CHANNELS) {
    wasMissing[channel] = row[channel] === null;
    values[channel] = interpolateAt(series, index, channel);
  }

  return { values, wasMissing };
}

/**
 * Rows of lookahead the streaming path must hold before a row can be finalised.
 *
 * An isolated gap needs exactly one following row to be fillable, and every one
 * of the six dropouts in the reference dataset is isolated. A longer run would
 * need as many rows as the run is long, so we cap it: a gap that outlives the
 * window is published as a genuine null instead of stalling the live stream
 * behind a sensor that may never come back. The batch path has no such cap.
 */
export const STREAM_LOOKAHEAD_ROWS = Math.max(1, INTERPOLATION_LIMIT);
