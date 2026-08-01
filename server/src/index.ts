import { DATA_DIR, PORT, SIM_SPEED } from './config.js';
import { PipelineRunner } from './pipeline/index.js';
import { startApiServer } from './api/server.js';
import { startSimulator } from './simulator/index.js';
import { ReadingStore } from './store.js';

/**
 * Main entrypoint — boots the three stages in one process.
 *
 * They are separate units with no direct coupling: the simulator only writes a
 * file, the pipeline only reads that file, and the API only reads the store. The
 * single wire between them here (`onTick` -> `poll`) is a latency optimisation,
 * not a dependency — the pipeline polls the file anyway, so the simulator could
 * equally run as its own process or on another machine.
 */

function main(): void {
  const store = new ReadingStore();

  // Order matters: the pipeline must restore prior history and hydrate the store
  // before the API starts serving, or the first client sees an empty dataset.
  const pipeline = new PipelineRunner(store);
  pipeline.start();

  const simulator = startSimulator();

  // Nudge the pipeline the moment rows land rather than waiting out the poll
  // interval, so the dashboard sees a new reading promptly at high speeds.
  simulator.onTick(() => pipeline.poll());

  // Dataset exhausted: flush the held row, wipe the published history, and let
  // the next pass begin. Fires before the raw file is truncated.
  simulator.onLoop(() => pipeline.resetForLoop());

  startApiServer(store);

  console.log(
    `[server] ready — port ${PORT}, speed ${SIM_SPEED}x, data ${DATA_DIR}\n` +
      `[server] ${store.count} reading(s) available at boot`,
  );

  const shutdown = (signal: string): void => {
    console.log(`\n[server] ${signal} — shutting down`);
    simulator.stop();
    pipeline.stop();
    // Publish anything still held for lookahead so the cleaned file ends in a
    // consistent state rather than one row short of the raw file.
    pipeline.flush();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
