# reid-monitor backend

Turns the static July 2026 sensor export into a live feed, runs the data team's
cleaning pipeline over it continuously, and serves the result to the dashboard.

Self-contained: its own `package.json`, its own copy of the source data, zero
runtime dependencies. Nothing here imports from the frontend's `src/`.

```
data/source/reid_library_sensor_data.csv    committed, read-only — the static dataset
        │  simulator     one row per simulated hour, --speed 1|2|5…
        ▼
data/live/raw-sensor-data.csv               append-only history
        │  pipeline      cleans, calibrates, segments, alerts
        ▼
data/live/cleaned-sensor-data.csv           append-only history
        │  api           REST + SSE on :8787
        ▼
dashboard
```

Both live CSVs are **append-only**. Nothing in normal operation rewrites or
truncates a published line — that constraint is what shapes the pipeline design
(see "One-hour lag" below).

## Run

```bash
npm install
npm run dev              # simulator + pipeline + API together
npm run dev -- --speed 5 # 5× playback
```

Then:

```bash
curl localhost:8787/api/health
curl "localhost:8787/api/readings?since=270" | head
curl -N localhost:8787/api/readings/stream
```

The frontend connects with `VITE_DATA_SOURCE=http`. See **API_CONTRACT.md** —
that is the document to hand to whoever is changing the dashboard.

### Individual processes

Useful when debugging one stage in isolation:

```bash
npm run simulator -- --speed 5 --seed-rows 100
npm run simulator -- --reset      # DESTROYS live history, replays from scratch
npm run simulator -- --once       # emit exactly one row and exit
```

## Verify

```bash
npm run parity      # the gate — see below
npm run typecheck
```

### The parity gate

`npm run parity` is the acceptance test for the whole port. The pipeline is a
TypeScript rewrite of the data team's pandas notebook (`data_analysis.ipynb` on
the `data-pipeline` branch), and parity is what proves the rewrite is faithful.
It checks three things:

1. **Batch output vs the notebook's committed export** — all 500 rows × 13 shared
   columns, cell by cell, against `fixtures/reid_library_dashboard_data.csv`.
2. **Streaming output vs batch output** — the live path must not drift from the
   offline definition.
3. **The alert-rule scorecard** against `fixtures/alert_rule_performance.csv`.

Run it after touching anything in `src/pipeline/` or `src/config.ts`. All
thresholds live in `src/config.ts`; changing one will fail parity, which is the
point — re-baseline the fixtures deliberately, never silently.

**One known tolerance.** Comparison is numeric with a 1e-9 tolerance rather than
string-exact. One cell needs it: the interpolated pressure at `2026-07-03 07:00`
is `349.09999999999997` in the data team's export where pandas 2.2.3 produces
`349.1` — a 5.7e-14 difference from their numpy build's rounding. No arithmetic
ordering reproduces it, and it is far below the sensor's 3-decimal resolution.
Every other cell matches exactly.

## What the pipeline does

Ported from the notebook, in this order — the order matters, since the alert
rules must see calibrated pressure:

| Stage | File | Notebook cell |
|---|---|---|
| Gap filling — `interpolate(method="time", limit=1, limit_area="inside")` | `pipeline/clean.ts` | 9 |
| Barry J calibration — pressure − 10 kPa on non-`original` sources | `pipeline/calibrate.ts` | 13 |
| Episode segmentation — running counter on `system_status` change | `pipeline/episodes.ts` | 15 |
| Stable baseline — 5th / median / 95th percentile of `stable` rows | `pipeline/baseline.ts` | 17 |
| Alert rules → `derived_alert` | `pipeline/alerts.ts` | 18 |
| Scorecard vs ground-truth labels | `pipeline/performance.ts` | 21 |

Two deliberate departures from the notebook, both documented at the call site:

- **The `*_was_missing` flags are exported.** The notebook computes them at cell 9
  and drops them at cell 22. Without them the dashboard cannot see dropouts at
  all, because the pipeline has filled every null.
- **`water_pressure_kpa_raw` is kept**, so Barry J's correction is auditable.

Neither affects the 13 columns parity compares.

### One-hour lag

`limit_area="inside"` fills a gap from the readings on **both** sides, so row *N*
cannot be finalised until row *N+1* exists. Since the cleaned file is append-only
— published once, never rewritten — the pipeline holds every row back until its
successor lands. Applied uniformly, so latency is a constant one simulated hour
(1.5 s at 1×) and the streaming output is identical to the batch run rather than
subtly different around dropouts.

A gap longer than one hour is published as a genuine `null` instead of stalling
the stream behind a sensor that may never come back. All six dropouts in the
reference dataset are isolated single readings, so this never triggers on it.

### Rebuild-on-boot

The simulator is deterministic: given the source file and a row cursor it
reproduces `raw-sensor-data.csv` byte-for-byte. On boot the pipeline re-reads the
cleaned file, replays raw rows through a fresh pipeline, and discards anything
already on disk. A crash, a half-finished tick, or a wiped filesystem all
converge on the same correct state.

This is what makes an ephemeral host survivable — see Persistence below.

## Configuration

Copy `.env.example` to `.env`. Everything is env-driven; nothing is hardcoded to
a machine.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8787` | Render injects this automatically |
| `CORS_ORIGIN` | `http://localhost:5173` | **Must** be the Vercel domain in production |
| `SIM_SPEED` | `1` | Simulated hours per 1.5 s |
| `SEED_ROWS` | `275` | Rows written instantly on cold boot, so the dashboard opens with history |
| `SIM_RESET` | `0` | `1` wipes live history on boot |
| `DATA_DIR` | `./data/live` | Point at a mounted disk to persist history |

## Deploying to Render

Not provisioned here — the team is setting up hosting. These are the settings it
needs.

| Setting | Value |
|---|---|
| Root Directory | `server` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

### TODOs for whoever wires up hosting

- [ ] **Set `CORS_ORIGIN` to the Vercel domain.** The dashboard is cross-origin;
      `EventSource` will not connect without it. A `*` value is refused when
      `NODE_ENV=production` — set the real origin.
- [ ] **Set `VITE_API_BASE_URL` in Vercel** to `https://<service>.onrender.com/api`.
      It is inlined at build time, so it must be set *before* the build and needs
      a redeploy to change.
- [ ] **Decide on persistence.** Free tier has an ephemeral filesystem, so
      `data/live/` is wiped on every redeploy. History rebuilds deterministically
      on boot, so the demo is unaffected — but for history that genuinely
      survives, mount a Render disk and point `DATA_DIR` at it.
- [ ] **Know about spin-down.** Free instances sleep after 15 min idle. SSE
      connections drop and the simulator pauses. The client reconnects and
      backfills via `?since=`, but the first request after sleep takes ~30 s. A
      paid instance removes this.

`render.yaml` is deliberately not committed so it does not collide with the
hosting work already in progress.

## Layout

```
src/
  config.ts            ALL tuning constants + env + paths — the single tuning surface
  types.ts             domain types; CleanedReading is the wire contract
  store.ts             SEAM: in-memory index + subscriber hub. The API's only data dependency
  csv/                 parse, serialize (frozen column order), append-only helpers
  pipeline/            the notebook port + the long-running runner
  simulator/           static CSV -> live raw feed
  api/                 node:http REST + SSE
scripts/parity.ts      the acceptance gate
fixtures/              the data team's reference output, for parity
```

Dependency direction: `api` → `store` ← `pipeline` → `csv` → `config`/`types`.
The API never imports the pipeline, and neither imports the simulator.
