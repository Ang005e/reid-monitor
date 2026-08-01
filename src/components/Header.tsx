import type { ViewMode } from '@/types';

export function Header({
  mode,
  onModeChange,
  paused,
  onTogglePaused,
  sourceLabel,
  lastTimestamp,
}: {
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  paused: boolean;
  onTogglePaused: () => void;
  sourceLabel: string;
  lastTimestamp: string | null;
}) {
  return (
    <header className="header">
      <div className="header-title">
        <h1>Reid Library · Essential Systems</h1>
        <span className="source-label" title={sourceLabel}>
          <span className={`live-dot ${paused ? 'paused' : ''}`} />
          {paused ? 'paused' : 'live'}
          {lastTimestamp && ` · ${new Date(lastTimestamp).toLocaleString()}`}
        </span>
      </div>
      <div className="header-actions">
        <button className="btn" onClick={onTogglePaused}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <div className="mode-toggle" role="tablist" aria-label="View mode">
          <button
            role="tab"
            aria-selected={mode === 'community'}
            className={mode === 'community' ? 'active' : ''}
            onClick={() => onModeChange('community')}
          >
            Community
          </button>
          <button
            role="tab"
            aria-selected={mode === 'engineer'}
            className={mode === 'engineer' ? 'active' : ''}
            onClick={() => onModeChange('engineer')}
          >
            Engineer
          </button>
        </div>
      </div>
    </header>
  );
}
