import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppAlert,
  ChannelStats,
  ConnectionStatus,
  HealthResponse,
  Interpretation,
  MetaResponse,
  SensorReading,
} from '@/types';
import { CHANNELS, ROLLING_WINDOW } from '@/config/channels';
import { computeChannelStats, stableBaseline } from '@/lib/spc';
import { interpret } from '@/lib/interpret';
import { createDataSource } from '@/services/dataSource';
import { alertDispatcher } from '@/services/alerts';

/**
 * Central monitoring state: readings stream, SPC stats, interpretations, alerts.
 * All backend coupling lives behind services/ — this hook only consumes the
 * DataSource + AlertDispatcher interfaces.
 *
 * ## Effect ordering and the cold-start race (FIX 1)
 *
 * The original code ran two independent effects:
 *   1. fetchHistory()  — async, resolves after the backend wakes (~30 s free tier)
 *   2. subscribe()     — fires synchronously on mount, BEFORE (1) resolves
 *
 * Against the HTTP backend both paths return everything when given no cursor:
 * GET /readings returns the full history; GET /readings/stream replays everything
 * before going live. With no cursor, effect (2) was racing effect (1) and every
 * reading arrived twice, doubling every SPC stat and firing every rule twice.
 *
 * Fix has two layers:
 *   a) `historyReady` gate: the subscribe effect depends on `historyReady`, so
 *      it cannot connect until fetchHistory() has settled. By then
 *      HttpDataSource.lastId is set and the SSE ?since= cursor is correct.
 *   b) Client-side id fence: when appending a streamed reading we drop any whose
 *      id is ≤ the last id we have appended. This covers pause/resume backfills
 *      (the ?since= overlap) and any future scenario where the server re-delivers
 *      a row we already have.
 *
 * ## Cold-start error handling (FIX 2)
 *
 * Render's free tier takes ~30 s to wake. A fetchHistory() failure used to leave
 * the dashboard empty forever with no feedback. Now we expose `loading`,
 * `loadError`, and `retryHistory` so the UI can show a spinner, an error banner,
 * and a Retry button.
 *
 * ## Connection status, meta, and health (FIX 3)
 *
 * `connectionStatus` is threaded from DataSource.subscribe's optional `onStatus`
 * callback through to the return value, powering the header status badge.
 * `meta` is fetched once after history resolves and exposes per-channel baselines,
 * episode history, and rule-performance scores for the engineer view.
 * `health` is polled every 30 s to surface subscriber count, uptime, etc.
 * Both are guarded with `?.()` so CsvDataSource (which lacks these methods)
 * continues to work as the demo fallback.
 */
export function useMonitor() {
  const dataSourceRef = useRef(createDataSource());
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [paused, setPaused] = useState(false);
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const activeRulesRef = useRef<Set<string>>(new Set());
  const alertSeq = useRef(0);

  // --- FIX 2: loading / error state -----------------------------------------

  /** True while fetchHistory() is in-flight or on cold start before it settles. */
  const [loading, setLoading] = useState(true);
  /** Non-null when fetchHistory() has failed. Cleared on retry. */
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Flips to true after a successful fetchHistory(). Gates the subscribe effect
   * (FIX 1a) and the meta/health effects so they never run before we have a
   * cursor and a baseline dataset.
   */
  const [historyReady, setHistoryReady] = useState(false);
  /**
   * Incremented by retryHistory(). The history effect lists this in its deps so
   * bumping it re-triggers a fresh fetch without re-creating the DataSource.
   */
  const [retryCount, setRetryCount] = useState(0);

  // --- FIX 3: live connection metadata ---------------------------------------

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  // --- FIX 1b: id fence ------------------------------------------------------

  /**
   * Highest reading id we have actually appended to `readings`. Maintained as a
   * ref (not state) because changes to it must NOT trigger a re-render — it is
   * write-only plumbing used only inside the subscribe callback to drop
   * duplicates.
   */
  const lastAppendedId = useRef<number | null>(null);

  // ---------------------------------------------------------------------------
  // History fetch
  // ---------------------------------------------------------------------------
  // retryCount is the only dep: a bump re-runs this effect without touching any
  // other state. The `cancelled` flag prevents stale async continuations from
  // writing state after either unmount or a quick double-retry.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    dataSourceRef.current
      .fetchHistory()
      .then((rows) => {
        if (cancelled) return;
        setReadings(rows);
        // Seed the id fence so subscribe() (which runs next) knows where history ends.
        lastAppendedId.current = rows.length > 0 ? rows[rows.length - 1].id : null;
        setHistoryReady(true);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        // historyReady stays false → subscribe won't connect → no dangling SSE.
      });

    return () => {
      cancelled = true;
    };
  }, [retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Re-attempts the history fetch after a failure. Resets all derived state so
   * the UI shows a clean loading screen. The existing subscribe, if any, is
   * closed by the subscribe effect's cleanup when historyReady flips to false.
   */
  const retryHistory = useCallback(() => {
    lastAppendedId.current = null;
    setReadings([]);
    setHistoryReady(false); // closes the stream (subscribe effect cleanup runs)
    setLoadError(null);
    setLoading(true);
    setRetryCount((c) => c + 1); // triggers the history effect
  }, []);

  // ---------------------------------------------------------------------------
  // Live subscription (FIX 1a — gated on historyReady)
  // ---------------------------------------------------------------------------
  // pause = unsubscribe; CsvDataSource stops its replay timer.
  // historyReady = false prevents connecting before the cursor is set, which
  // would cause the server to replay the full history on top of what fetchHistory
  // already returned (see the "Effect ordering" note at the top of this file).
  useEffect(() => {
    if (paused || !historyReady) return;

    const unsubscribe = dataSourceRef.current.subscribe(
      (reading) => {
        // FIX 1b: drop any id we have already appended.
        // Covers: (a) the initial fetchHistory/stream overlap on cold connect,
        // (b) pause-resume backfills via ?since= that overlap with existing state.
        if (lastAppendedId.current !== null && reading.id <= lastAppendedId.current) {
          return;
        }
        lastAppendedId.current = reading.id;
        setReadings((prev) => [...prev, reading]);
      },
      (status) => setConnectionStatus(status),
      // The server sends `reset` when what we hold is no longer part of its
      // timeline: the simulator looped back to the dataset's first timestamp,
      // or the backend restarted (no persistent disk on the free tier, so ids
      // begin again at 0). Either way we drop everything — otherwise the charts
      // keep a finished run and the time axis jumps backwards mid-series.
      //
      // lastAppendedId MUST be cleared with it. Ids climb across a loop but NOT
      // across a restart, so leaving the fence at a high-water mark from the
      // previous timeline makes it discard every reading that follows, and the
      // dashboard sits frozen on its last timestamp until the server's ids
      // happen to climb past it. Post-reset the server replays from the start
      // of the current pass, so there is nothing left for the fence to protect.
      //
      // Rule state is cleared too, so an alert that was firing at the end of
      // the previous pass re-fires (and re-notifies) when it recurs in the new
      // one, instead of being suppressed as "already active".
      () => {
        setReadings([]);
        lastAppendedId.current = null;
        activeRulesRef.current = new Set();
      },
    );

    return unsubscribe;
  }, [paused, historyReady]);

  // ---------------------------------------------------------------------------
  // /meta — fetched once after history resolves (FIX 3)
  // ---------------------------------------------------------------------------
  // fetchMeta is optional on the DataSource interface so that CsvDataSource
  // (which lacks it) keeps working as a demo fallback. The ?. guard makes that
  // explicit at the call site rather than relying on runtime duck-typing.
  useEffect(() => {
    if (!historyReady) return;
    void dataSourceRef.current
      .fetchMeta?.()
      .then(setMeta)
      .catch(() => {
        // Meta is supplementary; a failure doesn't disrupt the dashboard.
      });
  }, [historyReady]);

  // ---------------------------------------------------------------------------
  // /health — polled every 30 s after history resolves (FIX 3)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!historyReady) return;
    const { fetchHealth } = dataSourceRef.current;
    if (!fetchHealth) return; // CsvDataSource: bail out cleanly

    // Bind so `this` is correct inside the method even though we've destructured.
    const pollHealth = fetchHealth.bind(dataSourceRef.current);

    const tick = () => {
      void pollHealth()
        .then(setHealth)
        .catch(() => {
          // Health poll failures are silent; the last known value persists.
        });
    };

    tick(); // fetch immediately, then on every interval
    const intervalId = setInterval(tick, 30_000);
    return () => clearInterval(intervalId);
  }, [historyReady]);

  // ---------------------------------------------------------------------------
  // SPC stats
  // ---------------------------------------------------------------------------
  // Control limits from the stable baseline, Cp/Cpk from the rolling window.
  const stats: ChannelStats[] = useMemo(() => {
    if (readings.length === 0) return [];
    const baseline = stableBaseline(readings);
    const window = readings.slice(-ROLLING_WINDOW);
    return CHANNELS.map((cfg) => computeChannelStats(cfg, baseline, window));
  }, [readings]);

  // ---------------------------------------------------------------------------
  // Rule engine
  // ---------------------------------------------------------------------------
  const interpretations: Interpretation[] = useMemo(
    () => interpret(readings.slice(-ROLLING_WINDOW)),
    [readings],
  );

  // ---------------------------------------------------------------------------
  // Alert pipeline
  // ---------------------------------------------------------------------------
  // A rule firing anew (not already active) creates + dispatches an alert.
  useEffect(() => {
    const firing = new Set(interpretations.map((i) => i.ruleId));
    const newOnes = interpretations.filter((i) => !activeRulesRef.current.has(i.ruleId));
    activeRulesRef.current = firing;
    if (newOnes.length === 0) return;

    const created: AppAlert[] = newOnes.map((i) => ({
      ...i,
      id: `alert-${++alertSeq.current}`,
      acknowledged: false,
      createdAt: new Date().toISOString(),
    }));
    setAlerts((prev) => [...created, ...prev].slice(0, 100));
    created.forEach((a) => {
      if (a.severity === 'warning' || a.severity === 'critical') {
        void alertDispatcher.dispatch(a);
      }
    });
  }, [interpretations]);

  const acknowledgeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  }, []);

  const enableNotifications = useCallback(async () => {
    await alertDispatcher.init();
    setNotificationsReady(alertDispatcher.isReady('browser-notification'));
  }, []);

  return {
    // --- existing fields (unchanged names) ---
    readings,
    latest: readings[readings.length - 1] ?? null,
    stats,
    interpretations,
    alerts,
    acknowledgeAlert,
    paused,
    setPaused,
    notificationsReady,
    enableNotifications,
    sourceLabel: dataSourceRef.current.describe(),
    // --- new fields (FIX 2 + FIX 3) ---
    /** True while the initial history fetch (or a retry) is in-flight. */
    loading,
    /** Error message from the last failed fetchHistory(), or null. */
    loadError,
    /** Re-attempts fetchHistory() after a failure; resets all derived state. */
    retryHistory,
    /** EventSource lifecycle state, fed by HttpDataSource's onStatus callback. */
    connectionStatus,
    /** Per-channel baselines, episode history, and rule-performance scorecard. */
    meta,
    /** Backend health snapshot, polled every 30 s. */
    health,
  };
}

export type MonitorState = ReturnType<typeof useMonitor>;
