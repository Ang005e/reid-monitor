# reid-monitor — Claude Code context

Frontend for the Reid Library essential-systems dashboard (hackathon, Region 3:
Infrastructure Monitoring / "Cloudy's notes"). Vite + React 18 + TypeScript +
Apache ECharts. Frontend-only; the backend does not exist yet.

## Commands

- `npm run dev` — dev server
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run typecheck` — types only
- Rule-engine regression check (run after touching `src/lib/`):
  `npx esbuild scripts/verify-rules.ts --bundle --platform=node --alias:@=./src --outfile=/tmp/verify.cjs && node /tmp/verify.cjs`

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

## Backend seams — how to wire the real backend

1. **Data in**: implement `DataSource` (`services/dataSource/DataSource.ts`).
   An SSE-based `HttpDataSource` stub exists. Endpoints assumed:
   `GET /readings` → `SensorReading[]`, `GET /readings/stream` → SSE.
   Switch via `VITE_DATA_SOURCE=http` (factory in `services/dataSource/index.ts`).
2. **Alerts out**: `WebhookAlertChannel` stub POSTs `AppAlert` to `/alerts`.
   Register it in `services/alerts/index.ts` when the API lands.
3. The mock (`CsvDataSource`) replays `public/data/reid_library_sensor_data.csv`
   at 1 simulated hour / 1.5 s, serving the first 55% as instant history.
   The dataset will be REPLACED by the data-analysis team's cleaned version —
   only `lib/csv.ts` and the tuning constants should need review then.

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
