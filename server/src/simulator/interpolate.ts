/**
 * Expands the hourly source export into a 1-minute-resolution feed.
 *
 * The dataset is 500 hourly rows. The dashboard wants a clock that ticks
 * minute-by-minute, so between each pair of source hours we synthesise the 59
 * intervening minutes.
 *
 * ## What is and is not invented
 *
 * Minute 0 of every hour is the SOURCE LINE, byte-for-byte. Only minutes 1-59
 * are synthetic. That matters: every value the data team exported still appears
 * in the feed unaltered and on its original timestamp, so anything derived from
 * the hourly grid (parity, the reference episode boundaries, the two valve
 * events) is looking at the same numbers it always was. The synthetic rows sit
 * between them.
 *
 * Numeric channels are linearly interpolated. Labels (sound_event,
 * system_status, sensor_source) are HELD, not blended — they are categorical, so
 * a status change lands on the hour it landed on in the source and holds for the
 * following 59 minutes.
 *
 * ## Dropouts survive as dropouts
 *
 * The export has six single-cell gaps. Naively interpolating across them would
 * erase all six, and with them the sensor-dropout rule's only live trigger.
 *
 * So gaps are bridged for the purpose of generating neighbouring minutes — the
 * curve either side of a gap has to go somewhere — but minute 0 is emitted with
 * the cell still EMPTY. Each dropout therefore reaches the pipeline as a single
 * missing minute with valid readings one minute either side, which is exactly
 * the shape INTERPOLATION_LIMIT=1 / limit_area="inside" is designed to fill. The
 * pipeline gap-fills it and sets *_was_missing, as it did when rows were hourly.
 * Six dropouts in, six flagged rows out.
 */

import { splitCsv } from '../csv/parse.js';

/** Synthetic rows generated per source hour, including the verbatim minute 0. */
export const MINUTES_PER_HOUR = 60;

/** Columns interpolated between hours. Everything else is held. */
const NUMERIC_COLUMNS = [
  'power_kw',
  'airflow_m3s',
  'water_pressure_kpa',
  'water_flow_lps',
  'temperature_c',
  'vibration_level',
] as const;

/**
 * Formats an interpolated value the way the source file writes its own: up to
 * three decimals, no trailing zeros. Without the round-trip through toFixed,
 * ordinary float arithmetic emits tokens like 4.548500000000001, which is
 * noise rather than precision at this resolution.
 */
function formatValue(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** "2026-07-01 00:00:00" + m minutes, in the source's own space-separated form. */
function addMinutes(timestamp: string, minutes: number): string {
  const ms = Date.parse(`${timestamp.trim().replace(' ', 'T')}Z`);
  if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp: ${JSON.stringify(timestamp)}`);
  return new Date(ms + minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Fills nulls in a numeric series by linear interpolation between the nearest
 * real readings either side, so a gap still has a defined curve running through
 * it. Leading and trailing nulls are held flat — there is nothing to interpolate
 * towards. The returned series is used ONLY to generate minutes 1-59; the
 * original nulls are re-applied at minute 0 by the caller.
 */
function bridgeGaps(series: readonly (number | null)[]): (number | null)[] {
  const out = [...series];
  let lastReal = -1;

  for (let i = 0; i < out.length; i += 1) {
    if (out[i] === null) continue;
    if (lastReal !== -1 && i - lastReal > 1) {
      const from = out[lastReal] as number;
      const to = out[i] as number;
      const span = i - lastReal;
      for (let k = lastReal + 1; k < i; k += 1) {
        out[k] = from + ((to - from) * (k - lastReal)) / span;
      }
    }
    lastReal = i;
  }

  // Edges: nothing on one side, so hold the nearest real value flat.
  const firstReal = out.findIndex((v) => v !== null);
  if (firstReal > 0) for (let i = 0; i < firstReal; i += 1) out[i] = out[firstReal] as number;
  if (lastReal !== -1) for (let i = lastReal + 1; i < out.length; i += 1) out[i] = out[lastReal] as number;

  return out;
}

/**
 * Expands hourly source lines into minute-resolution lines.
 *
 * The final source hour contributes only its minute 0: there is no following
 * hour to interpolate towards, so a pass ends exactly on the dataset's last
 * timestamp rather than 59 invented minutes past it. Total output is therefore
 * (hours - 1) * 60 + 1 rows.
 *
 * @param header  The source header line, used to locate columns by name.
 * @param lines   Source data lines, hourly, in order.
 */
export function expandToMinutes(header: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [];

  const { header: columns } = splitCsv(`${header}\n`);
  const indexOf = (name: string): number => {
    const i = columns.indexOf(name);
    if (i === -1) throw new Error(`Missing required column "${name}" in source header`);
    return i;
  };

  const timestampAt = indexOf('timestamp');
  const numericAt = NUMERIC_COLUMNS.map(indexOf);

  const fields = lines.map((l) => l.split(','));

  // Bridge each numeric column across its gaps once, up front. The bridged
  // series drives minutes 1-59 only — minute 0 is always the untouched source
  // line, so a dropout stays a dropout.
  const bridged = numericAt.map((col) =>
    bridgeGaps(
      fields.map((f) => {
        const token = f[col];
        return token === undefined || token === '' ? null : Number(token);
      }),
    ),
  );

  const out: string[] = [];
  let rowIndex = 0;

  for (let h = 0; h < fields.length; h += 1) {
    const row = fields[h];
    if (row === undefined) continue;

    // Minute 0 — the source line itself, only the leading index column
    // renumbered so the expanded file stays sequentially indexed.
    out.push([String(rowIndex++), ...row.slice(1)].join(','));

    // The last hour has no successor to interpolate towards.
    if (h === fields.length - 1) break;

    const hourStart = row[timestampAt];
    if (hourStart === undefined) throw new Error(`Row ${h} has no timestamp`);

    for (let m = 1; m < MINUTES_PER_HOUR; m += 1) {
      const minuteRow = [...row];
      minuteRow[0] = String(rowIndex++);
      minuteRow[timestampAt] = addMinutes(hourStart, m);

      for (let c = 0; c < numericAt.length; c += 1) {
        const col = numericAt[c] as number;
        const series = bridged[c] as (number | null)[];
        const from = series[h];
        const to = series[h + 1];
        // A column with no real readings at all stays empty rather than
        // fabricating a number for it.
        minuteRow[col] =
          from === null || to === null || from === undefined || to === undefined
            ? ''
            : formatValue(from + ((to - from) * m) / MINUTES_PER_HOUR);
      }

      out.push(minuteRow.join(','));
    }
  }

  return out;
}
