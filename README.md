# Reid Library · Essential Systems Monitor

Live dashboard connecting Cloudy's handwritten maintenance patterns to the
library's sensor data. Built for the Region 3 (Infrastructure Monitoring)
hackathon track.

Two audiences, one screen:

- **Community mode** (default) — overall status banner, per-system health in
  plain language, and guidance cards: *what this means · what to do · who to
  tell*. No engineering knowledge assumed.
- **Engineer mode** — live control charts (UCL/LCL from stable baseline,
  spec limits, incident shading), rolling 24 h Cp/Cpk capability panel, raw
  KPI strip, and technical rule detail.

Alerts fire on Cloudy's validated failure signatures (falling water pressure,
airflow/power efficiency collapse, vibration bands, post-failure cold) and
push to the device via browser notifications.

## Run

```bash
npm install
npm run dev
```

The app replays the July 2026 sensor export as simulated live data
(1 hour ≈ 1.5 s). Pause/resume from the header. Toggle Engineer/Community
top right. Click "Enable device notifications" in the Alerts panel to receive
device alerts.

## Verify the rule engine

```bash
npx esbuild scripts/verify-rules.ts --bundle --platform=node \
  --alias:@=./src --outfile=/tmp/verify.cjs && node /tmp/verify.cjs
```

Expected on the bundled dataset: `pressure-ramp` ×2 (the real valve failures,
~19 h early), `efficiency-collapse` ×4, `temperature-drop` ×2 (only the failed
windows), `sensor-dropout` ×6, `sensor-source-change` ×1, no false positives.

## Backend integration

The UI talks only to two interfaces — see `CLAUDE.md` ("Backend seams"):
`DataSource` (readings in) and `AlertChannel` (alerts out). Set
`VITE_DATA_SOURCE=http` + `VITE_API_BASE_URL` to switch off the CSV replay.
