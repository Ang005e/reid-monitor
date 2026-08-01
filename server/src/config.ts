import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Single tuning surface for the backend.
 *
 * Everything the data team might retune lives here, mirroring the convention in
 * the frontend (src/lib/interpret.ts + src/config/channels.ts). Changing a
 * threshold below will break `npm run parity` — that is intentional. Parity is
 * the record of what the data team's notebook actually did; re-baseline the
 * fixture deliberately, never silently.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ — one level up from src/. Works from both src/ and dist/. */
export const SERVER_ROOT = path.resolve(here, '..');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Committed, read-only. The "static data file" the hackathon handed us. */
export const SOURCE_CSV = path.join(SERVER_ROOT, 'data/source/reid_library_sensor_data.csv');

/** Generated, append-only. Override with DATA_DIR to point at a mounted disk. */
export const DATA_DIR = path.resolve(
  SERVER_ROOT,
  process.env.DATA_DIR ?? path.join(SERVER_ROOT, 'data/live'),
);

export const RAW_CSV = path.join(DATA_DIR, 'raw-sensor-data.csv');
export const CLEANED_CSV = path.join(DATA_DIR, 'cleaned-sensor-data.csv');

// ---------------------------------------------------------------------------
// Calibration (notebook cell 13)
// ---------------------------------------------------------------------------

/**
 * Rows whose sensor_source is anything OTHER than this are treated as the
 * miscalibrated smart sensor. The notebook picks "the one non-original value",
 * so it never hardcodes the name — neither do we. (The dataset README calls it
 * `barry_j_smart_sensor`; the actual CSV says `barry_j_`.)
 */
export const REFERENCE_SENSOR_SOURCE = 'original';

/**
 * kPa subtracted from non-reference sources.
 *
 * The notebook uses a flat 10.0. The measured stable-median offset is +9.19 kPa
 * and CLAUDE.md quotes ~8.7. We keep 10.0 so our output matches the data team's
 * export exactly; if they retune, change it here and re-run parity.
 *
 * Note the notebook does NOT correct airflow (measured offset only
 * +0.077 m³/s), so we don't either.
 */
export const PRESSURE_OFFSET_KPA = 10.0;

// ---------------------------------------------------------------------------
// Alert rules (notebook cell 18)
// ---------------------------------------------------------------------------

export const ALERT_RULES = {
  /** Low pressure + low flow + raised vibration. */
  plumbing: {
    maxPressureKpa: 320,
    maxFlowLps: 1.9,
    minVibration: 0.25,
  },
  /** Normal power draw but poor airflow — "working harder, achieving less". */
  ventilation: {
    minPowerKw: 40,
    maxAirflowM3s: 4.0,
    minVibration: 0.25,
  },
  /** Any one of these alone is enough. */
  critical: {
    pressureKpaBelow: 100,
    flowLpsBelow: 0.3,
    vibrationAbove: 0.85,
  },
} as const;

// ---------------------------------------------------------------------------
// Cleaning (notebook cell 9)
// ---------------------------------------------------------------------------

/**
 * pandas `interpolate(limit=1)`: at most this many consecutive NaNs get filled.
 * A longer gap is left null and surfaces to the dashboard as a real dropout.
 */
export const INTERPOLATION_LIMIT = 1;

/**
 * pandas `limit_area="inside"`: only gaps with a valid reading on BOTH sides are
 * filled. This is what forces the pipeline's one-row lookahead — see
 * pipeline/runPipeline.ts.
 *
 * Interpolated values are deliberately NOT rounded. pandas writes the full
 * float64 repr (e.g. 4.548500000000001) and JavaScript's Number->string emits
 * the same shortest round-trip form, so leaving them alone is what keeps the
 * output identical to the notebook's.
 */
export const INTERPOLATION_LIMIT_AREA = 'inside';

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/**
 * How often the pipeline re-checks raw-sensor-data.csv for new rows.
 *
 * Polling rather than fs.watch: watch semantics differ across macOS, Linux and
 * container filesystems, and a missed event would stall the dashboard silently.
 * At 250 ms this is far faster than the fastest useful tick and costs nothing on
 * a file this size. The in-process runner is also nudged directly on each
 * simulator tick, so this is really a safety net for a detached simulator.
 */
export const PIPELINE_POLL_MS = 250;

/**
 * Minimum gap between recomputations of the /api/meta summaries.
 *
 * They are whole-history scans (percentile sorts per channel, an episode walk
 * and a rule scorecard) over what is now ~30,000 minute rows. Redoing them on
 * every 250 ms batch is pure waste: the dashboard polls /meta every few minutes
 * and the numbers move slowly by construction. End-of-pass flushes bypass this.
 */
export const META_REFRESH_MS = 1000;

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

/**
 * Simulated minutes elapsed per real second at 1x.
 *
 * The feed runs at 1-minute resolution (see simulator/interpolate.ts), so this
 * is also the row rate: 120 rows per second. The dataset spans 499 hours, which
 * expands to 29,941 minute rows, so one full pass takes ~4 min 10 s before it
 * loops (see SIM_LOOP).
 */
export const SIM_MINUTES_PER_SECOND = 120;

/**
 * Wall-clock cadence of the simulator's timer.
 *
 * Rows are emitted in BATCHES rather than one per timer fire. At 120 rows/s a
 * row-per-tick design would need an 8.3 ms interval, and setTimeout neither
 * holds that accurately nor is it free to wake the event loop that often. So the
 * interval stays fixed and the batch size absorbs the rate: 30 rows every 250 ms
 * at 1x, 60 at 2x, and so on. Playback speed changes how many rows a tick
 * carries, never how often it fires.
 */
export const SIM_TICK_MS = 250;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return n;
}

export const SIM_SPEED = envInt('SIM_SPEED', 1);

/**
 * Rows written instantly on a cold boot so the dashboard opens with history.
 *
 * Defaults to 0: the simulator replays the WHOLE dataset live, from the first
 * row, so nothing is skipped and every incident plays out on screen. Set it
 * above zero only if you want the dashboard to open mid-dataset — and note the
 * unit is now MINUTE rows, so an hour of seeded history is 60, not 1.
 */
export const SEED_ROWS = envInt('SEED_ROWS', 0);

export const SIM_RESET = process.env.SIM_RESET === '1';

/**
 * Replay the dataset forever instead of stopping at the last row.
 *
 * On each loop the live history is wiped and the replay restarts from the first
 * row, so the dashboard shows a fresh run rather than an ever-growing timeline
 * with a discontinuity in it.
 *
 * Reading ids deliberately keep counting UP across loops — they are never reset
 * to 0. They are the SSE resume cursor (`?since=`), and the dashboard also drops
 * any reading whose id it has already seen. Restarting ids would make every row
 * after the first loop look like a duplicate and be silently discarded.
 */
export const SIM_LOOP = (process.env.SIM_LOOP ?? '1') !== '0';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const PORT = envInt('PORT', 8787);

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Allowed CORS origins. The dashboard is served from a different host (Vercel)
 * than this API (Render), so EventSource needs an explicit grant.
 */
export const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** SSE comment frame interval — keeps proxies and load balancers from idling out. */
export const SSE_HEARTBEAT_MS = 15_000;
