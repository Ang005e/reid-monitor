import type { MonitorState } from '@/state/useMonitor';
import { CHANNELS, CHANNEL_MAP } from '@/config/channels';
import { channelValue } from '@/lib/spc';
import { ControlChart } from './ControlChart';
import { CpkPanel } from './CpkPanel';
import { InterpretationCard } from './InterpretationCard';
import { ChatPanel } from './ChatPanel';

/** Raw-data layer: live control charts, capability panel, technical findings. */
export function EngineerView({ monitor }: { monitor: MonitorState }) {
  const { readings, stats, interpretations, latest } = monitor;
  const statsMap = new Map(stats.map((s) => [s.key, s]));

  return (
    <div className="view">
      {latest && (
        <div className="kpi-strip">
          {CHANNELS.map((cfg) => {
            const v = channelValue(latest, cfg.key);
            return (
              <div className="kpi" key={cfg.key}>
                <span className="kpi-label">{cfg.label}</span>
                <span className="kpi-value">
                  {v == null ? '∅' : v.toFixed(cfg.precision)}
                  <small> {cfg.unit}</small>
                </span>
              </div>
            );
          })}
          <div className="kpi">
            <span className="kpi-label">Source</span>
            <span className="kpi-value">{latest.sensor_source}</span>
          </div>
        </div>
      )}

      {interpretations.length > 0 && (
        <section className="cards">
          {interpretations.map((i) => (
            <InterpretationCard key={i.ruleId} item={i} mode="engineer" />
          ))}
        </section>
      )}

      <CpkPanel stats={stats} />

      <div className="chart-grid">
        {CHANNELS.map((cfg) => (
          <ControlChart
            key={cfg.key}
            cfg={CHANNEL_MAP[cfg.key]}
            stats={statsMap.get(cfg.key)}
            readings={readings}
          />
        ))}
      </div>

      {/*
        Also rendered in CommunityView. Before the login gate existed every user
        landed on the community view and therefore saw the chat; engineers now
        open straight into this view, so it lives in both to keep it reachable.
      */}
      <ChatPanel monitor={monitor} />
    </div>
  );
}
