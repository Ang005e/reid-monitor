import type { ChannelStats } from '@/types';
import { CHANNEL_MAP } from '@/config/channels';
import { cpkBand } from '@/lib/spc';

const BAND_LABEL: Record<string, string> = {
  good: 'capable (≥1.33)',
  marginal: 'marginal (1.00–1.33)',
  poor: 'not capable (<1.00)',
  unknown: 'insufficient data',
};

/**
 * Rolling-window process capability per channel.
 * Cpk < 1 means the process is drifting toward (or past) its spec limits —
 * the "investigate" signal for engineers.
 */
export function CpkPanel({ stats }: { stats: ChannelStats[] }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Process capability — rolling 24 h window</span>
      </div>
      <div className="cpk-rows">
        {stats.map((s) => {
          const cfg = CHANNEL_MAP[s.key];
          const band = cpkBand(s.cpk);
          const width = s.cpk == null ? 0 : Math.max(2, Math.min(100, (s.cpk / 2) * 100));
          return (
            <div className="cpk-row" key={s.key} title={BAND_LABEL[band]}>
              <span className="cpk-label">{cfg.label}</span>
              <div className="cpk-bar-track">
                <div className={`cpk-bar cpk-bg-${band}`} style={{ width: `${width}%` }} />
                <div className="cpk-marker" style={{ left: '50%' }} title="Cpk = 1.0" />
                <div className="cpk-marker faint" style={{ left: '66.5%' }} title="Cpk = 1.33" />
              </div>
              <span className={`cpk-chip cpk-${band}`}>
                {s.cpk != null ? s.cpk.toFixed(2) : '—'}
              </span>
            </div>
          );
        })}
      </div>
      <p className="hint">
        Bars scale to Cpk 2.0. Markers at 1.0 (minimum) and 1.33 (industry target). Spec
        limits are set in <code>src/config/channels.ts</code>.
      </p>
    </div>
  );
}
