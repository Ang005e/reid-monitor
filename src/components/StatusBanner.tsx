import type { Interpretation, SensorReading } from '@/types';
import { SEVERITY_ORDER } from '@/lib/interpret';

const OVERALL: Record<
  string,
  { label: string; message: string; cls: string }
> = {
  critical: {
    label: 'Action needed now',
    message: 'A serious problem is happening. Read the cards below and follow the guidance.',
    cls: 'banner-critical',
  },
  warning: {
    label: 'Early warning active',
    message: 'The systems are showing the warning signs Cloudy taught us to watch. There is time to act.',
    cls: 'banner-warning',
  },
  watch: {
    label: 'Keep an ear out',
    message: 'Something minor changed. Nothing to do yet — the engineers are aware.',
    cls: 'banner-watch',
  },
  ok: {
    label: 'All systems steady',
    message: 'Power, water and ventilation are behaving normally.',
    cls: 'banner-ok',
  },
};

export function StatusBanner({
  interpretations,
  latest,
}: {
  interpretations: Interpretation[];
  latest: SensorReading | null;
}) {
  const worst = interpretations.reduce<string>((acc, i) => {
    return SEVERITY_ORDER[i.severity] > SEVERITY_ORDER[acc as keyof typeof SEVERITY_ORDER]
      ? i.severity
      : acc;
  }, 'info');
  const key = worst === 'info' ? 'ok' : worst;
  const o = OVERALL[key] ?? OVERALL.ok;

  return (
    <div className={`banner ${o.cls}`}>
      <div className="banner-label">{o.label}</div>
      <div className="banner-message">{o.message}</div>
      {latest && (
        <div className="banner-meta">
          System reports: <strong>{latest.system_status}</strong> · machinery sounds:{' '}
          <strong>{latest.sound_event}</strong>
        </div>
      )}
    </div>
  );
}
