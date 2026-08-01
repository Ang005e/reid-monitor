/**
 * Headless verification: replay the bundled dataset through the rule engine
 * and print when each rule fires. Run with:
 *   npx esbuild scripts/verify-rules.ts --bundle --platform=node \
 *     --alias:@=./src --outfile=/tmp/verify.cjs && node /tmp/verify.cjs
 *
 * Expected against the July 2026 export:
 *  - pressure-ramp fires early in the Jul 5 and Jul 15 valve incidents
 *  - efficiency-collapse fires during the Jul 10 and Jul 18–20 fan incidents
 *  - vibration-band tracks warning/critical periods
 *  - temperature-drop fires only during the two "failed" windows
 *  - sensor-dropout fires exactly 6 times
 *  - NO warning/critical rule fires during quiet stable stretches
 */
import { readFileSync } from 'node:fs';
import { parseSensorCsv } from '@/lib/csv';
import { interpret } from '@/lib/interpret';
import { ROLLING_WINDOW } from '@/config/channels';

const csv = readFileSync('public/data/reid_library_sensor_data.csv', 'utf8');
const rows = parseSensorCsv(csv);

const firing = new Map<string, { from: string; to: string }[]>();
const active = new Map<string, { from: string; to: string }>();

for (let i = 1; i <= rows.length; i++) {
  const window = rows.slice(Math.max(0, i - ROLLING_WINDOW), i);
  const results = interpret(window);
  const now = new Set(results.map((r) => r.ruleId));
  const ts = rows[i - 1].timestamp;

  for (const id of now) {
    if (!active.has(id)) active.set(id, { from: ts, to: ts });
    else active.get(id)!.to = ts;
  }
  for (const [id, span] of [...active]) {
    if (!now.has(id)) {
      if (!firing.has(id)) firing.set(id, []);
      firing.get(id)!.push(span);
      active.delete(id);
    }
  }
}
for (const [id, span] of active) {
  if (!firing.has(id)) firing.set(id, []);
  firing.get(id)!.push(span);
}

for (const [id, spans] of firing) {
  console.log(`\n${id} (${spans.length} span${spans.length === 1 ? '' : 's'}):`);
  for (const s of spans) console.log(`  ${s.from} → ${s.to}`);
}
