import type { ViewMode, ConnectionStatus, HealthResponse } from '@/types';

/** Maps connection state + pause flag to a dot modifier class and visible label. */
function connIndicator(
  connectionStatus: ConnectionStatus,
  paused: boolean,
): { dotClass: string; label: string } {
  // Local user action wins over stream state.
  if (paused) return { dotClass: 'paused', label: 'paused' };
  switch (connectionStatus) {
    case 'connecting':   return { dotClass: 'connecting',   label: 'connecting…' };
    case 'live':         return { dotClass: 'live',         label: 'live' };
    case 'reconnecting': return { dotClass: 'reconnecting', label: 'reconnecting…' };
    case 'ended':        return { dotClass: 'ended',        label: 'stream ended' };
    case 'error':        return { dotClass: 'error',        label: 'connection error' };
  }
}

/**
 * Returns true when the backend's latest timestamp is more than 2 hours
 * ahead of the newest reading the client holds — a sign the stream is lagging.
 */
function isStale(lastTimestamp: string | null, health: HealthResponse | null): boolean {
  if (!lastTimestamp || !health?.latestTimestamp) return false;
  const gapMs =
    new Date(health.latestTimestamp).getTime() - new Date(lastTimestamp).getTime();
  return gapMs > 2 * 60 * 60 * 1000;
}

export function Header({
  mode,
  onModeChange,
  canUseEngineerView,
  paused,
  onTogglePaused,
  sourceLabel,
  lastTimestamp,
  connectionStatus,
  health,
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
  connectionStatus: ConnectionStatus;
  health: HealthResponse | null;
  userName: string;
  role: string;
  onSignOut: () => void;
}) {
  const { dotClass, label } = connIndicator(connectionStatus, paused);
  const stale = isStale(lastTimestamp, health);

  return (
    <header className="header">
      <div className="header-title">
        <h1>Reid Library · Essential Systems</h1>
        <span className="source-label" title={sourceLabel}>
          {/* aria-hidden: colour dot is decorative; text label carries the meaning */}
          <span className={`live-dot live-dot--${dotClass}`} aria-hidden="true" />
          <span>{label}</span>
          {lastTimestamp && (
            <span className={stale ? 'conn-stale' : undefined}>
              {' · '}
              {new Date(lastTimestamp).toLocaleString()}
              {stale && ' · data may be behind'}
            </span>
          )}
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
