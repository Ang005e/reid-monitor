import { Header } from '@/components/Header';
import { EngineerView } from '@/components/EngineerView';
import { CommunityView } from '@/components/CommunityView';
import { AlertCenter } from '@/components/AlertCenter';
import { useMonitor } from '@/state/useMonitor';
import { useViewMode } from '@/state/ViewModeContext';

export default function App() {
  const monitor = useMonitor();
  const { mode, setMode } = useViewMode();

  // Determine main content area.
  let mainContent: React.ReactNode;

  if (monitor.loading && monitor.readings.length === 0) {
    mainContent = (
      <div className="loading-state">
        <div className="loading-spinner" aria-hidden="true" />
        <p className="loading-title">Connecting to Reid Library sensors…</p>
        <p className="hint">
          The server can take up to 30 seconds to wake from sleep — a slow first
          load is normal, not a fault. Hang tight.
        </p>
      </div>
    );
  } else if (monitor.loadError) {
    mainContent = (
      <div className="error-state">
        <p className="error-message">
          Could not load sensor history: {monitor.loadError}
        </p>
        <button className="btn" onClick={monitor.retryHistory}>
          Retry
        </button>
      </div>
    );
  } else {
    mainContent = (
      <main className="layout">
        <div className="layout-main">
          {mode === 'engineer' ? (
            <EngineerView monitor={monitor} />
          ) : (
            <CommunityView monitor={monitor} />
          )}
        </div>
        <aside className="layout-side">
          <AlertCenter
            alerts={monitor.alerts}
            onAcknowledge={monitor.acknowledgeAlert}
            notificationsReady={monitor.notificationsReady}
            onEnableNotifications={() => void monitor.enableNotifications()}
          />
        </aside>
      </main>
    );
  }

  return (
    <div className="app">
      <Header
        mode={mode}
        onModeChange={setMode}
        paused={monitor.paused}
        onTogglePaused={() => monitor.setPaused(!monitor.paused)}
        sourceLabel={monitor.sourceLabel}
        lastTimestamp={monitor.latest?.timestamp ?? null}
        connectionStatus={monitor.connectionStatus}
        health={monitor.health}
      />
      {mainContent}
    </div>
  );
}
