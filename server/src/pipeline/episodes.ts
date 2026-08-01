import type { CleanedReading, EpisodeSummary, SystemStatus } from '../types.js';

/**
 * Episode segmentation — port of notebook cell 15:
 *
 *   status_changed = system_status != system_status.shift()
 *   episode_id     = status_changed.cumsum()
 *
 * A new episode begins whenever the status label changes, so consecutive rows
 * sharing a status collapse into one incident. The batch version is a cumsum
 * over the whole frame; streaming it is just a running counter, which is why
 * this is the one piece of the notebook that needed no rethinking.
 *
 * Note the first row always counts as a change (pandas compares against NaN),
 * so ids start at 1 — matching failure_episode_summary.csv.
 */
export class EpisodeTracker {
  private lastStatus: SystemStatus | null = null;
  private currentId = 0;

  /** Returns the episode id for a row, advancing the counter on a status change. */
  next(status: SystemStatus): number {
    if (status !== this.lastStatus) {
      this.currentId += 1;
      this.lastStatus = status;
    }
    return this.currentId;
  }

  get episodeId(): number {
    return this.currentId;
  }
}

/**
 * Rolls readings up into one row per episode, for /api/meta.
 *
 * `duration_hours` counts readings inclusively (a 12-reading episode is 12 h),
 * matching the notebook's `+ 1` on the end-minus-start difference.
 */
export function summariseEpisodes(readings: readonly CleanedReading[]): EpisodeSummary[] {
  const byEpisode = new Map<number, CleanedReading[]>();
  for (const r of readings) {
    const bucket = byEpisode.get(r.episode_id);
    if (bucket) bucket.push(r);
    else byEpisode.set(r.episode_id, [r]);
  }

  return [...byEpisode.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([episode_id, rows]) => {
      const first = rows[0];
      const last = rows[rows.length - 1];
      if (first === undefined || last === undefined) return [];
      return [
        {
          episode_id,
          start: first.timestamp,
          end: last.timestamp,
          status: first.system_status,
          sound: first.sound_event,
          readings: rows.length,
          duration_hours: rows.length,
        } satisfies EpisodeSummary,
      ];
    });
}
