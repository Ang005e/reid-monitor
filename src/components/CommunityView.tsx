import type { MonitorState } from '@/state/useMonitor';
import { CHANNELS, SYSTEM_LABELS } from '@/config/channels';
import { channelValue, cpkBand } from '@/lib/spc';
import { StatusBanner } from './StatusBanner';
import { InterpretationCard } from './InterpretationCard';

const SYSTEM_ORDER = ['water', 'ventilation', 'power', 'environment'] as const;

/**
 * Interpreted layer for non-engineers: overall status, per-system health in
 * plain terms, and guidance cards (what it means / what to do / who to tell).
 */
export function CommunityView({ monitor }: { monitor: MonitorState }) {
  const { interpretations, latest, stats } = monitor;
  const statsMap = new Map(stats.map((s) => [s.key, s]));

  return (
    <div className="view">
      <StatusBanner interpretations={interpretations} latest={latest} />

      <div className="system-grid">
        {SYSTEM_ORDER.map((sys) => {
          const channels = CHANNELS.filter((c) => c.system === sys);
          // A system is "healthy" if no channel's rolling Cpk is poor.
          const worst = channels.reduce<'good' | 'marginal' | 'poor' | 'unknown'>(
            (acc, c) => {
              const band = cpkBand(statsMap.get(c.key)?.cpk ?? null);
              const rank = { poor: 3, marginal: 2, unknown: 1, good: 0 };
              return rank[band] > rank[acc] ? band : acc;
            },
            'good',
          );
          const face = worst === 'good' ? '●' : worst === 'marginal' ? '◐' : worst === 'poor' ? '○' : '·';
          const label =
            worst === 'good'
              ? 'Steady'
              : worst === 'marginal'
                ? 'Being watched'
                : worst === 'poor'
                  ? 'Needs attention'
                  : 'Limited data';
          return (
            <div className={`system-card sys-${worst}`} key={sys}>
              <div className="system-head">
                <span className={`sys-dot sys-dot-${worst}`}>{face}</span>
                <span className="system-name">{SYSTEM_LABELS[sys]}</span>
              </div>
              <span className="system-status">{label}</span>
              <div className="system-values">
                {channels
                  .filter((c) => !c.derived)
                  .map((c) => {
                    const v = latest ? channelValue(latest, c.key) : null;
                    return (
                      <span key={c.key}>
                        {c.label}: <strong>{v == null ? '—' : v.toFixed(c.precision)}</strong>{' '}
                        {c.unit}
                      </span>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>

      <section className="cards">
        {interpretations.length === 0 ? (
          <div className="card sev-info">
            <div className="card-head">
              <span className="card-title">Nothing needs your attention</span>
            </div>
            <p className="card-body">
              All systems are behaving the way they do on a good day. If you hear an unusual
              hum or rattle from the machinery, tell an engineer — the listeners have been
              right before.
            </p>
          </div>
        ) : (
          interpretations.map((i) => (
            <InterpretationCard key={i.ruleId} item={i} mode="community" />
          ))
        )}
      </section>
    </div>
  );
}
