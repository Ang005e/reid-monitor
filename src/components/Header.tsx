import type { ViewMode } from '@/types';

export function Header({
  mode,
  onModeChange,
  canUseEngineerView,
  paused,
  onTogglePaused,
  sourceLabel,
  lastTimestamp,
  userName,
  role,
  onSignOut,
}: {
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  canUseEngineerView: boolean;
  paused: boolean;
  onTogglePaused: () => void;
  sourceLabel: string;
  lastTimestamp: string | null;
  userName: string;
  role: string;
  onSignOut: () => void;
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
        {canUseEngineerView && (
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
        )}
        <div className="user-chip">
          <span className="user-name">{userName}</span>
          <span className="user-role">{role}</span>
        </div>
        <button className="btn btn-small" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
