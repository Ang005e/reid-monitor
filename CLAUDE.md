# reid-monitor — Claude Code context

Frontend for the Reid Library essential-systems dashboard (hackathon, Region 3:
Infrastructure Monitoring / "Cloudy's notes"). Vite + React 18 + TypeScript +
Apache ECharts. The backend now exists in `server/` and the dashboard runs
against it by default — `server/API_CONTRACT.md` is the authoritative contract.

## Commands

- `npm run dev` — dev server. Needs the backend running (below) unless you set
  `VITE_DATA_SOURCE=csv` to fall back to the bundled replay.
- `cd server && npm run dev` — backend on :8787 (simulator + pipeline + API).
  `vite.config.ts` proxies `/api` to it, so local dev needs no CORS or env vars.
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run typecheck` — types only
- Rule-engine regression check (run after touching `src/lib/`):
  `npx esbuild scripts/verify-rules.ts --bundle --platform=node --alias:@=./src --outfile=/tmp/verify.cjs && node /tmp/verify.cjs`
- `cd server && npm run parity` — confirms the backend still matches the data
  team's reference export. Run it before blaming the frontend for bad numbers.

## Architecture (what depends on what)

```
config/channels.ts   channel metadata, spec limits (Cp/Cpk), tuning constants
types/index.ts       domain types = the backend contract
lib/csv.ts           CSV parsing (dies when backend serves JSON)
lib/spc.ts           mean/σ/slope, control limits, Cp/Cpk, cpk bands
lib/interpret.ts     RULE ENGINE — Cloudy's patterns as executable rules
services/dataSource/ BACKEND SEAM #1 (data in)
services/alerts/     BACKEND SEAM #2 (alerts out)
state/useMonitor.ts  central hook: stream → stats → interpretations → alerts
state/ViewModeContext.tsx  engineer|community toggle
components/          presentational; consume MonitorState, never services directly
```

Dependency rule: components → state → lib/services → config/types. Never skip
layers upward (e.g. components must not import services).

## Backend seams

1. **Data in — WIRED.** `HttpDataSource` implements `DataSource` against
   `GET /readings`, `GET /readings/stream` (SSE), `GET /meta`, `GET /health`.
   Selected by `VITE_DATA_SOURCE=http` (factory in `services/dataSource/index.ts`).

   **The `since` cursor is load-bearing.** Both `GET /readings` and the SSE
   stream return the FULL history when given no cursor. So the stream must be
   opened with `?since=<last id seen>`, which means history must finish loading
   before subscribing — `useMonitor` gates the subscribe effect on that, and
   also drops any reading whose id it has already appended. Remove either guard
   and every reading arrives twice, silently corrupting the SPC stats and
   firing every rule twice. This also makes pause/resume safe, since resuming
   backfills.

   `reconnecting` is a normal state, not an error: the deployed backend sleeps
   when idle and `EventSource` retries on its own.

2. **Alerts out — BLOCKED, do not "fix" by wiring it up.** `WebhookAlertChannel`
   POSTs to `/alerts`, but the backend has no such route (`server/src/api/routes.ts`
   404s anything unmatched). It is deliberately NOT registered in
   `services/alerts/index.ts`; registering it makes every warning/critical alert
   fire a failed POST. Ask the backend owner for `POST /api/alerts` first.
   Browser notifications are unaffected.

3. **Fallback.** `CsvDataSource` replays `public/data/reid_library_sensor_data.csv`
   at 1 simulated hour / 1.5 s, serving the first 55% as instant history. Keep it
   working — it is the demo fallback if the backend is down. This is why every
   backend-only field on `SensorReading` is optional.

## Backend data differs from the CSV in ways that matter

- **Nulls are gap-filled.** The pipeline interpolates dropouts in four channels
  (airflow, pressure, water flow, vibration) and marks them with
  `*_was_missing` flags. `power_kw` and `temperature_c` are never interpolated
  and still arrive as real nulls. The `sensor-dropout` rule reads BOTH the flags
  and literal nulls for this reason — don't simplify it to one branch.
- **Pressure is calibrated.** `water_pressure_kpa` has the Barry J offset
  removed; `water_pressure_kpa_raw` keeps the original for audit.
- **`derived_alert`** is the data team's single-row classifier. It does NOT
  replace `lib/interpret.ts`, which reasons over a rolling window and predicts
  ~19 h ahead. Show both; they answer different questions.
- **The stream runs one simulated hour behind** (the pipeline needs the next row
  to interpolate). Not a bug, not tunable from the client.
- **Playback speed is a server setting** (`SIM_SPEED`). The pause button is a
  local pause only — the simulator keeps running.

## Domain facts the code encodes (validated against the July 2026 dataset)

- Stable baselines: pressure 351.4±12.0 kPa, airflow/power ratio 0.0941±0.0020,
  vibration 0.150±0.029, temp 19.0±0.5 °C. Power↔airflow r=0.991 when healthy.
- Valve failures (Jul 5, 15): pressure ramps −9.7 kPa/h for ~21 h before failure.
- Fan faults (Jul 10, 18): ratio collapses <0.086, pressure flat, self-resolves ~30 h.
- Sound labels map 1:1 to vibration bands: ≤0.25 normal, ≤0.46 hum, else rattle.
- Temperature is a LAGGING signal: drops to ~15 °C only after status=failed.
- 6 sensor dropouts in the dataset, all in stable periods (not precursors).
- Rows from `sensor_source=barry_j_` read pressure ~8.7 kPa and airflow
  ~0.14 m³/s high vs `original` — recalibrate thresholds on source change.

## Rule tuning

All thresholds live at the top of `lib/interpret.ts` and in `config/channels.ts`.
`pressure-ramp` uses slope ≤ −5 kPa/h over 8 h + level ≤ 340 kPa + 2 h
persistence; verified to fire exactly twice on the reference dataset (the two
real valve events, ~19 h ahead) with zero false positives. Keep it that way:
rerun the verify script after any change.

## Conventions

- Path alias `@/` → `src/`.
- No UI framework — hand-rolled CSS in `src/index.css` (design tokens in `:root`).
- Every `Interpretation` carries engineer AND community copy; the view mode
  picks which side renders. Don't fork rules per audience.
- localStorage/sessionStorage are fine here (this is a normal Vite app).
