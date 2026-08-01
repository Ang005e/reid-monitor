# Reid Monitor — backend API contract

**For the frontend engineer.** This is the contract the dashboard connects to. It
is stable; if something here needs to change, tell the backend owner rather than
working around it.

Base URL is whatever you set `VITE_API_BASE_URL` to, and every path below hangs
off it:

| Environment | `VITE_API_BASE_URL` |
|---|---|
| Local dev | `/api` (via the Vite proxy — see step 3) |
| Production | `https://<render-service>.onrender.com/api` |

---

## 1. The reading object

Every endpoint speaks in this one shape. It is a superset of the current
`SensorReading` in `src/types/index.ts` — the existing fields keep their exact
names, types and meanings, so charts and SPC code need no changes.

```jsonc
{
  "id": 275,                              // 0-based, monotonic, gapless. The resume cursor.
  "timestamp": "2026-07-12T11:00:00",     // ISO, timezone-naive. Already normalised —
                                          // no need for csv.ts's " " -> "T" replace.

  // --- sensor channels (interpolated + calibrated) ---
  "power_kw": 48.318,
  "airflow_m3s": 4.548500000000001,
  "water_pressure_kpa": 352.132,          // CALIBRATED value — chart this one
  "water_flow_lps": 2.12,
  "temperature_c": 18.297,
  "vibration_level": 0.098,

  // --- labels ---
  "sound_event": "normal",                // normal | hum | rattle
  "system_status": "stable",              // stable | warning | critical | failed | recovering
  "sensor_source": "original",            // "original" | "barry_j_"

  // --- pipeline output (new) ---
  "derived_alert": "normal",              // see §2
  "alert_raised": false,                  // derived_alert !== "normal"
  "pressure_calibrated": false,           // true = Barry J offset was removed
  "water_pressure_kpa_raw": 352.132,      // pre-calibration, for audit/tooltips

  // --- dropout flags (new) — see §4 ---
  "airflow_m3s_was_missing": false,
  "water_pressure_kpa_was_missing": false,
  "water_flow_lps_was_missing": false,
  "vibration_level_was_missing": false,

  "episode_id": 12                        // increments on every system_status change
}
```

**Numeric fields are `number | null`.** They are almost always numbers — the
pipeline fills isolated dropouts — but a gap at the very start or end of the
stream, or one lasting more than one hour, is genuinely unfillable and arrives as
`null`. Keep your null handling.

---

## 2. `derived_alert`

The data team's rule engine, ported verbatim from their notebook and verified
cell-by-cell against their reference output. Exactly four values:

| Value | Condition (on calibrated values) |
|---|---|
| `"normal"` | none of the below |
| `"ventilation warning"` | `power_kw > 40` AND `airflow_m3s < 4.0` AND `vibration_level > 0.25` |
| `"plumbing warning"` | `water_pressure_kpa < 320` AND `water_flow_lps < 1.9` AND `vibration_level > 0.25` |
| `"critical / failure alert"` | `water_pressure_kpa < 100` OR `water_flow_lps < 0.3` OR `vibration_level > 0.85` |

Precedence when several match: critical > plumbing > ventilation.

> **This does not replace `src/lib/interpret.ts`.** Your rule engine reasons over
> a rolling window and predicts (the pressure ramp fires ~19 h before failure).
> `derived_alert` classifies a single row in isolation. They answer different
> questions — show both. Suggested framing: your interpretations drive the alert
> cards; `derived_alert` is a per-reading badge on the chart.

---

## 3. Endpoints

### `GET /readings?since=<id>`

Returns `Reading[]`, ascending by `id`.

- `since` is **exclusive** — you saw `id: 41`, you ask `?since=41`, you get 42+.
- Omit `since` for the full history.
- This is your `fetchHistory()`.

### `GET /readings/stream?since=<id>`

Server-Sent Events. One reading per frame:

```
id: 276
data: {"id":276,"timestamp":"2026-07-12T12:00:00", ...}
```

- The SSE `id:` field is the reading id, so browser `Last-Event-ID` resume works
  automatically on reconnect.
- Pass `?since=` to explicitly backfill anything you missed; the server sends the
  catch-up rows first, then live ones, with no gap or duplicate between them.
- `:heartbeat` comment frames arrive every 15 s. `EventSource` ignores them; they
  exist to stop Render's proxy idling out the connection. You do not handle these.
- This is your `subscribe()`.

### `GET /health`

`{ status, simSpeed, cleanedRows, latestTimestamp, subscribers, uptimeSeconds }`.
Useful for a "connected / stale" indicator in the header.

### `GET /meta`

Derived summaries — optional, but good material for the engineer view:

- `baseline` — per channel, `{ low_alert_threshold, normal_median, high_alert_threshold }`
  (5th percentile / median / 95th percentile across `stable` rows only).
  **Expanding window**: these tighten as more stable hours accumulate, so early
  in a run they come from a small sample.
- `episodes` — one row per contiguous `system_status` run, with start/end and
  duration. Good for incident shading on the control charts.
- `performance` — the alert rules scored against the dataset's ground-truth
  labels (`precision`, `recall`, `accuracy`). Demo material; a real deployment
  has no ground truth.

---

## 4. Changes needed in the dashboard

### 4.1 Fill in `HttpDataSource`

`src/services/dataSource/HttpDataSource.ts` already assumes these exact paths, so
this is mostly filling in the body. Two things to add:

- **Track the last seen `id`** and reconnect with `?since=<lastId>`. `EventSource`
  auto-reconnects, but an explicit `since` makes the backfill guaranteed rather
  than dependent on `Last-Event-ID` surviving the round trip.
- **Add an `onerror` handler.** On Render's free tier the service sleeps after
  15 min idle, so the stream *will* drop. Reconnecting is normal, not an error
  state — don't surface it as a failure unless it keeps failing.

Then set `VITE_DATA_SOURCE=http`. The factory in `services/dataSource/index.ts`
already switches on it; nothing else in the UI layer changes.

### 4.2 Widen `system_status`

`src/types/index.ts` currently allows `stable | warning | critical | failed`. The
schema also permits `'recovering'`. The July 2026 dataset happens to contain
none, so this is latent today — but a cleaned dataset that does contain one would
otherwise flow through as an unhandled value.

### 4.3 Add the new fields as optional

Add `derived_alert`, `alert_raised`, `pressure_calibrated`,
`water_pressure_kpa_raw`, the four `*_was_missing` flags and `episode_id` to
`SensorReading` as **optional** (`?:`). That keeps `CsvDataSource` compiling
against the same type, so the bundled replay still works as a fallback if the
backend is down during the demo.

### 4.4 Rework the `sensor-dropout` rule — this one matters

`src/lib/interpret.ts:170` detects dropouts by looking for `null` channels. **The
pipeline fills those nulls, so that rule will never fire against live data.**

Switch it to read the `*_was_missing` flags. The flags mark exactly the same six
readings the null check used to catch, so behaviour is preserved.

Keep the null branch as well — `CsvDataSource` still produces real nulls, and
`scripts/verify-rules.ts` runs against the raw bundled CSV. It must still report
`sensor-dropout ×6` when you're done.

**Does this change Cp/Cpk?** Only trivially, and not because of the flags —
`spc.ts` ignores non-numeric fields entirely. The interpolation itself raises Cpk
by +0.007–0.035 in the 24 h window after each of the six dropouts, because an
interpolated midpoint is smoother than a real reading so σ shrinks slightly.
Across all 144 affected windows, 4 cross a display band boundary (airflow
`marginal`→`good`, all sitting between 1.32 and 1.34). No action needed; noted so
it doesn't surprise you.

### 4.5 Local dev proxy

Add to `vite.config.ts` so local work needs no CORS and no env var:

```ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:8787', changeOrigin: true },
  },
},
```

### 4.6 Vercel

`VITE_API_BASE_URL` is inlined at **build time**, not read at runtime. It must be
set in Vercel project settings *before* the build, and changing it requires a
redeploy. The backend must also have your Vercel domain in its `CORS_ORIGIN` —
coordinate that with the backend owner.

---

## 5. Behaviour worth knowing

**The feed is 1-minute resolution, and fast.** The export is hourly; the
simulator synthesises the 59 minutes between each pair of source hours by linear
interpolation, so timestamps advance a minute at a time. Minute 0 of every hour
is still the source row byte-for-byte — only the rows between hours are
synthetic. Labels (`sound_event`, `system_status`, `sensor_source`) are held
across the hour rather than blended, since they are categorical.

Consequences you have to design for:

- **120 readings per second** at 1×, and **29,941 per pass**. Do not call
  setState (or its equivalent) per reading — buffer and commit on a timer. The
  dashboard flushes at 5 Hz.
- **Anything expressed in "readings" is now wrong by 60x.** A 24-reading window
  used to be 24 hours and is now 24 minutes. Derive samples-per-hour from the
  timestamps rather than assuming (the dashboard's `samplesPerHour()` does this,
  which is what lets the same thresholds serve both this feed and the hourly CSV
  fallback).
- **A single-reading event lasts ~8 ms of wall clock.** Any rule keyed on "the
  latest reading" will miss it, both because it is one frame and because batched
  commits mean most readings are never the latest. The six sensor dropouts are
  exactly this case.

**The stream runs one simulated minute behind.** The pipeline holds each row
until its successor arrives, because gap-filling interpolates from the readings
on both sides and the cleaned file is append-only — a row is published once and
never rewritten. At 1× that is ~8 ms. It is not a bug and not something you can
tune away from the client.

**Playback speed is a server setting** (`SIM_SPEED`, or `--speed` on the CLI).
The dashboard's existing pause control still works as a local pause — it
unsubscribes — but the simulator keeps running server-side, so resuming backfills
via `?since=`. If you want a true global pause, ask for a control endpoint.

**The simulator LOOPS the dataset.** It replays the whole run
(2026-07-01 00:00 → 2026-07-21 19:00), then clears the live history and starts
again. At 1× that is 120 simulated minutes per real second, so a full pass takes
~4 min 10 s. Set `SIM_LOOP=0` to stop at the end instead, and `SEED_ROWS` above 0
to open mid-dataset (in minute rows — an hour is 60).

**You MUST handle the `reset` SSE event.** The server sends:

```
event: reset
data: {}
```

whenever the history you are holding is no longer part of its timeline. Clear
every reading you hold when you see it, **and clear your resume cursor and any
duplicate-id guard with it** — see the freeze note below. `EventSource` does not
route named events to `onmessage`, so use `addEventListener('reset', …)`.

It fires in three situations:

1. **Mid-stream, on each loop** — the next reading carries the dataset's FIRST
   timestamp again, so a chart that kept the finished run would see its time
   axis jump backwards.
2. **At connect, when your `?since=` is ABOVE our latest id** — you outlived the
   process. Ids restart at 0 on boot (free tier, no persistent disk).
3. **At connect, when your `?since=` is BELOW our oldest id** — you were
   disconnected across a loop and so never received (1).

In cases 2 and 3 the reset is written before any catch-up frames, and we then
replay the whole of the current pass rather than a tail.

**Reading ids count up across loops but restart on reboot.** Within one process
they only ever increase (…498, 499, 500 with the timestamp back at 2026-07-01) —
deliberately, since ids are the `?since=` cursor and the dashboard drops ids it
has already seen, so restarting them per pass would make an entire pass look like
duplicate data. A **restart** is the exception: history is rebuilt from
`data/source/` and ids begin again at 0.

> **The freeze this caused.** A client that kept a cursor of, say, 594 across a
> restart got nothing from catch-up (the server had no such id) and then dropped
> every live row as a duplicate, because they arrived numbered 0, 1, 2 … — below
> its fence. The dashboard sat on its last timestamp, apparently "live", until
> the server's ids climbed back past 594 — about five minutes. Cases 2 and 3
> above exist to make that impossible; clearing your cursor on `reset` is the
> half of the fix that lives on the client.

**Cold start on Render's free tier takes ~30 s.** First request after an idle
period will hang while the service wakes. Worth a loading state.
