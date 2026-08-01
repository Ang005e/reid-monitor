import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppAlert, ChannelStats, Interpretation, SensorReading } from '@/types';
import { CHANNELS, ROLLING_WINDOW } from '@/config/channels';
import { computeChannelStats, stableBaseline } from '@/lib/spc';
import { interpret } from '@/lib/interpret';
import { createDataSource } from '@/services/dataSource';
import { alertDispatcher } from '@/services/alerts';

/**
 * Central monitoring state: readings stream, SPC stats, interpretations, alerts.
 * All backend coupling lives behind services/ — this hook only consumes the
 * DataSource + AlertDispatcher interfaces.
 */
export function useMonitor() {
  const dataSourceRef = useRef(createDataSource());
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [paused, setPaused] = useState(false);
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const activeRulesRef = useRef<Set<string>>(new Set());
  const alertSeq = useRef(0);

  // Initial history load.
  useEffect(() => {
    let cancelled = false;
    dataSourceRef.current.fetchHistory().then((rows) => {
      if (!cancelled) setReadings(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live subscription (pause = unsubscribe; CsvDataSource stops its replay timer).
  useEffect(() => {
    if (paused) return;
    const unsubscribe = dataSourceRef.current.subscribe((reading) => {
      setReadings((prev) => [...prev, reading]);
    });
    return unsubscribe;
  }, [paused]);

  // SPC stats: control limits from the stable baseline, Cp/Cpk from the rolling window.
  const stats: ChannelStats[] = useMemo(() => {
    if (readings.length === 0) return [];
    const baseline = stableBaseline(readings);
    const window = readings.slice(-ROLLING_WINDOW);
    return CHANNELS.map((cfg) => computeChannelStats(cfg, baseline, window));
  }, [readings]);

  // Rule engine over the recent window.
  const interpretations: Interpretation[] = useMemo(
    () => interpret(readings.slice(-ROLLING_WINDOW)),
    [readings],
  );

  // Alert pipeline: a rule firing anew (not already active) creates + dispatches an alert.
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
  };
}

export type MonitorState = ReturnType<typeof useMonitor>;
