import { Header } from '@/components/Header';
import { EngineerView } from '@/components/EngineerView';
import { CommunityView } from '@/components/CommunityView';
import { AlertCenter } from '@/components/AlertCenter';
import { useMonitor } from '@/state/useMonitor';
import { useViewMode } from '@/state/ViewModeContext';

export default function App() {
  const monitor = useMonitor();
  const { mode, setMode } = useViewMode();

  return (
    <div className="app">
      <Header
        mode={mode}
        onModeChange={setMode}
        paused={monitor.paused}
        onTogglePaused={() => monitor.setPaused(!monitor.paused)}
        sourceLabel={monitor.sourceLabel}
        lastTimestamp={monitor.latest?.timestamp ?? null}
      />

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
    </div>
  );
}
